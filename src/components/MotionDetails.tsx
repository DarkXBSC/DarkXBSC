import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Pause, Play } from "lucide-react";
import { useApp } from "../lib/context";
import { useMotion } from "../lib/motion";
const chapters: Record<string, [string, string, string, string]> = {
  "/": ["/app/explore", "EXPLORE DARK.", "探索 DARK。", "floor"],
  "/app/explore": ["/app/launch", "MAKE IT REAL.", "真实发行。", "flip"],
  "/app/launch": ["/app/learn", "KNOW THE TOOLS.", "了解每一步。", "strips"],
  "/app/learn": ["/app/otc", "AGREE. THEN SETTLE.", "报价，再交割。", "wire"],
  "/app/otc": ["/app/rebalance", "MOVE INVENTORY.", "协调库存。", "tiles"],
  "/app/agent-otc": [
    "/app/rebalance",
    "MOVE INVENTORY.",
    "协调库存。",
    "tiles",
  ],
  "/app/rebalance": ["/", "BACK TO DARK.", "回到 DARK。", "tunnel"],
  "/app/contracts": [
    "/app/learn",
    "READ THE HANDBOOK.",
    "阅读使用教材。",
    "strips",
  ],
  "/app/activity": ["/app/explore", "EXPLORE DARK.", "探索 DARK。", "floor"],
};
export function NextChapter() {
  const { pathname } = useLocation(),
    { t } = useApp(),
    next = chapters[pathname];
  if (!next) return null;
  return (
    <Link to={next[0]} data-chapter={next[3]} className="next-page">
      <span>
        {t("NEXT", "下一步")}
        <ArrowRight size={14} />
      </span>
      <div>
        <strong data-fill={t(next[1], next[2])}>{t(next[1], next[2])}</strong>
        <i>
          <b />
          <ArrowRight size={22} />
        </i>
      </div>
    </Link>
  );
}
export function ReplaySeal() {
  const { replayIntro, canReplay, reduced } = useMotion(),
    { t } = useApp();
  return (
    <button
      className="replay-seal"
      aria-disabled={!canReplay || reduced}
      title={
        !canReplay
          ? t("Static view: animation is unavailable", "静态视图：动画暂不可用")
          : undefined
      }
      onClick={replayIntro}
      aria-label={t("Replay the opening film", "重播开场动画")}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <path
            id="dark-seal-ring"
            d="M50,50m-37,0a37,37 0 1,1 74,0a37,37 0 1,1 -74,0"
          />
        </defs>
        <text>
          <textPath href="#dark-seal-ring">
            DARK / REPLAY INTRO / DARK / REPLAY INTRO /{" "}
          </textPath>
        </text>
      </svg>
      <img src="/brand/dark-mark.png" alt="" />
    </button>
  );
}
export function MotionToggle() {
  const { paused, reduced, togglePause } = useMotion(),
    { t } = useApp();
  return (
    <button
      type="button"
      onClick={togglePause}
      disabled={reduced}
      aria-pressed={paused || reduced}
      title={
        reduced
          ? t(
              "Reduced motion follows your system setting",
              "已遵循系统减少动态效果设置",
            )
          : undefined
      }
    >
      {paused || reduced ? <Play size={12} /> : <Pause size={12} />}{" "}
      {t(
        paused || reduced ? "MOTION PAUSED" : "PAUSE MOTION",
        paused || reduced ? "动画已暂停" : "暂停动画",
      )}
    </button>
  );
}

// A process illustration, never a live transaction indicator.
export function FlowDiagram({
  kind = "otc",
}: {
  kind?: "otc" | "inventory" | "launch" | "agent" | "reserve";
}) {
  const { t } = useApp(),
    ref = useRef<HTMLDivElement>(null),
    { paused, reduced } = useMotion();
  const labels =
    kind === "inventory"
      ? [
          t("LOCK A", "锁定 A"),
          t("SAME HASH", "相同哈希"),
          t("LOCK B", "锁定 B"),
        ]
      : kind === "launch"
        ? [t("WALLET", "钱包"), t("SIMULATE", "模拟"), t("ISSUE", "发行")]
        : kind === "agent"
          ? [
              t("AGENT A", "AGENT A"),
              t("ID CHECK", "核对身份"),
              t("AGENT B", "AGENT B"),
            ]
          : kind === "reserve"
            ? [
                t("TOKEN TAX", "代币税"),
                t("RESERVE", "金库"),
                t("DEV / GUARDIAN", "DEV / GUARDIAN"),
              ]
            : [
                t("MAKER", "报价方"),
                t("SIGNATURE", "签名"),
                t("TAKER", "接单方"),
              ];
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => {
      if (ref.current) ref.current.dataset.visible = String(e.isIntersecting);
    });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="flow-diagram"
      data-still={paused || reduced}
      data-reveal
      aria-label={t("Process diagram", "流程示意")}
    >
      <svg viewBox="0 0 500 170" role="img" aria-label={labels.join(" → ")}>
        <g className="diagram-paths">
          <path pathLength="1" d="M70 52H175V85H218M282 85H325V52H430" />
          <path pathLength="1" d="M70 118H175V85M325 85V118H430" />
        </g>
        <g className="diagram-nodes">
          <rect x="48" y="41" width="22" height="22" />
          <rect x="48" y="107" width="22" height="22" />
          <rect x="218" y="53" width="64" height="64" />
          <rect
            x="235"
            y="70"
            width="30"
            height="30"
            className="diagram-core"
          />
          <rect x="430" y="41" width="22" height="22" />
          <rect x="430" y="107" width="22" height="22" />
        </g>
        <rect
          className="diagram-packet packet-in"
          x="-3"
          y="-3"
          width="6"
          height="6"
        />
        <rect
          className="diagram-packet packet-out"
          x="-3"
          y="-3"
          width="6"
          height="6"
        />
        <text x="60" y="157" textAnchor="middle">
          {labels[0]}
        </text>
        <text x="250" y="157" textAnchor="middle">
          {labels[1]}
        </text>
        <text x="440" y="157" textAnchor="middle">
          {labels[2]}
        </text>
      </svg>
      <span>
        {t("PROCESS DIAGRAM · NOT LIVE ACTIVITY", "流程示意 · 非实时交易")}
      </span>
    </div>
  );
}
