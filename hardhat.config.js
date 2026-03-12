require("@nomicfoundation/hardhat-toolbox")
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
};
