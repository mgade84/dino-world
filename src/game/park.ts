import * as THREE from 'three';
import { groundY } from './world';
import { bake } from './merge';

/** Wheel arches: centred at the axle height, wide enough for the tyres. */
const ARCH = { y: 0.58, r: 0.68 };
/**
 * A car panel's side profile (z, y), extruded across the car (x) to `width`, with rounded edges.
 * ['arc', z] cuts a wheel arch centred at z up into the bottom edge.
 */
function carProfile(pts: ([number, number] | ['arc', number])[], width: number, bevel: number) {
  const shape = new THREE.Shape();
  pts.forEach((p, i) => {
    if (p[0] === 'arc') shape.absarc(p[1], ARCH.y, ARCH.r, Math.PI, 0, true);
    else if (i === 0) shape.moveTo(p[0], p[1]);
    else shape.lineTo(p[0], p[1]);
  });
  const depth = width - 2 * bevel;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(depth / 2, 0, 0);
  return geo;
}

/** The player's cage: centred on the start, big enough for a Brachiosaurus, too tall to jump out of. All cages share its size. */
export const CAGE = { x: 0, z: 6, half: 7, height: 9 };
/** Bumps a side takes before its bars bend far enough to squeeze through. */
export const CAGE_HITS = 3;

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl16: new THREE.CylinderGeometry(1, 1, 1, 16),
  cone: new THREE.ConeGeometry(1, 1, 8),
  /** A triangular prism (a three-sided cylinder), for warning signs. */
  tri: new THREE.CylinderGeometry(1, 1, 1, 3),
  /** Half a ring: a wheel-arch flare. */
  flare: new THREE.TorusGeometry(1, 0.09, 4, 12, Math.PI),
  carShell: carProfile([
    [-2.25, 0.62], [-2.13, 0.62], ['arc', -1.45], [0.77, 0.58], ['arc', 1.45], [2.3, 0.62],
    [2.33, 1.15], [2.22, 1.32], [0.95, 1.48], [-2.2, 1.52], [-2.27, 1.4],
  ], 2.24, 0.05),
  carCabin: carProfile([[0.95, 1.45], [0.2, 2.4], [0.02, 2.47], [-1.95, 2.5], [-2.12, 2.42], [-2.2, 1.45]], 2.0, 0.05),
  carFrontWindow: carProfile([[0.78, 1.62], [0.22, 2.3], [-0.52, 2.33], [-0.52, 1.62]], 2.05, 0),
  carRearWindow: carProfile([[-0.72, 1.62], [-0.72, 2.34], [-1.9, 2.36], [-2.03, 2.25], [-2.07, 1.62]], 2.05, 0),
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
  const steel = mat('#6b737b');
  const post = mat('#3a4049');
  const concrete = mat('#b9b4aa');
  const footing = mat('#9a958b');
  const dark = mat('#1d1f22');
  const yellow = mat('#e8b923');
  const { half, height } = CAGE;
  const count = 8;
  const gap = (2 * half) / (count + 1);
  /** Heights of the horizontal rails above each bar's holder: two on the lower bar, two on the upper. */
  const RAILS = { lower: [1.7, 3.9], upper: [1.9, 4.35] };
  const sides: Side[] = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ].map(([nx, nz]) => {
    const n = new THREE.Vector3(nx, 0, nz);
    const t = new THREE.Vector3(-nz, 0, nx);
    const bars: Bar[] = [];
    for (let k = 0; k < count; k++) {
      const s = -half + ((k + 1) * 2 * half) / (count + 1);
      const x = cx + n.x * half + t.x * s;
      const z = cz + n.z * half + t.z * s;
      // Holder faces outwards (local +z = n), so bending is a rotation about local x.
      const holder = group(root, [x, groundY(x, z) - 0.3, z], [0, Math.atan2(n.x, n.z), 0]);
      const lower = group(holder);
      part(lower, GEO.cyl, steel, [0.15, height / 2, 0.15], [0, height / 4, 0]);
      // Each bar carries its share of the horizontal rails, so a bent bar takes its rails with it.
      for (const y of RAILS.lower) part(lower, GEO.cyl6, steel, [0.065, gap, 0.065], [0, y, 0], [0, 0, Math.PI / 2]);
      const upper = group(lower, [0, height / 2, 0]);
      part(upper, GEO.cyl, steel, [0.15, height / 2, 0.15], [0, height / 4, 0]);
      for (const y of RAILS.upper) part(upper, GEO.cyl6, steel, [0.065, gap, 0.065], [0, y, 0], [0, 0, Math.PI / 2]);
      // Anti-climb overhang: the top of each bar leans inwards, with a rail and a spike at the tip.
      const lean = Math.SQRT1_2;
      part(upper, GEO.cyl6, steel, [0.09, 1, 0.09], [0, height / 2 + lean / 2, -lean / 2], [-Math.PI / 4, 0, 0]);
      part(upper, GEO.cyl6, steel, [0.055, gap, 0.055], [0, height / 2 + lean, -lean], [0, 0, Math.PI / 2]);
      part(upper, GEO.cone, post, [0.11, 0.3, 0.11], [0, height / 2 + lean + 0.1, -lean - 0.1], [-Math.PI / 4, 0, 0]);
      bars.push({ lower, upper, s });
    }
    // The rail ends between the corner posts and the first and last bars (fixed).
    for (const end of [-1, 1]) {
      const s = end * (half - gap / 4);
      const x = cx + n.x * half + t.x * s;
      const z = cz + n.z * half + t.z * s;
      const holder = group(root, [x, groundY(x, z) - 0.3, z], [0, Math.atan2(n.x, n.z), 0]);
      for (const y of [...RAILS.lower, ...RAILS.upper.map((u) => u + height / 2)]) part(holder, GEO.cyl6, steel, [0.065, gap / 2, 0.065], [0, y, 0], [0, 0, Math.PI / 2]);
    }
    // Footing: a wide slab, and a kerb the bars are set into.
    const mx = cx + n.x * half;
    const mz = cz + n.z * half;
    const g = groundY(mx, mz);
    const along = (len: number, across: number, y: number, h: number, m: THREE.Material) =>
      part(root, GEO.box, m, [Math.abs(t.x) * len + Math.abs(n.x) * across, h, Math.abs(t.z) * len + Math.abs(n.z) * across], [mx, g + y, mz]);
    along(2 * half + 1.8, 1.7, 0.05, 0.5, footing).castShadow = false;
    along(2 * half + 0.9, 0.85, 0.35, 0.8, concrete).castShadow = false;
    return { n, t, bars, damage: 0, open: false, shake: 0, dir: 1 };
  });

  const corner = (sx: number, sz: number, out: number): [number, number, number] => {
    const x = cx + sx * (half + out);
    const z = cz + sz * (half + out);
    return [x, groundY(x, z), z];
  };
  const up = new THREE.Vector3(0, 1, 0);
  /** A round strut from a to b. */
  function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) {
    const d = b.clone().sub(a);
    const mesh = part(root, GEO.cyl, m, [r, d.length(), r], [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2]);
    mesh.quaternion.setFromUnitVectors(up, d.normalize());
    return mesh;
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const [x, g, z] = corner(sx, sz, 0);
    // Corner posts: steel I-beams with cap plates, hazard-striped at the bottom.
    const H = height + 0.8;
    part(root, GEO.box, post, [0.14, H, 0.5], [x, g + H / 2 - 0.1, z]);
    for (const f of [-1, 1]) part(root, GEO.box, post, [0.6, H, 0.1], [x, g + H / 2 - 0.1, z + f * 0.25]);
    part(root, GEO.box, post, [0.75, 0.08, 0.75], [x, g + H - 0.08, z]);
    part(root, GEO.box, dark, [0.9, 0.1, 0.9], [x, g + 0.8, z]);
    for (let k = 0; k < 4; k++) part(root, GEO.box, k % 2 ? dark : yellow, [0.66, 0.3, 0.66], [x, g + 1.0 + k * 0.3, z]);
    // A diagonal brace from high on the post down to a concrete anchor outside the corner.
    const d = new THREE.Vector3(sx, 0, sz).normalize();
    const top = new THREE.Vector3(x, g + 6, z).addScaledVector(d, 0.3);
    const foot = new THREE.Vector3(x, g + 0.4, z).addScaledVector(d, 3.4);
    strut(top, foot, 0.13, post);
    part(root, GEO.box, concrete, [1, 0.6, 1], [foot.x, groundY(foot.x, foot.z) + 0.15, foot.z], [0, Math.PI / 4, 0]);
  }

  // The front (-z) side is the gate: a sliding gate on a track, a motor housing, hinges and a lock.
  const front = cz - half;
  const fg = groundY(cx, front);
  part(root, GEO.box, dark, [2 * half, 0.08, 0.14], [cx, fg + 0.79, front - 0.32]);
  const [lx, lg, lz] = corner(-1, -1, 0);
  for (const y of [1.6, 4.6, 7.6]) part(root, GEO.box, dark, [0.3, 0.45, 0.3], [lx + 0.45, lg + y, lz - 0.05]);
  part(root, GEO.box, mat('#58605a'), [1.3, 1.1, 0.9], [lx + 0.6, lg + 0.55, lz - 1.25]);
  part(root, GEO.box, dark, [1.4, 0.1, 1.0], [lx + 0.6, lg + 1.15, lz - 1.25]);
  part(root, GEO.cyl6, dark, [0.06, 1.3, 0.06], [lx + 0.05, lg + 0.9, lz - 0.75], [Math.PI / 2, 0, 0]);
  const [rx, rg, rz] = corner(1, -1, 0);
  part(root, GEO.box, mat('#c9a227'), [0.5, 0.75, 0.3], [rx - 0.5, rg + 4.5, rz - 0.3]);
  part(root, GEO.box, dark, [0.32, 0.12, 0.05], [rx - 0.5, rg + 4.7, rz - 0.47]);
  part(root, GEO.sphere, mat('#b03a2e'), [0.06, 0.06, 0.04], [rx - 0.5, rg + 4.35, rz - 0.47]);
  // An electrical cabinet beside the gate, its conduit running into the kerb.
  part(root, GEO.box, mat('#6e7470'), [0.85, 1.5, 0.5], [rx - 1.8, rg + 0.75, rz - 1.5]);
  part(root, GEO.box, dark, [0.9, 0.06, 0.55], [rx - 1.8, rg + 1.52, rz - 1.5]);
  part(root, GEO.box, yellow, [0.3, 0.3, 0.02], [rx - 1.8, rg + 1.1, rz - 1.76]);
  part(root, GEO.cyl6, dark, [0.06, 1.1, 0.06], [rx - 1.8, rg + 0.35, rz - 0.95], [Math.PI / 2, 0, 0]);

  // Warning signs on both front corner posts: a red header band, a warning triangle and lines of "text".
  for (const sx of [-1, 1]) {
    const [x, g, z] = corner(sx, -1, 0);
    const sz = z - 0.36;
    const y = g + 3.3;
    part(root, GEO.box, dark, [1.45, 1.15, 0.04], [x, y, sz + 0.02]);
    part(root, GEO.box, yellow, [1.35, 1.05, 0.04], [x, y, sz]);
    part(root, GEO.box, mat('#a8322a'), [1.35, 0.24, 0.02], [x, y + 0.4, sz - 0.03]);
    part(root, GEO.box, mat('#f2efe6'), [0.8, 0.06, 0.02], [x, y + 0.4, sz - 0.045]);
    part(root, GEO.tri, dark, [0.3, 0.02, 0.3], [x - 0.35, y - 0.08, sz - 0.03], [-Math.PI / 2, 0, 0]);
    part(root, GEO.tri, yellow, [0.2, 0.02, 0.2], [x - 0.35, y - 0.1, sz - 0.045], [-Math.PI / 2, 0, 0]);
    part(root, GEO.box, dark, [0.05, 0.12, 0.02], [x - 0.35, y - 0.07, sz - 0.06]);
    for (let k = 0; k < 3; k++) part(root, GEO.box, dark, [0.55 - k * 0.1, 0.05, 0.02], [x + 0.25 - k * 0.05, y + 0.05 - k * 0.15, sz - 0.03]);
  }

  // Floodlights on tall poles behind the back wall (clear of the corner braces), angled down into the paddock.
  const lens = mat('#f2efe0');
  for (const sx of [-1, 1]) {
    const x = cx + sx * (half - 2.5);
    const z = cz + half + 1.6;
    const g = groundY(x, z);
    part(root, GEO.box, concrete, [0.9, 0.5, 0.9], [x, g + 0.1, z]);
    part(root, GEO.cyl, post, [0.12, 12.5, 0.12], [x, g + 6.25, z]);
    const head = group(root, [x, g + 12.3, z], [0, Math.atan2(cx - x, cz - z), 0]);
    part(head, GEO.box, post, [0.1, 0.1, 1.1], [0, 0, 0.5]);
    part(head, GEO.box, post, [1.3, 0.08, 0.08], [0, -0.1, 1.0]);
    for (const hx of [-0.5, 0.5]) {
      const lamp = group(head, [hx, -0.1, 1.05], [0.55, 0, 0]);
      part(lamp, GEO.box, mat('#2d3136'), [0.8, 0.5, 0.35], [0, 0, 0]);
      part(lamp, GEO.box, lens, [0.65, 0.36, 0.02], [0, 0, 0.18]);
    }
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
  body: THREE.MeshStandardMaterial;
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

/** Height of the roof gear (rack and light bar) above the wheels' ground line: a wreck rests on it. */
const CAR_ROOF = 2.8;

/**
 * A park utility vehicle facing +z, wheels on y = 0: a bevelled body with wheel arches and flares,
 * tinted glass, a bull bar, a roof rack and light bar, a snorkel and a spare wheel, in the park's paint
 * with a side stripe and a plain round door emblem, muddy low down. Two draw calls: the paint (which
 * darkens when wrecked) and everything else, baked into vertex colours.
 */
export function createCar(color: string, stripe: string): Car {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25 });
  body.userData.dynamic = true; // darkens when wrecked
  owned.push(body);
  const tire = mat('#232221');
  const rim = mat('#8c9196');
  const trim = mat('#2b2d30');
  const black = mat('#141516');
  const glass = mat('#1b232a');
  const mud = mat('#5b4a36');
  const chrome = mat('#b9bec2');
  const stripeMat = mat(stripe);
  const X = 1.12; // the body's side faces
  // Body shell (with the wheel arches cut out) and the cabin on top, narrower than the body.
  part(g, GEO.carShell, body, [1, 1, 1]);
  part(g, GEO.carCabin, body, [1, 1, 1]);
  // Tinted side windows, standing just proud of the cabin, and the B-pillar between them.
  part(g, GEO.carFrontWindow, glass, [1, 1, 1]);
  part(g, GEO.carRearWindow, glass, [1, 1, 1]);
  for (const s of [-1, 1]) part(g, GEO.box, body, [0.06, 0.74, 0.16], [s * 1.01, 1.98, -0.62]);
  // Raked windscreen and the rear window.
  part(g, GEO.box, glass, [1.75, 0.95, 0.03], [0, 1.97, 0.63], [-0.668, 0, 0]);
  part(g, GEO.box, glass, [1.6, 0.6, 0.03], [0, 2.05, -2.25]);
  // Arch liners, so the arches don't show daylight through the body, and the underbody.
  for (const z of [-1.45, 1.45]) part(g, GEO.box, black, [1.5, 0.75, 1.3], [0, 0.85, z]);
  part(g, GEO.box, black, [1.5, 0.22, 3.4], [0, 0.55, 0]);
  // Wheels: chunky tyres on steel rims with hubs, under black arch flares.
  for (const [x, z] of [[-1, 1.45], [1, 1.45], [-1, -1.45], [1, -1.45]] as const) {
    part(g, GEO.cyl16, tire, [0.58, 0.44, 0.58], [x, 0.58, z], [0, 0, Math.PI / 2]);
    part(g, GEO.cyl16, rim, [0.34, 0.46, 0.34], [x, 0.58, z], [0, 0, Math.PI / 2]);
    part(g, GEO.cyl6, trim, [0.12, 0.48, 0.12], [x, 0.58, z], [0, 0, Math.PI / 2]);
    part(g, GEO.flare, trim, [0.74, 0.74, 1.6], [Math.sign(x) * 1.15, ARCH.y, z], [0, Math.PI / 2, 0]);
  }
  // Side steps, mud along the sills and doors, door shut lines and handles, the stripe and the emblem.
  for (const s of [-1, 1]) {
    part(g, GEO.box, trim, [0.2, 0.07, 1.45], [s * 1.2, 0.56, 0]);
    part(g, GEO.box, mud, [0.02, 0.2, 1.5], [s * (X + 0.01), 0.72, 0]);
    for (const z of [-2.18, 2.2]) part(g, GEO.box, mud, [0.02, 0.18, 0.12], [s * (X + 0.01), 0.72, z]);
    for (const z of [0.72, -0.55]) part(g, GEO.box, black, [0.02, 0.82, 0.025], [s * (X + 0.005), 1.07, z]);
    for (const z of [0.42, -0.88]) part(g, GEO.box, trim, [0.04, 0.05, 0.18], [s * (X + 0.02), 1.33, z]);
    part(g, GEO.box, stripeMat, [0.02, 0.1, 3.4], [s * (X + 0.01), 1.43, -0.5]);
    part(g, GEO.cyl16, chrome, [0.2, 0.02, 0.2], [s * (X + 0.01), 1.0, 0.1], [0, 0, Math.PI / 2]);
    part(g, GEO.cyl16, stripeMat, [0.13, 0.02, 0.13], [s * (X + 0.02), 1.0, 0.1], [0, 0, Math.PI / 2]);
    // Mirrors on short arms at the windscreen pillars.
    part(g, GEO.box, trim, [0.22, 0.04, 0.04], [s * 1.13, 1.62, 0.78]);
    part(g, GEO.box, black, [0.08, 0.2, 0.26], [s * 1.26, 1.66, 0.78]);
  }
  // Front: grille with slats, round headlights in bezels, indicators, bumper, plate, skid plate, bull bar.
  part(g, GEO.box, black, [1.3, 0.38, 0.04], [0, 1.0, 2.4]);
  for (let k = -2; k <= 2; k++) part(g, GEO.box, trim, [0.05, 0.34, 0.03], [k * 0.24, 1.0, 2.42]);
  for (const s of [-1, 1]) {
    part(g, GEO.cyl16, trim, [0.18, 0.04, 0.18], [s * 0.85, 1.05, 2.4], [Math.PI / 2, 0, 0]);
    part(g, GEO.cyl16, mat('#f4f1dc'), [0.14, 0.05, 0.14], [s * 0.85, 1.05, 2.42], [Math.PI / 2, 0, 0]);
    part(g, GEO.box, mat('#e08a1e'), [0.18, 0.08, 0.03], [s * 0.85, 0.84, 2.4]);
  }
  part(g, GEO.box, trim, [2.3, 0.3, 0.3], [0, 0.75, 2.4]);
  part(g, GEO.box, mat('#e9e6dc'), [0.5, 0.14, 0.02], [0, 0.75, 2.56]);
  part(g, GEO.box, trim, [1.6, 0.06, 0.6], [0, 0.48, 2.3], [0.2, 0, 0]);
  for (const s of [-1, 1]) part(g, GEO.cyl6, trim, [0.05, 0.85, 0.05], [s * 0.55, 1.07, 2.62]);
  for (const y of [1.48, 1.12]) part(g, GEO.cyl6, trim, [0.05, 1.2, 0.05], [0, y, 2.62], [0, 0, Math.PI / 2]);
  // Rear: tail lights, plate, bumper and the spare wheel on the tailgate.
  for (const s of [-1, 1]) {
    part(g, GEO.box, mat('#9b1d1d'), [0.16, 0.34, 0.04], [s * 1.0, 1.2, -2.33]);
    part(g, GEO.box, mat('#e08a1e'), [0.16, 0.1, 0.04], [s * 1.0, 0.96, -2.33]);
  }
  part(g, GEO.box, trim, [2.3, 0.28, 0.26], [0, 0.72, -2.36]);
  part(g, GEO.box, mat('#e9e6dc'), [0.5, 0.14, 0.02], [0, 1.0, -2.33]);
  part(g, GEO.cyl16, tire, [0.5, 0.3, 0.5], [0, 1.45, -2.45], [Math.PI / 2, 0, 0]);
  part(g, GEO.cyl16, rim, [0.3, 0.32, 0.3], [0, 1.45, -2.45], [Math.PI / 2, 0, 0]);
  // Snorkel up the right windscreen pillar.
  part(g, GEO.cyl6, black, [0.07, 1.25, 0.07], [1.16, 1.88, 0.95]);
  part(g, GEO.box, black, [0.16, 0.14, 0.24], [1.16, 2.55, 1.0]);
  // Roof rack with a light bar across the front of it.
  for (const s of [-1, 1]) {
    part(g, GEO.cyl6, trim, [0.04, 2.0, 0.04], [s * 0.85, 2.64, -0.95], [Math.PI / 2, 0, 0]);
    for (const z of [-1.9, 0]) part(g, GEO.box, trim, [0.06, 0.14, 0.06], [s * 0.85, 2.55, z]);
  }
  for (const z of [-1.8, -0.95, -0.1]) part(g, GEO.cyl6, trim, [0.04, 1.75, 0.04], [0, 2.64, z], [0, 0, Math.PI / 2]);
  part(g, GEO.box, black, [1.5, 0.14, 0.16], [0, 2.72, 0.05]);
  for (let k = 0; k < 4; k++) part(g, GEO.box, mat('#e9eef0'), [0.3, 0.09, 0.02], [-0.54 + k * 0.36, 2.72, 0.14]);
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
  // The roof crumples as it lands on it, and the body comes to rest a little twisted.
  const squash = 1 - 0.14 * ease;
  g.scale.set(1 + 0.04 * ease, squash, 1);
  // Up in an arc, then resting on its roof gear.
  g.position.y = groundY(g.position.x, g.position.z) + Math.sin(Math.PI * k) * 3 + CAR_ROOF * squash * ease;
  g.rotation.set(0.07 * car.roll * ease, car.heading, car.roll * Math.PI * ease);
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

