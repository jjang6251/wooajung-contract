// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}        from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}          from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard}  from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Escrow2
 * @notice WUSDT 기반 탈중앙화 에스크로 — 가스비 최적화 버전
 *
 * [escrow.sol 대비 변경사항]
 *  1. Struct 슬롯 패킹: 8+ slot → 3 slot
 *     - id, createdAt 제거 (중복/미사용)
 *     - description 제거 → EscrowCreated 이벤트에서만 emit
 *     - 타임스탬프를 uint48로 축소 (충분)
 *     - buyer+depositDeadline+disputeDeadline → slot 0 (32B)
 *     - seller+state                          → slot 1
 *     - amount                                → slot 2
 *  2. require 문자열 → Custom Error (revert 비용 절감)
 *  3. userEscrows 배열 제거 → EscrowCreated indexed 이벤트로 오프체인 조회
 *  4. 함수 내 deal 단일 로드 → modifier 체인의 중복 SLOAD 제거
 *
 * ── 정상 흐름 ────────────────────────────────────────────────
 *  createEscrow → deposit → confirmDelivery → [RELEASED]
 *                          → refund (판매자 동의) → [REFUNDED]
 *
 * ── 분쟁 흐름 ────────────────────────────────────────────────
 *  openDispute (구매자 or 판매자)
 *    ├─ refund         (판매자) → [REFUNDED]
 *    ├─ confirmDelivery (구매자) → [RELEASED]
 *    └─ releaseFunds   (판매자, 타임락 초과 후) → [RELEASED]
 *
 * ── 취소 ─────────────────────────────────────────────────────
 *  입금 전 : cancelEscrow (양측)
 *  입금 후 : cancelEscrow (구매자, depositDeadline 초과 시만)
 */
