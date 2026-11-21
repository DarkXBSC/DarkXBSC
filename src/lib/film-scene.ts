import * as THREE from "three";

// Authored geometry/shaders. The measured reference timing is in docs/motion-spec.md.
const vertex = `
attribute vec4 seed;
attribute float trail;
uniform float time, gather, tunnel, pixelRatio, speed, flightTime;
varying float alpha;
float ease(float x){x=clamp(x,0.,1.);return x*x*(3.-2.*x);}
void main(){
 float lane=floor(seed.x*12.); float u=fract(seed.y+time*(.07+seed.z*.05)-trail*.0045);
 float inputY=(mod(lane,3.)-1.)*1.1;
 float outputY=(mod(lane+1.,3.)-1.)*1.1;
 float coreY=(lane/11.-.5)*.5;
 float a=ease(u/.5), b=ease((u-.5)/.5);
 float amp=(1.-a)*.55;
 vec3 flow=vec3(-4.2+8.4*u,mix(inputY,coreY,a)+sin(u*26.+lane*1.7+time*.8)*amp,cos(u*21.+lane*2.3+time*.6)*amp);
 if(u>.5)flow=vec3(-4.2+8.4*u,mix(coreY,outputY+(seed.x-.5)*.12,b),0.);
 float az=seed.y*6.2831853, cy=seed.z*2.-1., radius=2.+seed.w*4.;
 vec3 cloud=vec3(cos(az)*sqrt(1.-cy*cy),cy*.6,sin(az)*sqrt(1.-cy*cy))*radius;
 cloud+=vec3(sin(time*.3+seed.w*6.)*.25,cos(time*.25+seed.y*6.)*.2,0.);
 vec4 view=modelViewMatrix*vec4(mix(cloud,flow,gather),1.);
 float z=.3+mod(seed.w*40.-flightTime+trail*speed*.006,40.);
 float r=.25+pow(seed.z,.8)*1.9;
 vec4 flight=vec4(cos(az)*r,sin(az)*r*.75,-z,1.);
 view=mix(view,flight,tunnel);
 gl_Position=projectionMatrix*view;
 gl_PointSize=clamp((1.1+pow(seed.z,3.)*1.5)*5.5/max(.15,-view.z),1.05,9.)*pixelRatio;
 float edge=smoothstep(.3,1.2,z)*clamp(1.3-z/34.,0.,1.); vec2 screen=abs(gl_Position.xy/gl_Position.w); edge*=smoothstep(1.,.8,screen.x)*smoothstep(1.,.8,screen.y);
 float tail=trail==0.?1.:(u>.5?(1.-trail*.38)*.7*gather:0.);
 float fade=clamp(1.25+view.z/13.,.3,1.);
 alpha=mix((.25+gather*(u>.5?.75:.35))*tail*fade,edge*(.75+pow(seed.z,3.)*.25)*(trail==0.?1.:(1.-trail*.38)*.7),tunnel);
}`;
const fragment = `
uniform vec3 ink; varying float alpha;
void main(){float d=length(gl_PointCoord-.5)*2.; if(d>1.)discard; gl_FragColor=vec4(ink,alpha*(1.-smoothstep(.35,1.,d)));}`;
const cameraCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-3.2, 0.5, 2.4),
  new THREE.Vector3(-1.2, 1.6, 4.2),
  new THREE.Vector3(0.8, 0.9, 6.2),
  new THREE.Vector3(0, 0, 8.2),
]);
const lookCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-2.5, 0, 0),
  new THREE.Vector3(-0.5, 0, 0),
  new THREE.Vector3(0.5, 0, 0),
  new THREE.Vector3(0, 0, 0),
]);
const smooth = (x: number) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
const inOut = (x: number) =>
  x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
