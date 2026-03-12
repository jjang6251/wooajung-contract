const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Wusdt", function () {
  async function deployWusdtFixture() {
    const [owner, alice, bob] = await ethers.getSigners();

    const Wusdt = await ethers.getContractFactory("Wusdt");
    const wusdt = await Wusdt.deploy(owner.address);
    await wusdt.waitForDeployment();

    return { wusdt, owner, alice, bob };
  }

  it("배포 시 초기 공급량이 owner에게 들어가야 한다", async function () {
    const { wusdt, owner } = await deployWusdtFixture();

    const totalSupply = await wusdt.totalSupply();
    const ownerBalance = await wusdt.balanceOf(owner.address);

    expect(ownerBalance).to.equal(totalSupply);
    expect(await wusdt.decimals()).to.equal(6);
  });

  it("owner는 mint할 수 있어야 한다", async function () {
    const { wusdt, owner, alice } = await deployWusdtFixture();

    const mintAmount = ethers.parseUnits("1000", 6);

    await wusdt.mint(alice.address, mintAmount);

    const aliceBalance = await wusdt.balanceOf(alice.address);
    expect(aliceBalance).to.equal(mintAmount);
  });

  it("owner가 아닌 사용자는 mint할 수 없어야 한다", async function () {
    const { wusdt, alice, bob } = await deployWusdtFixture();

    const mintAmount = ethers.parseUnits("1000", 6);

    await expect(
      wusdt.connect(alice).mint(bob.address, mintAmount)
    ).to.be.reverted;
  });

  it("사용자 간 transfer가 가능해야 한다", async function () {
    const { wusdt, owner, alice } = await deployWusdtFixture();

    const transferAmount = ethers.parseUnits("500", 6);
    await wusdt.transfer(alice.address, transferAmount);

    const aliceBalance = await wusdt.balanceOf(alice.address);
    expect(aliceBalance).to.equal(transferAmount);
  });

  it("approve 후 transferFrom이 가능해야 한다", async function () {
    const { wusdt, owner, alice, bob } = await deployWusdtFixture();

    const approveAmount = ethers.parseUnits("300", 6);

    await wusdt.transfer(alice.address, approveAmount);
    await wusdt.connect(alice).approve(bob.address, approveAmount);

    await wusdt
      .connect(bob)
      .transferFrom(alice.address, bob.address, approveAmount);

    const bobBalance = await wusdt.balanceOf(bob.address);
    expect(bobBalance).to.equal(approveAmount);
  });

  it("잔액이 부족하면 transfer가 실패해야 한다", async function () {
    const { wusdt, alice, bob } = await deployWusdtFixture();

    const transferAmount = ethers.parseUnits("100", 6);

    await expect(
      wusdt.connect(alice).transfer(bob.address, transferAmount)
    ).to.be.reverted;
  });
});