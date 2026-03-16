## Methods
| **Symbol** | **Meaning**                                                                              |
| :--------: | :--------------------------------------------------------------------------------------- |
|    **◯**   | Execution gas for this method does not include intrinsic gas overhead                    |
|    **△**   | Cost was non-zero but below the precision setting for the currency display (see options) |

|                           |    Min |     Max |     Avg | Calls | usd avg |
| :------------------------ | -----: | ------: | ------: | ----: | ------: |
| **Escrow2**               |        |         |         |       |         |
|        *cancelEscrow*     | 33,073 |  46,557 |  38,164 |     8 |       - |
|        *confirmDelivery*  | 63,847 |  63,887 |  63,858 |     7 |       - |
|        *createEscrow*     | 96,244 | 113,344 | 112,900 |    77 |       - |
|        *deposit*          |      - |       - |  74,262 |    27 |       - |
|        *openDispute*      | 36,172 |  36,309 |  36,209 |    11 |       - |
|        *refund*           | 46,791 |  46,831 |  46,807 |     5 |       - |
|        *releaseFunds*     |      - |       - |  63,943 |     3 |       - |
|        *setDisputeWindow* |      - |       - |  30,027 |     3 |       - |
| **Wusdt**                 |        |         |         |       |         |
|        *approve*          |      - |       - |  46,413 |     1 |       - |
|        *mint*             |      - |       - |  53,570 |     1 |       - |

## Deployments
|             | Min | Max  |       Avg | Block % | usd avg |
| :---------- | --: | ---: | --------: | ------: | ------: |
| **Escrow2** |   - |    - | 1,244,931 |   2.1 % |       - |
| **Wusdt**   |   - |    - | 1,094,410 |   1.8 % |       - |

## Solidity and Network Config
| **Settings**        | **Value**  |
| ------------------- | ---------- |
| Solidity: version   | 0.8.28     |
| Solidity: optimized | true       |
| Solidity: runs      | 200        |
| Solidity: viaIR     | false      |
| Block Limit         | 60,000,000 |
| Gas Price           | -          |
| Token Price         | -          |
| Network             | ETHEREUM   |
| Toolchain           | hardhat    |

