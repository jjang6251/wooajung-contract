# wooajung-contract

v26.03.16 - Escrow 2nd
-> [Release Note](https://github.com/jjang6251/wooajung-contract/releases/tag/v26.03.16)
-> [v26.03.16 가스비 구조 개선 및 회고](https://velog.io/@jjang6251/%EC%8A%A4%EB%A7%88%ED%8A%B8-%EC%BB%A8%ED%8A%B8%EB%9E%99%ED%8A%B8-%EC%97%90%EC%8A%A4%ED%81%AC%EB%A1%9C-%EA%B0%80%EC%8A%A4%EB%B9%84-%EC%B5%9C%EC%A0%81%ED%99%94-%EB%B2%88%EA%B0%9C%ED%8E%98%EC%9D%B4%EB%B3%B4%EB%8B%A4-%EC%A0%80%EB%A0%B4%ED%95%98%EA%B2%8C-%EB%A7%8C%EB%93%A4-%EC%88%98-%EC%9E%88%EC%9D%84%EA%B9%8C)

v26.03.14 - Escrow 1st
-> [Release Note](https://github.com/jjang6251/wooajung-contract/releases/tag/v26.03.14)
-> [v26.03.14 가스비 측정 및 회고](https://velog.io/@jjang6251/v26.03.14-Escrow-1st)

---

## 프로젝트 소개

WUSDT 기반 탈중앙화 에스크로 스마트 컨트랙트.
중간자 없이 구매자와 판매자가 직접 안전하게 거래할 수 있도록 설계했다.
수수료 0%, 온체인 상태 머신으로 거래 흐름을 관리하며, 분쟁 발생 시 7일 타임락으로 자동 처리한다.

---

## 거래 구조

```
  구매자 (Buyer)                 에스크로 컨트랙트                  판매자 (Seller)
       │                               │                               │
       │──── createEscrow() ──────────▶│                               │
       │──── deposit() ───────────────▶│                               │
       │         WUSDT 예치            │                               │
       │                               │                               │
       │                    ┌──────────┴──────────┐                    │
       │               정상 흐름              분쟁 발생                 │
       │                    │                     │                    │
       │                    │          openDispute() (양측)            │
       │                    │                     │                    │
       │  confirmDelivery() │              ┌──────┴──────┐             │
       │◀───────────────────┤         구매자 합의    7일 타임락 초과    │
       │                    │  confirmDelivery()  releaseFunds()        │
       │                    │              └──────┬──────┘             │
       │                    │                     │                    │
       │                    └──────────┬──────────┘                    │
       │                               │                               │
       │                        RELEASED 상태                          │
       │                               │──── WUSDT 지급 ─────────────▶│
       │                               │                               │
       │                   ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─               │
       │                               │                               │
       │◀──── WUSDT 반환 ──────────────│  refund() (판매자 동의)        │
       │                         REFUNDED 상태                         │
       │                               │                               │
       │◀──── WUSDT 반환 ──────────────│  cancelEscrow()               │
       │                         CANCELLED 상태                        │
```

---

## 컨트랙트 구조

```
contracts/
├── wusdt.sol      # ERC20 토큰 (6 decimals, 오너 전용 mint)
├── escrow.sol     # 에스크로 v1
└── escrow2.sol    # 에스크로 v2 (가스비 최적화)
```

### 상태 머신

```
createEscrow()  → AWAITING_DEPOSIT
deposit()       → AWAITING_DELIVERY
confirmDelivery() → RELEASED      (구매자 확인 → 판매자 지급)
refund()          → REFUNDED      (판매자 동의 → 구매자 환불)
openDispute()     → DISPUTED
releaseFunds()    → RELEASED      (7일 타임락 초과 → 판매자 수령)
cancelEscrow()    → CANCELLED     (입금 전: 양측 / 입금 후: 구매자, deadline 초과 시)
```

---

## 시작하기

### 요구사항

- Node.js 18+
- npm

### 설치

```bash
npm install
```

### 환경 변수 설정

`.env` 파일을 생성하고 아래 값을 채운다.

```env
SEPOLIA_RPC_URL=
PRIVATE_KEY=
CMC_API_KEY=       # 가스 리포트 USD 환산용 (선택)
```

---

## 명령어

```bash
# 컴파일
npx hardhat compile

# 전체 테스트 실행
npx hardhat test

# 개별 테스트 실행
npx hardhat test test/Escrow.test.js
npx hardhat test test/Escrow2.test.js

# Sepolia 배포
npx hardhat run scripts/wusdt.js --network sepolia
```

---

## 가스비 비교 (v1 vs v2)

| 함수 | escrow.sol | escrow2.sol | 절감률 |
|------|----------:|------------:|------:|
| `createEscrow` | 237,143 | 112,900 | **-52.4%** |
| `deposit` | 95,485 | 74,262 | -22.2% |
| `openDispute` | 57,319 | 36,209 | -36.8% |
| `cancelEscrow` | 51,469 | 38,164 | -25.8% |
| `confirmDelivery` | 68,053 | 63,858 | -6.2% |
| 배포 비용 | 1,771,547 | 1,244,931 | **-29.7%** |

> 측정 환경: Solidity 0.8.28, optimizer runs 200, Hardhat hardhat-gas-reporter

---

## 기술 스택

- **Solidity** 0.8.28
- **Hardhat**
- **OpenZeppelin** — SafeERC20, ReentrancyGuard, Ownable, ERC20Permit
- **hardhat-gas-reporter**
- **Chai / Mocha**