/**
 * A park visitor in a safari hat, or a park ranger in uniform with a tranquilliser rifle. About 2.5 units
 * tall. Faces +z; rotation order YXZ so a fall (rotation.x) tips it over its own back.
 */
export function createPerson(rand: () => number, kind: Person['kind'] = 'visitor'): Person {
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  const ranger = kind === 'ranger';
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const body = group(g);
  body.scale.setScalar(1.4);
  const shirt = mat(ranger ? '#4a5638' : pick(SHIRTS));
  const pants = mat(ranger ? '#33382c' : pick(PANTS));
  const skin = mat(pick(SKIN));
  const legs = [-0.14, 0.14].map((x) => {
    const pivot = group(body, [x, 0.9, 0]);
    part(pivot, GEO.cyl, pants, [0.12, 0.88, 0.12], [0, -0.44, 0]);
    part(pivot, GEO.box, mat(ranger ? '#1f1a16' : '#4a3626'), [0.18, 0.12, 0.3], [0, -0.88, 0.05]);
    return pivot;
  });
  part(body, GEO.box, shirt, [0.56, 0.72, 0.32], [0, 1.28, 0]);
  if (ranger) {
    // Utility vest and belt.
    part(body, GEO.box, mat('#2a2f24'), [0.6, 0.42, 0.36], [0, 1.38, 0]);
    part(body, GEO.box, mat('#1e1c19'), [0.58, 0.08, 0.34], [0, 0.94, 0]);
  }
  const arms = [-0.37, 0.37].map((x) => {
    const pivot = group(body, [x, 1.6, 0]);
    part(pivot, GEO.cyl, shirt, [0.085, 0.36, 0.085], [0, -0.16, 0]);
    part(pivot, GEO.cyl, skin, [0.075, 0.32, 0.075], [0, -0.48, 0]);
    return pivot;
  });
  if (ranger) {
    // The tranquilliser rifle, held in the right hand along the arm.
    const rifle = group(arms[1], [-0.05, -0.6, 0.1]);
    part(rifle, GEO.box, mat('#22211f'), [0.08, 0.1, 0.95], [0, 0, 0.2]);
    part(rifle, GEO.cyl, mat('#3a3a38'), [0.03, 0.5, 0.03], [0, 0.03, 0.85], [Math.PI / 2, 0, 0]);
    part(rifle, GEO.box, mat('#4a3a2a'), [0.07, 0.18, 0.3], [0, -0.08, -0.25]);
  }
  part(body, GEO.sphere, skin, [0.21, 0.23, 0.21], [0, 1.88, 0]);
  for (const x of [-0.08, 0.08]) part(body, GEO.sphere, mat('#1b1b1b'), [0.03, 0.035, 0.03], [x, 1.91, 0.19]);
  if (ranger) {
    const cap = mat('#2b3024');
    part(body, GEO.cyl, cap, [0.22, 0.1, 0.22], [0, 2.05, 0]);
    part(body, GEO.box, cap, [0.3, 0.03, 0.2], [0, 2.01, 0.16]);
  } else {
    const hat = mat('#cdb27a');
    part(body, GEO.cyl, hat, [0.34, 0.03, 0.34], [0, 2.05, 0]);
    part(body, GEO.cyl, hat, [0.19, 0.16, 0.19], [0, 2.13, 0]);
  }
  const alert = new THREE.Sprite(alertMaterial());
  owned.push(alert.material);
  alert.scale.setScalar(1.1);
  alert.renderOrder = 10;
  alert.position.y = 4;
  // Kept for the panic bob, but not shown: a cartoon "!" doesn't suit the game any more.
  alert.visible = false;
  bake(g, [...legs, ...arms], owned);
  return { group: g, legs, arms, alert, state: 'idle', t: 0, heading: rand() * 6, vel: new THREE.Vector3(), phase: rand() * 6, kind, aim: 0 };
}

