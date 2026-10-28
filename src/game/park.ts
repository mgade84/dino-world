import * as THREE from 'three';
import { groundY } from './world';

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
      const side = sides[i];
      side.dir = dir;
      side.damage++;
      side.shake = 1;
      if (side.damage >= CAGE_HITS) side.open = true;
      setTargets(side);
      return side.open;
    },
    rattle() {
      for (const s of sides) s.shake = Math.max(s.shake, 0.6);
    },
    inside(p) {
      return Math.abs(p.x - cx) < CAGE.half + 0.5 && Math.abs(p.z - cz) < CAGE.half + 0.5;
    },
    update(dt, t) {
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

const SHIRTS = ['#e85d4a', '#3d8bd6', '#f2c14e', '#7bc950', '#b56ad9', '#ffffff', '#ff8fb1'];
const PANTS = ['#c9b38a', '#3e4a5c', '#6b5a45', '#2f2f2f'];
const SKIN = ['#f1c9a5', '#d9a47c', '#a8714f', '#7a4d32', '#ffdcbf'];

export interface Person {
  group: THREE.Group;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  alert: THREE.Sprite;
  state: 'idle' | 'panic' | 'gone';
  /** Seconds in the current state. */
  t: number;
  heading: number;
  vel: THREE.Vector3;
  phase: number;
}

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

/** A park visitor in a safari hat, about 2.5 units tall (a bit bigger than life, so small kids spot them). */
export function createPerson(rand: () => number): Person {
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  const g = new THREE.Group();
  const body = group(g);
  body.scale.setScalar(1.4);
  const shirt = mat(pick(SHIRTS));
  const pants = mat(pick(PANTS));
  const skin = mat(pick(SKIN));
  const legs = [-0.14, 0.14].map((x) => {
    const pivot = group(body, [x, 0.9, 0]);
    part(pivot, GEO.cyl, pants, [0.12, 0.88, 0.12], [0, -0.44, 0]);
    part(pivot, GEO.box, mat('#4a3626'), [0.18, 0.1, 0.3], [0, -0.88, 0.05]);
    return pivot;
  });
  part(body, GEO.box, shirt, [0.56, 0.72, 0.32], [0, 1.28, 0]);
  const arms = [-0.37, 0.37].map((x) => {
    const pivot = group(body, [x, 1.6, 0]);
    part(pivot, GEO.cyl, shirt, [0.085, 0.36, 0.085], [0, -0.16, 0]);
    part(pivot, GEO.cyl, skin, [0.075, 0.32, 0.075], [0, -0.48, 0]);
    return pivot;
  });
  part(body, GEO.sphere, skin, [0.21, 0.23, 0.21], [0, 1.88, 0]);
  for (const x of [-0.08, 0.08]) part(body, GEO.sphere, mat('#1b1b1b'), [0.03, 0.035, 0.03], [x, 1.91, 0.19]);
  const hat = mat('#cdb27a');
  part(body, GEO.cyl, hat, [0.34, 0.03, 0.34], [0, 2.05, 0]);
  part(body, GEO.cyl, hat, [0.19, 0.16, 0.19], [0, 2.13, 0]);
  const alert = new THREE.Sprite(alertMaterial());
  owned.push(alert.material);
  alert.scale.setScalar(1.1);
  alert.position.y = 4;
  alert.visible = false;
  g.add(alert);
  return { group: g, legs, arms, alert, state: 'idle', t: 0, heading: rand() * 6, vel: new THREE.Vector3(), phase: rand() * 6 };
}

/** Idle fidgeting and waving, or arms-up panicked running. `speed` is how fast it is moving. */
export function posePerson(p: Person, dt: number, t: number, speed: number) {
  p.t += dt;
  if (p.state === 'panic') {
    p.phase += dt * (6 + speed * 1.4);
    p.legs.forEach((l, i) => (l.rotation.x = Math.sin(p.phase + i * Math.PI) * 0.9));
    p.arms.forEach((a, i) => {
      a.rotation.x = Math.PI - 0.3 + Math.sin(p.phase * 1.3 + i * Math.PI) * 0.35;
      a.rotation.z = (i ? -1 : 1) * 0.25;
    });
    p.alert.position.y = 4 + Math.abs(Math.sin(t * 9)) * 0.3;
    // Gone from view after a few seconds of running away.
    if (p.t > 4.5) {
      const s = Math.max(0, 1 - (p.t - 4.5) * 2);
      p.group.scale.setScalar(s);
      if (s <= 0) {
        p.state = 'gone';
        p.group.visible = false;
      }
    }
  } else if (p.state === 'idle') {
    p.legs.forEach((l) => (l.rotation.x = 0));
    const wave = Math.sin(t * 0.7 + p.phase) > 0.85;
    p.arms[0].rotation.set(0, 0, 0.08);
    p.arms[1].rotation.set(wave ? Math.PI - 0.4 + Math.sin(t * 10) * 0.3 : 0, 0, -0.08);
    p.group.rotation.y = p.heading + Math.sin(t * 0.5 + p.phase) * 0.6;
  }
}

/** Starts a person screaming and running; true if they were calm. */
export function scare(p: Person): boolean {
  if (p.state !== 'idle') return false;
  p.state = 'panic';
  p.t = 0;
  p.alert.visible = true;
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
}
