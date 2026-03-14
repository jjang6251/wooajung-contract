## Methods


| **Symbol** | **Meaning**                                                                              |
| ---------- | ---------------------------------------------------------------------------------------- |
| **◯**      | Execution gas for this method does not include intrinsic gas overhead                    |
| **△**      | Cost was non-zero but below the precision setting for the currency display (see options) |



|                    | Min     | Max     | Avg     | Calls | usd avg |
| ------------------ | ------- | ------- | ------- | ----- | ------- |
| **Escrow**         |         |         |         |       |         |
| *cancelEscrow*     | 50,713  | 52,225  | 51,469  | 2     | -       |
| *confirmDelivery*  | -       | -       | 68,053  | 1     | -       |
| *createEscrow*     | 237,132 | 237,144 | 237,143 | 13    | -       |
| *deposit*          | -       | -       | 95,485  | 6     | -       |
| *openDispute*      | -       | -       | 57,319  | 2     | -       |
| *refund*           | -       | -       | 50,901  | 1     | -       |
| *releaseFunds*     | -       | -       | 68,218  | 1     | -       |
| *setDisputeWindow* | -       | -       | 30,033  | 1     | -       |
| **Wusdt**          |         |         |         |       |         |
| *approve*          | 46,341  | 46,413  | 46,405  | 10    | -       |
| *mint*             | 53,510  | 53,570  | 53,564  | 10    | -       |
| *transfer*         | -       | -       | 51,555  | 2     | -       |
| *transferFrom*     | -       | -       | 48,032  | 1     | -       |


## Deployments


|            | Min       | Max       | Avg       | Block % | usd avg |
| ---------- | --------- | --------- | --------- | ------- | ------- |
| **Escrow** | 1,771,536 | 1,771,548 | 1,771,547 | 3 %     | -       |
| **Wusdt**  | -         | -         | 1,094,410 | 1.8 %   | -       |


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


