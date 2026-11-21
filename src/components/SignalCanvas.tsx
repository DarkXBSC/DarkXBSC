import { useEffect, useRef, useState } from "react";
import { createFilmScene } from "../lib/film-scene";
import { useMotion } from "../lib/motion";
import { useApp } from "../lib/context";
export default function SignalCanvas() {
  const { dark, t } = useApp(),
    motion = useMotion(),
    settings = useRef({ dark, ...motion });
  settings.current = { dark, ...motion };
  const canvas = useRef<HTMLCanvasElement>(null),
    host = useRef<HTMLDivElement>(null),
    clock = useRef<HTMLSpanElement>(null),
    progress = useRef<HTMLElement>(null),
    labels = useRef<HTMLDivElement>(null),
    replaySeen = useRef(motion.replay);
  const restart = useRef<() => void>(() => {}),
    skip = useRef<() => void>(() => {}),
    [shot, setShot] = useState(0),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const c = canvas.current!,
      container = host.current!,
      initialTime = performance.now();
    let scene: ReturnType<typeof createFilmScene>;
    try {
      scene = createFilmScene(c);
    } catch {
      settings.current.setCanReplay(false);
      restart.current = skip.current = () =>
        settings.current.setPhase("settled");
      setFailed(true);
      settings.current.setPhase("settled");
      return;
    }
    settings.current.setCanReplay(true);
    let available = true;
    let frame = 0,
      last = 0,
      time = ["settled", "boot"].includes(settings.current.phase) ? 9 : 0,
      loadTime = 0,
      ready = false,
      visible = true,
      px = 0,
      py = 0,
      shotIndex = -1,
      ended = ["settled", "boot"].includes(settings.current.phase),
      handoverAt = -1,
      travel = 0;
    let loading = settings.current.phase === "loading";
    const setSeen = () => {
      try {
        sessionStorage.setItem("dark:intro-seen", "1");
        if (location.pathname === "/") sessionStorage.setItem("dark:entry-film", "1");
      } catch {}
    };
    const finish = () => {
      if (ended) return;
      ended = true;
      time = Math.max(time, 6.6);
      settings.current.setPhase("settled");
      setSeen();
      container.dataset.reveal = "true";
    };
    skip.current = () => {
      loading = false;
      finish();
      start();
    };
    restart.current = () => {
      ended = false;
      loading = false;
      time = 0;
      loadTime = 2.3;
      shotIndex = -1;
      container.dataset.reveal = "false";
      start();
    };
    const resize = () => {
      const hero = container.closest(".hero")!;
      const r = hero.getBoundingClientRect();
      container.style.setProperty("--hero-top", `${r.top + scrollY}px`);
      container.style.setProperty("--hero-left", `${r.left}px`);
      scene.resize(innerWidth, innerHeight);
      start();
    };
    function draw(now: number) {
      frame = 0;
      if (!available) return;
      const s = settings.current,
        dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      const advancing = !s.paused && !s.reduced && visible && !document.hidden;
      if (s.reduced && !ended) {
        loading = false;
        finish();
      }
      if (advancing) {
        if (loading)
          loadTime = Math.max(loadTime + dt, (now - initialTime) / 1000);
        else time += dt;
      }
      let flight = 0,
        speed = 1;
      if (loading) {
        const p = Math.min(1, loadTime / 1.2) * (ready ? 1 : 0.92);
        if (progress.current)
          progress.current.textContent = String(Math.round(p * 100)).padStart(
            3,
            "0",
          );
        speed = 0.6 + p * p * 30;
        flight = 1;
        if (loadTime >= 1.2 && ready) {
          if (handoverAt < 0) handoverAt = loadTime;
          const handover = loadTime - handoverAt;
          speed *= Math.max(0.1, 1 - handover / 0.5);
          flight = 1 - Math.min(1, Math.max(0, (handover - 0.5) / 0.6));
          if (handover >= 0.5) {
            if (s.phase === "loading") settings.current.setPhase("film");
            time = handover - 0.5;
          }
          if (handover >= 1.1) loading = false;
        }
      } else flight = Math.max(0, 1 - time / 0.6);
      if (s.phase === "film" || (!loading && time < 6.6)) {
        const next = Math.min(3, Math.floor(time / 1.6));
        if (next !== shotIndex) {
          shotIndex = next;
          setShot(next);
        }
        if (clock.current)
          clock.current.textContent = `T+${Math.min(time, 6.6).toFixed(1)}`;
        container.dataset.reveal = String(time >= 6);
        if (time >= 6.6) finish();
      }
      c.dataset.phase = loading ? "loading" : time < 6.6 ? "film" : "settled";
      if (advancing) travel += dt * speed;
      scene.render(time, flight, speed, s.dark, px, py, scrollY, dt, travel);
      if (labels.current) {
        const points = scene.labelPositions();
        const fade =
          Math.max(0, Math.min(1, (time - 1.9) / 0.6)) *
          Math.max(0, Math.min(1, (6.5 - time) / 0.6));
        labels.current
          .querySelectorAll<HTMLElement>("span")
          .forEach((el, i) => {
            const point = points[i];
            el.style.transform = `translate(${point.x}px,${point.y}px)`;
            el.style.opacity = String(fade * point.alpha);
          });
      }
      if (advancing) frame = requestAnimationFrame(draw);
    }
    function start() {
      if (!available) return;
      cancelAnimationFrame(frame);
      last = 0;
      frame = requestAnimationFrame(draw);
    }
    const move = (e: PointerEvent) => {
      px = (e.clientX / innerWidth - 0.5) * 2;
      py = -(e.clientY / innerHeight - 0.5) * 2;
    };
    const stopFilm = (e: Event) => {
      if (!["loading", "film"].includes(settings.current.phase)) return;
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") skip.current();
        return;
      }
      if ((e.target as Element)?.closest?.("button,a,input,select,textarea"))
        return;
      skip.current();
    };
    const contextLost = (e: Event) => {
      e.preventDefault();
      available = false;
      cancelAnimationFrame(frame);
      scene.dispose();
      settings.current.setCanReplay(false);
      restart.current = skip.current = () =>
        settings.current.setPhase("settled");
      setFailed(true);
      settings.current.setPhase("settled");
      setSeen();
    };
    const onMotion = () => {
      if (settings.current.phase === "settled" && !ended) {
        ended = true;
        time = Math.max(time, 9);
        loading = false;
      }
      start();
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting || settings.current.phase !== "settled";
      start();
    });
    io.observe(container.closest(".hero")!);
    const ro = new ResizeObserver(resize);
    ro.observe(container.closest(".hero")!);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("dark:motion", onMotion);
    window.addEventListener("keydown", stopFilm);
    window.addEventListener("wheel", stopFilm, { passive: true });
    window.addEventListener("click", stopFilm);
    document.addEventListener("visibilitychange", start);
    c.addEventListener("webglcontextlost", contextLost);
    const timeout = window.setTimeout(() => {
      ready = true;
      start();
    }, 6000);
    Promise.all([
      document.fonts.ready,
      new Promise<void>((resolve) => {
        if (document.readyState === "complete") resolve();
        else window.addEventListener("load", () => resolve(), { once: true });
      }),
    ]).then(() => {
      ready = true;
    });
    resize();
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("dark:motion", onMotion);
      window.removeEventListener("keydown", stopFilm);
      window.removeEventListener("wheel", stopFilm);
      window.removeEventListener("click", stopFilm);
      document.removeEventListener("visibilitychange", start);
      c.removeEventListener("webglcontextlost", contextLost);
      if (available) scene.dispose();
    };
  }, []);
  useEffect(() => {
    window.dispatchEvent(new Event("dark:motion"));
  }, [dark]);
  useEffect(() => {
    if (motion.replay !== replaySeen.current) {
      replaySeen.current = motion.replay;
      restart.current();
    }
  }, [motion.replay]);
  const captions = [
    t("UNORDERED SIGNALS.", "无序的信号。"),
    t("NATIVE SOURCES.", "连接原生网络。"),
    t("ONE SHARED CORE.", "经过同一核心。"),
    t("CLEAR DESTINATIONS.", "抵达明确目标。"),
  ];
  return (
    <div
      ref={host}
      className={`signal-stage${failed ? " signal-fallback" : ""}`}
      data-reveal={motion.phase === "settled"}
    >
      <canvas ref={canvas} className="signal-canvas" aria-hidden="true" />
      {failed && (
        <svg className="static-flow" viewBox="0 0 1440 1000" aria-hidden="true">
          <path d="M80 340C400 100 470 700 670 500M80 500H670M80 660C400 850 470 280 670 500M770 500C980 500 1100 340 1360 340M770 500H1360M770 500C980 500 1100 660 1360 660" />
          <rect x="670" y="420" width="100" height="160" />
        </svg>
      )}
      {motion.phase === "loading" && (
        <div className="film-loading" role="status">
          <span className="film-brand">{t("DARK / LIQUIDITY WORKSPACE", "DARK / 流动性工作台")}</span>
          <div className="loading-hud">
            <span>{t("00 — INGEST · DARK", "00 — 载入 · DARK")}</span>
            <span>
              <b ref={progress}>000</b> / 100
            </span>
          </div>
          <span className="film-rate">{t("VISUAL SIGNAL / INITIALIZING", "视觉信号 / 正在初始化")}</span>
          <button className="intro-skip" onClick={() => skip.current()}>{t("Skip intro", "跳过开场")} / ESC</button>
        </div>
      )}
      <div ref={labels} className="film-labels" aria-hidden="true">
        {[
          "SRC.01 BSC",
          "SRC.02 FLAP",
          "SRC.03 WALLET",
          "CORE / DARK",
          "DST.01 LAUNCH",
          "DST.02 QUOTE",
          "DST.03 GIVING",
        ].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {motion.phase === "film" && (
        <div className="film-hud" data-fading={shot === 3}>
          <span className="film-caption" key={shot}>
            {[...captions[shot]].map((letter, i) => (
              <i key={i} style={{ animationDelay: `${i * 14}ms` }}>
                {letter === " " ? "\u00a0" : letter}
              </i>
            ))}
          </span>
          <span ref={clock}>T+0.0</span>
          <button onClick={() => skip.current()}>
            {t("Skip intro", "跳过开场")} / ESC
          </button>
        </div>
      )}
    </div>
  );
}
