import * as THREE from 'three';
import { groundY } from './world';
import { bake } from './merge';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The player's cage: centred on the start, big enough for a Brachiosaurus, too tall to jump out of. All cages share its size. */
export const CAGE = { x: 0, z: 6, half: 7, height: 9 };
/** Bumps a side takes before its bars bend far enough to squeeze through. */
export const CAGE_HITS = 3;

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  sphere: new THREE.SphereGeometry(1, 10, 8),
};
const mats = new Map<string, THREE.MeshLambertMaterial>();
const mat = (color: string) => {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshLambertMaterial({ color, flatShading: true })));
  return m;
};
const owned: { dispose(): void }[] = [];

type V3 = [number, number, number];
function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, scale: V3, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.scale.set(...scale);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function group(parent: THREE.Object3D, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(...pos);
  g.rotation.set(...rot);
  parent.add(g);
  return g;
}

// ===================== Cage =====================

interface Bar { lower: THREE.Group; upper: THREE.Group; s: number; }
interface Side { n: THREE.Vector3; t: THREE.Vector3; bars: Bar[]; damage: number; open: boolean; shake: number; dir: number; }

export interface Cage {
  group: THREE.Group;
  center: THREE.Vector3;
  /** True once any side has been bent open. */
  readonly open: boolean;
  /** Keeps a circle inside the closed sides and bounces it back. Returns the side it hit (pushing outwards at `minHit` or more), else -1. */
  contain(p: THREE.Vector3, v: THREE.Vector3, radius: number, minHit: number, bounce?: number): number;
  /** The opposite of contain(): keeps a circle out of the cage. Open cages don't block. */
  block(p: THREE.Vector3, v: THREE.Vector3, radius: number, minHit: number, bounce?: number): number;
  /** Bends a side's bars further (outwards, or inwards with dir = -1); true when this bump broke it open. */
  bump(side: number, dir?: number): boolean;
  /** Outward normal of the first side that was broken open. */
  readonly exit: THREE.Vector3 | null;
  /** The nearest closed side whose bars are within `reach` of p and at least `minFacing` in front of it (`fwd`), or -1. */
  nearSide(p: THREE.Vector3, fwd: THREE.Vector3, reach: number, fromInside: boolean, minFacing?: number): number;
  /** Outward normal of a side. */
  normal(side: number): THREE.Vector3;
  rattle(): void;
  inside(p: THREE.Vector3): boolean;
  update(dt: number, t: number): void;
}

