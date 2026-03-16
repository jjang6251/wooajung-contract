const { expect }                    = require("chai");
const { ethers }                    = require("hardhat");
const { loadFixture, time }         = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue }                  = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

// ── State enum (컨트랙트와 동일한 순서) ─────────────────────────
const State = {
  AWAITING_DEPOSIT:  0n,
  AWAITING_DELIVERY: 1n,
  DISPUTED:          2n,
  RELEASED:          3n,
  REFUNDED:          4n,
  CANCELLED:         5n,
};

const AMOUNT          = ethers.parseUnits("1000", 18);
const DEPOSIT_OFFSET  = 86400n; // 1일 (초)
const DISPUTE_WINDOW  = 7n * 24n * 60n * 60n; // 7일

// ── Fixture ──────────────────────────────────────────────────────
async function deployFixture() {
  const [owner, buyer, seller, other] = await ethers.getSigners();

  const Wusdt  = await ethers.getContractFactory("Wusdt");
  const wusdt  = await Wusdt.deploy(owner.address);

  const Escrow2 = await ethers.getContractFactory("Escrow2");
  const escrow  = await Escrow2.deploy(await wusdt.getAddress());

  await wusdt.mint(buyer.address, AMOUNT * 10n);
  await wusdt.connect(buyer).approve(await escrow.getAddress(), AMOUNT * 10n);

  return { escrow, wusdt, owner, buyer, seller, other };
}

// ── Helper ───────────────────────────────────────────────────────
async function createEscrow(escrow, buyer, seller) {
  const deadline = BigInt(await time.latest()) + DEPOSIT_OFFSET;
  const tx       = await escrow.connect(buyer).createEscrow(seller.address, AMOUNT, deadline);
  const receipt  = await tx.wait();
  const event    = receipt.logs.find((l) => l.fragment?.name === "EscrowCreated");
  return { escrowId: event.args[0], deadline };
}

async function createAndDeposit(escrow, buyer, seller) {
  const { escrowId, deadline } = await createEscrow(escrow, buyer, seller);
  await escrow.connect(buyer).deposit(escrowId);
  return { escrowId, deadline };
}

