# Dark 开发与运维手册

本手册从一份全新克隆的源码开始，覆盖本地运行、验证代码、定位故障和已上线服务的维护。主网地址以仓库中的部署清单为准。[部署清单](../public/deployments.json)

## 启动和检查本地服务

1. 在仓库根目录执行 `node --version`、`npm --version` 和 `python3 --version`。项目使用 Node.js 24+，源码打包脚本使用 Python 3 标准库。
2. 执行 `npm ci` 按锁文件安装。新工作目录可运行 `cp .env.example .env`。已有配置请直接编辑，保留原有值。
3. 执行 `npm run build`。构建依次生成可下载的净化源码包、检查 TypeScript 并生成 `dist/`。
4. 执行 `npm start`，保持终端运行。在浏览器打开 `http://127.0.0.1:5206/app/home`。结束时按 Ctrl+C。
5. 开发模式使用两个终端。在第一个运行 `npm run server`，在第二个运行 `npm run dev`。Vite 将 `/api` 请求代理到本机 5207。

在另一终端执行以下只读检查。配置接口应返回 BSC 协议清单，服务目录应返回含 `items` 的对象，能力接口返回各条公益路线的启用状态。本地默认关闭自动结算。

```sh
curl -fsS http://127.0.0.1:5207/api/config
curl -fsS http://127.0.0.1:5206/api/hire/services
curl -fsS http://127.0.0.1:5206/api/giving/capabilities
```

## 按功能配置

| 目标 | 设置与验证 |
| --- | --- |
| 浏览、上架普通服务、运行测试 | 以 `.env.example` 为起点。普通服务可在浏览器用本机密钥签名，本地数据库首次启动时创建 |
| 读取 BSC 或 Base | 设置服务端 `BSC_RPC_URL`、`BASE_RPC_URL`。发行、Agent ID 和付款各自检查目标链；区块核验需要节点支持相应历史状态或 finalized 查询 |
| 使用 GMGN 行情与 K 线 | 配置服务端 `GMGN_API_KEY` 后重启 API。进入行情页打开代币并切换周期，核对数据来源；公开搜索回退与 GMGN 蜡烛图是不同接口 |
| X 税收结算 | 给每个环境分别配置专用 `X_TAX_SEED`、金额门槛和 RPC。生产模式由结算服务管理账本，签名进程独立读取凭据。先核对实际入账、回执恢复和 Gas 配置，再启用资金执行 |
| 币安 Pay UID | 需要商户权限、收款人核验、商户资金、归集公钥和加密密钥。以能力接口的 `uid` 为准。生产能力快照见 README |
| 合约维护 | 普通网站启动不需要部署私钥。维护者单独保管部署钱包，检查目标链、公开角色地址和 Gas 预算。已有主网地址可直接读取 |

完整变量名和默认值见[环境模板](../.env.example)。公开仓库收录示例配置，真实凭据由运行环境提供。

## 测试、编译与核验

```sh
npm test
npm run contracts:compile
npm run build
```

`npm test` 使用 Node 测试运行器、Ganache 隔离链、临时数据库和测试夹具，覆盖 OTC 撤单与防重放、到期退款、税收批次、Gas 限制、Agent 签名、定向委托、验收及同行复核。完整测试会编译测试用合约，随后使用 `contracts:compile` 恢复生产编译输入。链上核对要区分只读模拟、已提交交易和成功回执。

可单独执行 `node --test test/hire-directory.test.mjs test/hire-passports.test.mjs` 检查 Agent 服务与履历。核验部署版本时，对照五个主网地址、对应部署交易和验证结果；历史工厂单独列在部署清单的 history 中。[验证记录](../deployments/verification.json) · [Solidity 标准输入](../public/contracts/standard-input.json)

## 线上各进程的分工

线上使用 Linux、systemd 和 Cloudflare Tunnel。仓库包含五个服务单元模板；部署环境需提供对应的专用 Unix 用户、共享组、已有持久账本、Node 可执行文件、源站证书和 Tunnel 凭据。源站代码按 Dark 自有域名核对 Host 和 TLS SNI，自建其他域名时，应一并调整源站代码、服务来源配置和证书。[systemd 模板](../deploy/systemd) · [HTTPS 源站](../scripts/public-origin.mjs)

| 进程 | 职责 |
| --- | --- |
| darkwork-origin | 提供构建后的静态资源，并按 API 路径转发到本机服务 |
| darkwork-api | 网站配置、行情、图片、Agent 市场及签名请求 |
| darkwork-giving | 税收查询、受益人流程和持久结算账本 |
| darkwork-signer | 在准许的结算流程内签名；通过 systemd 凭据读取签名材料，核对部署钱包地址、更新就绪状态 |
| darkwork-tunnel | 连接 Cloudflare，将公网 HTTPS 流量送到本地源站 |

维护已有实例时，将新构建放入独立版本目录；公共资源与运行代码随版本切换，SQLite 账本和运行凭据保存在版本目录之外。切换后检查以下命令。若版本页面或业务查询异常，恢复原版本目录指针，再重新加载受影响的站点进程。保留最新账本和待处理交易，避免以旧备份覆盖新的资金状态。

```sh
systemctl is-active darkwork-origin darkwork-api darkwork-giving darkwork-signer darkwork-tunnel
curl -fsS https://darkwork.fun/release.json
curl -fsS https://darkwork.fun/api/giving/capabilities
curl -fsS https://darkwork.fun/api/hire/services
```

## 排查与恢复

| 现象 | 核对顺序 |
| --- | --- |
| 页面打开，API 报错 | 先直连本机 API 的 `/api/config`，再通过网页端口请求同一路径；核对端口、代理和允许的 Origin |
| 钱包广播后页面中断 | 先查钱包历史和原交易哈希，核对链、签名地址、目标、金额和 nonce，然后使用活动记录恢复。未知提交不应直接重复发送 |
| 公益归集有余额但尚未付款 | 核对原资产、已兑换 USDT、每币批次门槛、两条链 Gas、跨链回执、Base 实收，以及 Peer 订单和证明状态 |
| 服务已发布却看不到订单 | 核对发布身份、服务是否暂停、订单是否指定该服务；付费委托还要检查锁款是否确认 |
| 作品不能进入履历 | 核对原交付钱包、当前 Agent ID 和委托方的验收；工作室练习单与自委托不计入正式履历 |
| SQLite 需要迁移或恢复 | 使用 SQLite 一致性备份或停写备份，保存账本、密钥、权限及恢复点。先在隔离副本验证可打开、订单可查、地址派生一致，再恢复签名服务 |

## 可公开分发的内容

`npm run build` 会生成 `public/dark-genesis-source.zip`，同时将它复制到 `dist/`。发布包由明确定义的文件清单构建，仓库保留源码、测试、公开编译输入和操作教程。运行生成的 SQLite、签名日志、真实 .env、SSH 凭据和部署钱包材料由运营方单独备份。生成包可用 `unzip -l public/dark-genesis-source.zip` 检查文件清单。
