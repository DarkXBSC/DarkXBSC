import { ArrowRight, Check, Download, RefreshCw } from "lucide-react";
import { PageTitle, CopyText, OfficialTokenNotice } from "../components/Frame";
import { useApp } from "../lib/context";
import { railgunNetwork } from "../lib/railgun-config.mjs";
const rail = railgunNetwork("bsc");
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
        .filter(([chain]) => ["bsc", "base"].includes(chain))
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
      <section className="issue-card">
        <h2>{t("Launch contracts", "发行合约")}</h2>
        <p>{t("BSC and Base launches use Flap V3. Robinhood Chain launches use Pons V2. Dark’s custom registry, commission vaults and OTC contracts are currently on BSC. The official Dark token remains on BSC.", "BSC 和 Base 通过 Flap V3 发行，Robinhood Chain 通过 Pons V2 发行。Dark 自有登记簿、公益委托金库与 OTC 合约目前在 BSC；官方 Dark 代币也仍在 BSC。")}</p>
        <div className="contracts-list">{config && (["bsc", "base"] as const).map(chain => <article key={chain}><h3>{chain === "base" ? "Base · 8453" : "BSC · 56"}</h3>{(["portal", "vaultPortal", "taxImplementation"] as const).map(key => <div key={key}><p>Flap · {key}</p><CopyText value={config.protocols.flapChains[chain][key]} /><a href={config.chains[chain].explorer + "/address/" + config.protocols.flapChains[chain][key] + "#code"} target="_blank" rel="noreferrer">{t("Contract source", "查看合约源码")}</a></div>)}</article>)}
          {config && <article>
            <h3>Robinhood Chain · 4663</h3>
            {(["factory", "launchAndBuy"] as const).map(key => <div key={key}>
              <p>Pons V2 · {key === "factory" ? t("Launch factory", "发行工厂") : t("Launch and first buy", "发行与首买路由")}</p>
              <CopyText value={config.protocols.pons[key]} />
              <a href={config.chains.robinhood.explorer + "/address/" + config.protocols.pons[key]} target="_blank" rel="noreferrer">{t("Explorer", "区块浏览器")}</a>
            </div>)}
          </article>}
        </div>
      </section>
      <section className="issue-card">
        <h2>RAILGUN · BSC</h2>
        <p>{t("Third-party protocol used for shield deposits.", "隐私存入使用的第三方协议合约。")}</p>
        {[[rail.proxy, "Smart Wallet"], [rail.relay, "RelayAdapt"]].map(([address, name]) => <div key={address}><b>{name}</b> <CopyText value={address} /> <a href={"https://bscscan.com/address/" + address + "#code"} target="_blank" rel="noreferrer">{t("Contract source", "查看合约源码")}</a></div>)}
      </section>
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
