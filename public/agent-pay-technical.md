> 2026-11-19 更新：新增独立 Peer Cash X Money 路径，见 [x-pay-paths.md](x-pay-paths.md)。本文讨论的跨链 USDC 资金计划仍属研究。BSC 原生税收受益人已接入独立发行流程，见 [税收受益人指南](private-giving.md)。

# Dark Agent Pay：隐私、公益与 Meme 的可执行设计

更新：2026-11-19（新加坡）。这是本地产品设计、真实只读接口和未部署合约原型；不代表支付服务已经上线。

## 1. 产品方向

Dark 的新增主线是：Meme 的税收为公益、原创创作者和公共工具提供预算，Agent ID 执行者在批准范围内把 Base 原生 USDC 直接转给收款人。

| 模块 | 具体行为 | 准入与完成依据 |
| --- | --- | --- |
| Meme → Meaning | 每期按明确比例分配已到账资金，一部分给审核通过的原创作品，一部分给核验过的公益项目 | 原创内容证据、预算清单、实际支付回执；不按刷交易量或刷互动发奖励 |
| Quiet Support | 对受助者付款，公开活动总账，避免公开 X 身份排行榜 | 受助资格审核；公开回执不能单独证明善款用途 |
| Agent Commons | 给调查、翻译、图片授权、社区数据等 x402 服务单独设预算 | 服务域名、资源路径、付款地址、币种、单价及累计上限白名单 |
| Direct X Delivery | 向 X 身份对应的钱包推送 USDC，不要求每次点领取或提交领取交易 | 稳定的 X 数字 ID、钱包绑定/预生成、支付确认 |
| Impact Receipts | 每笔支付使用随机业务编号，提供已付款证明和项目报告链接 | 链上金额与交易对应；报告必须另行验证 |

Agent ID 约束执行者，受益人无需持有 Agent ID。否则公益接收门槛会被不必要地提高。

## 2. 已核实的技术事实

