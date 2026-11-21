import { ArrowRight, Check, Download, RefreshCw } from "lucide-react";
import { PageTitle, CopyText, OfficialTokenNotice } from "../components/Frame";
import { useApp } from "../lib/context";
const descriptions: Record<string, [string, string]> = {
  registry: [
    "Creator-authored project identities and cross-chain links. Owner attestations are explicit.",
    "创建者登记项目及跨链身份关联，管理员核对状态明确展示。",
  ],
  settlement: [
    "EIP-712 private quotes, cancellations and atomic ERC20 settlement. Agent-gated orders check both participants.",
    "EIP-712 私下报价、取消和 ERC20 原子交割。Agent 限制订单核对双方身份。",
  ],
  inventory: [
    "Time-limited inventory escrow. Claim with a secret or refund after expiry. No admin withdrawal.",
    "限时库存托管，凭 secret 领取或到期退款，没有管理员提款接口。",
  ],
  commissionFactory: [
    "Creates per-token Flap commission vaults. Each vault locks rewards and pays the signed author upon selection.",
    "为每枚 Flap 代币建立公益委托金库，锁定报酬，选稿时直接向署名钱包付款。",
  ],
  reserveFactory: [
    "Flap V3 reserve creation. Creator and official Guardian have immediate withdrawal and rescue authority.",
    "创建 Flap V3 储备金库，代币创建者与官方 Guardian 拥有即时支取及救援权限。",
  ],
};
export default function Contracts() {
  const { t, config, refresh } = useApp();
  const entries = config
    ? Object.entries(config.chains)
        .filter(([chain]) => chain === "bsc")
        .flatMap(([chain, c]) =>
          Object.entries(c.contracts).map(([key, d]) => ({
            ...d,
            key,
            chain,
            explorer: c.explorer,
            chainId: c.chainId,
          })),
        )
    : [];
  return (
    <>
      <PageTitle
        title={t("Contracts & source", "合约与源码")}
        description={t(
          "Look up the official token address and inspect the source and receipts for the BSC protocol contracts.",
          "核对官方代币地址，查看 BSC 协议合约的公开源码与部署回执。",
        )}
        aside={
          <button className="button" onClick={() => void refresh()}>
            <RefreshCw size={15} />
            {t("Refresh status", "刷新状态")}
          </button>
        }
      />
      <OfficialTokenNotice />
      <div className="directory-toolbar">
        <h2>{t("BSC protocol contracts", "BSC 协议合约")}</h2>
        {config && (
          <span>
            {entries.length} {t("contracts", "个合约")}
          </span>
        )}
      </div>
      <div className="contracts-list">
        {entries.map((d) => (
          <article key={d.address}>
            <div className="contract-heading">
              <span className="mono">
                {d.chain.toUpperCase()} / {d.chainId}
              </span>
              <span className="verification">
                {d.verified ? (
                  <>
                    <Check size={14} />
                    {t("Source verified", "源码已验证")}
                  </>
                ) : (
                  t("Verification pending", "源码验证中")
                )}
              </span>
            </div>
            <h2>{d.name}</h2>
            <p>{descriptions[d.key] ? t(...descriptions[d.key]) : ""}</p>
            <CopyText value={d.address} />
            <details className="contract-files">
              <summary>
                {t("Receipts & source files", "回执与源码文件")}
              </summary>
              <div className="contract-links">
                <a
                  href={d.explorer + "/address/" + d.address}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Explorer", "区块浏览器")}
                  <ArrowRight size={14} />
                </a>
                <a
                  href={d.explorer + "/tx/" + d.transactionHash}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Deployment receipt", "部署回执")}
                  <ArrowRight size={14} />
                </a>
                <a href={"/contracts/" + d.name + ".sol"} download>
                  {t("Solidity source", "Solidity 源码")}
                  <Download size={14} />
                </a>
                <a href={"/contracts/" + d.name + ".abi.json"} download>
                  ABI
                  <Download size={14} />
                </a>
                {d.verified && (
                  <a href={d.verificationApi} target="_blank" rel="noreferrer">
                    Sourcify
                    <ArrowRight size={14} />
                  </a>
                )}
              </div>
            </details>
          </article>
        ))}
      </div>
      <p className="note">
        {t(
          "Dark uses the Tiger contract names for source verification. Previous reserve factory deployments are listed below.",
          "Dark 沿用 Tiger 合约名以便核对源码。储备金库工厂的历史部署列于下方。",
        )}
      </p>
      {config?.chains.bsc.history?.reserveFactory?.map((factory) => (
        <p key={factory.address} className="note">
          {t("Previous reserve factory", "旧版储备金库工厂")} ·{" "}
          <a
            href={config.chains.bsc.explorer + "/address/" + factory.address}
            target="_blank"
            rel="noreferrer"
          >
            {factory.address}
          </a>
        </p>
      ))}
      <section className="source-section">
        <h2>{t("Reproduce the build", "复现编译结果")}</h2>
        <p>
          {t(
            "The standard JSON contains the exact Solidity sources, dependencies and compilation settings used for this deployment. Verification is a source-to-bytecode match, not an independent security audit.",
            "标准 JSON 包含本次部署的完整 Solidity 源码、依赖与编译设置。源码验证证明与字节码匹配，不等同于独立安全审计。",
          )}
        </p>
        <div>
          <a className="button" href="/contracts/standard-input.json" download>
            <Download size={15} />
            {t("Complete compiler input", "完整编译输入")}
          </a>
          <a className="button" href="/contracts/build.json" download>
            {t("Compiler & source hash", "编译器与源码哈希")}
            <Download size={15} />
          </a>
          <a className="button" href="/dark-genesis-source.zip" download>
            {t("Full project source", "完整项目源码")}
            <Download size={15} />
          </a>
        </div>
      </section>
    </>
  );
}