export function createFilmScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0, 0);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const geometry = new THREE.BufferGeometry(),
    count = 9000 * 3;
  const seeds = new Float32Array(count * 4),
    trails = new Float32Array(count);
  let state = 731991;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < 9000; i++) {
    const s = [random(), random(), random(), random()];
    for (let j = 0; j < 3; j++) {
      seeds.set(s, (i * 3 + j) * 4);
      trails[i * 3 + j] = j;
    }
  }
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(count * 3), 3),
  );
  geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
  geometry.setAttribute("trail", new THREE.BufferAttribute(trails, 1));
  const uniforms = {
    time: { value: 0 },
    gather: { value: 0 },
    tunnel: { value: 1 },
    pixelRatio: { value: 1 },
    speed: { value: 5 },
    flightTime: { value: 0 },
    ink: { value: new THREE.Color("#101010") },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const particles = new THREE.Points(geometry, material);
  particles.frustumCulled = false;
  scene.add(particles);
  const source = new THREE.Group(),
    destination = new THREE.Group(),
    core = new THREE.Group();
  scene.add(source, destination, core);
  const lineMaterials: THREE.LineBasicMaterial[] = [];
  function box(
    parent: THREE.Group,
    w: number,
    h: number,
    d: number,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const g = new THREE.BoxGeometry(w, h, d),
      edges = new THREE.EdgesGeometry(g);
    g.dispose();
    const mat = new THREE.LineBasicMaterial({
      color: 0x101010,
      transparent: true,
      opacity: 0.5,
    });
    lineMaterials.push(mat);
    const line = new THREE.LineSegments(edges, mat);
    line.position.set(x, y, z);
    parent.add(line);
    return line;
  }
  for (let i = 0; i < 3; i++) {
    box(source, 0.35, 0.22, 0.22, -4.3, (i - 1) * 1.1);
    box(destination, 0.35, 0.22, 0.22, 4.3, (i - 1) * 1.1);
  }
  box(core, 0.7, 1.1, 0.7);
  const inner = box(core, 0.38, 0.38, 0.38);
  inner.rotation.set(Math.PI / 4, Math.PI / 4, 0);
  const faceMaterial = new THREE.MeshBasicMaterial({
    color: 0x101010,
    transparent: true,
    opacity: 0.05,
    depthWrite: false,
  });
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.1, 0.7),
    faceMaterial,
  );
  core.add(face);
  const pointer = new THREE.Vector2();
  let width = 1,
    height = 1,
    frames = 0;
  function resize(w: number, h: number) {
    width = w;
    height = h;
    const d = Math.min(devicePixelRatio, 2);
    renderer.setPixelRatio(d);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    uniforms.pixelRatio.value = d;
  }
  function render(
    time: number,
    flight: number,
    flightSpeed: number,
    dark: boolean,
    px: number,
    py: number,
    scroll: number,
    dt: number,
    flightTime = time,
  ) {
    uniforms.time.value = time;
    uniforms.flightTime.value = flightTime;
    uniforms.gather.value = inOut(Math.min(1, Math.max(0, (time - 1.2) / 2.2)));
    uniforms.tunnel.value = flight;
    uniforms.speed.value = flightSpeed;
    const ink = dark ? 0xf5f5f5 : 0x101010;
    uniforms.ink.value.setHex(ink);
    for (const mat of lineMaterials) mat.color.setHex(ink);
    faceMaterial.color.setHex(ink);
    function opacity(group: THREE.Group, amount: number) {
      for (const child of group.children) {
        if (child instanceof THREE.LineSegments)
          (child.material as THREE.LineBasicMaterial).opacity = amount * 0.7;
      }
    }
    opacity(source, smooth((time - 1.6) / 0.8) * (1 - flight));
    opacity(core, smooth((time - 2.8) / 0.8) * (1 - flight));
    opacity(destination, smooth((time - 4.6) / 0.8) * (1 - flight));
    faceMaterial.opacity =
      (0.05 + 0.02 * Math.sin(time * 1.4)) *
      smooth((time - 2.8) / 0.8) *
      (1 - flight);
    inner.rotation.y = Math.PI / 4 + time * 0.25;
    core.rotation.y = 0.8 * (1 - smooth((time - 2.8) / 2.2));
    const p = inOut(Math.min(time / 6.6, 1)),
      pos = cameraCurve.getPoint(p),
      look = lookCurve.getPoint(p),
      idle = smooth((time - 6.6) / 2);
    pointer.lerp(
      new THREE.Vector2(px, py),
      1 - Math.exp(-2.5 * Math.max(dt, 0.001)),
    );
    pos.z *= Math.max(1, 1.5 / camera.aspect);
    pos.x += idle * (Math.sin(time * 0.2) * 0.15 + pointer.x * 0.25);
    pos.y += idle * (Math.cos(time * 0.17) * 0.08 + pointer.y * 0.15);
    pos.z -= idle * Math.min(1.5, Math.max(0, scroll / height)) * 2.2;
    camera.position.copy(pos);
    camera.lookAt(look);
    renderer.render(scene, camera);
    if (++frames % 30 === 0) {
      canvas.dataset.time = time.toFixed(3);
      canvas.dataset.frames = String(frames);
      canvas.dataset.size = `${width}x${height}`;
    }
  }
  const labelVectors = [
    [-4.3, 0.88, 0],
    [-4.3, -0.22, 0],
    [-4.3, -1.32, 0],
    [0, -0.72, 0],
    [4.3, 0.88, 0],
    [4.3, -0.22, 0],
    [4.3, -1.32, 0],
  ].map((p) => new THREE.Vector3(...(p as [number, number, number])));
  return {
    labelPositions() {
      return labelVectors.map((v, i) => {
        const p = v.clone().project(camera);
        const time = uniforms.time.value;
        return {
          x: (p.x * 0.5 + 0.5) * width - 24,
          y: (-0.5 * p.y + 0.5) * height,
          alpha:
            p.z > 1
              ? 0
              : i < 3
                ? smooth((time - 1.6) / 0.8)
                : i === 3
                  ? smooth((time - 2.8) / 0.8)
                  : smooth((time - 4.6) / 0.8),
        };
      });
    },
    resize,
    render,
    dispose() {
      scene.traverse((o) => {
        if (
          o instanceof THREE.Mesh ||
          o instanceof THREE.LineSegments ||
          o instanceof THREE.Points
        )
          o.geometry.dispose();
      });
      material.dispose();
      faceMaterial.dispose();
      lineMaterials.forEach((m) => m.dispose());
      renderer.dispose();
    },
  };
}
