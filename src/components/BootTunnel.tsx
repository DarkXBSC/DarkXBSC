import { useEffect, useRef } from "react";
import { createFilmScene } from "../lib/film-scene";
import { useMotion } from "../lib/motion";
import { useApp } from "../lib/context";
export default function BootTunnel() {
  const { setPhase } = useMotion(),
    { dark, t } = useApp(),
    canvas = useRef<HTMLCanvasElement>(null),
    host = useRef<HTMLDivElement>(null),
    count = useRef<HTMLElement>(null);
  useEffect(() => {
    const c = canvas.current!;
    let scene: ReturnType<typeof createFilmScene>;
    try {
      scene = createFilmScene(c);
    } catch {
      setPhase("settled");
      return;
    }
    let frame = 0,
      last = 0,
      time = 0,
      travel = 0,
      ready = false,
      handover = -1;
    const end = () => setPhase("settled");
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
    };
    const resize = () => scene.resize(innerWidth, innerHeight);
    const draw = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (!document.hidden) time += dt;
      const p = Math.min(time / 1.2, ready ? 1 : 0.92),
        speed = 0.6 + p * p * 30;
      if (count.current)
        count.current.textContent = String(Math.round(p * 100)).padStart(
          3,
          "0",
        );
      if (time >= 1.2 && ready && handover < 0) handover = time;
      const fade =
        handover < 0 ? 0 : Math.max(0, (time - handover - 0.5) / 0.6);
      if (host.current)
        host.current.style.opacity = String(1 - Math.min(1, fade));
      travel += dt * speed;
      scene.render(0, 1, speed, dark, 0, 0, 0, dt, travel);
      if (fade >= 1) {
        end();
        return;
      }
      frame = requestAnimationFrame(draw);
    };
    document.fonts.ready.then(() => {
      ready = true;
    });
    const timeout = setTimeout(end, 6000);
    resize();
    frame = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", key);
      scene.dispose();
    };
  }, [setPhase, dark]);
  return (
    <div ref={host} className="boot-tunnel">
      <canvas ref={canvas} aria-hidden="true" />
      <div className="film-loading" role="status">
        <span className="film-brand">{t("DARK / LIQUIDITY WORKSPACE", "DARK / 流动性工作台")}</span>
        <div className="loading-hud">
          <span>{t("00 — INGEST · DARK", "00 — 载入 · DARK")}</span>
          <span>
            <b ref={count}>000</b> / 100
          </span>
        </div>
        <span className="film-rate">{t("VISUAL SIGNAL / INITIALIZING", "视觉信号 / 正在初始化")}</span>
      </div>
      <button onClick={() => setPhase("settled")}>
        {t("Skip loading animation", "跳过加载动画")} / ESC
      </button>
    </div>
  );
}