export function createCage(cx = CAGE.x, cz = CAGE.z): Cage {
  const root = new THREE.Group();
  const steel = mat('#5b6470');
  const post = mat('#3a4049');
  const concrete = mat('#b9b4aa');
  const { half, height } = CAGE;
  const sides: Side[] = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ].map(([nx, nz]) => {
    const n = new THREE.Vector3(nx, 0, nz);
    const t = new THREE.Vector3(-nz, 0, nx);
    const bars: Bar[] = [];
    const count = 8;
    for (let k = 0; k < count; k++) {
      const s = -half + ((k + 1) * 2 * half) / (count + 1);
      const x = cx + n.x * half + t.x * s;
      const z = cz + n.z * half + t.z * s;
      // Holder faces outwards (local +z = n), so bending is a rotation about local x.
      const holder = group(root, [x, groundY(x, z) - 0.3, z], [0, Math.atan2(n.x, n.z), 0]);
      const lower = group(holder);
      part(lower, GEO.cyl, steel, [0.13, height / 2, 0.13], [0, height / 4, 0]);
      const upper = group(lower, [0, height / 2, 0]);
      part(upper, GEO.cyl, steel, [0.13, height / 2, 0.13], [0, height / 4, 0]);
      part(upper, GEO.sphere, post, [0.2, 0.2, 0.2], [0, height / 2, 0]);
      bars.push({ lower, upper, s });
    }
    const mx = cx + n.x * half;
    const mz = cz + n.z * half;
    const curb = part(root, GEO.box, concrete, [Math.abs(t.x) * 2 * half + 0.9, 0.7, Math.abs(t.z) * 2 * half + 0.9], [mx, groundY(mx, mz) + 0.05, mz]);
    curb.castShadow = false;
    return { n, t, bars, damage: 0, open: false, shake: 0, dir: 1 };
  });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = cx + sx * half;
    const z = cz + sz * half;
    part(root, GEO.box, post, [0.55, height + 0.6, 0.55], [x, groundY(x, z) + height / 2 - 0.1, z]);
  }
  // Yellow-and-black warning boards on the front corner posts.
  const stripeA = mat('#ffcc00');
  const stripeB = mat('#222222');
  for (const sx of [1, -1]) {
    const x = cx + sx * (half + 0.35);
    const z = cz - half;
    for (let k = 0; k < 4; k++) part(root, GEO.box, k % 2 ? stripeB : stripeA, [0.12, 0.35, 0.9], [x, groundY(x, z) + 3 + k * 0.35, z]);
  }

  // Bars move (they bend when bitten); everything else in the cage is one mesh per material.
  const barGroups = sides.flatMap((s) => s.bars.flatMap((b) => [b.lower, b.upper]));
  bake(root, barGroups, owned);
  // Until a bar is touched, draw all of them as a couple of merged meshes and hide the separate ones.
  root.updateMatrixWorld(true);
  const holders = sides.flatMap((s) => s.bars.map((b) => b.lower.parent!));
  const intact = new THREE.Group();
  const inv = root.matrixWorld.clone().invert();
  for (const g of barGroups) for (const c of g.children) {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) continue;
    const copy = new THREE.Mesh(mesh.geometry, mesh.material);
    copy.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    copy.castShadow = true;
    intact.add(copy);
  }
  bake(intact, [], owned);
  root.add(intact);
  holders.forEach((h) => (h.visible = false));
  let whole = true;
  /** The first touch swaps in the real, bendable bars. */
  const wake = () => {
    if (!whole) return;
    whole = false;
    root.remove(intact);
    holders.forEach((h) => (h.visible = true));
  };

  // Bend targets are eased towards, so a bump looks like the bars giving way.
  const target = new Map<Bar, { bend: number; spread: number }>();
  function setTargets(side: Side) {
    for (const b of side.bars) {
      const centre = 1 - Math.min(1, Math.abs(b.s) / CAGE.half);
      const k = side.damage / CAGE_HITS;
      target.set(b, side.open && Math.abs(b.s) < 3.2
        ? { bend: 0.55 * side.dir, spread: -Math.sign(b.s || 1) * (0.7 + centre * 0.5) }
        : { bend: k * (0.15 + centre * 0.3) * side.dir, spread: 0 });
    }
  }
  const off = new THREE.Vector3();

  return {
    group: root,
    center: new THREE.Vector3(cx, groundY(cx, cz), cz),
    get open() {
      return sides.some((s) => s.open);
    },
    get exit() {
      return sides.find((s) => s.open)?.n ?? null;
    },
    normal: (i) => sides[i].n,
    nearSide(p, fwd, reach, fromInside, minFacing = 0.35) {
      let best = -1;
      let bestD = reach;
      sides.forEach((side, i) => {
        if (side.open) return;
        off.set(p.x - cx, 0, p.z - cz);
        if (Math.abs(off.dot(side.t)) > CAGE.half + 0.5) return;
        const d = fromInside ? CAGE.half - off.dot(side.n) : off.dot(side.n) - CAGE.half;
        if (d < -0.5 || d > bestD) return;
        if (fwd.dot(side.n) * (fromInside ? 1 : -1) < minFacing) return;
        best = i;
        bestD = d;
      });
      return best;
    },
    block(p, v, radius, minHit, bounce = 1.6) {
      if (sides.some((s) => s.open)) return -1;
      const dx = p.x - cx;
      const dz = p.z - cz;
      const lim = CAGE.half + radius + 0.25;
      if (Math.abs(dx) >= lim || Math.abs(dz) >= lim) return -1;
      const i = lim - Math.abs(dx) < lim - Math.abs(dz) ? (dx > 0 ? 0 : 1) : dz > 0 ? 2 : 3;
      const n = sides[i].n;
      if (i < 2) p.x = cx + n.x * lim;
      else p.z = cz + n.z * lim;
      const into = -v.dot(n);
      if (into <= 0) return -1;
      v.addScaledVector(n, into * bounce);
      return into >= minHit ? i : -1;
    },
    contain(p, v, radius, minHit, bounce = 1.6) {
      let hit = -1;
      sides.forEach((side, i) => {
        if (side.open) return;
        off.set(p.x - cx, 0, p.z - cz);
        const d = off.dot(side.n);
        const lim = CAGE.half - radius - 0.25;
        if (d <= lim) return;
        p.addScaledVector(side.n, lim - d);
        const into = v.dot(side.n);
        if (into > 0) {
          if (into >= minHit) hit = i;
          v.addScaledVector(side.n, -into * bounce);
        }
      });
      return hit;
    },
    bump(i, dir = 1) {
      wake();
      const side = sides[i];
      side.dir = dir;
      side.damage++;
      side.shake = 1;
      if (side.damage >= CAGE_HITS) side.open = true;
      setTargets(side);
      return side.open;
    },
    rattle() {
      wake();
      for (const s of sides) s.shake = Math.max(s.shake, 0.6);
    },
    inside(p) {
      return Math.abs(p.x - cx) < CAGE.half + 0.5 && Math.abs(p.z - cz) < CAGE.half + 0.5;
    },
    update(dt, t) {
      if (whole) return; // nothing to animate until a bar is touched
      for (const side of sides) {
        side.shake = Math.max(0, side.shake - dt * 2.5);
        for (const b of side.bars) {
          const goal = target.get(b) ?? { bend: 0, spread: 0 };
          const k = 1 - Math.exp(-dt * 9);
          const wobble = Math.sin(t * 40 + b.s) * 0.06 * side.shake;
          b.lower.rotation.x += (goal.bend * 0.35 + wobble - b.lower.rotation.x) * k;
          b.upper.rotation.x += (goal.bend - b.upper.rotation.x) * k;
          b.lower.rotation.z += (goal.spread * 0.4 - b.lower.rotation.z) * k;
          b.upper.rotation.z += (goal.spread - b.upper.rotation.z) * k;
        }
      }
    },
  };
}

// ===================== Jeeps =====================

