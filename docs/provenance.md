# 依赖与视觉来源

- 自有网站与四个协议模块以 MIT 许可证提供。源代码保留已部署的 Tiger 技术名称；品牌为 Dark。
- `contracts/flap/` 来自官方 https://github.com/flap-sh/FlapVaultExample ，2026-11-18 读取，保留各文件 MIT SPDX。部署所用实际字节内容固定于 `public/contracts/standard-input.json` 和 `build.json` 的哈希，更新仓库上游不会改写本次产物。
- OpenZeppelin contracts 5.0.2、upgradeable 4.9.6，MIT；精确安装树由 package-lock.json 固定。
- Archivo Variable、Geist Mono Variable 由 @fontsource-variable 本地自托管（各自字体许可证随 npm 包）；Lucide 图标采用 lucide-react（ISC）。
- 设计参考 https://www.asklionel.tech/。未复制个人履历、客户/奖项、原站字体以外的个人资产或品牌身份。Three.js/GLSL/GSAP 动画实现独立编写，参考站公开页面与客户端资产仅用于测量时长、几何、交互；原站 bundle 未进入交付包。Three.js 0.187.0 与 GSAP 3.15.1 的 npm 依赖保留自身许可证。
- `public/brand/dark-mark.png`：本会话使用内置 image_gen 生成的全新透明 Logo。最终完整提示词在 `docs/logo-prompt.txt`，同一提示词已嵌入 PNG 的 tEXt。原始图生成在 Codex generated_images，项目保留本地副本；没有背景去色处理。深色主题由 CSS invert 显示。
- Flap 币股/加密资产图标按实时 quote-tokens 目录的精确资产地址显示，仅用于资产识别，不代表合作背书。外部服务图标不冒充 Dark 官方代币图片。

## 协议依据

- https://docs.flap.sh/en/flap/v2/developers/deployed-contract-addresses
- https://docs.flap.sh/en/flap/v2/developers/flap-infrastructures/flap-ipfs-gateway
- https://docs.flap.sh/en/flap/v2/developers/bonding-curve/basic-and-mechanism/agent-id-gate
- https://docs.flap.sh/en/flap/developers/token-launcher-developers/launch-token-through-vaultportal
- https://docs.ponsfamily.com/v2
- https://docs.sourcify.dev/docs/api/

官方页面可能更新；本轮先做当前链上只读模拟再签名基础设施部署，旧版页面的接口描述不替代实时模拟。BSC 零税 V2 路径返回 FeatureDisabled，V7 探测也未通过，未对用户开放，未广播试错交易。

## Bags / Pump 工作台（2026-11-19）
结构参考 https://bags.fm/trade 、https://bags.fm/launch 与 https://pump.fun/。Bags 使用真实浏览器观察；Pump 直接浏览被 Cloudflare 阻挡，仅使用官方可读页面结构，不声称像素复刻。参考截图仅开发证据，不作为网站素材发布。DEX Screener 图片在运行时从其 CDN 读取，仅用于对应第三方资产；无图片时显示代币文字，不虚构图标。新增界面无生成图片，沿用 Dark 图标及已有来源记录。


## Agent 服务目录（2026-11-19）

目录封面 public/brand/agent-directory.jpg 由 ImageGen 为 Dark 生成，描绘机械手从卡片盒中选取卡片。图像内嵌了生成提示词。服务列表和收件箱由签名记录生成。
