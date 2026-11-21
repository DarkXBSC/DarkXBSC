# Dark 操作工作台重塑 · 2026-11-19

模式：Operate；教材为 Read。用户指定 Bags / Pump 为主、现有 Dark 为辅，不进行新的风格投票。只做桌面、本地预览，保留已部署合约与真实钱包路径。

## 依据与优先级
Bags 的 /trade 三栏密集列表、圆角容器、紧凑数值与按钮；/launch 的图片资料、底池、首次买入和分账分组。Pump 官方首页可读结构包含固定侧栏、搜索、市场过滤、收藏和订单。直接浏览 Pump 被 Cloudflare 安全页阻挡，不绕过，也不声称逐像素对齐。参考截图/DOM 保存在工作区 work/dark-panels-20261119。

用户已经明确选择竞品式标准操作面板；本次自主决策权限沿用“不需要过问我”。concept-seed 已运行，seed:de33adb91342cd1c；用户指定的 Bags/Pump 结构覆盖抽签的装饰性形式，不再要求确认。Code-led。保留 Dark D 标、Archivo、双主题和中英文；旧电影式品牌页转为 About，日常工作台不等待长转场。

## Direction contract
THESIS: 一个可反复操作的桌面市场与付款工作台，主要任务首屏可见，替代巨型标题和空白宣传段落。
OWN-WORLD: Bags 的深灰分层、12–16px 面板和胶囊操作；Pump 的固定侧栏、搜索/筛选和表格密度；Dark 字标和几何 D 为品牌锚点。绿色仅标记主要动作和正向状态，浅色版本保持相同结构。
STORY: 找市场或收藏，创建自己的代币；进入 X Pay 查看实际付款通道、报价并通过自己的钱包操作，随后追踪回执。
FIRST VIEWPORT: 208px 固定侧栏、64px 顶部工具条、紧凑公告；中央市场数据与筛选，右侧所选资产/任务操作；发行和付款采用左右表单/摘要工作区。1280/1440/1600 均直接看到可操作控件。
FORM: 用户钉选 Bags/Pump 标准产品界面，seed:de33adb91342cd1c；参考产品中的金融数据不复制成 Dark 业绩。
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Quality bar
TYPE: 操作标题 24–32px、数据 12–14px，避免巨型广告字。MATERIAL: 平整深色分层、统一圆角和清楚边界。GROUND: 长时间桌面交易使用的深色默认，保留浅色切换。
界面必须真实：行情来源标注 DEX Screener，外部社区资产不叫本站发行；无行情时明确失败/空状态。X Money 支付与 X 登录钱包收 USDC 分开；钱包签名、资金锁入和现金付款是不同状态。未实际付款不能出现成功。不得使用东北箭头、移动布局、虚构数据或部署私钥。

## 范围
重塑 app 外壳、市场、发行、OTC、配平、合约、教材、记录、Agent Pay；增加收藏与 X Money 操作面板。旧品牌动画保存在 About，不删除其源代码。不新增合约、不广播测试交易、不公开发布。

## 隐私公益补充
最新用户要求把 Agent ID 创新重点放在隐私与公益。新增本地名单与整数预算检查、加盐承诺公开摘要、AES-GCM 加密备份/恢复、一次性内存传递收款人到 X 支付。承诺不叫付款证明，Agent ID 不叫真人/慈善认证。签名与资金状态分开。关键交互是“私密名单 → 可核对公开计划 → 用户确认单笔付款”，不增加自动支出或假到账。

## 当前桌面工作台 · 2026-11-19 后续定稿

本轮依据 Bags 的首页、Trade、Launch 和 Earn 桌面页面调整布局。上文的 Pump 侧栏与左右分栏是早期方案。Dark 原创几何 D 和开场电影延续使用，首次进入结束后落在 Home。工作台改用本地 Open Runde、Archivo Black，保留深浅主题和中英文。

- 66px 顶栏居中排列 Home、Launch、Trade、Giving、Docs、More tools。右侧保留搜索与钱包。页脚可进入合约与源码、教材、X、更多工具及关于，也可切换语言和主题。
- Home 在居中标题与钱包按钮下，呈现 X 公益单批税额、BSC、Flap V3、已验证合约数和可复制的 BSC 官方代币地址。
- Trade 在 32px 行情条之下排列独立滚动的 New、Soon、Bonded 三栏。New 与 Trending 切换各栏排序，资产行打开实际 K 线，搜索和回退状态标记数据来源。
- Launch 采用 560px 单列。图片、名称与代码先行，随后填写受益人、底池、税率与首买。交易经模拟、确认及用户签名。
- Giving 在 592px 居中卡片上分出回执查询与受益渠道。Bags 原站的收益数字、Solana 钱包与领取操作没有映射到 Dark。当前配置是每个币每批 25 USDT 的 X 公益自动结算，支付结果以实际凭证为准。

实装截图位于 `.impeccable/review/bags/`。本地参考图位于工作区的 `work/dark-panels-20261119/`。[产品说明](../PRODUCT.md)
