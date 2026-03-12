// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}        from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}          from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard}  from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Escrow
 * @notice WUSDT 기반 탈중앙화 에스크로 (중재자 없음, 수수료 없음)
 *
 * ── 정상 흐름 ──────────────────────────────────────────────
 *  createEscrow → deposit → confirmDelivery → [RELEASED]
 *                         → refund (판매자 동의) → [REFUNDED]
 *
 * ── 분쟁 흐름 ──────────────────────────────────────────────
 *  openDispute (구매자 or 판매자)
 *    ├─ agreeToRefund  (판매자) → [REFUNDED]   구매자 환불
 *    ├─ confirmDelivery (구매자) → [RELEASED]  판매자 지급
 *    └─ 타임락 초과 후 releaseFunds (판매자) → [RELEASED]  자동 지급
 *
 * ── 취소 ────────────────────────────────────────────────────
 *  입금 전 : cancelEscrow (양측)
 *  입금 후 : cancelEscrow (구매자, depositDeadline 초과 시만)
 */
contract Escrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ───────────────────────────────────────────────
    //  Enums & Structs
    // ───────────────────────────────────────────────

    enum State {
        AWAITING_DEPOSIT,   // 0: 생성됨, 입금 대기
        AWAITING_DELIVERY,  // 1: 입금 완료, 이행 대기
        DISPUTED,           // 2: 분쟁 발생
        RELEASED,           // 3: 판매자에게 지급 완료
        REFUNDED,           // 4: 구매자에게 환불 완료
        CANCELLED           // 5: 거래 취소
    }

    struct EscrowDeal {
        uint256 id;
        address buyer;
        address seller;
        uint256 amount;           // WUSDT 예치 수량
        State   state;
        uint256 createdAt;
        uint256 depositDeadline;  // 입금 마감 시간 (Unix timestamp)
        uint256 disputeDeadline;  // 분쟁 타임락 — 초과 시 판매자 자동 지급
        string  description;
    }

    // ───────────────────────────────────────────────
    //  State Variables
    // ───────────────────────────────────────────────

    IERC20  public immutable wusdt;
    uint256 public nextEscrowId;

    /// @notice 분쟁 발생 후 합의 없을 시 판매자 자동 지급까지의 대기 시간
    uint256 public disputeWindow = 7 days;

    mapping(uint256 => EscrowDeal) public escrows;
    mapping(address => uint256[])  public userEscrows;

    // ───────────────────────────────────────────────
    //  Events
    // ───────────────────────────────────────────────

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        string  description
    );
    event FundsDeposited(uint256 indexed escrowId, address indexed buyer,  uint256 amount);
    event FundsReleased (uint256 indexed escrowId, address indexed seller, uint256 amount);
    event FundsRefunded (uint256 indexed escrowId, address indexed buyer,  uint256 amount);
    event DisputeOpened (uint256 indexed escrowId, address indexed openedBy, uint256 disputeDeadline);
    event EscrowCancelled(uint256 indexed escrowId, address indexed cancelledBy);
    event DisputeWindowUpdated(uint256 oldWindow, uint256 newWindow);

    // ───────────────────────────────────────────────
    //  Modifiers
    // ───────────────────────────────────────────────

    modifier escrowExists(uint256 _id) {
        require(_id < nextEscrowId, "Escrow: does not exist");
        _;
    }

    modifier onlyBuyer(uint256 _id) {
        require(msg.sender == escrows[_id].buyer, "Escrow: caller is not buyer");
        _;
    }

    modifier onlySeller(uint256 _id) {
        require(msg.sender == escrows[_id].seller, "Escrow: caller is not seller");
        _;
    }

    modifier onlyParties(uint256 _id) {
        require(
            msg.sender == escrows[_id].buyer || msg.sender == escrows[_id].seller,
            "Escrow: caller is not a party"
        );
        _;
    }

    modifier inState(uint256 _id, State _state) {
        require(escrows[_id].state == _state, "Escrow: invalid state");
        _;
    }

    // ───────────────────────────────────────────────
    //  Constructor
    // ───────────────────────────────────────────────

    constructor(address _wusdt) Ownable(msg.sender) {
        require(_wusdt != address(0), "Escrow: invalid WUSDT address");
        wusdt = IERC20(_wusdt);
    }

    // ───────────────────────────────────────────────
    //  1. 거래 생성 (createEscrow)
    // ───────────────────────────────────────────────

    /**
     * @notice 새로운 에스크로 거래를 생성합니다.
     * @param _seller          판매자 주소
     * @param _amount          예치할 WUSDT 수량
     * @param _depositDeadline 입금 마감 시간 (Unix timestamp)
     * @param _description     거래 설명
     */
    function createEscrow(
        address _seller,
        uint256 _amount,
        uint256 _depositDeadline,
        string calldata _description
    ) external returns (uint256 escrowId) {
        require(_seller != address(0),       "Escrow: invalid seller address");
        require(_seller != msg.sender,       "Escrow: buyer and seller cannot be the same");
        require(_amount > 0,                 "Escrow: amount must be greater than 0");
        require(_depositDeadline > block.timestamp, "Escrow: deposit deadline must be in the future");

        escrowId = nextEscrowId++;

        EscrowDeal storage deal = escrows[escrowId];
        deal.id              = escrowId;
        deal.buyer           = msg.sender;
        deal.seller          = _seller;
        deal.amount          = _amount;
        deal.state           = State.AWAITING_DEPOSIT;
        deal.createdAt       = block.timestamp;
        deal.depositDeadline = _depositDeadline;
        deal.disputeDeadline = 0;
        deal.description     = _description;

        userEscrows[msg.sender].push(escrowId);
        userEscrows[_seller].push(escrowId);

        emit EscrowCreated(escrowId, msg.sender, _seller, _amount, _description);
    }

    // ───────────────────────────────────────────────
    //  2. 자금 예치 (deposit)
    //  ※ 사전에 wusdt.approve(escrowAddress, amount) 필요
    // ───────────────────────────────────────────────

    /**
     * @notice 구매자가 WUSDT를 에스크로에 예치합니다.
     * @dev    호출 전 wusdt.approve(address(this), amount) 필수
     */
    function deposit(uint256 _id)
        external
        nonReentrant
        escrowExists(_id)
        onlyBuyer(_id)
        inState(_id, State.AWAITING_DEPOSIT)
    {
        EscrowDeal storage deal = escrows[_id];
        require(block.timestamp <= deal.depositDeadline, "Escrow: deposit deadline has passed");

        deal.state = State.AWAITING_DELIVERY;

        wusdt.safeTransferFrom(msg.sender, address(this), deal.amount);

        emit FundsDeposited(_id, msg.sender, deal.amount);
    }

    // ───────────────────────────────────────────────
    //  3. 거래 상태 조회
    // ───────────────────────────────────────────────

    function getState(uint256 _id)
        external view escrowExists(_id) returns (State)
    {
        return escrows[_id].state;
    }

    function getEscrow(uint256 _id)
        external view escrowExists(_id) returns (EscrowDeal memory)
    {
        return escrows[_id];
    }

    function getUserEscrows(address _user) external view returns (uint256[] memory) {
        return userEscrows[_user];
    }

    // ───────────────────────────────────────────────
    //  4. 거래 승인 (confirmDelivery) — 구매자
    //     정상 흐름 및 분쟁 중 구매자 합의 모두 처리
    // ───────────────────────────────────────────────

    /**
     * @notice 구매자가 이행 완료를 확인합니다.
     *         AWAITING_DELIVERY 또는 DISPUTED 상태에서 호출 가능하며,
     *         즉시 판매자에게 WUSDT가 지급됩니다.
     */
    function confirmDelivery(uint256 _id)
        external
        nonReentrant
        escrowExists(_id)
        onlyBuyer(_id)
    {
        State s = escrows[_id].state;
        require(
            s == State.AWAITING_DELIVERY || s == State.DISPUTED,
            "Escrow: cannot confirm in current state"
        );

        _releaseFunds(_id);
    }

    // ───────────────────────────────────────────────
    //  5. 자금 지급 (releaseFunds) — 타임락 자동 지급
    //     분쟁 후 disputeWindow 초과 시 판매자가 호출
    // ───────────────────────────────────────────────

    /**
     * @notice 분쟁 발생 후 disputeWindow 기간이 지나도록 구매자가
     *         confirmDelivery를 하지 않으면 판매자가 이 함수로 자금을 수령합니다.
     */
    function releaseFunds(uint256 _id)
        external
        nonReentrant
        escrowExists(_id)
        onlySeller(_id)
        inState(_id, State.DISPUTED)
    {
        EscrowDeal storage deal = escrows[_id];
        require(
            block.timestamp > deal.disputeDeadline,
            "Escrow: dispute window has not passed yet"
        );

        _releaseFunds(_id);
    }

    // ───────────────────────────────────────────────
    //  6. 환불 (refund) — 판매자 동의
    //     정상 흐름 및 분쟁 중 판매자 합의 모두 처리
    // ───────────────────────────────────────────────

    /**
     * @notice 판매자가 환불에 동의합니다.
     *         AWAITING_DELIVERY 또는 DISPUTED 상태에서 호출 가능하며,
     *         즉시 구매자에게 WUSDT가 반환됩니다.
     */
    function refund(uint256 _id)
        external
        nonReentrant
        escrowExists(_id)
        onlySeller(_id)
    {
        State s = escrows[_id].state;
        require(
            s == State.AWAITING_DELIVERY || s == State.DISPUTED,
            "Escrow: cannot refund in current state"
        );

        _refundBuyer(_id);
    }

    // ───────────────────────────────────────────────
    //  7. 분쟁 발생 (openDispute)
    // ───────────────────────────────────────────────

    /**
     * @notice 구매자 또는 판매자가 분쟁을 제기합니다.
     *         분쟁 발생 시점부터 disputeWindow 후에는
     *         판매자가 releaseFunds로 자동 수령 가능합니다.
     */
    function openDispute(uint256 _id)
        external
        escrowExists(_id)
        onlyParties(_id)
        inState(_id, State.AWAITING_DELIVERY)
    {
        EscrowDeal storage deal = escrows[_id];
        deal.state           = State.DISPUTED;
        deal.disputeDeadline = block.timestamp + disputeWindow;

        emit DisputeOpened(_id, msg.sender, deal.disputeDeadline);
    }

    // ───────────────────────────────────────────────
    //  8. 거래 취소 (cancelEscrow)
    // ───────────────────────────────────────────────

    /**
     * @notice 입금 전(AWAITING_DEPOSIT)이면 양측 모두 취소 가능.
     *         입금 후(AWAITING_DELIVERY)에는 depositDeadline 초과 시
     *         구매자만 취소 가능하며 WUSDT가 반환됩니다.
     */
    function cancelEscrow(uint256 _id)
        external
        nonReentrant
        escrowExists(_id)
        onlyParties(_id)
    {
        EscrowDeal storage deal = escrows[_id];

        if (deal.state == State.AWAITING_DEPOSIT) {
            deal.state = State.CANCELLED;
            emit EscrowCancelled(_id, msg.sender);

        } else if (deal.state == State.AWAITING_DELIVERY) {
            require(
                msg.sender == deal.buyer && block.timestamp > deal.depositDeadline,
                "Escrow: only buyer can cancel after deposit deadline"
            );
            deal.state = State.CANCELLED;
            wusdt.safeTransfer(deal.buyer, deal.amount);
            emit EscrowCancelled(_id, msg.sender);

        } else {
            revert("Escrow: cannot cancel in current state");
        }
    }

    // ───────────────────────────────────────────────
    //  Admin — disputeWindow 조정
    // ───────────────────────────────────────────────

    /**
     * @notice 분쟁 타임락 기간을 변경합니다. (기본값: 7일)
     * @param _newWindow 새로운 분쟁 윈도우 (초 단위)
     */
    function setDisputeWindow(uint256 _newWindow) external onlyOwner {
        require(_newWindow >= 1 days && _newWindow <= 30 days, "Escrow: window out of range");
        emit DisputeWindowUpdated(disputeWindow, _newWindow);
        disputeWindow = _newWindow;
    }

    // ───────────────────────────────────────────────
    //  Internal helpers
    // ───────────────────────────────────────────────

    function _releaseFunds(uint256 _id) internal {
        EscrowDeal storage deal = escrows[_id];
        deal.state = State.RELEASED;
        wusdt.safeTransfer(deal.seller, deal.amount);
        emit FundsReleased(_id, deal.seller, deal.amount);
    }

    function _refundBuyer(uint256 _id) internal {
        EscrowDeal storage deal = escrows[_id];
        deal.state = State.REFUNDED;
        wusdt.safeTransfer(deal.buyer, deal.amount);
        emit FundsRefunded(_id, deal.buyer, deal.amount);
    }

    // ───────────────────────────────────────────────
    //  Fallback — ETH 수신 차단
    // ───────────────────────────────────────────────

    receive() external payable {
        revert("Escrow: ETH not accepted. Use WUSDT");
    }
}
