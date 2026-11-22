import { useMotion } from "../lib/motion";
import { NextChapter, ReplaySeal } from "../components/MotionDetails";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, ArrowDown, RotateCcw, Pause, Play } from "lucide-react";
import {
  Header,
  Footer,
  ScrollRail,
  OfficialTokenNotice,
  Status,
} from "../components/Frame";
import SignalCanvas from "../components/SignalCanvas";
import LanguageSwitch from "../components/LanguageSwitch";
import { useApp } from "../lib/context";
export default function Home({ entry = false }: { entry?: boolean }) {
  const { phase } = useMotion();
  const { t, dark, config } = useApp();
  const { paused, reduced, canReplay, togglePause, replayIntro } = useMotion();
  const deployed = config
    ? Object.values(config.chains).reduce(
        (n, c) => n + Object.keys(c.contracts).length,
        0,
      )
    : 0;
  if (entry && phase === "settled")
    return <Navigate replace to="/app/home" />;
  if (entry)
    return (
      <main className="home entry-film">
        <LanguageSwitch className="film-language" />
        <section className="hero">
          <SignalCanvas />
        </section>
      </main>
    );
  return (
    <>
      <Header />
      <ScrollRail />
      <main className="home">
        <OfficialTokenNotice />
        <Status />
        <section className="hero">
          <SignalCanvas />
          <h1>
            <span>
              <span>{t("LIQUIDITY.", "流动性。")}</span>
            </span>
            <span>
              <span>{t("IN MOTION.", "在流动。")}</span>
            </span>
          </h1>
          <div className="hero-bottom">
            <div className="hero-actions">
              <Link to="/app/explore">
                <ArrowDown size={17} />
                {t("Explore the ecosystem", "探索生态")}
              </Link>
              <button
                onClick={replayIntro}
                aria-disabled={!canReplay || reduced}
                title={
                  !canReplay
                    ? t(
                        "Static view: animation is unavailable",
                        "静态视图：动画暂不可用",
                      )
                    : undefined
                }
              >
                <RotateCcw size={13} />
                {t("Replay", "重播")}
              </button>
              <button
                onClick={togglePause}
                disabled={reduced}
                aria-pressed={paused || reduced}
                aria-label={t("Toggle animation", "切换动画")}
              >
                {paused ? <Play size={13} /> : <Pause size={13} />}
              </button>
            </div>
            <div className="hero-description">
              <p>
                {t(
                  "Native launches. Private quotes. Inventory across markets. Dark connects the tools, while your wallet stays in control.",
                  "原生发行、私下报价与跨市场库存。Dark 连接交易工具，资产操作由你的钱包签名。",
                )}
              </p>
              <span data-decode>{t("FLAP V3 / PONS V2", "Flap V3 / Pons V2")}</span>
            </div>
          </div>
        </section>
        <section className="facts" aria-label={t("Protocol facts", "协议数据")}>
          <div>
            <strong>3</strong>
            <span>{t("NATIVE NETWORKS", "原生网络")}</span>
            <p>BSC · Base · Robinhood Chain</p>
          </div>
          <div>
            <strong>{deployed || "—"}</strong>
            <span>{t("NEW CONTRACTS", "全新部署合约")}</span>
            <Link to="/app/contracts">
              {t("Inspect the deployment", "查看部署记录")}
              <ArrowRight size={13} />
            </Link>
          </div>
          <div>
            <strong>0.30%</strong>
            <span>{t("OTC SETTLEMENT FEE", "OTC 成交手续费")}</span>
            <p>{t("Charged to the taker on settlement", "成交时由买方另付")}</p>
          </div>
          <div>
            <strong>{config ? Number(Boolean(config.officialToken)) : "—"}</strong>
            <span>{t("OFFICIAL TOKENS ISSUED", "官方代币发行数")}</span>
            {config?.officialToken && (
              <Link to="/app/contracts">
                {t("View token contract", "查看代币合约")}
                <ArrowRight size={13} />
              </Link>
            )}
          </div>
        </section>
        <section
          data-reveal
          className="routes-wordmarks"
          aria-label={t("Protocol routes", "协议渠道")}
        >
          <span data-cursor>
            <b className="word-fill" data-fill="Flap">
              Flap
            </b>
            <small>BSC + Base</small>
          </span>
          <span data-cursor>
            <b className="word-fill" data-fill={t("Giving", "公益")}>
              {t("Giving", "公益")}
            </b>
            <small>{t("X / SQUARE", "X / 币安广场")}</small>
          </span>
          <span data-cursor>
            <b className="word-fill" data-fill="Agent ID">
              Agent ID
            </b>
          </span>
          <span data-cursor>
            <b className="word-fill" data-fill="Sourcify">
              Sourcify
            </b>
          </span>
        </section>
        <section className="home-explainer">
          <h2>
            {t("One workspace. Your own wallet.", "一个工作台。自己的钱包。")}
          </h2>
          <div>
            <p>
              {t(
                "Launch through the native protocol. Share an OTC quote with a chosen counterparty. Coordinate inventory with explicit amounts and time limits.",
                "通过原生协议发行代币，与指定对手方分享 OTC 报价，使用明确的金额和时间限制协调库存。",
              )}
            </p>
            <p>
              {t(
                "An off-chain quote is private until shared. Its eventual settlement is public on the blockchain. Inventory exchange does not guarantee equal market prices.",
                "报价在链下保存并由你选择分享对象；最终成交在链上公开。库存交割不保证两端市场价格相同。",
              )}
            </p>
            <Link to="/app/learn">
              {t("Read the handbook", "阅读使用教材")}
              <ArrowRight size={15} />
            </Link>
          </div>
        </section>
        <NextChapter />
      </main>
      <Footer />
      <ReplaySeal />
    </>
  );
}