1. Binance 公布的 BSC Agent ID 合约是 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F，以 balanceOf(address) > 0 判断持有。它不是唯一真人、公益资质或支付授权证明。[Binance 官方开发者资源](https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf)
2. Agentic Wallet 提供额度、资产范围和高风险处理限制；外部合约与签名可能仍需开发者模式及 App 确认，不能将本产品的后台任务描述成无条件无人值守。[Binance Agentic Wallet](https://developers.binance.com/en/docs/products/agentic-wallet/welcome)
3. Base 原生 USDC：chain ID 8453，合约 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913。6 位精度也已通过链上读取核验。[Circle 地址表](https://developers.circle.com/stablecoins/usdc-contract-addresses)
4. Circle 当前对 BNB Smart Chain 的 CCTP 支持为 USYC，不支持该链的 USDC。不能直接把 BSC 上的 USDC 当作 CCTP 原生 USDC 烧铸到 Base。[Circle 支持矩阵](https://developers.circle.com/cctp/concepts/supported-chains-and-domains)
5. LI.FI quote 接口支持指定来源/目标链、代币、金额及两端地址，返回最低到账额、成本和交易请求。Dark 本地只读服务核对这些字段并删除交易请求，不执行任何桥交易。[LI.FI Quote](https://docs.li.fi/api-reference/get-a-quote-for-a-token-transfer)
6. Privy 支持在用户首次登录前预生成钱包并向其充值；用户登录后才能访问这些资产。REST 创建用户支持 Twitter 身份输入。研究确认了接口，尚未用生产凭据跑通 X 用户恢复及使用链路。[钱包预生成](https://docs.privy.io/recipes/pregenerate-wallets)、[创建用户](https://docs.privy.io/api-reference/users/create)、[官方类型定义](https://raw.githubusercontent.com/privy-io/node-sdk/main/src/resources/users/users.ts)
7. x402 是 HTTP 资源付费协议。V2 通过 PAYMENT-REQUIRED、PAYMENT-SIGNATURE、PAYMENT-RESPONSE 完成需求、授权和结算反馈。它不负责跨链，不把 X 用户名自动变成收款地址，也不自动批量发公益款。[x402 官方协议](https://docs.x402.org/core-concepts/http-402)
8. Binance Pay Merchant 是另一套商户/账户体系，部分流程需商户或 OAuth 权限及用户确认。本期选择 Base USDC 链上支付作为 Dark Pay 主通道；不声称已接入 Binance Pay 或能付款到 X 的平台账户余额。[Binance Pay Merchant](https://developers.binance.com/en/docs/products/binance-pay-merchant/introduction)

## 3. 资金路径与自动化范围

建议拆成两条独立流水线：

税收补库：Flap 收入 → BSC 储备 → 兑换/桥报价 → 授权交易 → 等待来源确认 → 跟踪桥状态 → 验证 Base USDC 实际到账。

支付出库：已到账 Base USDC → 按预算审批清单 → Agent ID 执行租约 → 批量推送 → 确认回执 → 更新业务账。

小额奖励优先从预先注资的 Base 资金池支付，累计税收达到经济阈值后再跨链补库。这样不会让每个收款人分摊一次桥费。阈值必须根据真实成本、最低转账额与日预算计算，不能固定承诺某个费率或到账时间。

**现有合约限制：** 已部署 TigerReserve 的 withdraw 只允许 dev 或 Flap Guardian。Agent 持有 ID 并不获得此权限。第一阶段可由 dev 明确支取并注资；若要自动支取，需要另外实现和部署带固定收款地址、周期限额及紧急救援的 RevenueVault/Factory 版本，完成 Flap 接口验证。不能伪装成当前储备已经可自动给 Agent 授权。

币股底池还涉及各资产的精度、兑换和交易限制。本地桥报价先开放 BNB/USDT；SPCXB、XAUT 等必须逐一验证真实流动性和税收资产路径，不能直接套用 USDC 精度。

桥状态机：

prepared → source_submitted → source_confirmed → bridging → destination_confirmed → allocated

任一步 unknown/pending 都进入核查队列，不能生成新的支付或重复桥转。业务唯一键绑定来源 chainId、交易哈希、日志序号和预算期次；到账凭证按目标 token、接收地址、实际余额增量及关联收据确认。报价是估算，不能用来源已扣款代替目标已到账。

## 4. X 自动收款：可行方式与关键边界

优先使用用户首次登录并绑定的钱包。用 X OAuth 2.0 PKCE（S256、一次性 state、准确 callback）获取真实身份，以数字 user ID 为主键。用户自行绑定外部钱包时还需在同一服务端会话中签署带 nonce、域名、chainId、期限和用途的地址绑定声明；不能接受前端上报 username + address 就入库。[X OAuth 官方文档](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)

尚未登录的账号，可以先通过可信 X API 查询数字 ID，再用预生成方案：

POST https://api.privy.io/v1/users

请求主体示意（只在服务端，真实值来自 X API）：

    {
      "linked_accounts": [{
        "type": "twitter_oauth",
        "subject": "<stable-numeric-x-user-id>",
        "username": "<current-handle>",
        "name": "<display-name>"
      }],
      "wallets": [{"chain_type": "ethereum"}]
    }

服务端使用 Privy app ID / app secret 认证；凭据绝不能进入浏览器。收款钱包不要添加运营方 additional_signers。记录返回的 user ID、wallet ID 和完整 EVM 地址，确认用户未来通过同一 X 身份可以访问。遇到已存在用户，应先按 subject 查找，不得重复创建并付到第二个钱包。

“无需领取”准确含义：资产已转到收款钱包，不需要每笔领取交易，接收无需 Gas。首次访问资产仍需登录/恢复身份；后续主动转出资产可能需要 Gas 或赞助。不能保证一个从未登录、失去 X 账号控制权的人也能立即支配资金。

账号重命名不更换数字主键。停用、重绑、申诉、OAuth 失效和误识别均进入人工核查；未付款资金留在资金池，不创建伪成功记录。不要从社交简介或评论里的任意 0x 地址自动付款。

## 5. 权限与本地付款合约

contracts/experimental/DarkPayoutVault.sol 是独立、未部署的原型，不能覆盖已有 BSC 四个合约及其已验证编译输入。

Base 无法直接调用 BSC 上的 Agent ID 合约。本期方案采用**可信跨链身份签发者**：服务核验操作钱包签名、BSC chainId、注册合约及确认区块的 balanceOf，签发至多 600 秒的 EIP-712 AgentLease。签名绑定 Base chainId、目标金库、agent、agent epoch、attestor epoch、issuedAt 和 validUntil。这个签发者是明确的信任依赖，并非零知识跨链证明。

金库的独立限制：

- owner 事先启用 agent，并设置按 UTC 自然日计的累计额度。
- 每个 campaign 固定 Merkle root、总额、单笔上限与期限，root 不能替换。
- 叶子为双哈希 ABI 编码的 campaign、index、recipient、amount、随机 receiptRef；排序 Merkle 证明必须匹配。
- Agent 只能推送获批叶子，不能传任意目标调用、批准 spender 或随意更换 token。
- 同一 campaign/index 只能付款一次；最多 50 笔一批，失败整批回滚。黑名单等单个收款异常需要隔离后重试其余已批准叶子，不能标记整批成功。
- 校验真实到账差额，拒绝转账税代币；上线必须额外固定核验 Circle 原生 USDC 地址。构造器的 6 位精度检查本身不等于 USDC 身份核验。
- 暂停、关闭 campaign、撤销 agent、轮换 attestor 均有效。资格读取失效时签发者停止签新租约；已签租约最多仍有效 10 分钟。
- 保留明确的 dev 即时救援：指定 ERC-20 全余额转到不可变 dev，支付暂停。救援可能让已批准承诺缺少资金，必须公开披露；这是可管理金库，不是不可撤回的公益信托。

原型只覆盖资金池付款，未实现生产签发服务、X 钱包服务、自动税收支取、桥执行或后台任务调度。部署前需要代码审查、独立审计、测试网恢复演练、金库预注资和业务授权；本次没有生成或请求实际付款签名。

## 6. 隐私与公益真实性

保护的是 X 身份与业务资料：链下加密映射，按职责授权访问；日志不得存 OAuth token、付款授权头或完整受助材料。receiptRef 使用随机 32 字节，不使用可枚举用户名的普通 hash。公开活动报告以已确认总额、用途和核验证据为主；个人披露应经过同意。

普通 Base USDC 转账公开暴露地址和金额，RPC、桥和身份服务也有各自观察范围。当前设计不承诺匿名、隐藏金额、不可追踪或零知识成员证明。未来引入隐私证明需要另行选择协议、验证链支持、审计与密钥恢复；不能靠把按钮叫“暗池”实现。

公益项目应记录受益方确认、收款地址验证、用途预算、付款回执、阶段报告和异常处置。Meme 的作者奖励以原创审核为基础，避免把买入、拉盘、刷量或虚假宣传设计成公益资格。当前没有已确认的合作机构或真实公益支出，页面不能展示虚构成果。

## 7. x402 与 Agent 权限

Agent Commons 适合让代理为获批研究/API服务支付 Base USDC。需逐项检查 network=eip155:8453、asset 为原生 USDC、payTo、资源 URL、金额、expiry 和 nonce，并在服务/收款人白名单与独立预算内签名。读取 PAYMENT-RESPONSE 还要核验真实 settlement；HTTP 成功不自动证明慈善付款已完成。

Binance Agentic Wallet 的本机 skill 当前提供 x402-payment preview/sign，支持 V2 的 BSC、Base、Solana。它需要用户自己的 Agentic Wallet 会话；网页不读取或托管该 CLI 凭据。API 付费与向 X 用户发奖励使用不同预算和幂等键，不能把同一授权重复使用。

## 8. 本地交付与后续启用条件

已实现：/app/agent-pay；整数精度分配器；Agent ID 公开只读查询；Base USDC 实时核验；LI.FI BSC→Base 只读报价；草稿导出；付款合约与隔离链测试。

本地 API：

- GET /api/agent-pay/identity?address=0x…：返回区块与持有数量，authentication=false。
- GET /api/agent-pay/destination：核验 Base chainId、USDC code、symbol 和 decimals。
- POST /api/agent-pay/quote：asset=BNB/USDT、amount、fromAddress、toAddress；返回经核验报价，canExecute=false，无交易 calldata。

后续配置单独放入服务器环境：X_CLIENT_ID / X_CLIENT_SECRET / X_CALLBACK_URL、PRIVY_APP_ID / PRIVY_APP_SECRET、BASE_RPC_URL、数据库与密钥管理、专用 Agent 会话、身份签发者及其轮换策略。当前 .env 不被本功能改写，部署者私钥不被当作运营代理或用户钱包。

已完成一次主网只读探测，记录在 work/agent-pay-live.json：BSC Agent ID 查询、Base 原生 USDC 核验、BNB→USDC 报价均成功；0 笔广播。报价会过期，不是可执行承诺。部署钱包在当次 BSC 区块查询的 Agent ID 数量为 0。

尚未验证：真实 X 登录与预生成钱包恢复、实际 bridge、实际 Base 批量付款、Binance Pay 商户能力、自动税收支取、生产 x402 付费。接入这些服务后才可将对应页面状态改为可执行。