export const CAR_COLORS = ['#5f8f3e', '#d9c27a', '#f2f0e6', '#c94a3a', '#f4b63a', '#3d7fb8'];

export interface Car {
  group: THREE.Group;
  body: THREE.MeshLambertMaterial;
  heading: number;
  wrecked: boolean;
  /** Seconds since it was wrecked. */
  t: number;
  from: THREE.Vector3;
  push: THREE.Vector3;
  roll: number;
  smoke: THREE.Mesh[];
}

const smokeMat = new THREE.MeshLambertMaterial({ color: '#4a4a4a', transparent: true, opacity: 0.55, depthWrite: false });
const glassMat = new THREE.MeshLambertMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.55 });

/** A chunky open safari jeep facing +z, wheels on y = 0. */
export function createCar(color: string, stripe: string): Car {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color, flatShading: true });
  body.userData.dynamic = true; // darkens when wrecked
  owned.push(body);
  const tire = mat('#2a2a2a');
  const rim = mat('#c9c9c9');
  const bar = mat('#4a4f55');
  part(g, GEO.box, body, [2.3, 0.75, 4.4], [0, 1.0, 0]);
  part(g, GEO.box, body, [2.2, 0.45, 1.5], [0, 1.55, 1.35]);
  part(g, GEO.box, mat(stripe), [2.34, 0.18, 4.2], [0, 1.05, 0]);
  part(g, GEO.box, mat('#3b3b3b'), [2.0, 0.3, 0.25], [0, 0.8, 2.25]);
  part(g, GEO.box, glassMat, [2.1, 0.75, 0.06], [0, 2.1, 0.55], [-0.25, 0, 0]);
  for (const x of [-1.05, 1.05]) {
    part(g, GEO.cyl, bar, [0.07, 1.4, 0.07], [x, 2.05, -0.6]);
    part(g, GEO.cyl, bar, [0.07, 1.1, 0.07], [x, 1.9, 0.55], [-0.25, 0, 0]);
  }
  part(g, GEO.cyl, bar, [0.07, 2.1, 0.07], [0, 2.75, -0.6], [0, 0, Math.PI / 2]);
  for (const x of [-0.6, 0.6]) part(g, GEO.box, mat('#7a5a3a'), [0.7, 0.6, 0.7], [x, 1.6, -0.5]);
  for (const [x, z] of [[-1.15, 1.45], [1.15, 1.45], [-1.15, -1.45], [1.15, -1.45]] as const) {
    part(g, GEO.cyl, tire, [0.58, 0.42, 0.58], [x, 0.58, z], [0, 0, Math.PI / 2]);
    part(g, GEO.cyl, rim, [0.3, 0.44, 0.3], [x, 0.58, z], [0, 0, Math.PI / 2]);
  }
  part(g, GEO.cyl, tire, [0.5, 0.35, 0.5], [0, 1.3, -2.4], [Math.PI / 2, 0, 0]);
  for (const x of [-0.75, 0.75]) part(g, GEO.sphere, mat('#fff6c8'), [0.18, 0.18, 0.08], [x, 1.45, 2.22]);
  const smoke = Array.from({ length: 4 }, (_, i) => {
    const m = new THREE.Mesh(GEO.sphere, smokeMat);
    m.visible = false;
    m.userData.k = i / 4;
    return m;
  });
  bake(g, [], owned);
  return { group: g, body, heading: 0, wrecked: false, t: 0, from: new THREE.Vector3(), push: new THREE.Vector3(), roll: 1, smoke };
}

/** Knocks the jeep away from `by`, rolling it onto its roof. */
export function wreckCar(car: Car, by: THREE.Vector3, scene: THREE.Scene) {
  car.wrecked = true;
  car.t = 0;
  car.from.copy(car.group.position);
  car.push.subVectors(car.group.position, by).setY(0).normalize().multiplyScalar(6);
  // Roll to whichever side it was hit from.
  const side = new THREE.Vector3(Math.cos(car.heading), 0, -Math.sin(car.heading));
  car.roll = car.push.dot(side) >= 0 ? -1 : 1;
  car.smoke.forEach((m) => scene.add(m));
}

export function updateCar(car: Car, dt: number, t: number) {
  if (!car.wrecked) return;
  car.t += dt;
  const k = Math.min(1, car.t / 0.9);
  const ease = 1 - (1 - k) ** 3;
  const g = car.group;
  g.position.x = car.from.x + car.push.x * ease;
  g.position.z = car.from.z + car.push.z * ease;
  // Up in an arc, then resting on its roof (the roof is 2.9 above the wheels' ground line).
  g.position.y = groundY(g.position.x, g.position.z) + Math.sin(Math.PI * k) * 3 + 2.9 * ease;
  g.rotation.set(0, car.heading, car.roll * Math.PI * ease);
  if (k >= 1 && car.body.color.getHex() !== 0x3a3a3a) car.body.color.lerp(new THREE.Color('#3a3a3a'), Math.min(1, dt * 3));
  for (const m of car.smoke) {
    const s = (t * 0.45 + m.userData.k) % 1;
    m.visible = k >= 0.6;
    m.position.set(g.position.x + Math.sin(s * 7 + m.userData.k * 9) * 0.6, g.position.y - 1.6 + s * 6, g.position.z);
    m.scale.setScalar(0.5 + s * 1.6);
  }
}

