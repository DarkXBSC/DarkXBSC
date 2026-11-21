# Dark

Dark 是在 BNB Smart Chain 上发行 Flap 税收代币的桌面工作台。用户选受益人，核对实际收款条件和交易，再用自己的钱包发币。Dark 尚未发行官方代币。独立厂牌、公益项目与外部市场代币分别标示。

## 首次进入与日常操作

首次从根路径进入时播放 Dark 原有的 Three.js 开场，播放结束或跳过后进入首页。访客可在「关于」重播，站点支持减少动态效果与 WebGL 降级。首页可连接钱包，查看来自服务配置的 X 公益单批税额、BSC 发行网络、Flap V3 和已验证合约数量。

桌面顶栏按首页、招个 Agent、发行、行情、公益、教材、更多工具排列，品牌旁可切换中文与英文，右侧提供市场搜索和钱包操作。页脚提供关于、合约与源码、教材、X、更多工具、语言和主题切换。收藏、钱包支付、交易记录、Agent OTC、私下报价、库存管理、资金计划与 BSC 登记簿均可从「更多工具」进入。

「招个 Agent」支持按能力、交付物或 Agent 名称搜索，并按分类和服务语言筛选。委托方可以核对服务详情，向指定服务方提交需求并验收交付物，也可以到「委托板」公开发布需求。服务方签名上架后，可在「我的 Agent」管理服务、查看收到的委托并签名交付。Dark 自营服务在目录中单独标明。

行情页从 GMGN 读取 BSC Flap 的 New、Soon、Bonded 三组资产。行情条下方的三栏独立滚动，New 与 Trending 分别按原始顺序或近 24 小时成交量查看。每行显示图片或代币简称、市值及可用指标。打开资产可查看站内 K 线、成交量、时间周期及合约地址。搜索与行情回退注明 DEX Screener 来源。深浅主题和中英文共用桌面布局。保留 Dark 几何 D 标和原电影资产，工作台使用本地的 Open Runde 和 Archivo Black。

「招个 Agent」内的 Agent ID 履历支持作者主动收录已验收的正式作品，持有不同 Agent ID 的第三方可以留下署名复核意见。履历分列作者作品、复核贡献和有 BSC 回执的付款记录。

## 发行与公益

发行页采用单列。首张卡片上传图片、填写名称和代码，下方可填写公开介绍、网站和 X 链接。随后选择税收受益人、底池和发行条款，最后复核。公益首页提供「核对付款」与「选择税收受益人」。查询可填写代币或归集地址，也可补充发行回执。BSC Flap Tax Token V3 支持真实图片上传、有效底池、税率和首买、主网只读模拟、用户钱包签名、回执与登记。X 渠道在发行时绑定 X Money 受益人的稳定账号身份。Flap 将税收受益份额分配到专属 BSC 地址；非 USDT 税收由运营方兑换，核验所得 USDT 后，通过 NEAR Intents 换成 Base USDC，Peer 买家向受益人付美元。生产服务当前按每个代币每批 25 USDT 自动结算，由部署钱包按需补充 BSC 和 Base 的 Gas。两条链的到账及 Peer 付款凭证分别核对。发行者可用普通广场原帖或 UID。匹配商户已核验的帖子或作者收款记录后，按 UID 结算；签名 BSC 钱包为单独选项。币安 Pay UID 渠道要求启用商户、独立 BSC USDT 归集和预充商户资金。本地缺少商户配置，该渠道自动停用。使用指引与证明边界见 docs/private-giving.md。

仅 BSC 对访客开放发现和发行。X Money 单笔付款沿用独立的 Peer Cash / Base USDC 路径，有独立的 Agent ID 核验、授权、入金与付款核对。用户的历史链上回执仍可查看。OTC 结算合约对 Agent 专区双方检查 Binance Agent ID，私下报价链上公开交割。库存以资金价值与哈希时间锁管理 BSC 仓位，不提供做市或价格保证。

## 部署与本地运行

Dark 在 BSC 使用登记、OTC 结算、库存锁、储备金库工厂、公益委托工厂五个合约。最新地址、历史工厂和验证结果见 public/deployments.json 及 deployments/verification.json。合约保留部署时的 Tiger 技术名。实验支付金库单独存放在 contracts/experimental。

生产网站为 https://darkwork.fun ，页脚社交账号为 https://x.com/DarkLBSC 。本地启动使用 5206 网页和 5207 API。用户教程见 docs/user-guide.md，运维手册见 docs/operations.md。品牌与动画来源见 docs/motion-spec.md 和 docs/panels-direction.md。
