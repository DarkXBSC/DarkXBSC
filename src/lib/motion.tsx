import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import type { Cut } from "./depth-scene";
import { snapshotPage } from "./page-snapshot";
import { lazy, Suspense } from "react";
const BootTunnel = lazy(() => import("../components/BootTunnel"));

type Phase = "loading" | "film" | "settled" | "boot";
type MotionState = {
  canReplay: boolean;
  setCanReplay: (available: boolean) => void;
  paused: boolean;
  reduced: boolean;
  phase: Phase;
  replay: number;
  setPhase: (p: Phase) => void;
  togglePause: () => void;
  replayIntro: () => void;
};
const Context = createContext<MotionState>(null!);
export const useMotion = () => useContext(Context);
export function motionEnabled() {
  return document.documentElement.dataset.motion !== "off";
}
export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [canReplay, setCanReplay] = useState(true);
  const [paused, setPaused] = useState(false),
    [replay, setReplay] = useState(0);
  const [phase, setPhase] = useState<Phase>(() => {
    try {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches)
        return "settled";
      return (location.pathname === "/" && !sessionStorage.getItem("dark:entry-film")) || (location.pathname === "/about" && !sessionStorage.getItem("dark:intro-seen"))
        ? "loading"
        : "settled";
    } catch {
      return "settled";
    }
  });
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(m.matches);
    m.addEventListener("change", change);
    return () => m.removeEventListener("change", change);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = paused || reduced ? "off" : "on";
    document.documentElement.dataset.intro = phase;
    window.dispatchEvent(new Event("dark:motion"));
  }, [paused, reduced, phase]);
  useEffect(() => {
    if (reduced && phase !== "settled") setPhase("settled");
  }, [reduced, phase]);
  return (
    <Context.Provider
      value={{
        canReplay,
        setCanReplay,
        paused,
        reduced,
        phase,
        replay,
        setPhase,
        togglePause: () => setPaused((p) => !p),
        replayIntro: () => {
          if (!canReplay || reduced) {
            setPhase("settled");
            return;
          }
          setPaused(false);
          setReplay((n) => n + 1);
          setPhase(reduced ? "settled" : "film");
          scrollTo(0, 0);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function MotionShell({ children }: { children: ReactNode }) {
  const location = useLocation(),
    host = useRef<HTMLDivElement>(null),
    overlay = useRef<HTMLDivElement>(null);
  const { paused, reduced, phase, setPhase, togglePause } = useMotion();
  const pending = useRef<{
    snapshot: HTMLElement;
    path: string;
    cut: Cut;
    scroll: number;
  } | null>(null);
  const cancel = useRef<(() => void) | null>(null),
    previous = useRef(location.pathname),
    generation = useRef(0);
  useEffect(() => {
    const capture = (path: string, cut: Cut) => {
      if (
        !host.current ||
        path.startsWith("/app/") || window.location.pathname.startsWith("/app/") ||
        !motionEnabled() ||
        path === window.location.pathname
      )
        return;
      cancel.current?.();
      pending.current = {
        snapshot: snapshotPage(host.current),
        path,
        cut,
        scroll: scrollY,
      };
    };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (
        !link ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        link.target ||
        link.download ||
        event.defaultPrevented
      )
        return;
      const url = new URL(link.href);
      if (
        url.origin !== window.location.origin ||
        url.pathname === window.location.pathname
      )
        return;
      capture(url.pathname, (link.dataset.chapter as Cut) || "slide");
    };
    // popstate has already changed location; use the still-rendered React plane.
    const pop = () => {
      if (host.current && motionEnabled() && !window.location.pathname.startsWith("/app/")) {
        cancel.current?.();
        pending.current = {
          snapshot: snapshotPage(host.current),
          path: window.location.pathname,
          cut: "slide",
          scroll: scrollY,
        };
      }
    };
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", pop);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", pop);
      cancel.current?.();
    };
  }, []);
  useLayoutEffect(() => {
    if (previous.current === location.pathname) return;
    previous.current = location.pathname;
    const id = ++generation.current,
      old = pending.current;
    pending.current = null;
    setPhase("settled");
    const plane = host.current!,
      stage = overlay.current!;
    let closed = false,
      started = false,
      frame = 0,
      nextFrame = 0,
      timer = 0;
    let observer: MutationObserver | undefined,
      stopActive: (() => void) | undefined;
    const finish = () => {
      if (closed) return;
      closed = true;
      if (generation.current === id) generation.current++;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
      observer?.disconnect();
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", finish);
      window.removeEventListener("pointerdown", pointer, true);
      const stop = stopActive;
      stopActive = undefined;
      stop?.();
      if (cancel.current === finish) cancel.current = null;
      delete document.documentElement.dataset.transition;
      plane.style.visibility = "";
      plane.inert = false;
      stage.replaceChildren();
      stage.style.background = "";
      scrollTo(0, 0);
      window.dispatchEvent(new Event("dark:route-ready"));
      const focus = plane.querySelector<HTMLElement>("h1") || plane;
      focus.setAttribute("tabindex", "-1");
      focus.focus({ preventScroll: true });
    };
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
    }
    function pointer(e: PointerEvent) {
      if (!(e.target as Element)?.closest(".transition-stop")) finish();
    }
    const valid = () =>
      !closed &&
      generation.current === id &&
      motionEnabled() &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Own cancellation before hiding anything, including route readiness and lazy import.
    cancel.current = finish;
    if (!old || !valid()) {
      frame = requestAnimationFrame(finish);
      return finish;
    }
    window.addEventListener("keydown", key);
    window.addEventListener("resize", finish);
    window.addEventListener("pointerdown", pointer, true);
    document.documentElement.dataset.transition = "waiting";
    plane.style.visibility = "hidden";
    plane.inert = true;
    stage.replaceChildren(old.snapshot);
    old.snapshot.style.transform = `translateY(${-old.scroll}px)`;
    const start = () => {
      if (
        started ||
        closed ||
        plane.querySelector(".route-loading") ||
        !plane.querySelector("h1")
      )
        return;
      if (!valid()) {
        finish();
        return;
      }
      started = true;
      observer?.disconnect();
      scrollTo(0, 0);
      frame = requestAnimationFrame(() => {
        nextFrame = requestAnimationFrame(() => {
          if (!valid()) {
            finish();
            return;
          }
          const incoming = snapshotPage(plane, true);
          import("./depth-scene")
            .then(({ runDepthTransition }) => {
              if (closed || generation.current !== id) return;
              if (!valid()) {
                finish();
                return;
              }
              clearTimeout(timer);
              timer = window.setTimeout(finish, 3000);
              document.documentElement.dataset.transition = old.cut;
              stopActive = runDepthTransition(
                stage,
                old.snapshot,
                incoming,
                old.scroll,
                old.cut,
                finish,
              );
            })
            .catch(() => {
              if (!closed && generation.current === id) finish();
            });
        });
      });
    };
    observer = new MutationObserver(start);
    observer.observe(plane, { childList: true, subtree: true });
    timer = window.setTimeout(finish, 3000);
    start();
    return finish;
  }, [location.pathname, setPhase]);
  useEffect(() => {
    if (paused || reduced) cancel.current?.();
  }, [paused, reduced]);
  return (
    <>
      <div ref={host} className="page-plane" inert={phase === "boot"}>
        {children}
      </div>
      <div className="depth-stage" ref={overlay} aria-hidden="true" inert />
      {phase === "boot" && (
        <Suspense fallback={<div className="boot-tunnel" />}>
          <BootTunnel />
        </Suspense>
      )}
      <button
        className="transition-stop"
        onClick={() => {
          cancel.current?.();
          togglePause();
        }}
        aria-label="Pause transition / 暂停转场"
      >
        PAUSE / 暂停
      </button>
      <CursorBrackets />
      <MotionReveals
        route={location.pathname}
        enabled={!paused && !reduced && location.pathname === "/about"}
        settled={phase === "settled"}
      />
    </>
  );
}

