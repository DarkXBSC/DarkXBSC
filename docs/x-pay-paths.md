# Dark：向 X 用户付款的实际路径

核对日期：2026-11-19。本文区分已经写入网站的操作流程、只读主网检查和未完成的真实付款。**本轮没有发生任何真实现金付款、入金、授权或跨链交易。**

新发行使用 BSC Flap 交易税直接资助 X Money 付款。在 /app/launch?route=x 核验收款人并指定该代币的专属地址，后台按最终确认的 USDT 税额或兑换所得通过免密钥的 NEAR Intents 与 Peer 结算，公益页核对美元付款凭证。配置及确认规则见 [税收受益人指南](private-giving.md)。

## 三条 X Money 或 Base 路径

| 路径 | 资金与收款条件 | Dark 当前状态 |
| --- | --- | --- |
| Peer Cash → X Money | 出资者持有 Base 原生 USDC 与 ETH；收款 X 账号已经开通 X Money；等待买家付款和证明 | `/app/wallet-pay` 已接 SDK、钱包确认、回执追踪与提现恢复；只读能力/汇率已真实查询，未完成首次真实付款 |
| Bags Pay → X Money | Bags 的 Solana SOL 底池代币，费用接收配置与 Bags Pay 钱包；收款账号已开通 X Money | 完成官方文档研究；没有创建 Bags 代币，不直接兼容现有 BSC Flap 税收 |
| X OAuth → Privy 钱包 → Base USDC | 使用 X 稳定用户 ID 绑定钱包，收款人首次登录后取得钱包访问权 | 架构备选，未接入服务凭据；不是 X Money 现金到账，也不是完全无需首次登录 |

Peer 是撮合式现金支付通道，不是向 X 用户发送普通链上转账。资金锁入金库后，买家向指定收款账号付现金；验证付款证明后释放 USDC。不能承诺即时到账。付款者无需拿到收款人的 EVM 地址，但必须确认账号正确并可接收对应渠道。

## 已实现的 Peer 流程

服务端固定 `@zkp2p/cash@0.8.2`，production environment，Base chain ID `8453`，原生 USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`。SDK 在本地 Node API 中运行，不向前端提供部署私钥。

1. `GET /api/peer/capabilities` 查询支持的平台；`POST /api/peer/estimate` 获取实时预言机估算，不注册收款人、不产生交易。
2. 用户钱包签署有用途、来源域、地址、随机 nonce 和五分钟有效期的登录消息。签名不是支出授权。当前登录使用 EOA 消息签名校验，尚未适配 ERC-1271 合约钱包登录。服务端验证签名并在 BSC 查询 Binance Agent ID，发放十分钟内存会话。
3. 用户勾选收款人核对与资料分享声明。`prepare` 再次查询 Agent ID，调用 SDK 注册/解析收款 handle，并生成**未签名**精确授权及 `createDeposit`。这是第一次把填写的 handle 发送给 Peer Curator；不是无副作用的只读操作。
4. 服务端限定 Base、零原生币 value、两步计划、精确 USDC 授权、spender 与金库地址一致，并读取金库链上代码。用户在页面核对收款账号、金额、链和 calldata，然后分别在自己的钱包确认。
5. 每一步前核对账户、网络、余额、nonce 和估算预算。Gas limit 加 20% 余量；L1 数据费通过 Base GasPriceOracle 读取并预留三倍、operator fee 预留两倍。已确认的累计费用包含 L2、回执 L1 fee 和对应区块的 operator fee。L1 价格仍会变化，估算预算不是协议层绝对总费用上限，最终费用需在钱包核对。
6. 广播前保存账户绑定的待确认状态。明确拒签可以重试；未知提交不能重复发送。通过哈希恢复时必须匹配发送人、目标、calldata、value、链、nonce 和两次确认。UI 不保存收款 handle 明文到本地存储，但待确认交易 calldata、账户、金额和哈希仍可见。
7. 入金回执只创建订单，**不标记付款成功**。查看 SDK 订单及 fills 中的 `fiatPaid`、`paymentId`、已释放和退回金额。只有可核对的付款证明才作为付款记录。
8. 用户可从查询面板准备提现可退资金。服务端验证订单属于签名钱包；取回资金不要求继续持有 Agent ID，仍由原钱包签交易。撮合中的锁定、过期 intent 等限制由 Peer 协议决定。

Dark 的 Agent ID 限制是**准备新支付计划时的应用层资格检查**。Peer 金库不认识 BSC Agent ID，也不会在 Base 结算时强制此资格。与 Dark Agent OTC 的合约层双边检查不同。恢复已准备交易仍要求原钱包，但不声称持续的链上 Agent ID 门禁。

安装版本的当前手册明确：cashout 不需要后续 whitelist/group/access-policy 配置。不要使用旧版说明增加这些交易。收款人 X 账号存在不等于开通 X Money；Curator 检查不能替代收款能力核对。地区、账户资格、平台条款与买家供给仍影响可用性。

## 税收资金如何接入

X 公益发行通过 Flap Portal 直接设定独立 BSC 归集受益地址，BNB 与其他底池资产先由运营方兑换为 USDT。生产签名服务每批结算 25 USDT，由独立归集钱包执行，部署钱包按需代补 BSC 和 Base 的结算 Gas。每批用实际税收跨链并结算，不依赖另行授权旧储备金库或另投 Base USDC。单独的钱包付款历史和恢复仍在 /app/wallet-pay。

## 隐私边界

公开链上可见付款钱包、金库、USDC 金额和交易。handle 不直接写入链上，但 Peer、买家和收款平台知道支付信息。哈希字段不等于匿名。公益名单在 `/app/impact` 本地内存中整理，只在明确准备某笔支付时分享该收款 handle。更多见 `private-giving.md`。

## 核对来源

- Peer 官方 SDK 与当前集成手册：https://github.com/zkp2p/peer-cash 、https://github.com/zkp2p/peer-cash/blob/main/AGENTS.md
- 固定包版本：https://www.npmjs.com/package/@zkp2p/cash/v/0.8.2
- Bags 官方 X Money 接入与事件：https://docs.bags.fm/how-to-guides/pay-fees-to-x-money 、https://docs.bags.fm/how-to-guides/track-bags-payout-events
- Circle 原生 USDC 地址：https://developers.circle.com/stablecoins/usdc-contract-addresses
- Base 费用：https://docs.base.org/specifications/transactions/network-fees
- OP Stack L1 估算接口：https://viem.sh/op-stack/actions/estimateL1Fee
- Privy 预生成钱包：https://docs.privy.io/recipes/pregenerate-wallets

Bags 文档中费用归集和转换门槛及折价策略属于 Bags 自身配置，不能直接当作本页面 Peer Cash 的费率。页面实时估算不保证收款金额、成交时间或零总成本。