/**
 * Poses for each state: standing about (visitors fidget and wave; rangers walk their patrol or raise
 * the rifle), arms-up running in a panic, and lying flat after being knocked over. `speed` is how fast
 * it is moving.
 */
export function posePerson(p: Person, dt: number, t: number, speed: number) {
  p.t += dt;
  const g = p.group;
  if (p.state === 'down') {
    // Topple over backwards, lie still, then scramble up and run.
    const k = Math.min(1, p.t / 0.35);
    g.rotation.x = -(Math.PI / 2 - 0.1) * k * k;
    g.position.y += Math.sin(Math.PI * k) * 0.02;
    p.legs.forEach((l, i) => (l.rotation.x = 0.3 * k * (i ? 1 : -0.5)));
    p.arms.forEach((a, i) => a.rotation.set(-0.5 * k, 0, (i ? -1 : 1) * 1.2 * k));
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
    p.legs.forEach((l, i) => (l.rotation.x = Math.sin(p.phase + i * Math.PI) * 0.9));
    p.arms.forEach((a, i) => {
      a.rotation.x = p.kind === 'ranger' ? -0.6 + Math.sin(p.phase + i * Math.PI) * 0.5 : Math.PI - 0.3 + Math.sin(p.phase * 1.3 + i * Math.PI) * 0.35;
      a.rotation.z = (i ? -1 : 1) * 0.25;
    });
    p.alert.position.y = 4 + Math.abs(Math.sin(t * 9)) * 0.3;
    if (p.t > RUN_FOR) {
      p.state = 'gone';
      g.visible = false;
    }
  } else if (p.state === 'idle') {
    if (speed > 0.3) {
      p.phase += dt * (4 + speed * 1.5);
      p.legs.forEach((l, i) => (l.rotation.x = Math.sin(p.phase + i * Math.PI) * 0.55));
    } else p.legs.forEach((l) => (l.rotation.x = 0));
    if (p.kind === 'ranger') {
      // Rifle carried low, or raised to the shoulder and pointed.
      p.arms[0].rotation.set(-0.2 - p.aim * 1.25, 0.35 * p.aim, 0.1 + p.aim * 0.35);
      p.arms[1].rotation.set(-0.35 - p.aim * 1.2, 0, -0.1);
      g.rotation.y = p.heading;
    } else {
      const wave = Math.sin(t * 0.7 + p.phase) > 0.85;
      p.arms[0].rotation.set(0, 0, 0.08);
      p.arms[1].rotation.set(wave ? Math.PI - 0.4 + Math.sin(t * 10) * 0.3 : 0, 0, -0.08);
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
}
