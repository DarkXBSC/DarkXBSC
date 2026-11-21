import * as THREE from "three";
import {
  CSS3DRenderer,
  CSS3DObject,
} from "three/addons/renderers/CSS3DRenderer.js";
import { gsap } from "gsap";
export type Cut =
  | "slide"
  | "floor"
  | "flip"
  | "strips"
  | "wire"
  | "tiles"
  | "tunnel";
export function runDepthTransition(
  stage: HTMLElement,
  old: HTMLElement,
  incoming: HTMLElement,
  scroll: number,
  cut: Cut,
  onDone: () => void,
) {
  const w = innerWidth,
    h = innerHeight,
    bg = getComputedStyle(document.documentElement)
      .getPropertyValue("--bg")
      .trim(),
    ink = getComputedStyle(document.documentElement)
      .getPropertyValue("--text")
      .trim();
  stage.replaceChildren();
  stage.style.background = bg;
  const scene = new THREE.Scene(),
    wireScene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(
      (2 * Math.atan(h / 2200) * 180) / Math.PI,
      w / h,
      1,
      20000,
    );
  camera.position.z = 1100;
  const css = new CSS3DRenderer();
  css.setSize(w, h);
  stage.append(css.domElement);
  css.domElement.style.position = "absolute";
  let renderer: THREE.WebGLRenderer | undefined;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(w, h);
    renderer.domElement.className = "depth-wires";
    stage.append(renderer.domElement);
  } catch {
    /* DOM planes still work without WebGL. */
  }
  const lineMat = new THREE.LineBasicMaterial({
    color: ink,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  const packetMat = new THREE.MeshBasicMaterial({
    color: ink,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  const timeline = gsap.timeline({ paused: true });
  let raf = 0,
    finished = false;
  const particles: { mesh: THREE.Mesh; tick: (t: number) => void }[] = [];
  function page(snapshot: HTMLElement, y = 0) {
    const el = document.createElement("div");
    el.className = "depth-page";
    Object.assign(el.style, {
      width: `${w}px`,
      height: `${h}px`,
      background: bg,
      overflow: "hidden",
      backfaceVisibility: "hidden",
    });
    Object.assign(snapshot.style, {
      width: `${w}px`,
      transform: `translateY(${-y}px)`,
      transformOrigin: "top left",
      visibility: "visible",
    });
    el.append(snapshot);
    return new CSS3DObject(el);
  }
  function line(points: THREE.Vector3[], closed = false) {
    const g = new THREE.BufferGeometry().setFromPoints(
      closed ? [...points, points[0]] : points,
    );
    const l = new THREE.Line(g, lineMat);
    wireScene.add(l);
    return l;
  }
  function frame(x: number, y: number, z: number, scale = 1) {
    const border = line(
      [
        new THREE.Vector3(x - w * 0.5 * scale, y - h * 0.5 * scale, z),
        new THREE.Vector3(x + w * 0.5 * scale, y - h * 0.5 * scale, z),
        new THREE.Vector3(x + w * 0.5 * scale, y + h * 0.5 * scale, z),
        new THREE.Vector3(x - w * 0.5 * scale, y + h * 0.5 * scale, z),
      ],
      true,
    );
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const xx = x + sx * (w * 0.5 * scale + 12),
          yy = y + sy * (h * 0.5 * scale + 12),
          length = 24;
        line([
          new THREE.Vector3(xx - sx * length, yy, z),
          new THREE.Vector3(xx, yy, z),
          new THREE.Vector3(xx, yy - sy * length, z),
        ]);
      }
    return border;
  }
  function packet(tick: (mesh: THREE.Mesh, t: number) => void) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(7, 7, 7), packetMat);
    wireScene.add(mesh);
    particles.push({ mesh, tick: (t) => tick(mesh, t) });
  }
  const a = page(old, scroll),
    b = page(incoming);
  scene.add(a, b);
  b.element.style.opacity = "0";
  const opacity = (
    o: CSS3DObject,
    value: number,
    start: number,
    duration: number,
  ) =>
    timeline.to(o.element, { opacity: value, duration, ease: "none" }, start);
  const fadeWires = (start: number, end: number) => {
    timeline
      .to([lineMat, packetMat], { opacity: 0.45, duration: 0.3 }, start)
      .to([lineMat, packetMat], { opacity: 0, duration: 0.25 }, end);
  };
  if (cut === "slide") {
    const order = [
      "/",
      "/app/explore",
      "/app/launch",
      "/app/learn",
      "/app/otc",
      "/app/agent-otc",
      "/app/rebalance",
      "/app/contracts",
      "/app/activity",
    ];
    const oldPath =
      old.querySelector("nav a.active")?.getAttribute("href") || "/";
    const direction =
      order.indexOf(location.pathname) >= order.indexOf(oldPath) ? 1 : -1;
    b.position.set(direction * w * 1.5, 0, -950);
    b.scale.setScalar(0.82);
    timeline
      .to(a.position, { z: -950, duration: 0.22, ease: "expo.inOut" }, 0)
      .to(
        a.scale,
        { x: 0.82, y: 0.82, z: 0.82, duration: 0.22, ease: "expo.inOut" },
        0,
      )
      .to(
        a.position,
        { x: -direction * w * 1.5, duration: 0.22, ease: "power3.in" },
        0.22,
      );
    opacity(a, 0, 0.3, 0.14);
    opacity(b, 1, 0.44, 0.14);
    timeline
      .to(b.position, { x: 0, duration: 0.2, ease: "power3.out" }, 0.44)
      .to(b.position, { z: 0, duration: 0.24, ease: "expo.inOut" }, 0.64)
      .to(
        b.scale,
        { x: 1, y: 1, z: 1, duration: 0.24, ease: "expo.inOut" },
        0.64,
      );
  } else if (cut === "floor") {
    const hinge = new THREE.Group();
    scene.add(hinge);
    hinge.position.y = -h / 2;
    hinge.add(a);
    a.position.y = h / 2;
    const incomingHinge = new THREE.Group();
    scene.add(incomingHinge);
    incomingHinge.position.set(0, -h / 2, -4600);
    incomingHinge.rotation.x = -Math.PI / 2;
    incomingHinge.add(b);
    b.position.y = h / 2;
    timeline.to(
      hinge.rotation,
      { x: -Math.PI / 2, duration: 0.6, ease: "power2.in" },
      0,
    );
    opacity(a, 0, 0.42, 0.22);
    opacity(b, 1, 0.95, 0.2);
    timeline
      .to(
        camera.position,
        { z: -3500, duration: 1.25, ease: "power3.inOut" },
        0.35,
      )
      .to(
        incomingHinge.rotation,
        { x: 0, duration: 0.6, ease: "power3.out" },
        1,
      );
    for (const x of [-0.46, -0.3, -0.14, 0.14, 0.3, 0.46]) {
      line([
        new THREE.Vector3(x * w, -h / 2, 900),
        new THREE.Vector3(x * w, -h / 2, -7600),
      ]);
      packet((m, t) =>
        m.position.set(
          x * w,
          -h / 2,
          900 - ((t * 5200 + (x + 1) * 2000) % 8500),
        ),
      );
    }
    fadeWires(0.38, 0.85);
  } else if (cut === "flip") {
    const group = new THREE.Group();
    scene.add(group);
    group.add(a, b);
    b.rotation.y = Math.PI;
    b.position.z = -1;
    b.element.style.opacity = "1";
    timeline
      .to(
        camera.position,
        { z: 2970, x: -0.18 * w, duration: 0.6, ease: "power3.inOut" },
        0,
      )
      .to(
        group.rotation,
        { y: Math.PI, duration: 0.8, ease: "power3.inOut" },
        0.55,
      )
      .to(
        group.rotation,
        { x: 0.14, duration: 0.4, ease: "power2.inOut", yoyo: true, repeat: 1 },
        0.55,
      )
      .to(
        camera.position,
        { x: 0, z: 1100, duration: 0.6, ease: "power3.inOut" },
        1.05,
      );
    frame(0, 0, 0, 1.04);
    const scan = line([
      new THREE.Vector3(-w * 0.54, h * 0.52, 12),
      new THREE.Vector3(w * 0.54, h * 0.52, 12),
    ]);
    timeline.to(
      scan.position,
      { y: -h * 1.04, duration: 0.45, ease: "power2.inOut" },
      0.3,
    );
    fadeWires(0.2, 1.2);
  } else if (cut === "strips") {
    scene.remove(a);
    for (let i = 0; i < 8; i++) {
      const strip = page(old.cloneNode(true) as HTMLElement, scroll);
      strip.element.style.clipPath = `inset(${i * 12.5}% 0 ${100 - (i + 1) * 12.5}% 0)`;
      scene.add(strip);
      const delay = 0.08 + i * 0.045;
      timeline
        .to(
          strip.position,
          {
            x: w * 1.3,
            z: -350 - (i % 3) * 140,
            duration: 0.6,
            ease: "power3.in",
          },
          delay,
        )
        .to(
          strip.rotation,
          { y: -0.28, duration: 0.6, ease: "power3.in" },
          delay,
        );
      opacity(strip, 0, delay + 0.4, 0.2);
      if (i > 0) {
        const y = h / 2 - (i * h) / 8;
        line([
          new THREE.Vector3(-w * 0.6, y, -300),
          new THREE.Vector3(w * 0.6, y, -300),
        ]);
        packet((m, t) =>
          m.position.set(
            -w * 0.6 + (((t + i * 0.1) * w * 0.9) % (w * 1.2)),
            y,
            -300,
          ),
        );
      }
    }
    b.position.set(-w * 1.15, 0, -900);
    b.rotation.y = 0.35;
    opacity(b, 1, 0.6, 0.25);
    timeline
      .to(b.position, { x: 0, z: 0, duration: 0.85, ease: "power3.out" }, 0.62)
      .to(b.rotation, { y: 0, duration: 0.85, ease: "power3.out" }, 0.62);
    fadeWires(0.1, 1.1);
  } else if (cut === "wire") {
    const x = w * 1.5,
      y = -h * 0.7,
      z = -1600;
    b.position.set(x, y, z);
    opacity(b, 1, 0.35, 0.25);
    timeline
      .to(camera.position, { z: 5300, duration: 0.7, ease: "power3.inOut" }, 0)
      .to(
        camera.position,
        { x, y, z: z + 1100, duration: 0.95, ease: "power3.inOut" },
        0.8,
      );
    opacity(a, 0, 1.15, 0.3);
    frame(0, 0, 0, 1.02);
    frame(x, y, z, 1.02);
    const path = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(w / 2, 0, 0),
        new THREE.Vector3(x * 0.62, 0, -700),
        new THREE.Vector3(x * 0.62, y, -700),
        new THREE.Vector3(x - w / 2, y, z),
      ],
      false,
      "catmullrom",
      0,
    );
    line(path.getPoints(80));
    const route = { p: 0 };
    timeline.to(route, { p: 1, duration: 0.65, ease: "power2.inOut" }, 0.5);
    packet((m) => m.position.copy(path.getPoint(route.p)));
    const gap = Math.max(w, h) * 0.32;
    for (let gx = -2; gx < 8; gx++)
      for (let gy = -5; gy < 4; gy++) {
        const dot = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), packetMat);
        dot.position.set(gx * gap, gy * gap, -700);
        wireScene.add(dot);
      }
    fadeWires(0.25, 1.4);
  } else if (cut === "tiles") {
    const size = w / 8,
      rows = Math.ceil(h / size),
      mid = (8 + rows - 2) * 0.035 + 0.35;
    b.position.z = -2;
    opacity(b, 1, mid, 0.01);
    opacity(a, 0, mid, 0.01);
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < 8; col++) {
        const el = document.createElement("div");
        el.className = "depth-tile";
        el.style.width = el.style.height = `${size + 1}px`;
        el.style.background = ink;
        const pieces = ["M0 50H100", "M0 50H50V0", "M0 50H100M50 50V0"];
        const shape = pieces[(row * 5 + col * 7) % pieces.length],
          turn = ((row * 3 + col * 7) % 4) * 90;
        el.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${shape}"/><rect x="44" y="44" width="12" height="12"/></svg>`;
        gsap.set(el.firstElementChild, {
          rotation: turn,
          transformOrigin: "50% 50%",
        });
        const tile = new CSS3DObject(el);
        tile.position.set(
          -w / 2 + (col + 0.5) * size,
          h / 2 - (row + 0.5) * size,
          3,
        );
        tile.rotation.y = Math.PI / 2;
        scene.add(tile);
        const delay = (col + row) * 0.035;
        timeline
          .to(tile.rotation, { y: 0, duration: 0.3, ease: "power2.out" }, delay)
          .to(
            el.firstElementChild,
            {
              rotation: turn + 90,
              transformOrigin: "50% 50%",
              duration: 0.25,
              ease: "power2.inOut",
            },
            mid - 0.15 + delay * 0.25,
          )
          .to(
            tile.rotation,
            { y: -Math.PI / 2, duration: 0.3, ease: "power2.in" },
            mid + 0.3 + delay,
          );
      }
  } else {
    b.position.z = -6600;
    b.element.style.opacity = "1";
    opacity(a, 0, 0, 0.3);
    for (let i = 1; i <= 5; i++) {
      frame(0, 0, -1100 * i, 1);
      const label = document.createElement("div");
      label.className = "depth-portal-label";
      label.textContent = [
        "EXPLORE",
        "LAUNCH",
        "HANDBOOK",
        "PRIVATE QUOTES",
        "REBALANCE",
      ][i - 1];
      label.style.opacity = "0";
      const portal = new CSS3DObject(label);
      portal.position.set(-w / 2 + 150, h / 2 - 30, -1100 * i + 2);
      scene.add(portal);
      timeline
        .to(label, { opacity: 1, duration: 0.25 }, 0.1)
        .to(label, { opacity: 0, duration: 0.25 }, 1.4);
      for (const side of [-1, 1])
        packet((m, t) =>
          m.position.set(side * w * 0.5, Math.sin(t + i) * h * 0.5, -1100 * i),
        );
    }
    timeline.to(
      camera.position,
      { z: -5500, duration: 1.55, ease: "power3.inOut" },
      0.1,
    );
    fadeWires(0.1, 1.4);
    timeline.to({}, { duration: 0.15 }, 1.65);
  }
  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    timeline.kill();
    window.removeEventListener("resize", finish);
    window.removeEventListener("keydown", key);
    window.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("visibilitychange", hidden);
    wireScene.traverse((o) => {
      if (o instanceof THREE.Line || o instanceof THREE.Mesh)
        o.geometry.dispose();
    });
    lineMat.dispose();
    packetMat.dispose();
    renderer?.dispose();
    stage.replaceChildren();
    stage.style.background = "";
    onDone();
  }
  function key(e: KeyboardEvent) {
    if (e.key === "Escape") finish();
  }
  function pointer(event: PointerEvent) {
    if (!(event.target as Element)?.closest(".transition-stop")) finish();
  }
  function hidden() {
    if (document.hidden) finish();
  }
  function render() {
    if (finished) return;
    const t = timeline.time();
    particles.forEach((p) => p.tick(t));
    css.render(scene, camera);
    renderer?.render(wireScene, camera);
    raf = requestAnimationFrame(render);
  }
  timeline.eventCallback("onComplete", finish);
  window.addEventListener("resize", finish);
  window.addEventListener("keydown", key);
  window.addEventListener("pointerdown", pointer, true);
  document.addEventListener("visibilitychange", hidden);
  timeline.play();
  render();
  return finish;
}