// ===================== People =====================

// Believable clothes for a wet day at a theme park: rain jackets, fleeces and plain tees, denim and khaki.
const JACKETS = ['#2f3b45', '#4a4f3a', '#6b2e2a', '#3d4a52', '#7d6a3e', '#55595c', '#2b2b2e', '#8c4a32', '#3f5a6b', '#5b4a5e'];
const SHIRTS = ['#cfc8b8', '#7d8a8f', '#5c6650', '#8c7b65', '#4f5a66', '#a59a86', '#6a4a45'];
const PANTS = ['#3b4656', '#2f3846', '#7d7058', '#4a4740', '#5a5345', '#2a2a2a', '#63604f'];
const SHOES = ['#2a2622', '#3d3a36', '#5a4b3a', '#b9b4ac', '#4a3a2c'];
const SKIN = ['#efcfb2', '#e2b48f', '#c89270', '#a8714f', '#82543a', '#5e3c28'];
const HAIR = ['#1d1814', '#2e2219', '#4a3626', '#6b5038', '#9a7f58', '#6e6a66', '#5e3220', '#2a2a2a'];
const PACKS = ['#3a3f35', '#2d3640', '#5a3a2e', '#46423b'];

export interface Person {
  group: THREE.Group;
  /** Thighs (the knees are in `shins`). Index 0 is on the -x side. */
  legs: THREE.Object3D[];
  /** Upper arms (the elbows are in `forearms`). Index 1, on the +x side, carries a ranger's rifle. */
  arms: THREE.Object3D[];
  shins: THREE.Object3D[];
  forearms: THREE.Object3D[];
  alert: THREE.Sprite;
  /** idle: standing about (or, for rangers, walking a patrol); panic: running; down: knocked over; gone: run off. */
  state: 'idle' | 'panic' | 'down' | 'gone';
  /** Seconds in the current state. */
  t: number;
  heading: number;
  vel: THREE.Vector3;
  phase: number;
  kind: 'visitor' | 'ranger';
  /** Rangers: 0..1 rifle raised to the shoulder. */
  aim: number;
}

/** How long a knocked-down person lies there before scrambling up and running. */
const DOWN_FOR = 2.6;
/** Seconds of running before a person has fled out of the action. */
const RUN_FOR = 9;

