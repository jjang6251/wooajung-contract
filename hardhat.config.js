require("@nomicfoundation/hardhat-toolbox")
require("hardhat-gas-reporter");
require("dotenv").config();

const DEFAULT_COMPILER_SETTINGS = {
  version: "0.8.28",
  settings: {
    evmVersion: "cancun",
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
};

module.exports = {
  solidity: DEFAULT_COMPILER_SETTINGS,

  networks: { 
    hardhat: {
      chainId: 31337,
      hardfork: "cancun",
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 11155111,
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD", //USD 환산 표시
    coinmarketcap: process.env.CMC_API, // CMC API키 있으면 실시간 ETH 가격을 반영
    reportFormat: "markdown",
    outputFile: "gas-report.md", // 마크다운으로 저장 → GitHub/에디터에서 보기 좋게 렌더링됨
    noColors: true, //파일 저장 시 색상 코드 제거
    token: "ETH"
  }
};