// ════════════════════════════════════════════════════════════════
describe("Escrow2", function () {

  // ── 1. createEscrow ──────────────────────────────────────────
  describe("createEscrow", function () {
    it("정상 생성 후 escrowId 반환 및 상태 확인", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createEscrow(escrow, buyer, seller);

      expect(escrowId).to.equal(0n);

      const deal = await escrow.getEscrow(escrowId);
      expect(deal.buyer).to.equal(buyer.address);
      expect(deal.seller).to.equal(seller.address);
      expect(deal.amount).to.equal(AMOUNT);
      expect(deal.state).to.equal(State.AWAITING_DEPOSIT);
    });

    it("EscrowCreated 이벤트 emit", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + DEPOSIT_OFFSET;

      await expect(
        escrow.connect(buyer).createEscrow(seller.address, AMOUNT, deadline)
      ).to.emit(escrow, "EscrowCreated")
        .withArgs(0n, buyer.address, seller.address, AMOUNT);
    });

    it("연속 생성 시 escrowId 증가", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId: id0 } = await createEscrow(escrow, buyer, seller);
      const { escrowId: id1 } = await createEscrow(escrow, buyer, seller);
      expect(id0).to.equal(0n);
      expect(id1).to.equal(1n);
    });

    it("InvalidAddress: seller가 zero address", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + DEPOSIT_OFFSET;
      await expect(
        escrow.connect(buyer).createEscrow(ethers.ZeroAddress, AMOUNT, deadline)
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
    });

    it("SameParty: buyer와 seller가 동일", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + DEPOSIT_OFFSET;
      await expect(
        escrow.connect(buyer).createEscrow(buyer.address, AMOUNT, deadline)
      ).to.be.revertedWithCustomError(escrow, "SameParty");
    });

    it("AmountZero: amount가 0", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + DEPOSIT_OFFSET;
      await expect(
        escrow.connect(buyer).createEscrow(seller.address, 0n, deadline)
      ).to.be.revertedWithCustomError(escrow, "AmountZero");
    });

    it("DeadlineInPast: deadline이 현재 시각 이하", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const past = BigInt(await time.latest()) - 1n;
      await expect(
        escrow.connect(buyer).createEscrow(seller.address, AMOUNT, past)
      ).to.be.revertedWithCustomError(escrow, "DeadlineInPast");
    });
  });

  // ── 2. deposit ───────────────────────────────────────────────
  describe("deposit", function () {
    it("정상 입금 후 상태 AWAITING_DELIVERY", async function () {
      const { escrow, wusdt, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createEscrow(escrow, buyer, seller);

      await expect(escrow.connect(buyer).deposit(escrowId))
        .to.emit(escrow, "FundsDeposited")
        .withArgs(escrowId, buyer.address, AMOUNT);

      expect(await escrow.getState(escrowId)).to.equal(State.AWAITING_DELIVERY);
      expect(await wusdt.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);
    });

    it("EscrowNotFound: 존재하지 않는 id", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(buyer).deposit(999n)
      ).to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });

    it("NotBuyer: seller가 호출", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createEscrow(escrow, buyer, seller);
      await expect(
        escrow.connect(seller).deposit(escrowId)
      ).to.be.revertedWithCustomError(escrow, "NotBuyer");
    });

    it("InvalidState: 이미 입금된 escrow에 재입금", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await expect(
        escrow.connect(buyer).deposit(escrowId)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("DepositDeadlinePassed: deadline 초과 후 입금 시도", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createEscrow(escrow, buyer, seller);
      await time.increase(DEPOSIT_OFFSET + 1n);
      await expect(
        escrow.connect(buyer).deposit(escrowId)
      ).to.be.revertedWithCustomError(escrow, "DepositDeadlinePassed");
    });
  });

  // ── 3. confirmDelivery ───────────────────────────────────────
  describe("confirmDelivery", function () {
    it("AWAITING_DELIVERY → RELEASED, 판매자에게 자금 지급", async function () {
      const { escrow, wusdt, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      const sellerBefore = await wusdt.balanceOf(seller.address);

      await expect(escrow.connect(buyer).confirmDelivery(escrowId))
        .to.emit(escrow, "FundsReleased")
        .withArgs(escrowId, seller.address, AMOUNT);

      expect(await escrow.getState(escrowId)).to.equal(State.RELEASED);
      expect(await wusdt.balanceOf(seller.address)).to.equal(sellerBefore + AMOUNT);
    });

    it("DISPUTED → RELEASED (분쟁 중 구매자 합의)", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await escrow.connect(buyer).openDispute(escrowId);

      await expect(escrow.connect(buyer).confirmDelivery(escrowId))
        .to.emit(escrow, "FundsReleased");

      expect(await escrow.getState(escrowId)).to.equal(State.RELEASED);
    });

    it("NotBuyer: seller가 호출", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await expect(
        escrow.connect(seller).confirmDelivery(escrowId)
      ).to.be.revertedWithCustomError(escrow, "NotBuyer");
    });

    it("InvalidState: RELEASED 상태에서 호출", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await escrow.connect(buyer).confirmDelivery(escrowId);
      await expect(
        escrow.connect(buyer).confirmDelivery(escrowId)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });
  });

  // ── 4. refund ────────────────────────────────────────────────
  describe("refund", function () {
    it("AWAITING_DELIVERY → REFUNDED, 구매자에게 반환", async function () {
      const { escrow, wusdt, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      const buyerBefore = await wusdt.balanceOf(buyer.address);

      await expect(escrow.connect(seller).refund(escrowId))
        .to.emit(escrow, "FundsRefunded")
        .withArgs(escrowId, buyer.address, AMOUNT);

      expect(await escrow.getState(escrowId)).to.equal(State.REFUNDED);
      expect(await wusdt.balanceOf(buyer.address)).to.equal(buyerBefore + AMOUNT);
    });

    it("DISPUTED → REFUNDED (분쟁 중 판매자 합의)", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await escrow.connect(seller).openDispute(escrowId);

      await expect(escrow.connect(seller).refund(escrowId))
        .to.emit(escrow, "FundsRefunded");

      expect(await escrow.getState(escrowId)).to.equal(State.REFUNDED);
    });

    it("NotSeller: buyer가 호출", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await expect(
        escrow.connect(buyer).refund(escrowId)
      ).to.be.revertedWithCustomError(escrow, "NotSeller");
    });

    it("InvalidState: AWAITING_DEPOSIT 상태에서 호출", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createEscrow(escrow, buyer, seller);
      await expect(
        escrow.connect(seller).refund(escrowId)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });
  });

  // ── 5. openDispute ───────────────────────────────────────────
  describe("openDispute", function () {
    it("구매자가 분쟁 제기 → DISPUTED, disputeDeadline 설정", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);

      await expect(escrow.connect(buyer).openDispute(escrowId))
        .to.emit(escrow, "DisputeOpened")
        .withArgs(escrowId, buyer.address, anyValue);

      expect(await escrow.getState(escrowId)).to.equal(State.DISPUTED);
      const deal = await escrow.getEscrow(escrowId);
      expect(deal.disputeDeadline).to.be.gt(0n);
    });

    it("판매자도 분쟁 제기 가능", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);

      await expect(escrow.connect(seller).openDispute(escrowId))
        .to.emit(escrow, "DisputeOpened")
        .withArgs(escrowId, seller.address, anyValue);

      expect(await escrow.getState(escrowId)).to.equal(State.DISPUTED);
    });

    it("NotParty: 제3자가 호출", async function () {
      const { escrow, buyer, seller, other } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await expect(
        escrow.connect(other).openDispute(escrowId)
      ).to.be.revertedWithCustomError(escrow, "NotParty");
    });

    it("InvalidState: AWAITING_DEPOSIT에서 호출", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createEscrow(escrow, buyer, seller);
      await expect(
        escrow.connect(buyer).openDispute(escrowId)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });
  });

  // ── 6. releaseFunds ──────────────────────────────────────────
  describe("releaseFunds", function () {
    it("타임락 초과 후 판매자가 수령 → RELEASED", async function () {
      const { escrow, wusdt, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await escrow.connect(buyer).openDispute(escrowId);

      await time.increase(DISPUTE_WINDOW + 1n);

      const sellerBefore = await wusdt.balanceOf(seller.address);
      await expect(escrow.connect(seller).releaseFunds(escrowId))
        .to.emit(escrow, "FundsReleased")
        .withArgs(escrowId, seller.address, AMOUNT);

      expect(await escrow.getState(escrowId)).to.equal(State.RELEASED);
      expect(await wusdt.balanceOf(seller.address)).to.equal(sellerBefore + AMOUNT);
    });

    it("NotSeller: buyer가 호출", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await escrow.connect(buyer).openDispute(escrowId);
      await time.increase(DISPUTE_WINDOW + 1n);

      await expect(
        escrow.connect(buyer).releaseFunds(escrowId)
      ).to.be.revertedWithCustomError(escrow, "NotSeller");
    });

    it("InvalidState: DISPUTED가 아닌 상태에서 호출", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await expect(
        escrow.connect(seller).releaseFunds(escrowId)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("DisputeWindowNotPassed: 타임락 미경과", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await escrow.connect(buyer).openDispute(escrowId);

      await expect(
        escrow.connect(seller).releaseFunds(escrowId)
      ).to.be.revertedWithCustomError(escrow, "DisputeWindowNotPassed");
    });
  });

  // ── 7. cancelEscrow ──────────────────────────────────────────
  describe("cancelEscrow", function () {
    it("입금 전 buyer가 취소 → CANCELLED", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createEscrow(escrow, buyer, seller);

      await expect(escrow.connect(buyer).cancelEscrow(escrowId))
        .to.emit(escrow, "EscrowCancelled")
        .withArgs(escrowId, buyer.address);

      expect(await escrow.getState(escrowId)).to.equal(State.CANCELLED);
    });

    it("입금 전 seller도 취소 가능", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createEscrow(escrow, buyer, seller);

      await expect(escrow.connect(seller).cancelEscrow(escrowId))
        .to.emit(escrow, "EscrowCancelled")
        .withArgs(escrowId, seller.address);
    });

    it("입금 후 depositDeadline 초과 시 buyer가 취소 → CANCELLED + 환불", async function () {
      const { escrow, wusdt, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId, deadline } = await createAndDeposit(escrow, buyer, seller);
      const buyerBefore = await wusdt.balanceOf(buyer.address);

      await time.increase(DEPOSIT_OFFSET + 1n);

      await expect(escrow.connect(buyer).cancelEscrow(escrowId))
        .to.emit(escrow, "EscrowCancelled")
        .withArgs(escrowId, buyer.address);

      expect(await escrow.getState(escrowId)).to.equal(State.CANCELLED);
      expect(await wusdt.balanceOf(buyer.address)).to.equal(buyerBefore + AMOUNT);
    });

    it("CancelNotAllowed: 입금 후 deadline 미경과 시 취소 불가", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);

      await expect(
        escrow.connect(buyer).cancelEscrow(escrowId)
      ).to.be.revertedWithCustomError(escrow, "CancelNotAllowed");
    });

    it("CancelNotAllowed: 입금 후 deadline 초과여도 seller는 취소 불가", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await time.increase(DEPOSIT_OFFSET + 1n);

      await expect(
        escrow.connect(seller).cancelEscrow(escrowId)
      ).to.be.revertedWithCustomError(escrow, "CancelNotAllowed");
    });

    it("NotParty: 제3자가 호출", async function () {
      const { escrow, buyer, seller, other } = await loadFixture(deployFixture);
      const { escrowId } = await createEscrow(escrow, buyer, seller);

      await expect(
        escrow.connect(other).cancelEscrow(escrowId)
      ).to.be.revertedWithCustomError(escrow, "NotParty");
    });

    it("InvalidState: RELEASED 상태에서 취소 불가", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await escrow.connect(buyer).confirmDelivery(escrowId);

      await expect(
        escrow.connect(buyer).cancelEscrow(escrowId)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });
  });

  // ── 8. setDisputeWindow ──────────────────────────────────────
  describe("setDisputeWindow", function () {
    it("owner가 3일로 변경", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      const newWindow = 3n * 24n * 60n * 60n;

      await expect(escrow.connect(owner).setDisputeWindow(newWindow))
        .to.emit(escrow, "DisputeWindowUpdated")
        .withArgs(DISPUTE_WINDOW, newWindow);

      expect(await escrow.disputeWindow()).to.equal(newWindow);
    });

    it("DisputeWindowOutOfRange: 1일 미만", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(owner).setDisputeWindow(60n)
      ).to.be.revertedWithCustomError(escrow, "DisputeWindowOutOfRange");
    });

    it("DisputeWindowOutOfRange: 30일 초과", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(owner).setDisputeWindow(31n * 24n * 60n * 60n)
      ).to.be.revertedWithCustomError(escrow, "DisputeWindowOutOfRange");
    });

    it("owner가 아니면 revert", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(buyer).setDisputeWindow(3n * 24n * 60n * 60n)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  // ── 9. getEscrow / getState ──────────────────────────────────
  describe("조회 함수", function () {
    it("EscrowNotFound: 없는 id로 getEscrow 호출", async function () {
      const { escrow } = await loadFixture(deployFixture);
      await expect(escrow.getEscrow(999n))
        .to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });

    it("EscrowNotFound: 없는 id로 getState 호출", async function () {
      const { escrow } = await loadFixture(deployFixture);
      await expect(escrow.getState(999n))
        .to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });
  });

  // ── 10. ETH 수신 차단 ────────────────────────────────────────
  describe("receive()", function () {
    it("ETH 전송 시 revert", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      await expect(
        buyer.sendTransaction({ to: await escrow.getAddress(), value: ethers.parseEther("1") })
      ).to.be.reverted;
    });
  });

  // ── 11. 가스비 측정 (Gas Report) ────────────────────────────
  describe("Gas Report", function () {
    it("createEscrow", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + DEPOSIT_OFFSET;
      await escrow.connect(buyer).createEscrow(seller.address, AMOUNT, deadline);
    });

    it("deposit", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createEscrow(escrow, buyer, seller);
      await escrow.connect(buyer).deposit(escrowId);
    });

    it("confirmDelivery", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await escrow.connect(buyer).confirmDelivery(escrowId);
    });

    it("refund", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await escrow.connect(seller).refund(escrowId);
    });

    it("openDispute", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await escrow.connect(buyer).openDispute(escrowId);
    });

    it("releaseFunds (타임락 후)", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await escrow.connect(buyer).openDispute(escrowId);
      await time.increase(DISPUTE_WINDOW + 1n);
      await escrow.connect(seller).releaseFunds(escrowId);
    });

    it("cancelEscrow (입금 전)", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createEscrow(escrow, buyer, seller);
      await escrow.connect(buyer).cancelEscrow(escrowId);
    });

    it("cancelEscrow (deadline 후)", async function () {
      const { escrow, buyer, seller } = await loadFixture(deployFixture);
      const { escrowId } = await createAndDeposit(escrow, buyer, seller);
      await time.increase(DEPOSIT_OFFSET + 1n);
      await escrow.connect(buyer).cancelEscrow(escrowId);
    });

    it("setDisputeWindow", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      await escrow.connect(owner).setDisputeWindow(3n * 24n * 60n * 60n);
    });
  });
});

