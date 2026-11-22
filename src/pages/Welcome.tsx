import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Wallet } from "lucide-react";
import { OfficialTokenNotice } from "../components/Frame";
import { useApp } from "../lib/context";

export default function Welcome() {
  const { t, account, connect, config } = useApp();
  const [batch, setBatch] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/giving/capabilities", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const n = Number(data?.xMin);
        if (n > 0 && Number.isFinite(n)) setBatch(n);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const verified =
    config &&
    Object.values(config.chains.bsc.contracts).filter((c) => c.verified).length;
  return (
    <section className="bags-welcome">
      <h1>{t("WELCOME TO DARK", "欢迎来到 DARK")}</h1>
      <p className="welcome-sub">
        {t("Launch, trade, and give.", "发行、交易，让税收成为捐赠。")}
      </p>
      {account ? (
        <Link className="bags-action welcome-cta" to="/app/launch">
          {t("Launch a coin", "发行代币")}
        </Link>
      ) : (
        <button
          className="bags-action welcome-cta"
          onClick={() => void connect()}
        >
          <Wallet size={18} />
          {t("Connect wallet", "连接钱包")}
        </button>
      )}
      <details className="welcome-options">
        <summary>
          {t("More options", "更多选项")} <ChevronDown size={12} />
        </summary>
        <div>
          <Link to="/app/explore">{t("Explore markets", "浏览行情")}</Link>
          <Link to="/app/launch">{t("Launch a coin", "发行代币")}</Link>
        </div>
      </details>
      <div className="welcome-metrics">
        <span>{t("X Money giving batch", "X 公益单批税收")}</span>
        <strong>
          {batch === null
            ? "—"
            : batch.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{" "}
          <small>USDT</small>
        </strong>
        <dl>
          <div>
            <dt>{t("Launch network", "发行网络")}</dt>
            <dd>BSC + Base</dd>
          </div>
          <div>
            <dt>{t("Launchpad", "发行平台")}</dt>
            <dd>Flap V3</dd>
          </div>
          <div>
            <dt>{t("Verified contracts", "已验证合约")}</dt>
            <dd>
              <Link to="/app/contracts">{verified ?? "—"}</Link>
            </dd>
          </div>
        </dl>
      </div>
      <OfficialTokenNotice />
    </section>
  );
}