contract Escrow2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ───────────────────────────────────────────────
    //  Enums & Structs
    // ───────────────────────────────────────────────

    enum State {
        AWAITING_DEPOSIT,   // 0
        AWAITING_DELIVERY,  // 1
        DISPUTED,           // 2
        RELEASED,           // 3
        REFUNDED,           // 4
        CANCELLED           // 5
    }

    /// @dev 3 storage slots (기존 8+ slots)
    struct EscrowDeal {
        // slot 0: 20 + 6 + 6 = 32 bytes
        address buyer;
        uint48  depositDeadline;
        uint48  disputeDeadline;
        // slot 1: 20 + 1 = 21 bytes
        address seller;
        State   state;
        // slot 2: 32 bytes
        uint256 amount;
    }

    // ───────────────────────────────────────────────
    //  Custom Errors
    // ───────────────────────────────────────────────

    error EscrowNotFound();
    error NotBuyer();
    error NotSeller();
    error NotParty();
    error InvalidState();
    error InvalidAddress();
    error SameParty();
    error AmountZero();
    error DeadlineInPast();
    error DepositDeadlinePassed();
    error DisputeWindowNotPassed();
    error DisputeWindowOutOfRange();
    error CancelNotAllowed();

    // ───────────────────────────────────────────────
    //  State Variables
    // ───────────────────────────────────────────────

    IERC20  public immutable wusdt;
    uint256 public nextEscrowId;

    /// @notice 분쟁 발생 후 판매자 자동 지급까지의 대기 시간 (기본 7일)
    uint256 public disputeWindow = 7 days;

    mapping(uint256 => EscrowDeal) public escrows;

    // ───────────────────────────────────────────────
    //  Events
    //  buyer/seller indexed → 오프체인에서 getUserEscrows 대체
    // ───────────────────────────────────────────────

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed seller,
        uint256 amount
    );
    event FundsDeposited(uint256 indexed escrowId, address indexed buyer,  uint256 amount);
    event FundsReleased (uint256 indexed escrowId, address indexed seller, uint256 amount);
    event FundsRefunded (uint256 indexed escrowId, address indexed buyer,  uint256 amount);
    event DisputeOpened (uint256 indexed escrowId, address indexed openedBy, uint256 disputeDeadline);
    event EscrowCancelled(uint256 indexed escrowId, address indexed cancelledBy);
    event DisputeWindowUpdated(uint256 oldWindow, uint256 newWindow);

    // ───────────────────────────────────────────────
    //  Constructor
    // ───────────────────────────────────────────────

    constructor(address _wusdt) Ownable(msg.sender) {
        if (_wusdt == address(0)) revert InvalidAddress();
        wusdt = IERC20(_wusdt);
    }

    // ───────────────────────────────────────────────
    //  1. 거래 생성 (createEscrow)
    // ───────────────────────────────────────────────

    function createEscrow(
        address _seller,
        uint256 _amount,
        uint256 _depositDeadline
    ) external returns (uint256 escrowId) {
        if (_seller == address(0))              revert InvalidAddress();
        if (_seller == msg.sender)              revert SameParty();
        if (_amount == 0)                       revert AmountZero();
        if (_depositDeadline <= block.timestamp) revert DeadlineInPast();

        escrowId = nextEscrowId++;

        EscrowDeal storage deal = escrows[escrowId];
        deal.buyer           = msg.sender;
        deal.seller          = _seller;
        deal.amount          = _amount;
        deal.depositDeadline = uint48(_depositDeadline);
        // state      → AWAITING_DEPOSIT (0, 기본값)
        // disputeDeadline → 0 (기본값)

        emit EscrowCreated(escrowId, msg.sender, _seller, _amount);
    }

    // ───────────────────────────────────────────────
    //  2. 자금 예치 (deposit)
    // ───────────────────────────────────────────────

    function deposit(uint256 _id) external nonReentrant {
        EscrowDeal storage deal = escrows[_id];
        if (deal.buyer == address(0))                revert EscrowNotFound();
        if (msg.sender != deal.buyer)                revert NotBuyer();
        if (deal.state != State.AWAITING_DEPOSIT)    revert InvalidState();
        if (block.timestamp > deal.depositDeadline)  revert DepositDeadlinePassed();

        deal.state = State.AWAITING_DELIVERY;
        wusdt.safeTransferFrom(msg.sender, address(this), deal.amount);
        emit FundsDeposited(_id, msg.sender, deal.amount);
    }

    // ───────────────────────────────────────────────
    //  3. 거래 상태 조회
    // ───────────────────────────────────────────────

    function getState(uint256 _id) external view returns (State) {
        if (escrows[_id].buyer == address(0)) revert EscrowNotFound();
        return escrows[_id].state;
    }

    function getEscrow(uint256 _id) external view returns (EscrowDeal memory) {
        if (escrows[_id].buyer == address(0)) revert EscrowNotFound();
        return escrows[_id];
    }

    // ───────────────────────────────────────────────
    //  4. 거래 승인 (confirmDelivery) — 구매자
    // ───────────────────────────────────────────────

    function confirmDelivery(uint256 _id) external nonReentrant {
        EscrowDeal storage deal = escrows[_id];
        if (deal.buyer == address(0)) revert EscrowNotFound();
        if (msg.sender != deal.buyer) revert NotBuyer();
        State s = deal.state;
        if (s != State.AWAITING_DELIVERY && s != State.DISPUTED) revert InvalidState();

        _releaseFunds(_id, deal);
    }

    // ───────────────────────────────────────────────
    //  5. 자금 지급 (releaseFunds) — 타임락 자동 지급
    // ───────────────────────────────────────────────

    function releaseFunds(uint256 _id) external nonReentrant {
        EscrowDeal storage deal = escrows[_id];
        if (deal.buyer == address(0))               revert EscrowNotFound();
        if (msg.sender != deal.seller)              revert NotSeller();
        if (deal.state != State.DISPUTED)           revert InvalidState();
        if (block.timestamp <= deal.disputeDeadline) revert DisputeWindowNotPassed();

        _releaseFunds(_id, deal);
    }

    // ───────────────────────────────────────────────
    //  6. 환불 (refund) — 판매자 동의
    // ───────────────────────────────────────────────

    function refund(uint256 _id) external nonReentrant {
        EscrowDeal storage deal = escrows[_id];
        if (deal.buyer == address(0))  revert EscrowNotFound();
        if (msg.sender != deal.seller) revert NotSeller();
        State s = deal.state;
        if (s != State.AWAITING_DELIVERY && s != State.DISPUTED) revert InvalidState();

        _refundBuyer(_id, deal);
    }

    // ───────────────────────────────────────────────
    //  7. 분쟁 발생 (openDispute)
    // ───────────────────────────────────────────────

    function openDispute(uint256 _id) external {
        EscrowDeal storage deal = escrows[_id];
        if (deal.buyer == address(0))                  revert EscrowNotFound();
        if (msg.sender != deal.buyer && msg.sender != deal.seller) revert NotParty();
        if (deal.state != State.AWAITING_DELIVERY)     revert InvalidState();

        uint48 deadline      = uint48(block.timestamp + disputeWindow);
        deal.state           = State.DISPUTED;
        deal.disputeDeadline = deadline;

        emit DisputeOpened(_id, msg.sender, deadline);
    }

    // ───────────────────────────────────────────────
    //  8. 거래 취소 (cancelEscrow)
    // ───────────────────────────────────────────────

    function cancelEscrow(uint256 _id) external nonReentrant {
        EscrowDeal storage deal = escrows[_id];
        if (deal.buyer == address(0))                              revert EscrowNotFound();
        if (msg.sender != deal.buyer && msg.sender != deal.seller) revert NotParty();

        State s = deal.state;

        if (s == State.AWAITING_DEPOSIT) {
            deal.state = State.CANCELLED;
            emit EscrowCancelled(_id, msg.sender);

        } else if (s == State.AWAITING_DELIVERY) {
            if (msg.sender != deal.buyer || block.timestamp <= deal.depositDeadline) {
                revert CancelNotAllowed();
            }
            deal.state = State.CANCELLED;
            wusdt.safeTransfer(deal.buyer, deal.amount);
            emit EscrowCancelled(_id, msg.sender);

        } else {
            revert InvalidState();
        }
    }

    // ───────────────────────────────────────────────
    //  Admin — disputeWindow 조정
    // ───────────────────────────────────────────────

    function setDisputeWindow(uint256 _newWindow) external onlyOwner {
        if (_newWindow < 1 days || _newWindow > 30 days) revert DisputeWindowOutOfRange();
        emit DisputeWindowUpdated(disputeWindow, _newWindow);
        disputeWindow = _newWindow;
    }

    // ───────────────────────────────────────────────
    //  Internal helpers
    // ───────────────────────────────────────────────

    function _releaseFunds(uint256 _id, EscrowDeal storage deal) internal {
        deal.state = State.RELEASED;
        wusdt.safeTransfer(deal.seller, deal.amount);
        emit FundsReleased(_id, deal.seller, deal.amount);
    }

    function _refundBuyer(uint256 _id, EscrowDeal storage deal) internal {
        deal.state = State.REFUNDED;
        wusdt.safeTransfer(deal.buyer, deal.amount);
        emit FundsRefunded(_id, deal.buyer, deal.amount);
    }

    // ───────────────────────────────────────────────
    //  Fallback — ETH 수신 차단
    // ───────────────────────────────────────────────

    receive() external payable {
        revert("Escrow: ETH not accepted");
    }
}