function CursorBrackets() {
  const el = useRef<HTMLDivElement>(null),
    { paused, reduced } = useMotion();
  useEffect(() => {
    if (paused || reduced) return;
    const box = el.current!;
    let x = 0,
      y = 0,
      frame = 0,
      target: HTMLElement | null = null;
    const paint = () => {
      frame = 0;
      const r = target?.getBoundingClientRect();
      box.style.transform = `translate3d(${r ? r.left - 6 : x - 12}px,${r ? r.top - 6 : y - 12}px,0)`;
      box.style.width = `${r ? r.width + 12 : 24}px`;
      box.style.height = `${r ? r.height + 12 : 24}px`;
      box.dataset.snap = String(!!r);
      box.style.opacity = r ? "1" : ".45";
    };
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      target =
        (e.target as Element)?.closest<HTMLElement>(
          "a,button,input,select,textarea,[data-cursor]",
        ) ?? null;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const hide = () => {
      box.style.opacity = "0";
      target = null;
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      hide();
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", hide);
    };
  }, [paused, reduced]);
  return (
    <div ref={el} className="cursor-brackets" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
function MotionReveals({
  route,
  enabled,
  settled,
}: {
  route: string;
  enabled: boolean;
  settled: boolean;
}) {
  useEffect(() => {
    if (!enabled || !settled) return;
    let observer: IntersectionObserver | undefined;
    const timers = new Set<number>(),
      animations = new Set<Animation>();
    const visited = new WeakSet<Element>();
    const animate = (el: HTMLElement, frames: Keyframe[], delay = 0) => {
      const a = el.animate(frames, {
        duration: 620,
        delay,
        easing: "cubic-bezier(.16,1,.3,1)",
        fill: "backwards",
      });
      animations.add(a);
      a.onfinish = () => animations.delete(a);
    };
    const scan = () => {
      document
        .querySelectorAll<HTMLElement>(
          ".page-plane .facts > div,.page-plane .home-explainer,.page-plane .next-page,.page-plane .contract-row,.page-plane .guide-steps > li,.page-plane [data-reveal]",
        )
        .forEach((el) => {
          if (visited.has(el)) return;
          visited.add(el);
          observer?.observe(el);
        });
      document
        .querySelectorAll<HTMLElement>(".page-plane [data-decode]")
        .forEach((el) => {
          if (visited.has(el) || el.children.length) return;
          visited.add(el);
          const original = el.textContent || "",
            start = performance.now(),
            alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ/0123456789";
          el.dataset.decodeActive = "true";
          const timer = window.setInterval(() => {
            const p = Math.min(1, (performance.now() - start) / 650),
              n = Math.floor(p * original.length);
            el.dataset.decodeText = [...original]
              .map((c, i) =>
                i < n || /\s/.test(c)
                  ? c
                  : alphabet[Math.floor(Math.random() * alphabet.length)],
              )
              .join("");
            if (p === 1) {
              clearInterval(timer);
              timers.delete(timer);
              delete el.dataset.decodeActive;
              delete el.dataset.decodeText;
            }
          }, 40);
          timers.add(timer);
        });
    };
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            const el = e.target as HTMLElement;
            observer?.unobserve(el);
            const border = parseFloat(getComputedStyle(el).borderTopWidth) > 0;
            animate(
              el,
              border
                ? [
                    { clipPath: "inset(0 100% 0 0)" },
                    { clipPath: "inset(0 0 0 0)" },
                  ]
                : [
                    { opacity: 0.35, transform: "translateY(14px)" },
                    { opacity: 1, transform: "none" },
                  ],
            );
          }
      },
      { rootMargin: "0px 0px -36px 0px" },
    );
    const ready = () => scan();
    window.addEventListener("dark:route-ready", ready);
    scan();
    const mutation = new MutationObserver(scan);
    const plane = document.querySelector(".page-plane");
    if (plane) mutation.observe(plane, { subtree: true, childList: true });
    return () => {
      observer?.disconnect();
      mutation.disconnect();
      timers.forEach(clearInterval);
      document
        .querySelectorAll<HTMLElement>("[data-decode-active]")
        .forEach((el) => {
          delete el.dataset.decodeActive;
          delete el.dataset.decodeText;
        });
      animations.forEach((a) => a.cancel());
      window.removeEventListener("dark:route-ready", ready);
    };
  }, [route, enabled, settled]);
  return null;
}
