# Dark · 发币时指定税收受益人

打开 [本地发行页](http://127.0.0.1:5206/app/launch)，连接自己的 BSC 钱包，填写名称和代码，在第一步选「交易税收给谁」。上传图片、选择底池和税率，首买可为 0。页面读取 Flap 配置、模拟完整交易并显示预计合约地址、收款路径与 Gas。核对后在自己的钱包确认。成功回执里的代币地址和交易哈希可带到 [公益页](http://127.0.0.1:5206/app/impact) 追踪。

Flap V3 的买卖税与协议费用分别计算。Dark 将可分配份额的 100% 配给选定受益人，不收发行渠道佣金。每笔交易产生的税需依 Flap 规则清算、分配，有交易量和可分配余额时才有收入。[Flap 税收处理说明](https://docs.flap.sh/en/flap/v2/developers/bonding-curve/basic-and-mechanism/bonding-curve-tax-token-v3)

## 用这枚代币的交易税向 X Money 付款

1. 在发行第一步选择「X Money 公益」，填写对方的 X 用户名。发行人确认对方已开通美元收款并同意向身份查询服务和 Peer 提供账号。Dark 通过 FxEmbed 核对稳定的数字用户 ID，并检查 BSC USDT 至 Base USDC 的实时报价。账号存在本身不能证明 X Money 已开通。
2. 选择 BNB、USDT 或 Flap BSC 目录中的其他底池，设置买税、卖税、税期和首买。核对专属归集地址后在自己的 BSC 钱包确认发行。Flap Portal 的 newTokenV6 将可分配税收的受益份额指定给该地址。X 收款用户名与数字 ID 加密在本地，发币 calldata 只含地址；用户主动填写的项目社交链接及图片描述会进入公开 metadata。
3. Darkwork.fun 的独立签名服务按需从部署钱包支付 BSC 的 BNB 和 Base 的 ETH。服务只累计该代币 TaxProcessor 分给专属地址的已确认底池税收。USDT 直接入账，其他资产按下方流程兑换，最终确认的 USDT 所得才进入付款批次。达到起付额后按批次上限取得 NEAR Intents 1Click 签名报价，核对来源和目标资产、金额和地址。当前要求每 1 USDT 至少换得 0.98 USDC，报价不达标会等待。
4. 服务同时核对 BSC 扣款与 Base 原生 USDC 的已确认入账。实际换得的 USDC 进入指定 X 账户的 Peer 订单。买家向该账户支付美元；达到起付额、跨链成功、资金进入 Peer 均不等于收款人到账。
5. 在公益页输入代币或归集地址，分别查看实收税额（USDT）和有付款证明的实际金额（USD）。部分成交按逐笔凭证累计。买家撮合、收款地区及 X Money 资格会影响到账。收款人无需逐笔申领。链上金额与地址可见；FxEmbed、Peer 和付款买家会处理必要身份信息。

### 本地开通与恢复

X_TAX_BSC_RPC_URL 用于最终区块与 ERC-20 事件查询，默认使用已经通过这两项检查的 BSC PublicNode，可换为支持日志的自有节点。本机 .env 已选用免密钥接口 X_TAX_IDENTITY_API=https://api.fxtwitter.com 和 X_TAX_BRIDGE_API=https://1click.chaindefuser.com。X_API_BEARER_TOKEN 与 RELAY_API_KEY 可留空，仅保留给原来使用这两项服务的安装。公众接口有速率限制。1Click 对免密钥 EXACT_INPUT 兑换收取额外 0.25% 平台费，另有网络费及报价成本。Base 的只读节点使用 BASE_RPC_URL=https://mainnet.base.org。[FxEmbed API](https://docs.fxembed.com/api/introduction/) · [1Click 费率](https://docs.agentsonintents.com/resources/fees) · [报价签名核验](https://docs.agentsonintents.com/integration/distribution-channels/1click-api/verify-quote-signature)

查询身份与实时报价在关闭付款时也可操作。X_TAX_SEED 是服务端保管的独立结算种子，X_TAX_MIN_USDT 默认 25。生产服务的 X_TAX_MIN_USDT 和 X_TAX_MAX_USDT 均为 25，X_TAX_ENABLE=yes，X_TAX_GAS_SPONSOR=deployer。单个代币的已确认税收每满 25 USDT 进入一批，余数留待下批。部署钱包承担结算 Gas，发行人仍用自己的钱包支付发币交易费用。

本地工作进程仅向该代币的派生归集地址补 BNB 或 ETH。按实际结算调用估算 Gas，Base 同时估算 L1 数据费与 operator fee。已有余额够用便直接结算；不足时补缺额并留 10% 估算余量，剩余 Gas 留给后续批次。X_TAX_GAS_LIMIT_BNB 和 X_TAX_GAS_LIMIT_ETH 默认各为 0.0001 原生币，限制单次补款及其预计网络费。费用回落或部署钱包恢复余额后会自动重试。补款签名先存入私有账本，再按原哈希广播并核对最终确认。同一部署钱包赞助多个地址会留下公开的链上关联。请保持本机服务在线；离线后重启会沿原账本继续。

生产账本保存在 /var/lib/darkwork-settlement/routes.sqlite。备份时同时保管结算种子和 SQLite 一致性快照。运营方掌握派生钱包签名权。账本逐笔记录归集进度、跨链报价与请求、Base 签名交易与 Peer 订单；部署钱包只需保有两条链的原生币。订单匹配前若 X 用户名换主，服务会暂停新付款并保留余额。已发给支付网络的委托遵循其原有收款条件。

1Click 入金交易会在广播前落盘。结果不明时按原哈希查询，仍在报价有效期且链上查不到交易时仅重发相同签名。运营方应使用该请求的两链交易与金额核对退款、未广播或异常订单。Base 提交状态未知时按账本中签名交易的固定哈希恢复。Peer 已退回或资金与证据不匹配的批次保留待核对。对旧单的核实须在另发资金之前完成。停用结算开关将暂停后台处理。

[Flap V3](https://docs.flap.sh/en/flap/v2/developers/bonding-curve/basic-and-mechanism/bonding-curve-tax-token-v3) · [Peer Cash SDK](https://github.com/zkp2p/peer-cash/blob/main/AGENTS.md) · [X 用户查询](https://docs.x.com/x-api/users/get-user-by-username)

## 普通广场帖或交易所 UID，收款作者免声明

[在发行第一步检查收款人](http://127.0.0.1:5206/app/launch?route=square)。发行者粘贴普通官方帖子或填写对方的交易所 UID，然后点「检查能否自动付款」。这一步不分配资金，也不发起付款。直接填写 UID 时，资金将付给该 UID；请核对是你想支持的账户。币安 Pay 的收款人校验只核对交易所账户，不能单独证明一篇帖子的作者身份。

普通帖按两种已有证据解析。商户曾独立核验并留存该帖与 UID 的对应记录时，可按原帖精确匹配。对于同一作者的另一篇普通帖子，服务读取币安官方页的原帖标识、作者主页和作者标识，再与商户已核验的作者记录比对。帖子正文、转帖引用、昵称和帖子编号不会用于推算 UID。收款作者不需要发帖、连接钱包或逐笔领取。

缺乏对应关系、币安官方页面无法读取或商户未接入时，发行页显示具体原因并暂停此渠道。可以改填已知 UID。也可打开官方原帖，由付款人使用币安的打赏按钮手动确认；是否出现该按钮取决于作者资格和设置。人工打赏不计入 Dark 自动结算金额。[币安广场打赏说明](https://www.binance.com/en/support/faq/detail/9c92d94e63ec47db8a82f1742322ad5d)

## 可选的广场作者 BSC 钱包收款

下面是作者选择直接收链上资产时使用的另一条路径。


1. 作者在公益页展开「创建我的广场收款声明」，填写自己的官方广场主页，用收款钱包签名身份声明。这里使用个人消息签名，无需 Token 授权或 Gas。
2. 从同一广场账号将完整声明和签名发布为原创帖。在公益页填回链接并核验，或由发行者直接使用该签名帖子。
3. 成功登记后，发行者可用同一作者的其他公开原帖。服务从币安官方网页读取原帖与作者资料，并重新读取签名帖、恢复签名钱包。声明被删除、页面不可读取、作者不一致或署名信息无法核对时，流程会停止。首次设置可以直接使用签名原帖。
4. 核对签名前显示的收款钱包。Flap 创建交易的 beneficiary 为该 BSC 地址。净税收按所选底池与 Flap 的分配机制到账。公益页可用代币地址和发行回执核对创建时的接收地址。既有代币的地址不会随着新的广场帖子自动改变。

签名声明和作者钱包公开。广场帖子 ID 只能标识帖子。普通用户想在币安官方给一篇合资格的普通帖子打赏，可使用广场自身的打赏功能。[币安广场打赏](https://www.binance.com/en/support/faq/detail/9c92d94e63ec47db8a82f1742322ad5d)

## 按交易所 UID 收 USDT

此路径需要具有 Payout 权限且有可用余额的币安 Pay 商户。当前本地环境未配置，网站会在确认发行前提示。输入的是交易所账户 UID。帖子只有在商户另有经过核验的作者和 UID 关联证据时才能用于该渠道。

- 发行时，服务按官方接口校验 UID，为该 UID 分配专属 BSC 收款地址，限定 BSC USDT 底池。链上创建交易只含归集地址。
- 本地服务运行时扫描 BSC 已最终确认的 USDT 转入，累计满 1 USDT 后，从商户预充值余额向该 UID 付款。每次受商户设置的金额上限限制，支付精度为六位小数，余数留在账上。商户承担其收款链上管理、余额补充及币安商户费用。
- 税收与其他直接转入此专属地址的 USDT 均计入归集。公示分别显示确认归集和币安确认付款。网络超时或进程重启将查询原请求，只有明细里的请求号、收款类型、UID、币种、金额和成功状态一致才记为已付。
- 收款是否可用取决于币安账户、商户权限与币安实际处理结果。待收、失败或需核对的记录保留，不会显示已到账。[收款人校验](https://developers.binance.com/en/docs/products/binance-pay-merchant/api-payout-validate-receiver) · [付款](https://developers.binance.com/en/docs/products/binance-pay-merchant/api-payout) · [订单核对](https://developers.binance.com/en/docs/products/binance-pay-merchant/api-payout-query)

### 商户本机配置

从项目根目录的 `.env.example` 查看 `BINANCE_PAY_KEY`、`BINANCE_PAY_SECRET`、`GIVING_COLLECTION_XPUB`、`GIVING_STORE_KEY` 和 `GIVING_PAYOUT_MAX_USDT`。将值填入本机 `.env` 后重启 API。配置设置会启用真实结算。使用独立的 HD 公钥分支；子钱包按序派生，支出密钥由商户离线管理。不得使用归集地址互转来记账。商户可自行归集链上 USDT 并为币安余额补充资金。

账本位于 `deployments/private/binance-giving/ledger.sqlite`。UID 以 AES-256-GCM 加密，索引用独立 HMAC 命名空间。私下共同备份 SQLite、原加密密钥与分支信息。第三方看得到链上地址、转账与可推断的关联。映射文件 `verified-posts.json` 的键是帖子 ID，值含字符串 `uid`、`verifiedAt`、`evidence`。记录当前作者与其收款账户所有权证据。若掌握同一作者的独立核验证据，可在同一私有目录的 verified-authors.json 中，用规范主页 https://www.binance.com/en/square/profile/<slug> 为键，保存 squareAuthorId、uid、verifiedAt 和 evidence 四个字符串。squareAuthorId 与 uid 属于两个不同系统。verifiedAt 为 ISO 日期，evidence 引用商户独立核对的凭证。只有公开原帖提供相符的作者标识与主页才复用作者记录。核验凭证可以来自获授权的合作方。若用已有打赏交叉核对，须由币安记录明确把该原帖或作者、同一笔交易与收款方的交易所 UID 对上。仅有昵称、近似付款时间或金额不够。可用 revokedAt 停用新发行的对应关系；已上链代币的收款地址以原创建交易为准。两份文件均包含敏感身份映射，仅限商户本机读取。不得以帖子 ID、用户昵称或公开推测代替验证。

若付款状态异常，商户先核对账本中原 `requestId` 和币安商户记录；未知结果不创建新单，明确失败的路由保留等待人工对账。保持服务器在线有助于及时分配。密钥、UID 和归集账本不进入源码下载包。
## Agent ID 公益提名

在公益页打开「社区公益提名」。提名钱包签署包含公开标题、理由、私密受益人、本站来源和五分钟有效期的消息，服务核验签名和 BSC 官方 Agent ID 合约的持有状态。提名人钱包地址随项目公开。X 用户名与稳定账号 ID 加密保存在本机。社区可通过「用发行税支持」打开 BSC 发行表单，核验提名与报价，再签署自己的 Flap 发行交易。提名人无法替换受益人或取走税收。同一钱包再次提名同一受益人时返回已有记录。

提名人地址链接打开可分享的公开记录。只有归集器认出的税收和结算器核验的美元付款计入记录。发行预览不产生已资助记录。

## 生产结算服务

Darkwork.fun 的签名服务随服务器启动，每 15 秒检查一次。部署钱包支付 BSC 与 Base 的结算 Gas，收款和兑换记录保存在服务器。电脑关机后继续处理，每笔美元到账以付款凭证为准。运营兑换命令在服务器执行。签名钱包使用独立的系统账户，网站和公网 API 的进程无法读取部署私钥。

## 将非 USDT 交易税用于 X Money

运营方负责把原资产兑换为 USDT。每个代币独立记账。BNB 只根据该币税处理器成功发给专属地址的分账事件确认，ERC20 根据所选资产从该处理器发来的 Transfer 确认。打入的钱包 Gas 与普通转账均不计作交易税。USDT 直接归集沿用原流程。币安 Pay 商户 UID 渠道仍要求 USDT 底池。

登录生产服务器后运行 `darkwork-x-convert list` 可查看池资产、已确认量、剩余量与归集地址。以下命令中的尖括号字段需替换。预览不签名；追加 `--commit --id <本次操作唯一编号>` 后由服务器签名服务 执行，断线重试沿用同一编号。每个收款路由同一时间处理一笔兑换。

- **PancakeSwap V2 兑换**。运行 `darkwork-x-convert dex --token <发行代币地址> --amount <原资产数量> --min-usdt <最低可得USDT>`。订单在直接市场和 WBNB、USDC 中转路径里选报价，worker 复核下限，将结果付回原归集地址。非零 ERC20 首次兑换使用精确额度授权。订单约 30 分钟有效；过期或交易失败时查单后使用新编号和新报价。
- **运营库存兑换**。无合适 DEX 报价时，由运营钱包先在 BSC 调用官方 USDT 的 transfer，将议定的准确 USDT 数量付到这枚币的归集地址。等交易最终确认，运行 `darkwork-x-convert inventory --token <发行代币地址> --amount <原资产数量> --min-usdt <确切付入的USDT> --deposit <该笔交易哈希>` 并核对预览后提交。worker 只把对应的已确认原资产发给固定运营钱包。运营钱包取自本项目部署记录。每张回执限用一次。若原资产交付交易在链上最终失败，排除原因后运行 `darkwork-x-convert retry --id <原编号> --commit`。
- 公益页分别显示底池原资产、待兑换数量、已核验的 USDT 和 X Money 的美元付款。DEX 成交或库存兑换的两端回执确认后，净 USDT 才进入可付账本。当前每枚发行代币每累计 25 USDT 自动启动一批。运营方决定兑换价格和时点，缺少报价或尚未提交订单时资产留在该币归集地址。