let alertTex: THREE.CanvasTexture | null = null;
function alertMaterial() {
  if (!alertTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ff3b30';
    x.beginPath();
    x.arc(64, 64, 56, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#ffffff';
    x.font = 'bold 96px sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('!', 64, 70);
    alertTex = new THREE.CanvasTexture(c);
    alertTex.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.SpriteMaterial({ map: alertTex, depthTest: false });
}

// ---- Person models ----
// Each person is one skinned mesh (one draw call): every part is baked into a single geometry with
// its colour in the vertices, skinned rigidly to one of nine bones (the body, and a thigh, shin,
// upper arm and forearm per side). Built in metres for a 1.85 m adult (about 7.5 heads tall), then
// scaled up to the dinosaurs' world.

/** Bones, in order. */
const B = { body: 0, thigh0: 1, shin0: 2, thigh1: 3, shin1: 4, arm0: 5, fore0: 6, arm1: 7, fore1: 8 };
const HIP = { x: 0.088, y: 0.93 };
const KNEE_Y = 0.47;
const SHOULDER = { x: 0.215, y: 1.475 };
const ELBOW_Y = 1.185;
/** How a ranger's rifle lies along the forearm: rotated so it points forward when the arm is raised to aim. */
const RIFLE_TILT = 1.95;

/** Shared, lazily built unit shapes that parts are cloned from; freed by disposePark(). */
let personShapes: { sphere: THREE.BufferGeometry; small: THREE.BufferGeometry; box: THREE.BufferGeometry; cyl: Map<string, THREE.BufferGeometry> } | null = null;
let personMat: THREE.MeshLambertMaterial | null = null;
function shapes() {
  personShapes ??= { sphere: new THREE.SphereGeometry(1, 10, 8), small: new THREE.SphereGeometry(1, 7, 5), box: new THREE.BoxGeometry(1, 1, 1), cyl: new Map() };
  return personShapes;
}
/** A unit-height cylinder with radii `top` and `bottom` (a tapering limb or torso). */
function taper(top: number, bottom: number) {
  const s = shapes();
  const key = `${top}/${bottom}`;
  let g = s.cyl.get(key);
  if (!g) s.cyl.set(key, (g = new THREE.CylinderGeometry(top, bottom, 1, 10)));
  return g;
}

const pM = new THREE.Matrix4();
const pQ = new THREE.Quaternion();
const pE = new THREE.Euler();
const pP = new THREE.Vector3();
const pS = new THREE.Vector3();
const pC = new THREE.Color();

type Paint = string | THREE.Color;
/** Collects a person's parts, each skinned to one bone. */
class Kit {
  parts: THREE.BufferGeometry[] = [];
  add(shape: THREE.BufferGeometry, color: Paint, bone: number, scale: V3, pos: V3, rot: V3 = [0, 0, 0]) {
    const g = shape.clone();
    pM.compose(pP.set(...pos), pQ.setFromEuler(pE.set(...rot)), pS.set(...scale));
    g.applyMatrix4(pM);
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const idx = new Uint16Array(n * 4);
    const wgt = new Float32Array(n * 4);
    pC.set(color);
    for (let i = 0; i < n; i++) {
      col[i * 3] = pC.r;
      col[i * 3 + 1] = pC.g;
      col[i * 3 + 2] = pC.b;
      idx[i * 4] = bone;
      wgt[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(wgt, 4));
    this.parts.push(g);
  }
  sphere(color: Paint, bone: number, scale: V3, pos: V3, rot?: V3) {
    // Small parts (hands, ears, joints) don't need the head's smoothness.
    this.add(Math.max(...scale) > 0.08 ? shapes().sphere : shapes().small, color, bone, scale, pos, rot);
  }
  box(color: Paint, bone: number, scale: V3, pos: V3, rot?: V3) {
    this.add(shapes().box, color, bone, scale, pos, rot);
  }
  /** A tapering cylinder from `y0` (radius `r0`) up to `y1` (radius `r1`), squashed front to back by `depth`. */
  tube(color: Paint, bone: number, x: number, y0: number, y1: number, r0: number, r1: number, depth = 1, z = 0) {
    this.add(taper(r1, r0), color, bone, [1, y1 - y0, depth], [x, (y0 + y1) / 2, z]);
  }
}

/** `hex` darkened (k < 1) or lightened (k > 1). */
const shade = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

/**
 * A park visitor in rain gear or a tee, or a park ranger in uniform with a tranquilliser rifle. About
 * 2.6 units tall. Faces +z; rotation order YXZ so a fall (rotation.x) tips it over its own back.
 */
export function createPerson(rand: () => number, kind: Person['kind'] = 'visitor'): Person {
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  const ranger = kind === 'ranger';
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const body = group(g);
  body.scale.setScalar(1.4 * (0.93 + rand() * 0.12));
  const k = new Kit();
  // Build: broader or slighter.
  const w = 0.92 + rand() * 0.16;

  const skin = pick(SKIN);
  const top = ranger ? 'jacket' : rand() < 0.6 ? 'jacket' : 'tee';
  const shirt = ranger ? '#454c36' : top === 'jacket' ? pick(JACKETS) : pick(SHIRTS);
  const pants = ranger ? '#30342a' : pick(PANTS);
  const shoes = ranger ? '#1d1a17' : pick(SHOES);
  const hair = pick(HAIR);
  const hairStyle = pick(['short', 'short', 'long', 'ponytail', 'buzz', 'bald']);
  const hat = ranger ? 'cap' : top === 'jacket' && rand() < 0.3 ? 'hood' : pick(['none', 'none', 'cap', 'safari']);

  // Legs: thigh and shin per side, and a shoe on the shin.
  for (const side of [0, 1]) {
    const x = (side ? 1 : -1) * HIP.x * w;
    const thigh = side ? B.thigh1 : B.thigh0;
    const shin = side ? B.shin1 : B.shin0;
    k.sphere(pants, thigh, [0.085 * w, 0.08, 0.085], [x, HIP.y, 0]);
    k.tube(pants, thigh, x, KNEE_Y + 0.02, HIP.y, 0.055, 0.078 * w);
    k.sphere(pants, shin, [0.055, 0.055, 0.058], [x, KNEE_Y, 0.005]);
    k.tube(pants, shin, x, 0.1, KNEE_Y, 0.041, 0.054);
    // Calf.
    k.sphere(pants, shin, [0.05, 0.11, 0.052], [x, 0.34, -0.012]);
    k.box(shoes, shin, [0.092, 0.075, 0.2], [x, 0.04, 0.035]);
    k.sphere(shoes, shin, [0.047, 0.04, 0.065], [x, 0.042, 0.13]);
    k.box(shade(shoes, 0.6), shin, [0.096, 0.018, 0.27], [x, 0.009, 0.06]);
  }
  // Hips and torso: a tapering chest over a narrower waist, rounded across the shoulders.
  k.tube(pants, B.body, 0, 0.88, 1.07, 0.15 * w, 0.14 * w, 0.68);
  if (top === 'jacket' || ranger) {
    // A jacket hangs over the hips, with a collar.
    k.tube(shirt, B.body, 0, 0.9, 1.08, 0.168 * w, 0.158 * w, 0.7);
    k.tube(shirt, B.body, 0, 1.53, 1.58, 0.085, 0.068, 0.9);
    // Zip line.
    k.box(shade(shirt, 0.6), B.body, [0.012, 0.6, 0.01], [0, 1.24, 0.118 * w]);
  } else {
    // Belt line.
    k.tube(shade(pants, 0.55), B.body, 0, 1.03, 1.07, 0.152 * w, 0.152 * w, 0.69);
  }
  k.tube(shirt, B.body, 0, 1.06, 1.5, 0.152 * w, 0.19 * w, 0.62);
  k.sphere(shirt, B.body, [0.2 * w, 0.075, 0.118], [0, 1.485, 0]);
  if (ranger) {
    // Tactical vest with pouches, a radio on the chest, a belt and a holster.
    const vest = '#262a21';
    k.tube(vest, B.body, 0, 1.1, 1.47, 0.165 * w, 0.2 * w, 0.68);
    for (const x of [-0.08, 0, 0.08]) k.box(shade(vest, 1.25), B.body, [0.065, 0.075, 0.04], [x * w, 1.2, 0.135 * w]);
    k.box('#141414', B.body, [0.045, 0.09, 0.03], [0.09 * w, 1.4, 0.14 * w]);
    k.box('#3a3a38', B.body, [0.008, 0.07, 0.008], [0.1 * w, 1.48, 0.14 * w]);
    k.tube('#1c1b18', B.body, 0, 1.04, 1.09, 0.162 * w, 0.162 * w, 0.72);
    k.box('#1c1b18', B.body, [0.05, 0.16, 0.08], [-0.17 * w, 0.98, 0.02]);
    // Shoulder patch.
    k.box('#7a6a3a', B.arm1, [0.01, 0.05, 0.045], [SHOULDER.x * w + 0.046, 1.39, 0]);
  } else if (rand() < 0.3) {
    // A backpack.
    const pack = pick(PACKS);
    k.box(pack, B.body, [0.26 * w, 0.34, 0.13], [0, 1.28, -0.17]);
    k.sphere(pack, B.body, [0.13 * w, 0.06, 0.065], [0, 1.45, -0.17]);
    for (const x of [-0.08, 0.08]) k.box(shade(pack, 0.6), B.body, [0.03, 0.4, 0.02], [x * w, 1.3, 0.118 * w]);
  }

  // Arms: upper arm and forearm per side, hands on the forearms.
  for (const side of [0, 1]) {
    const s = side ? 1 : -1;
    const x = s * SHOULDER.x * w;
    const arm = side ? B.arm1 : B.arm0;
    const fore = side ? B.fore1 : B.fore0;
    const sleeve = top === 'tee' && !ranger ? skin : shirt;
    k.sphere(shirt, arm, [0.06, 0.068, 0.062], [x, SHOULDER.y - 0.005, 0]);
    if (top === 'tee' && !ranger) k.tube(shirt, arm, x, 1.34, SHOULDER.y, 0.05, 0.056);
    k.tube(sleeve, arm, x, ELBOW_Y, SHOULDER.y - 0.02, 0.04, 0.048);
    k.sphere(sleeve, fore, [0.04, 0.04, 0.042], [x, ELBOW_Y, 0]);
    k.tube(sleeve, fore, x, 0.95, ELBOW_Y, 0.031, 0.04);
    if (sleeve !== skin) k.tube(shade(shirt, 0.8), fore, x, 0.94, 0.975, 0.035, 0.035);
    // Hand: palm and fingers, slightly cupped, with the thumb forward.
    k.sphere(skin, fore, [0.026, 0.048, 0.042], [x, 0.9, 0.005]);
    k.sphere(skin, fore, [0.022, 0.035, 0.036], [x - s * 0.002, 0.845, 0.01]);
    k.sphere(skin, fore, [0.013, 0.028, 0.014], [x - s * 0.012, 0.885, 0.042], [0.3, 0, 0]);
  }
  if (ranger) {
    // The tranquilliser rifle, gripped in the +x hand and lying along the forearm.
    const hx = SHOULDER.x * w;
    const hy = 0.89;
    const dir = new THREE.Vector3(0, -Math.sin(RIFLE_TILT), Math.cos(RIFLE_TILT));
    const up = new THREE.Vector3(0, Math.cos(RIFLE_TILT), Math.sin(RIFLE_TILT));
    const at = (along: number, above: number): V3 => [hx, hy + dir.y * along + up.y * above, dir.z * along + up.z * above];
    const rot: V3 = [RIFLE_TILT, 0, 0];
    const metal = '#262624';
    k.box(metal, B.fore1, [0.045, 0.075, 0.42], at(0.06, 0.04), rot);
    k.box('#3a3a38', B.fore1, [0.024, 0.024, 0.42], at(0.46, 0.06), rot);
    k.box('#4a3a2a', B.fore1, [0.042, 0.09, 0.26], at(-0.27, 0.01), rot);
    k.box(metal, B.fore1, [0.03, 0.035, 0.16], at(0.08, 0.1), rot);
    k.box(metal, B.fore1, [0.03, 0.1, 0.04], at(0.18, -0.03), rot);
  }

  // Neck and head: cranium, jaw, ears, and a hint of brow, eye sockets and nose (no cartoon eyes).
  k.tube(skin, B.body, 0, 1.52, 1.64, 0.05, 0.046, 1, 0.005);
  k.sphere(skin, B.body, [0.093, 0.115, 0.105], [0, 1.74, 0]);
  k.sphere(skin, B.body, [0.074, 0.07, 0.085], [0, 1.665, 0.022]);
  for (const s of [-1, 1]) {
    k.sphere(skin, B.body, [0.014, 0.03, 0.022], [s * 0.092, 1.72, -0.005]);
    k.sphere(shade(skin, 0.55), B.body, [0.024, 0.012, 0.012], [s * 0.035, 1.727, 0.097]);
  }
  k.box(shade(skin, 0.75), B.body, [0.13, 0.016, 0.022], [0, 1.748, 0.094]);
  k.box(shade(skin, 0.92), B.body, [0.024, 0.05, 0.034], [0, 1.705, 0.104], [-0.25, 0, 0]);
  k.box(shade(skin, 0.6), B.body, [0.04, 0.007, 0.01], [0, 1.655, 0.104]);
  // Hair.
  if (hairStyle !== 'bald' && hat !== 'hood') {
    const tall = hairStyle === 'buzz' ? 0.09 : 0.098;
    k.sphere(hair, B.body, [0.099, tall, 0.11], [0, 1.765, -0.012]);
    if (hairStyle === 'long') {
      k.box(hair, B.body, [0.18, 0.2, 0.06], [0, 1.66, -0.075]);
      for (const s of [-1, 1]) k.box(hair, B.body, [0.03, 0.14, 0.08], [s * 0.088, 1.69, -0.02]);
    } else if (hairStyle === 'ponytail') {
      k.sphere(hair, B.body, [0.034, 0.085, 0.034], [0, 1.69, -0.125], [0.35, 0, 0]);
    }
  }
  if (hat === 'cap') {
    const c = ranger ? '#2a2e24' : pick(JACKETS);
    k.sphere(c, B.body, [0.103, 0.065, 0.113], [0, 1.805, -0.005]);
    k.box(c, B.body, [0.11, 0.012, 0.09], [0, 1.795, 0.12], [-0.12, 0, 0]);
    if (ranger) k.box('#7a6a3a', B.body, [0.04, 0.025, 0.005], [0, 1.83, 0.108]);
  } else if (hat === 'safari') {
    const c = pick(['#9a8a66', '#6d6650', '#4f4a3c']);
    k.tube(c, B.body, 0, 1.79, 1.802, 0.16, 0.16);
    k.tube(c, B.body, 0, 1.79, 1.88, 0.105, 0.095);
    k.tube(shade(c, 0.6), B.body, 0, 1.8, 1.82, 0.106, 0.106);
  } else if (hat === 'hood') {
    k.sphere(shirt, B.body, [0.125, 0.135, 0.128], [0, 1.755, -0.03]);
  }

  // One skinned mesh for the whole person.
  const geo = mergeGeometries(k.parts)!;
  k.parts.forEach((p) => p.dispose());
  owned.push(geo);
  personMat ??= new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.SkinnedMesh(geo, personMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const bones = Array.from({ length: 9 }, () => new THREE.Bone());
  mesh.add(bones[B.body]);
  for (const side of [0, 1]) {
    const s = side ? 1 : -1;
    const thigh = bones[side ? B.thigh1 : B.thigh0];
    const shin = bones[side ? B.shin1 : B.shin0];
    const arm = bones[side ? B.arm1 : B.arm0];
    const fore = bones[side ? B.fore1 : B.fore0];
    thigh.position.set(s * HIP.x * w, HIP.y, 0);
    shin.position.set(0, KNEE_Y - HIP.y, 0);
    arm.position.set(s * SHOULDER.x * w, SHOULDER.y, 0);
    fore.position.set(0, ELBOW_Y - SHOULDER.y, 0);
    bones[B.body].add(thigh, arm);
    thigh.add(shin);
    arm.add(fore);
  }
  body.add(mesh);
  g.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  // Bounds from the bind pose, padded for raised arms and bent legs.
  mesh.computeBoundingSphere();
  mesh.boundingSphere!.radius += 0.45;

  const alert = new THREE.Sprite(alertMaterial());
  owned.push(alert.material);
  alert.scale.setScalar(1.1);
  alert.renderOrder = 10;
  alert.position.y = 4;
  // Kept for the panic bob, but not shown: a cartoon "!" doesn't suit the game any more.
  alert.visible = false;
  return {
    group: g,
    legs: [bones[B.thigh0], bones[B.thigh1]],
    arms: [bones[B.arm0], bones[B.arm1]],
    shins: [bones[B.shin0], bones[B.shin1]],
    forearms: [bones[B.fore0], bones[B.fore1]],
    alert, state: 'idle', t: 0, heading: rand() * 6, vel: new THREE.Vector3(), phase: rand() * 6, kind, aim: 0,
  };
}

/** A walking or running stride: thighs swing by `swing`, knees fold as each leg comes forward. Returns the arm swing. */
function stride(p: Person, swing: number, knee: number) {
  p.legs.forEach((l, i) => {
    const ph = p.phase + i * Math.PI;
    l.rotation.set(Math.sin(ph) * swing, 0, 0);
    // The thigh swings forward while its angle falls: fold the knee then, and a little at push-off.
    p.shins[i].rotation.x = 0.08 + Math.max(0, -Math.cos(ph)) * knee + Math.max(0, Math.sin(ph)) * knee * 0.2;
  });
}

/** Arms hanging relaxed (a slight outward angle and bent elbow), swinging by `swing` against the legs. */
function hang(p: Person, swing: number, elbow: number) {
  p.arms.forEach((a, i) => {
    a.rotation.set(Math.sin(p.phase + (1 - i) * Math.PI) * swing, 0, (i ? 1 : -1) * 0.07);
    p.forearms[i].rotation.set(-elbow, 0, 0);
  });
}

/**
 * Poses for each state: standing about (visitors shift and now and then wave; rangers walk their
 * patrol or raise the rifle), running in a panic, and lying flat after being knocked over. `speed` is
 * how fast it is moving.
 */
export function posePerson(p: Person, dt: number, t: number, speed: number) {
  p.t += dt;
  const g = p.group;
  const ranger = p.kind === 'ranger';
  if (p.state === 'down') {
    // Topple over backwards, lie still, then scramble up and run.
    const k = Math.min(1, p.t / 0.35);
    g.rotation.x = -(Math.PI / 2 - 0.1) * k * k;
    g.position.y += Math.sin(Math.PI * k) * 0.02;
    p.legs.forEach((l, i) => l.rotation.set((i ? -0.35 : 0.1) * k, 0, (i ? 1 : -1) * 0.12 * k));
    p.shins.forEach((s, i) => (s.rotation.x = (i ? 0.7 : 0.2) * k));
    p.arms.forEach((a, i) => a.rotation.set(-0.4 * k, 0, (i ? 1 : -1) * 1.1 * k));
    p.forearms.forEach((f) => f.rotation.set(-0.5 * k, 0, 0));
    if (p.t > DOWN_FOR) {
      p.state = 'panic';
      p.t = 0;
      g.rotation.x = 0;
    }
    return;
  }
  g.rotation.x = 0;
  if (p.state === 'panic') {
    p.phase += dt * (6 + speed * 1.4);
    // Running hard, leaning into it.
    g.rotation.x = 0.16;
    stride(p, 0.95, 1.5);
    if (ranger) {
      // Rifle held across the body.
      p.arms.forEach((a, i) => a.rotation.set(-0.5 + Math.sin(p.phase + i * Math.PI) * 0.25, 0, (i ? 1 : -1) * 0.1));
      p.forearms[0].rotation.set(-1.4, 0, 0);
      p.forearms[1].rotation.set(-1.1, 0, 0);
    } else {
      // Arms pumping, elbows bent.
      p.arms.forEach((a, i) => a.rotation.set(Math.sin(p.phase + (1 - i) * Math.PI) * 0.9, 0, (i ? 1 : -1) * 0.12));
      p.forearms.forEach((f) => f.rotation.set(-1.35, 0, 0));
    }
    p.alert.position.y = 4 + Math.abs(Math.sin(t * 9)) * 0.3;
    if (p.t > RUN_FOR) {
      p.state = 'gone';
      g.visible = false;
    }
  } else if (p.state === 'idle') {
    if (speed > 0.3) {
      p.phase += dt * (4 + speed * 1.5);
      stride(p, 0.5, 0.75);
    } else {
      // Standing, weight shifted onto one leg.
      p.legs.forEach((l, i) => l.rotation.set(0, 0, (i ? 1 : -1) * 0.03));
      p.shins.forEach((s, i) => (s.rotation.x = i === Math.round(p.phase) % 2 ? 0.12 : 0.02));
    }
    if (ranger) {
      // Rifle carried low and ready, or raised to the shoulder and pointed.
      p.arms[0].rotation.set(-0.3 - p.aim * 1.15, 0.35 * p.aim, 0.25 + p.aim * 0.2);
      p.forearms[0].rotation.set(-1.25 + p.aim * 0.35, 0, 0);
      p.arms[1].rotation.set(-0.35 - p.aim * 1.2, 0, -0.05);
      p.forearms[1].rotation.set(-1.1 + p.aim * 0.7, 0, 0);
      g.rotation.y = p.heading;
    } else {
      hang(p, speed > 0.3 ? 0.4 : 0, speed > 0.3 ? 0.35 : 0.15);
      // Now and then, a wave: the arm up, the hand going side to side.
      if (speed <= 0.3 && Math.sin(t * 0.7 + p.phase) > 0.85) {
        p.arms[1].rotation.set(-2.5, 0, 0.35);
        p.forearms[1].rotation.set(-0.5, 0, Math.sin(t * 9) * 0.45);
      }
      g.rotation.y = p.heading + (speed > 0.3 ? 0 : Math.sin(t * 0.5 + p.phase) * 0.6);
    }
  }
}

/** Starts a person screaming and running; true if they were calm. */
export function scare(p: Person): boolean {
  if (p.state !== 'idle') return false;
  p.state = 'panic';
  p.t = 0;
  return true;
}

/** Knocks a person flat, falling away from `from`. They get up after a moment and run. True if they were on their feet. */
export function knockDown(p: Person, from: THREE.Vector3): boolean {
  if (p.state === 'down' || p.state === 'gone') return false;
  const q = p.group.position;
  // Face the dinosaur, so falling backwards is falling away from it.
  p.heading = Math.atan2(from.x - q.x, from.z - q.z);
  p.group.rotation.y = p.heading;
  p.state = 'down';
  p.t = 0;
  p.aim = 0;
  p.vel.set(q.x - from.x, 0, q.z - from.z).normalize().multiplyScalar(5);
  return true;
}

export function disposePark() {
  Object.values(GEO).forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  mats.clear();
  owned.forEach((o) => o.dispose());
  owned.length = 0;
  smokeMat.dispose();
  glassMat.dispose();
  alertTex?.dispose();
  alertTex = null;
  if (personShapes) {
    personShapes.sphere.dispose();
    personShapes.small.dispose();
    personShapes.box.dispose();
    personShapes.cyl.forEach((g) => g.dispose());
    personShapes = null;
  }
  personMat?.dispose();
  personMat = null;
}
