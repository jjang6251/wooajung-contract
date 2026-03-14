const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Escrow - Gas Report", function () {
  let escrow, wusdt;
  let buyer, seller, owner;

  const AMOUNT = ethers.parseUnits("1000", 18);
  const DEADLINE_OFFSET = 86400; // 1일

  async function getFutureDeadline(offset = DEADLINE_OFFSET) {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + offset;
  }

  beforeEach(async () => {
    [owner, buyer, seller] = await ethers.getSigners();

    // Mock WUSDT 배포 (initialOwner 필요)
    const MockERC20 = await ethers.getContractFactory("Wusdt");
    wusdt = await MockERC20.deploy(owner.address);

    // Escrow 배포
    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.deploy(await wusdt.getAddress());

    // buyer에게 WUSDT 지급 및 approve
    await wusdt.mint(buyer.address, AMOUNT * 10n);
    await wusdt.connect(buyer).approve(await escrow.getAddress(), AMOUNT * 10n);
  });

  // ── 헬퍼: 거래 생성 + 입금까지 ──────────────────────────
  async function createAndDeposit() {
    const deadline = await getFutureDeadline();
    const tx = await escrow.connect(buyer).createEscrow(
      seller.address, AMOUNT, deadline, "test deal"
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(
      (log) => log.fragment?.name === "EscrowCreated"
    );
    const escrowId = event.args[0];
    await escrow.connect(buyer).deposit(escrowId);
    return escrowId;
  }

  // ── 1. createEscrow ──────────────────────────────────────
  it("createEscrow", async () => {
    const deadline = await getFutureDeadline();
    await escrow.connect(buyer).createEscrow(
      seller.address, AMOUNT, deadline, "test deal"
    );
  });

  // ── 2. deposit ───────────────────────────────────────────
  it("deposit", async () => {
    const deadline = await getFutureDeadline();
    await escrow.connect(buyer).createEscrow(
      seller.address, AMOUNT, deadline, "test deal"
    );
    await escrow.connect(buyer).deposit(0);
  });

  // ── 3. confirmDelivery ───────────────────────────────────
  it("confirmDelivery", async () => {
    const id = await createAndDeposit();
    await escrow.connect(buyer).confirmDelivery(id);
  });

  // ── 4. refund ────────────────────────────────────────────
  it("refund", async () => {
    const id = await createAndDeposit();
    await escrow.connect(seller).refund(id);
  });

  // ── 5. openDispute ───────────────────────────────────────
  it("openDispute", async () => {
    const id = await createAndDeposit();
    await escrow.connect(buyer).openDispute(id);
  });

  // ── 6. releaseFunds (타임락 후) ──────────────────────────
  it("releaseFunds (after dispute timelok)", async () => {
    const id = await createAndDeposit();
    await escrow.connect(buyer).openDispute(id);

    // 7일 경과 시뮬레이션
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine");

    await escrow.connect(seller).releaseFunds(id);
  });

  // ── 7. cancelEscrow (입금 전) ────────────────────────────
  it("cancelEscrow (before deposit)", async () => {
    const deadline = await getFutureDeadline();
    await escrow.connect(buyer).createEscrow(
      seller.address, AMOUNT, deadline, "test deal"
    );
    await escrow.connect(buyer).cancelEscrow(0);
  });

  // ── 8. cancelEscrow (데드라인 초과) ─────────────────────
  it("cancelEscrow (after deadline)", async () => {
    const id = await createAndDeposit();
    await ethers.provider.send("evm_increaseTime", [DEADLINE_OFFSET + 1]);
    await ethers.provider.send("evm_mine");
    await escrow.connect(buyer).cancelEscrow(id);
  });

  // ── 9. setDisputeWindow ──────────────────────────────────
  it("setDisputeWindow", async () => {
    await escrow.connect(owner).setDisputeWindow(3 * 24 * 60 * 60); // 3일
  });
});