import * as THREE from 'three';
import type { DinoSpec } from './species';
import { bake } from './merge';

export { DINOS, type DinoSpec } from './species';

/**
 * Procedural dinosaurs. Each body (tail, torso, neck and head) is one smooth mesh, swept along the spine
 * and skinned to a chain of bones, so tails and necks bend without seams. Legs are jointed (hip, knee,
 * ankle, foot) so feet lift and plant. Skin is a scale-and-stripe texture painted in code.
 */

/** A leg's joints, animated by animate(). Knee and ankle are optional for very simple legs. */
interface Leg {
  pivot: THREE.Object3D;
  knee: THREE.Object3D;
  ankle: THREE.Object3D;
  foot: THREE.Object3D;
  /** +1 for knees that point forward (hind legs), -1 for elbows that point back (front legs). */
  bend: number;
  offset: number;
  amp: number;
  /** How high the foot lifts on its swing (1 is the usual; a sauropod shuffles lower). */
  lift: number;
  /** Hip height at rest. */
  baseY: number;
  /** Thigh, shin and foot bone as (dy, dz) offsets, for working out how much a bent leg shortens. */
  segs: [number, number][];
  /** Hip-to-foot height with the leg straight. */
  rest: number;
}

/** How far below the hip the end of the leg is, with the hip, knee and ankle bent by these angles. */
function legDrop(l: Leg, hip: number, knee: number, ankle: number) {
  const angles = [hip, hip + knee, hip + knee + ankle];
  let y = 0;
  l.segs.forEach(([dy, dz], i) => {
    y += dy * Math.cos(angles[i]) - dz * Math.sin(angles[i]);
  });
  return -y;
}

/** The moving parts of a dinosaur model, animated by animate(). */
export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  legs: Leg[];
  tail: THREE.Object3D[];
  neck: THREE.Object3D[];
  head: THREE.Object3D;
  jaw: THREE.Object3D | null;
  /** Collision radius. */
  radius: number;
  stepRate: number;
  /** How long the current roar lasts, in seconds (the head rears back for the first 5/8 of it). */
  roarFor: number;
  bob: number;
  phase: number;
  /** Counts down from 1 while roaring. */
  roaring: number;
  /** Counts down from 1 during a bite: lunge forward, jaws snap shut halfway. */
  biting: number;
  /** Wings, for flyers: folded on the ground, spread in the air. */
  wings: { pivot: THREE.Object3D; side: number }[];
  /** 0 folded (walking), 0.5 spread and still (gliding), 1 flapping. */
  wingMode: number;
  spread: number;
  lastStep: number;
  /** 0..1: knees bent and body lowered, feet staying planted (before a jump, and on landing). */
  crouch: number;
  /** 0..1: legs tucked up under the body, for time in the air. */
  air: number;
  /** The chest bone, swelled for breathing (and the first neck bone, which undoes the swell so the head stays put). */
  chest: THREE.Bone;
  /** How far the body shifts sideways over the planted leg each step, in body units. */
  sway: number;
  /** How much the tail swings when walking (1 = a heavy theropod; a stiffened raptor tail is less). */
  tailWag: number;
  /** Resting pitch of the body (negative is nose up); flyers level out as their wings spread. */
  lean: number;
  /** Quadruped: the gait and the body roll are timed to four feet instead of two. */
  quad: boolean;
  /** Seconds left of a head shake with something held in the jaws (set by the game; counts down here). */
  thrash: number;
  /** How long the current head shake lasts in all. */
  thrashFor: number;
  /** Counts down from 1 while heaving something over with the jaws: the head hauls up and back, the body rears. */
  heave: number;
  /** How this species leans into a tree or rock it's pushing, and what it does when a tree gives way (none: it can't push). */
  pushStyle: PushStyle | null;
  /** 0..1, set by the game: how hard it's pushing against something right now. */
  push: number;
  /** The push eased in and out (animate() follows `push` with it). */
  strain: number;
  /** Counts down from 1 after a tree gives way: the species' follow-through (set by the game). */
  shove: number;
  /** Which way the follow-through goes: -1 left, 1 right. */
  shoveSide: number;
  /** 0..1, set by the game: how far a quadruped's gait has gone from a walk into a gallop (see animate()). */
  gallop: number;
  /** The gallop eased in and out. */
  galloping: number;
}

/**
 * A quadruped's gallop, a horse's transverse gallop: the hind feet land one just after the other, then the
 * fore feet, the right fore leading (fractions of the cycle from the left hind's footfall, legs listed
 * front-left, front-right, hind-left, hind-right), each foot down for only `duty` of the cycle, so after the
 * leading fore foot pushes off there's a moment with all four in the air.
 */
const GALLOP = { land: [0.4, 0.5, 0, 0.1], duty: 0.34 };
/** A leg's phase offset (in animate()'s terms) that lands its foot `at` that fraction of the cycle. */
const landAt = (at: number) => -Math.PI / 2 - 2 * Math.PI * at;
/** The shortest way round from angle a to angle b. */
const turn = (a: number, b: number) => {
  const d = (((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return d;
};
/**
 * Stretches a leg's phase so its foot is down for `duty` of the cycle instead of half of it: the stance
 * (phase -π/2 to π/2, where cos > 0) is squeezed into that share, and the swing fills the rest.
 */
function warp(ph: number, duty: number) {
  if (duty === 0.5) return ph;
  const x = (((ph + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI);
  return x < duty ? -Math.PI / 2 + (Math.PI * x) / duty : Math.PI / 2 + (Math.PI * (x - duty)) / (1 - duty);
}

/**
 * - `butt` (T-Rex): head down, snout and brow jammed against it, tail up for balance and legs dug in;
 *   when it gives, the head wrenches up and aside with a snarl.
 * - `horns` (Triceratops): head tucked right down so the horns take it, front end low; then a hooking
 *   upward toss of the head.
 * - `shoulder` (Stegosaurus): head low, leaning a shoulder into it, rolled onto that side; then a
 *   swipe of the spiked tail across, the body twisting against it.
 * - `chest` (Brachiosaurus): leaning its great chest into it, the neck drawn back up out of the way;
 *   then the neck sweeps back and over as it bears down and through.
 */
export type PushStyle = 'butt' | 'horns' | 'shoulder' | 'chest';
interface PushPose {
  /** Seconds the follow-through takes. */
  time: number;
  /** While pushing: body forward (units) and pitched nose-down, rolled, knees bent; neck bones and head pitched down; tail raised. */
  bodyZ: number; pitch: number; roll: number; crouch: number; neck: number; head: number; tail: number;
}
const PUSH: Record<PushStyle, PushPose> = {
  butt: { time: 0.75, bodyZ: 0.35, pitch: 0.1, roll: 0, crouch: 0.35, neck: 0.1, head: 0.28, tail: 0.025 },
  horns: { time: 0.65, bodyZ: 0.25, pitch: 0.08, roll: 0, crouch: 0.45, neck: 0.14, head: 0.4, tail: 0 },
  shoulder: { time: 0.85, bodyZ: 0.2, pitch: 0.06, roll: 0.08, crouch: 0.35, neck: 0.1, head: 0.25, tail: 0.01 },
  chest: { time: 1.0, bodyZ: 0.4, pitch: 0.04, roll: 0, crouch: 0.3, neck: -0.05, head: 0.12, tail: 0.02 },
};

type V3 = [number, number, number];
type Colors = DinoSpec['colors'];

// ===================== Shared resources, freed by disposeDinoAssets() =====================

const GEO = {
  sphere: new THREE.SphereGeometry(1, 14, 10),
  cone: new THREE.ConeGeometry(1, 1, 8),
};
/** Per-model geometry (every swept part is unique). */
const owned: { dispose(): void }[] = [];
const plain = new Map<string, THREE.MeshStandardMaterial>();
const skins = new Map<string, { mat: THREE.MeshStandardMaterial; tex: THREE.Texture[] }>();

function plainMat(color: string, roughness = 0.6) {
  const key = `${color}/${roughness}`;
  let m = plain.get(key);
  if (!m) plain.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness })));
  return m;
}
const ivory = () => plainMat('#d9cfb8', 0.45);
const eyeMat = () => plainMat('#1b120a', 0.15);
const mouthMat = () => plainMat('#4a201c', 0.7);

// ===================== Skin texture =====================

/** Tileable value noise on a `period`-cell lattice. */
function noise2(x: number, y: number, period: number, seed: number) {
  const hash = (i: number, j: number) => {
    const h = Math.sin(((i % period) + period) % period * 127.1 + (((j % period) + period) % period) * 311.7 + seed * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Scales, a darker back with irregular stripes, and a pale belly. u runs round the body (0 and 1 under
 * the belly, 0.5 along the spine); v runs along it and repeats. Returns a colour map and a bump map.
 */
function skinMaterial(c: Colors, stripes = true) {
  const key = `${c.body}${c.belly}${c.accent}${stripes ? '' : '/plain'}`;
  const hit = skins.get(key);
  if (hit) return hit.mat;
  const W = 256;
  const H = 512;
  const colCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  colCanvas.width = bumpCanvas.width = W;
  colCanvas.height = bumpCanvas.height = H;
  const cctx = colCanvas.getContext('2d')!;
  const bctx = bumpCanvas.getContext('2d')!;
  const col = cctx.createImageData(W, H);
  const bump = bctx.createImageData(W, H);
  const body = new THREE.Color(c.body);
  const belly = new THREE.Color(c.belly);
  const accent = new THREE.Color(c.accent);
  const tmp = new THREE.Color();
  const SCALES_U = 64;
  const SCALES_V = 128;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      // Limbs (no stripes) keep close to the body colour all the way round; bodies shade to a pale belly.
      const dorsal = (1 - Math.cos(u * Math.PI * 2)) / 2 * (stripes ? 1 : 0.45) + (stripes ? 0 : 0.5);
      tmp.copy(belly).lerp(body, THREE.MathUtils.smoothstep(dorsal, 0.22, 0.6));
      // Irregular darker bands across the back, broken up by noise.
      const wobble = noise2(u * 8, v * 16, 8, 1) * 2.2 + noise2(u * 16, v * 32, 16, 2) * 0.8;
      const band = Math.sin(v * Math.PI * 2 * 7 + wobble * 2.4);
      if (stripes && band > 0.25 && dorsal > 0.45) tmp.lerp(accent, THREE.MathUtils.clamp((band - 0.25) * 1.6, 0, 1) * (dorsal - 0.45) * 1.5);
      // Mottling.
      const mottle = noise2(u * 32, v * 64, 32, 3);
      tmp.multiplyScalar(0.86 + mottle * 0.24);
      // Scales: offset rows of rounded bumps, bigger along the back.
      const cu = u * SCALES_U;
      const cv = v * SCALES_V;
      const row = Math.floor(cv);
      const fx = cu + (row % 2) * 0.5 - Math.floor(cu + (row % 2) * 0.5) - 0.5;
      const fy = cv - row - 0.5;
      const d = Math.min(1, Math.hypot(fx, fy * 1.15) * 1.9);
      const height = 1 - d * d;
      const cell = noise2(Math.floor(cu) * 1.7, row * 1.3, 4096, 4);
      tmp.multiplyScalar(0.9 + height * 0.12 + (cell - 0.5) * 0.08);
      const i = (y * W + x) * 4;
      col.data[i] = Math.min(255, tmp.r * 255);
      col.data[i + 1] = Math.min(255, tmp.g * 255);
      col.data[i + 2] = Math.min(255, tmp.b * 255);
      col.data[i + 3] = 255;
      const h = Math.round((height * 0.75 + mottle * 0.25) * 255);
      bump.data[i] = bump.data[i + 1] = bump.data[i + 2] = h;
      bump.data[i + 3] = 255;
    }
  }
  // The colour data is linear-ish arithmetic on sRGB values; that's fine for a painted look.
  cctx.putImageData(col, 0, 0);
  bctx.putImageData(bump, 0, 0);
  const map = new THREE.CanvasTexture(colCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  for (const t of [map, bumpMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  const mat = new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: 1.2, roughness: 0.62, metalness: 0 });
  mat.userData.colors = c;
  skins.set(key, { mat, tex: [map, bumpMap] });
  return mat;
}

/** The same skin without the back stripes, for limbs (stripes along a leg read as bandages). */
const limbSkin = (skin: THREE.Material) => (skin.userData.colors ? skinMaterial(skin.userData.colors as Colors, false) : skin);

// ===================== Swept geometry =====================

/** A cross-section on a sweep: centre, half-width (x), half-height, and how much deeper the lower half is. */
interface Ring { p: THREE.Vector3; w: number; h: number; drop: number }

const SIDE = new THREE.Vector3(1, 0, 0);

/**
 * Sweeps a slightly boxy elliptical cross-section along rings whose centres all lie in the yz plane.
 * The section's width is always along x, so the sweep can turn up (necks) or down (legs) freely.
 * u runs round the section from the underside; v is distance along the sweep times `vScale`.
 */
function sweep(rings: Ring[], sides = 16, vScale = 0.25, uOffset = 0) {
  const S = sides;
  const n = rings.length;
  const posArr = new Float32Array(n * (S + 1) * 3);
  const uvArr = new Float32Array(n * (S + 1) * 2);
  const T = new THREE.Vector3();
  const U = new THREE.Vector3();
  const p = new THREE.Vector3();
  let along = 0;
  for (let i = 0; i < n; i++) {
    const r = rings[i];
    if (i > 0) along += r.p.distanceTo(rings[i - 1].p);
    const a = rings[Math.max(0, i - 1)].p;
    const b = rings[Math.min(n - 1, i + 1)].p;
    T.subVectors(b, a).normalize();
    U.crossVectors(T, SIDE).normalize();
    for (let k = 0; k <= S; k++) {
      const ang = -Math.PI / 2 + (k / S) * Math.PI * 2;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      const sx = Math.sign(cs) * Math.abs(cs) ** 0.85;
      const sy = Math.sign(sn) * Math.abs(sn) ** 0.85;
      const hh = sy < 0 ? r.h * (1 + r.drop) : r.h;
      p.copy(r.p).addScaledVector(SIDE, r.w * sx).addScaledVector(U, hh * sy);
      const j = i * (S + 1) + k;
      posArr.set([p.x, p.y, p.z], j * 3);
      uvArr.set([k / S + uOffset, along * vScale], j * 2);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < S; k++) {
      const a = i * (S + 1) + k;
      const b = a + S + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // The seam (first and last column) shares a position; give both the averaged normal.
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const a = i * (S + 1);
    const b = a + S;
    const x = nrm.getX(a) + nrm.getX(b);
    const y = nrm.getY(a) + nrm.getY(b);
    const z = nrm.getZ(a) + nrm.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(a, x / l, y / l, z / l);
    nrm.setXYZ(b, x / l, y / l, z / l);
  }
  owned.push(geo);
  return geo;
}

/** Catmull-Rom through evenly spaced values, sampled at t in [0, 1] for segment i. */
function cr(a: number, b: number, c: number, d: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

/** A spine station: z along the body, centre height y (relative to the hips), half-width, half-height, belly drop. */
type Station = [z: number, y: number, w: number, h: number, drop?: number];

/** Smoothly interpolated rings through the stations, about `density` per unit of length. */
function ringsFrom(stations: Station[], density = 6): Ring[] {
  const out: Ring[] = [];
  const at = (i: number) => stations[Math.max(0, Math.min(stations.length - 1, i))];
  for (let i = 0; i < stations.length - 1; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const len = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const steps = Math.max(2, Math.ceil(len * density));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const f = (k: number) => cr(a[k] ?? 0, b[k] ?? 0, c[k] ?? 0, d[k] ?? 0, t);
      out.push({ p: new THREE.Vector3(0, f(1), b[0] + (c[0] - b[0]) * t), w: Math.max(0.01, f(2)), h: Math.max(0.01, f(3)), drop: f(4) });
    }
  }
  const last = stations[stations.length - 1];
  out.push({ p: new THREE.Vector3(0, last[1], last[0]), w: Math.max(0.01, last[2]), h: Math.max(0.01, last[3]), drop: last[4] ?? 0 });
  return out;
}

/**
 * Rounds off the open ends of a sweep with two shrinking rings each, so tubes are closed (no seeing inside
 * them from behind) and joints overlap like ball joints.
 */
function capped(rings: Ring[], start = true, end = true): Ring[] {
  const cap = (r: Ring, toward: Ring): Ring[] => {
    const dir = r.p.clone().sub(toward.p).normalize();
    const size = Math.max(r.w, r.h);
    return [0.72, 0.38, 0.02].map((k, i) => ({
      p: r.p.clone().addScaledVector(dir, size * [0.35, 0.6, 0.68][i]),
      w: r.w * k,
      h: r.h * k,
      drop: r.drop,
    }));
  };
  const out = [...rings];
  if (start && rings.length > 1) out.unshift(...cap(rings[0], rings[1]).reverse());
  if (end && rings.length > 1) out.push(...cap(rings[rings.length - 1], rings[rings.length - 2]));
  return out;
}

/** A tapered limb segment from `a` to `b` (in the yz plane), with a muscle bulge near the top. */
function limb(parent: THREE.Object3D, mat: THREE.Material, a: V3, b: V3, w0: number, w1: number, bulge = 1.12, uOffset = 0.5) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const rings: Ring[] = [0, 0.12, 0.35, 0.7, 1].map((t) => {
    const w = (w0 + (w1 - w0) * t) * (t > 0.05 && t < 0.6 ? bulge : 1);
    return { p: A.clone().lerp(B, t), w, h: w * 1.05, drop: 0 };
  });
  // uOffset picks which side of the limb gets the texture's darker back: 0.5 the back, 0.25 the +x side, 0.75 the -x side.
  const mesh = new THREE.Mesh(sweep(capped(rings), 12, 0.5, uOffset), mat);
  mesh.castShadow = true;
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

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, scale: V3, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(...scale);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// ===================== Skinned body =====================

interface Body {
  mesh: THREE.SkinnedMesh;
  pelvis: THREE.Bone;
  tail: THREE.Bone[];
  fwd: THREE.Bone[];
  /** Body-space position of each bone (bones are never rotated at rest, so positions just add up). */
  home: Map<THREE.Object3D, THREE.Vector3>;
  /** Spine height at z (relative to the hips). */
  spineY(z: number): number;
  /** Spine half-height at z. */
  spineH(z: number): number;
  /** The bone that carries body-space point z. */
  boneAt(z: number): THREE.Bone;
}

/**
 * One continuous body from the stations, skinned to bones: a pelvis, a tail chain backwards from it and a
 * chest/neck/head chain forwards. Each ring follows the bone of the segment it sits in, blending with the
 * previous bone near each joint so the skin stretches instead of creasing.
 */
function skinnedBody(stations: Station[], tailZ: number[], pelvisZ: number, fwdZ: number[], mat: THREE.Material): Body {
  const rings = ringsFrom(stations);
  const geo = sweep(rings, 18, 0.25);
  const ys = rings.map((r) => r.p.y);
  const zs = rings.map((r) => r.p.z);
  const spineAt = (z: number, arr: number[]) => {
    for (let i = 0; i < zs.length - 1; i++) {
      if (z <= zs[i + 1]) {
        const t = THREE.MathUtils.clamp((z - zs[i]) / (zs[i + 1] - zs[i] || 1), 0, 1);
        return arr[i] + (arr[i + 1] - arr[i]) * t;
      }
    }
    return arr[arr.length - 1];
  };
  const hs = rings.map((r) => r.h);
  const spineY = (z: number) => spineAt(z, ys);
  const spineH = (z: number) => spineAt(z, hs);

  const home = new Map<THREE.Object3D, THREE.Vector3>();
  const pelvis = new THREE.Bone();
  pelvis.position.set(0, spineY(pelvisZ), pelvisZ);
  home.set(pelvis, pelvis.position.clone());
  const chain = (zsList: number[]) => {
    const out: THREE.Bone[] = [];
    let parent: THREE.Bone = pelvis;
    for (const z of zsList) {
      const b = new THREE.Bone();
      const at = new THREE.Vector3(0, spineY(z), z);
      b.position.subVectors(at, home.get(parent)!);
      parent.add(b);
      home.set(b, at);
      out.push(b);
      parent = b;
    }
    return out;
  };
  const tail = chain(tailZ);
  const fwd = chain(fwdZ);
  const bones = [pelvis, ...tail, ...fwd];

  // Weights per ring.
  const S = 19; // sides + 1
  const skinIndex = new Uint16Array(rings.length * S * 4);
  const skinWeight = new Float32Array(rings.length * S * 4);
  const owner = (z: number): { a: number; b: number; w: number } => {
    const list = z >= pelvisZ ? fwdZ : tailZ;
    const sign = z >= pelvisZ ? 1 : -1;
    const base = z >= pelvisZ ? 1 + tail.length : 1;
    let k = 0;
    while (k < list.length && (list[k] - z) * sign <= 0) k++;
    if (k === 0) return { a: 0, b: 0, w: 1 };
    const ownZ = list[k - 1];
    const nextZ = list[k] ?? ownZ + sign * 1.2;
    const t = Math.abs(z - ownZ) / Math.abs(nextZ - ownZ);
    const w = 0.5 + 0.5 * Math.min(1, t / 0.45);
    return { a: base + k - 1, b: k === 1 ? 0 : base + k - 2, w };
  };
  rings.forEach((r, i) => {
    const o = owner(r.p.z);
    for (let k = 0; k < S; k++) {
      const j = (i * S + k) * 4;
      skinIndex[j] = o.a;
      skinIndex[j + 1] = o.b;
      skinWeight[j] = o.w;
      skinWeight[j + 1] = 1 - o.w;
    }
  });
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // the bind-pose bounds don't follow the bones
  mesh.add(pelvis);
  mesh.bind(new THREE.Skeleton(bones));
  const boneAt = (z: number) => {
    const o = owner(z);
    return bones[o.a];
  };
  return { mesh, pelvis, tail, fwd, home, spineY, spineH, boneAt };
}

/** Adds `obj` to the bone that carries body-space point `at`, placed at that point. */
function attach(b: Body, obj: THREE.Object3D, at: V3, bone = b.boneAt(at[2])) {
  const h = b.home.get(bone)!;
  obj.position.set(at[0] - h.x, at[1] - h.y, at[2] - h.z);
  bone.add(obj);
  return obj;
}

// ===================== Common parts =====================

/** Small, deep-set eyes with a bony brow. */
/**
 * Reptile eyes: a glossy eyeball with an amber iris, a slit pupil and a highlight, set in a dark socket
 * under heavy upper and lower lids and a bony brow, looking out to the side and a little forward.
 */
function eyes(b: Body, skin: THREE.Material, x: number, y: number, z: number, r: number, bone?: THREE.Bone) {
  const ball = plainMat('#1a120b', 0.08);
  const iris = new THREE.MeshStandardMaterial({ color: '#c08a2a', emissive: '#5a3208', emissiveIntensity: 0.6, roughness: 0.12 });
  owned.push(iris);
  const pupil = plainMat('#050403', 0.1);
  const socket = plainMat('#140e0a', 0.9);
  for (const side of [-1, 1]) {
    const g = attach(b, new THREE.Group(), [x * side, y, z], bone);
    g.rotation.y = side * 0.35; // turn the eye's +x (outward) a little forward
    part(g, GEO.sphere, socket, [r * 0.7, r * 1.2, r * 1.45], [-side * r * 0.12, 0, 0]);
    part(g, GEO.sphere, ball, [r * 0.82, r, r * 1.1]);
    // Iris and pupil sit on the outward-facing surface of the eyeball.
    part(g, GEO.sphere, iris, [r * 0.16, r * 0.72, r * 0.78], [side * r * 0.72, 0, 0]);
    part(g, GEO.sphere, pupil, [r * 0.08, r * 0.6, r * 0.16], [side * r * 0.86, 0, 0]);
    part(g, GEO.sphere, plainMat('#ffffff', 0.05), [r * 0.05, r * 0.12, r * 0.12], [side * r * 0.84, r * 0.35, r * 0.28]);
    // Lids: hooded above, a softer fold below; they leave a narrow, watchful opening.
    part(g, GEO.sphere, skin, [r * 0.95, r * 0.62, r * 1.35], [side * r * 0.08, r * 0.62, 0], [0, 0, side * 0.25]);
    part(g, GEO.sphere, skin, [r * 0.9, r * 0.45, r * 1.25], [side * r * 0.05, -r * 0.72, 0], [0, 0, -side * 0.2]);
    // The brow ridge overhanging it all.
    part(g, GEO.sphere, skin, [r * 1.1, r * 0.5, r * 2.0], [-side * r * 0.1, r * 1.05, -r * 0.1], [0.12, 0, side * 0.3]);
  }
}

/** A row of teeth along a jaw edge, pointing down (upper) or up (lower). */
function teeth(parent: THREE.Object3D, from: V3, to: V3, count: number, size: number, up: boolean) {
  for (let k = 0; k < count; k++) {
    const t = k / (count - 1);
    const s = size * (1 - Math.abs(t - 0.35) * 0.7);
    for (const side of [-1, 1]) {
      const x = (from[0] + (to[0] - from[0]) * t) * side;
      const y = from[1] + (to[1] - from[1]) * t;
      const z = from[2] + (to[2] - from[2]) * t;
      part(parent, GEO.cone, ivory(), [s * 0.32, s, s * 0.32], [x, y + (up ? s / 2 : -s / 2), z], [up ? 0 : Math.PI, 0, 0]);
    }
  }
}

/** A hinged lower jaw swept from the hinge forward, with a dark mouth lining above it. */
function jaw(b: Body, skin: THREE.Material, hinge: V3, path: [dz: number, dy: number, w: number, h: number][], teethCount: number, toothSize: number) {
  const head = b.fwd[b.fwd.length - 1];
  const j = attach(b, new THREE.Group(), hinge, head);
  const rings: Ring[] = path.map(([dz, dy, w, h]) => ({ p: new THREE.Vector3(0, dy, dz), w, h, drop: 0.1 }));
  const m = new THREE.Mesh(sweep(capped(rings, true, false), 14, 0.4), skin);
  m.castShadow = true;
  j.add(m);
  const end = path[path.length - 2];
  const first = path[1];
  teeth(j, [first[2] * 0.78, first[1] + first[3] * 0.85, first[0]], [end[2] * 0.75, end[1] + end[3] * 0.85, end[0]], teethCount, toothSize, true);
  // Lining: only seen when the mouth opens.
  const lining = new THREE.Mesh(sweep(path.slice(0, -1).map(([dz, dy, w, h]) => ({ p: new THREE.Vector3(0, dy + h * 0.75, dz), w: w * 0.8, h: h * 0.25, drop: 0 })), 10, 0.4), mouthMat());
  j.add(lining);
  return j;
}

interface LegDef {
  x: number;
  y: number;
  z: number;
  /** Hip, knee, ankle and foot joints relative to the hip; all in the leg's yz plane. */
  pts: [V3, V3, V3, V3];
  w: [number, number, number, number];
  toes: number;
  toeLen: number;
  bend: number;
  offset: number;
  amp: number;
  claws?: boolean;
  /** Semi-erect limbs: the upper segment is bowed outwards by this angle and the lower one brought back in. */
  splay?: number;
  /** A raptor's foot: the inner toe is held cocked up off the ground, carrying a big sickle claw. */
  sickle?: boolean;
  /** How far the thigh continues above the hip joint, up into the body, so the leg grows out of the torso. */
  up?: number;
  /** Muscle bulge of the thigh and shin (1 = straight, column-like segments). */
  bulge?: number;
  /** How high the foot lifts on its swing, relative to the usual (1). */
  lift?: number;
}

function buildLeg(root: THREE.Object3D, skin: THREE.Material, d: LegDef): Leg {
  const [p0, p1, p2, p3] = d.pts;
  const rel = (a: V3, b: V3): V3 => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const pivot = group(root, [d.x, d.y, d.z]);
  // Stripe-free skin, turned so the outer side of the leg matches the flank above it.
  skin = limbSkin(skin);
  const uo = d.x >= 0 ? 0 : 1;
  const out = Math.sign(d.x) || 1;
  // animate() only ever sets rotation.x on these joints, so a resting roll stays put.
  if (d.splay) pivot.rotation.z = -out * d.splay;
  const up = d.up ?? 0;
  limb(pivot, skin, [p0[0], p0[1] + up, p0[2]], p1, d.w[0], d.w[1], d.bulge ?? 1.1, uo);
  const knee = group(pivot, p1);
  if (d.splay) knee.rotation.z = out * d.splay;
  limb(knee, skin, [0, 0, 0], rel(p1, p2), d.w[1], d.w[2], d.bulge ?? 1.12, uo);
  const ankle = group(knee, rel(p1, p2));
  limb(ankle, skin, [0, 0, 0], rel(p2, p3), d.w[2], d.w[3], 1.0, uo);
  // Fill the knee and ankle so the segments flow into each other instead of pinching at the joint
  // (flush with the segments on straight, column-like legs, so no knob shows).
  const js = d.bulge === 1 ? 0.97 : 1.02;
  part(knee, GEO.sphere, skin, [d.w[1] * js, d.w[1] * (js + 0.03), d.w[1] * (js + 0.06)]);
  part(ankle, GEO.sphere, skin, [d.w[2] * js, d.w[2] * (js + 0.03), d.w[2] * (js + 0.04)]);
  const foot = group(ankle, rel(p2, p3));
  // A fleshy pad under the end of the leg, from the heel to the toe joints, sitting on the ground.
  const above = d.y + p3[1];
  const w3 = d.w[3];
  const padH = Math.max(w3 * 0.45, Math.min(above, w3 * 0.7) * 0.6);
  const padY = -above + padH;
  // With no toes (sauropods) the pad is a broad, round elephant's foot instead.
  const round = d.toes === 0;
  const pad = new THREE.Mesh(
    sweep(capped(round
      ? [
        { p: new THREE.Vector3(0, -above + w3 * 0.62, -w3 * 0.6), w: w3 * 0.98, h: w3 * 0.62, drop: 0 },
        { p: new THREE.Vector3(0, -above + w3 * 0.62, 0), w: w3 * 1.08, h: w3 * 0.62, drop: 0 },
        { p: new THREE.Vector3(0, -above + w3 * 0.62, w3 * 0.7), w: w3 * 1.02, h: w3 * 0.62, drop: 0 },
      ]
      : [
        { p: new THREE.Vector3(0, padY + padH * 0.4, -w3 * 0.6), w: w3 * 0.85, h: padH * 1.15, drop: 0 },
        { p: new THREE.Vector3(0, padY + padH * 0.15, 0), w: w3 * 1.15, h: padH * 1.1, drop: 0 },
        { p: new THREE.Vector3(0, padY - padH * 0.05, w3 * 0.85), w: w3 * 1.3, h: padH * 0.9, drop: 0 },
      ]), 12, 0.5),
    skin,
  );
  pad.castShadow = true;
  foot.add(pad);
  // Toes grow out of the front of the pad, fanned out and resting on the ground, each ending in a claw.
  const toeR = w3 * 0.4;
  const inner = d.x < 0 ? d.toes - 1 : 0;
  for (let k = 0; k < d.toes; k++) {
    const spread = d.toes === 1 ? 0 : (k / (d.toes - 1) - 0.5) * (d.toes > 3 ? 1.1 : 0.85);
    const sickle = !!d.sickle && k === inner;
    // The sickle toe pivots up at the pad so only the two outer toes bear weight.
    const toe = group(foot, [Math.sin(spread) * w3 * 0.6, 0, w3 * 0.55], [sickle ? -0.75 : 0, spread, 0]);
    const len = d.toeLen * (sickle ? 0.7 : k === 0 || k === d.toes - 1 ? 0.82 : 1);
    const tip: V3 = [0, -above + toeR * 0.75, len];
    limb(toe, skin, [0, -above + toeR * 1.1, -w3 * 0.1], tip, toeR, toeR * 0.6, 1.08, uo);
    if (sickle) part(toe, GEO.cone, ivory(), [toeR * 0.55, len * 0.95, toeR * 0.55], [0, tip[1] - len * 0.47, tip[2] + len * 0.05], [Math.PI / 2 + 1.5, 0, 0]);
    else if (d.claws !== false) part(toe, GEO.cone, ivory(), [toeR * 0.45, len * 0.42, toeR * 0.45], [0, tip[1] - toeR * 0.25, tip[2] + len * 0.14], [Math.PI / 2 + 0.35, 0, 0]);
  }
  const segs = [rel(p0, p1), rel(p1, p2), rel(p2, p3)].map(([, y, z]) => [y, z] as [number, number]);
  const leg: Leg = { pivot, knee, ankle, foot, bend: d.bend, offset: d.offset, amp: d.amp, lift: d.lift ?? 1, baseY: d.y, segs, rest: 0 };
  leg.rest = legDrop(leg, 0, 0, 0);
  return leg;
}

/** Two legs (bipeds) or four (quadrupeds) with the usual diagonal gait. */
const PAIR = [0, Math.PI];

function rig(root: THREE.Group, body: THREE.Group, b: Body, o: Partial<Rig>): Rig {
  return {
    root, body, head: b.fwd[b.fwd.length - 1], legs: [], tail: b.tail, neck: b.fwd.slice(1, -1), jaw: null, chest: b.fwd[0],
    radius: 2, stepRate: 6, roarFor: 1.6, bob: 0.1, phase: 0, roaring: 0, biting: 0, lastStep: 0, wings: [], wingMode: 0, spread: 0, crouch: 0, air: 0,
    sway: 0.06, tailWag: 1, lean: 0, quad: false, thrash: 0, thrashFor: 1, heave: 0,
    pushStyle: null, push: 0, strain: 0, shove: 0, shoveSide: 1, gallop: 0, galloping: 0,
    ...o,
  };
}

/**
 * Walking quadrupeds use a lateral-sequence gait: left hind, left fore, right hind, right fore, a quarter
 * of a cycle apart. Legs are listed front-left, front-right, hind-left, hind-right.
 */
const QUAD = [-Math.PI / 2, Math.PI / 2, 0, Math.PI];

/** A row of small bony scutes along the back, from z0 to z1. */
function scutes(b: Body, mat: THREE.Material, z0: number, z1: number, n: number, size: number) {
  for (let k = 0; k < n; k++) {
    const z = z0 + ((z1 - z0) * k) / (n - 1);
    const s = size * (0.6 + Math.sin((k / (n - 1)) * Math.PI) * 0.4);
    const g = attach(b, new THREE.Group(), [0, b.spineY(z) + b.spineH(z) * 0.92, z]);
    part(g, GEO.sphere, mat, [s * 0.55, s * 0.45, s]);
  }
}

// ===================== Species =====================

function trex(c: Colors): Rig {
  const skin = skinMaterial(c);
  const root = new THREE.Group();
  const hip = 2.95;
  const body = group(root, [0, hip, 0]);
  // Tail held straight out as a counterbalance, deep and muscular at the base; a short, thick S-curved
  // neck; a deep, boxy skull about a fifth of the length, with a blunt snout.
  const b = skinnedBody(
    [
      [-5.3, -0.05, 0.02, 0.02], [-4.6, 0.02, 0.1, 0.13], [-3.6, 0.1, 0.22, 0.3], [-2.6, 0.2, 0.36, 0.48],
      [-1.7, 0.32, 0.56, 0.7], [-0.9, 0.42, 0.76, 0.86, 0.1], [-0.2, 0.45, 0.86, 0.9, 0.12], [0.5, 0.4, 0.86, 0.92, 0.18],
      [1.2, 0.48, 0.76, 0.9, 0.2], [1.8, 0.78, 0.62, 0.74, 0.1], [2.25, 1.12, 0.56, 0.64], [2.6, 1.4, 0.58, 0.7, -0.35],
      [3.0, 1.48, 0.56, 0.66, -0.45], [3.45, 1.44, 0.48, 0.58, -0.45], [3.9, 1.32, 0.38, 0.47, -0.4], [4.3, 1.18, 0.28, 0.35, -0.35],
      [4.58, 1.08, 0.16, 0.2, -0.3], [4.68, 1.04, 0.04, 0.05],
    ],
    [-1.0, -1.9, -2.9, -4.0], -0.2, [1.0, 1.75, 2.2, 2.55], skin,
  );
  body.add(b.mesh);
  const skull = b.fwd[3];
  const sh = b.home.get(skull)!;
  const jawPivot = jaw(b, skin, [0, 0.98, 2.62], [[-0.1, 0, 0.42, 0.25], [0.05, -0.08, 0.5, 0.27], [0.65, -0.13, 0.44, 0.23], [1.3, -0.1, 0.31, 0.16], [1.8, -0.04, 0.17, 0.09], [1.95, -0.03, 0.03, 0.03]], 9, 0.13);
  // Upper teeth hang from the skull's lower edge (body-space points, made relative to the skull bone).
  teeth(skull, [0.44, 1.12 - sh.y, 2.95 - sh.z], [0.18, 0.94 - sh.y, 4.35 - sh.z], 10, 0.18, false);
  eyes(b, skin, 0.5, 1.74, 2.92, 0.085, skull);
  for (const side of [-1, 1]) part(attach(b, new THREE.Group(), [side * 0.13, 1.28, 4.5], skull), GEO.sphere, eyeMat(), [0.04, 0.035, 0.06]);
  scutes(b, plainMat(c.accent, 0.7), -3.8, 1.6, 14, 0.14);
  // Little two-fingered arms under the chest: upper arm angled back, elbow tucked in, forearm forward,
  // and the palms facing each other, so the two claws sit one above the other.
  for (const side of [-1, 1]) {
    const arm = attach(b, new THREE.Group(), [side * 0.56, 0.05, 1.45], b.fwd[0]);
    arm.rotation.set(0.35, 0, side * 0.12);
    limb(arm, skin, [0, 0, 0], [0, -0.42, 0.12], 0.13, 0.09);
    const fore = group(arm, [0, -0.42, 0.12], [-1.25, 0, -side * 0.2]);
    limb(fore, skin, [0, 0, 0], [0, -0.32, 0.05], 0.08, 0.06);
    for (const dy of [-0.04, 0.03]) part(fore, GEO.cone, ivory(), [0.025, 0.13, 0.025], [-side * 0.01, -0.36 + dy, 0.09 - dy * 0.5], [Math.PI - 0.75, 0, 0]);
  }
  const r = rig(root, body, b, { jaw: jawPivot, radius: 1.8, stepRate: 6.2, bob: 0.12, sway: 0.09, pushStyle: 'butt' });
  r.legs = [-1, 1].map((side, i) =>
    buildLeg(root, skin, {
      x: side * 0.52, y: hip, z: -0.15, pts: [[0, 0.2, -0.05], [0, -1.0, 0.55], [0, -2.15, -0.05], [0, -2.82, 0.2]],
      w: [0.6, 0.34, 0.2, 0.17], toes: 3, toeLen: 0.66, bend: 1, offset: PAIR[i], amp: 0.4,
    }),
  );
  return r;
}

function triceratops(c: Colors): Rig {
  const skin = skinMaterial(c);
  const root = new THREE.Group();
  const hip = 1.8;
  const body = group(root, [0, hip, 0]);
  const b = skinnedBody(
    [
      [-3.7, -0.35, 0.02, 0.02], [-3.0, -0.18, 0.15, 0.18], [-2.2, 0.05, 0.32, 0.38], [-1.4, 0.25, 0.64, 0.72],
      [-0.6, 0.35, 0.92, 0.94, 0.2], [0.3, 0.35, 1.0, 0.96, 0.3], [1.1, 0.25, 0.86, 0.84, 0.2], [1.7, 0.1, 0.64, 0.62],
      // A big, deep skull (a good quarter of the animal) carried low, narrowing to the beak.
      [2.1, 0.12, 0.68, 0.72], [2.55, 0.02, 0.64, 0.72, -0.1], [3.0, -0.18, 0.5, 0.56, -0.1], [3.45, -0.4, 0.3, 0.36], [3.75, -0.55, 0.08, 0.1],
    ],
    [-1.4, -2.3, -3.0], -0.6, [1.0, 1.8, 2.15], skin,
  );
  body.add(b.mesh);
  const head = b.fwd[2];
  const jawPivot = jaw(b, skin, [0, -0.22, 2.45], [[-0.1, 0, 0.42, 0.2], [0.1, -0.05, 0.46, 0.22], [0.6, -0.14, 0.32, 0.17], [1.05, -0.26, 0.14, 0.09], [1.2, -0.3, 0.03, 0.03]], 0, 0.05);
  // Frill: a broad bony shield growing from the back of the skull and sweeping back over the neck at
  // about 55 degrees, its top a little above the back, with a scalloped rim of small knobs.
  const frill = attach(b, new THREE.Group(), [0, 0.5, 2.05], head);
  frill.rotation.x = -0.98;
  // Skin-covered shield on a darker rim that shows round its edge.
  part(frill, GEO.sphere, plainMat(c.accent, 0.65), [1.5, 1.3, 0.12], [0, 0.8, -0.03]);
  part(frill, GEO.sphere, skin, [1.4, 1.2, 0.16], [0, 0.8, 0.01]);
  for (let k = 0; k < 15; k++) {
    const a = -1.5 + (k / 14) * 3.0;
    part(frill, GEO.cone, ivory(), [0.08, 0.22, 0.08], [Math.sin(a) * 1.47, 0.8 + Math.cos(a) * 1.27, 0], [0, 0, -a]);
  }
  // Brow horns: long, rooted above and behind the eyes, pointing forward and a little up and out.
  const horn = plainMat('#d6cbb0', 0.5);
  for (const side of [-1, 1]) {
    const h = attach(b, new THREE.Group(), [side * 0.36, 0.55, 2.42], head);
    h.rotation.set(Math.PI / 2 - 0.48, 0, -side * 0.12);
    part(h, GEO.cone, horn, [0.14, 1.35, 0.14], [0, 0.6, 0]);
  }
  // A short nose horn, and a hooked, parrot-like beak.
  part(attach(b, new THREE.Group(), [0, 0.18, 3.3], head), GEO.cone, horn, [0.09, 0.44, 0.09], [0, 0.18, 0], [0.5, 0, 0]);
  part(attach(b, new THREE.Group(), [0, -0.44, 3.72], head), GEO.cone, plainMat('#2e2720', 0.5), [0.15, 0.36, 0.13], [0, 0, 0.1], [Math.PI / 2 + 0.6, 0, 0]);
  eyes(b, skin, 0.52, 0.32, 2.6, 0.065, head);
  const r = rig(root, body, b, { jaw: jawPivot, radius: 2, stepRate: 6, bob: 0.05, sway: 0.05, quad: true, tailWag: 0.7, pushStyle: 'horns' });
  // Semi-erect forelimbs: the humerus bows outwards and the elbow turns back; hind legs are upright pillars.
  r.legs = ([[-1, 1.05, -1], [1, 1.05, -1], [-1, -0.85, 1], [1, -0.85, 1]] as const).map(([sx, z, bend], i) =>
    buildLeg(root, skin, bend < 0
      ? { x: sx * 0.78, y: hip - 0.15, z, pts: [[0, 0, 0], [0, -0.68, -0.2], [0, -1.38, 0.05], [0, -1.56, 0.1]], w: [0.4, 0.27, 0.21, 0.23], toes: 4, toeLen: 0.2, bend, offset: QUAD[i], amp: 0.4, claws: false, splay: 0.3 }
      : { x: sx * 0.75, y: hip, z, pts: [[0, 0.05, 0], [0, -0.75, 0.3], [0, -1.4, -0.12], [0, -1.7, 0.05]], w: [0.52, 0.3, 0.2, 0.22], toes: 4, toeLen: 0.22, bend, offset: QUAD[i], amp: 0.4, claws: false }),
  );
  return r;
}

/** Leaf-shaped plate, flat in the yz plane. */
let plateGeo: THREE.ShapeGeometry | null = null;
function plate() {
  if (!plateGeo) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.6, 0.35, 0.12, 1);
    s.quadraticCurveTo(-0.5, 0.45, -0.45, 0);
    s.closePath();
    plateGeo = new THREE.ShapeGeometry(s, 6);
    plateGeo.rotateY(Math.PI / 2);
    owned.push(plateGeo);
  }
  return plateGeo;
}

function stegosaurus(c: Colors): Rig {
  const skin = skinMaterial(c);
  const root = new THREE.Group();
  const hip = 1.9;
  const body = group(root, [0, hip, 0]);
  const b = skinnedBody(
    [
      [-4.0, -0.15, 0.02, 0.02], [-3.2, 0.02, 0.12, 0.14], [-2.4, 0.28, 0.26, 0.31], [-1.5, 0.58, 0.52, 0.62],
      [-0.6, 0.78, 0.76, 0.9, 0.15], [0.3, 0.62, 0.78, 0.84, 0.2], [1.2, 0.22, 0.6, 0.62, 0.1], [1.9, -0.18, 0.35, 0.36],
      [2.5, -0.38, 0.22, 0.24], [2.9, -0.48, 0.2, 0.2, -0.1], [3.25, -0.53, 0.12, 0.12], [3.42, -0.55, 0.03, 0.03],
    ],
    [-1.5, -2.4, -3.2], -0.6, [0.9, 1.8, 2.65], skin,
  );
  body.add(b.mesh);
  const plateMat = new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.55, side: THREE.DoubleSide });
  owned.push(plateMat);
  // Two staggered rows of plates, each leaning a little outwards, the biggest over the hips.
  for (let k = 0; k < 13; k++) {
    const z = -2.8 + k * 0.38;
    const size = 0.35 + Math.sin(((k + 0.5) / 13) * Math.PI) * 0.65;
    const side = k % 2 ? 1 : -1;
    const g = attach(b, new THREE.Group(), [side * 0.2, b.spineY(z) + b.spineH(z) * 0.82, z]);
    g.rotation.z = side * 0.2;
    const m = part(g, plate(), plateMat, [1, size, size]);
    m.position.z = -size * 0.1;
  }
  // The thagomizer: two pairs of long spikes near the tail tip, pointing out to the sides and back.
  const spikeDir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  for (const side of [-1, 1]) for (const z of [-2.95, -3.4]) {
    const g = attach(b, new THREE.Group(), [side * 0.12, b.spineY(z) + 0.04, z]);
    g.quaternion.setFromUnitVectors(UP, spikeDir.set(side * 0.72, 0.28, -0.64).normalize());
    part(g, GEO.cone, ivory(), [0.075, 0.9, 0.075], [0, 0.42, 0]);
  }
  eyes(b, skin, 0.17, -0.38, 2.95, 0.04, b.fwd[2]);
  const r = rig(root, body, b, { radius: 2, stepRate: 5.5, bob: 0.05, sway: 0.05, quad: true, tailWag: 0.8, pushStyle: 'shoulder' });
  // Forelimbs about two thirds the length of the hind legs, so the back is highest over the hips.
  r.legs = ([[-1, 1.15, -1], [1, 1.15, -1], [-1, -0.6, 1], [1, -0.6, 1]] as const).map(([sx, z, bend], i) =>
    buildLeg(root, skin, bend < 0
      ? { x: sx * 0.58, y: hip - 0.6, z, pts: [[0, 0, 0], [0, -0.5, -0.1], [0, -1.08, 0.04], [0, -1.22, 0.08]], w: [0.3, 0.22, 0.17, 0.19], toes: 4, toeLen: 0.18, bend, offset: QUAD[i], amp: 0.38, claws: false, splay: 0.22 }
      : { x: sx * 0.6, y: hip, z, pts: [[0, 0.05, 0], [0, -0.85, 0.25], [0, -1.55, -0.1], [0, -1.8, 0.05]], w: [0.46, 0.28, 0.2, 0.22], toes: 3, toeLen: 0.22, bend, offset: QUAD[i], amp: 0.38, claws: false }),
  );
  return r;
}

function brachiosaurus(c: Colors): Rig {
  const skin = skinMaterial(c);
  const root = new THREE.Group();
  const hip = 2.8;
  const body = group(root, [0, hip, 0]);
  const b = skinnedBody(
    [
      [-5.0, -0.6, 0.02, 0.02], [-4.2, -0.45, 0.12, 0.14], [-3.2, -0.1, 0.25, 0.3], [-2.1, 0.3, 0.52, 0.62],
      // A broad barrel of a body: wide enough across the hips and shoulders for the legs to stand under it.
      [-1.0, 0.65, 1.22, 1.02, 0.12], [0.2, 0.85, 1.3, 1.15, 0.2], [1.3, 1.02, 1.2, 1.02, 0.12], [2.0, 1.55, 0.7, 0.66],
      [2.45, 2.35, 0.42, 0.45], [2.8, 3.3, 0.35, 0.38], [3.1, 4.3, 0.3, 0.32], [3.35, 5.2, 0.27, 0.28], [3.62, 5.72, 0.3, 0.3],
      // A short, deep snout under the tall nasal arch.
      [4.0, 5.8, 0.27, 0.27, -0.2], [4.35, 5.68, 0.2, 0.2, -0.2], [4.55, 5.58, 0.13, 0.13], [4.65, 5.54, 0.04, 0.05],
    ],
    [-2.1, -3.2, -4.2], -1.0, [1.0, 2.0, 2.45, 2.8, 3.1, 3.55], skin,
  );
  body.add(b.mesh);
  const head = b.fwd[b.fwd.length - 1];
  // The domed nasal arch over the eyes that marks a brachiosaur's head.
  part(attach(b, new THREE.Group(), [0, 6.0, 3.72], head), GEO.sphere, skin, [0.22, 0.24, 0.34]);
  eyes(b, skin, 0.27, 5.84, 3.9, 0.05, head);
  const r = rig(root, body, b, { radius: 2.4, stepRate: 4, bob: 0.07, sway: 0.05, quad: true, tailWag: 0.8, pushStyle: 'chest' });
  // Column-like legs, the front pair the longer: no muscle bulge, an even taper from a thick thigh or
  // shoulder that rises well up into the torso, straight lines, and broad round pads with no toes
  // showing. A short, low, measured stride.
  r.legs = ([[-1, 1.15, -1], [1, 1.15, -1], [-1, -1.1, 1], [1, -1.1, 1]] as const).map(([sx, z, bend], i) =>
    buildLeg(root, skin, bend < 0
      ? { x: sx * 0.56, y: hip + 0.45, z, pts: [[0, 0, 0], [0, -1.55, -0.04], [0, -3.0, 0.02], [0, -3.2, 0.04]], w: [0.56, 0.44, 0.37, 0.35], toes: 0, toeLen: 0, bend, offset: QUAD[i], amp: 0.26, claws: false, up: 0.8, bulge: 1, lift: 0.55 }
      : { x: sx * 0.58, y: hip, z, pts: [[0, 0.05, 0], [0, -1.3, 0.1], [0, -2.52, -0.03], [0, -2.74, 0.02]], w: [0.62, 0.46, 0.37, 0.35], toes: 0, toeLen: 0, bend, offset: QUAD[i], amp: 0.26, claws: false, up: 0.7, bulge: 1, lift: 0.55 }),
  );
  return r;
}

/** Velociraptor body, legs and claws; Spinosaurus sail and crocodile snout. */
function spinoraptor(c: Colors): Rig {
  const skin = skinMaterial(c);
  const root = new THREE.Group();
  const hip = 1.9;
  const body = group(root, [0, hip, 0]);
  const b = skinnedBody(
    [
      [-4.1, -0.12, 0.02, 0.02], [-3.4, -0.02, 0.07, 0.08], [-2.5, 0.08, 0.13, 0.15], [-1.6, 0.18, 0.22, 0.26],
      [-0.8, 0.3, 0.38, 0.45], [0, 0.36, 0.48, 0.58, 0.15], [0.8, 0.4, 0.45, 0.55, 0.15], [1.35, 0.58, 0.31, 0.35],
      [1.75, 0.92, 0.22, 0.24], [2.05, 1.16, 0.24, 0.27, -0.2], [2.4, 1.12, 0.2, 0.22, -0.35], [2.8, 1.02, 0.12, 0.13, -0.35],
      [3.15, 0.96, 0.08, 0.08, -0.3], [3.3, 0.94, 0.02, 0.03],
    ],
    [-0.8, -1.7, -2.6, -3.4], 0, [0.8, 1.4, 1.75, 2.0], skin,
  );
  body.add(b.mesh);
  // The sail: a membrane on the back, braced by spines.
  const sailShape = new THREE.Shape();
  sailShape.moveTo(-1.2, 0);
  sailShape.bezierCurveTo(-0.9, 1.1, 0.5, 1.5, 1.15, 0);
  sailShape.closePath();
  const sailGeo = new THREE.ShapeGeometry(sailShape, 10);
  sailGeo.rotateY(Math.PI / 2);
  owned.push(sailGeo);
  const sailMat = new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.7, side: THREE.DoubleSide });
  owned.push(sailMat);
  const sail = attach(b, new THREE.Group(), [0, 0.75, 0], b.pelvis);
  part(sail, sailGeo, sailMat, [1, 1, 1]);
  for (let k = 0; k < 9; k++) {
    const z = -1.0 + (k / 8) * 2.0;
    const top = 1.35 * Math.sin(((z + 1.2) / 2.35) * Math.PI) ** 0.8;
    part(sail, GEO.cone, plainMat('#3a2a22', 0.6), [0.03, top + 0.15, 0.03], [0, (top + 0.15) / 2, z]);
  }
  const jawPivot = jaw(b, skin, [0, 1.0, 2.05], [[-0.1, 0, 0.2, 0.1], [0.05, -0.03, 0.2, 0.1], [0.5, -0.05, 0.14, 0.07], [1.0, -0.04, 0.08, 0.05], [1.2, -0.03, 0.03, 0.03]], 9, 0.07);
  teeth(b.fwd[3], [0.18, 1.04 - 1.16, 2.25 - 2.0], [0.07, 0.92 - 1.16, 3.15 - 2.0], 10, 0.08, false);
  eyes(b, skin, 0.2, 1.3, 2.18, 0.045, b.fwd[3]);
  // Long arms folded like a bird's wing, three fingers with the palms facing each other (claws stacked).
  for (const side of [-1, 1]) {
    const arm = attach(b, new THREE.Group(), [side * 0.36, 0.2, 1.05], b.fwd[0]);
    arm.rotation.set(0.2, 0, side * 0.15);
    limb(arm, skin, [0, 0, 0], [0, -0.45, 0.15], 0.1, 0.07);
    const fore = group(arm, [0, -0.45, 0.15], [-1.1, 0, -side * 0.2]);
    limb(fore, skin, [0, 0, 0], [0, -0.42, 0.05], 0.07, 0.05);
    for (const dy of [-0.045, 0, 0.045]) part(fore, GEO.cone, ivory(), [0.022, 0.15, 0.022], [-side * 0.01, -0.48 + dy, 0.08 - dy * 0.6], [Math.PI - 0.75, 0, 0]);
  }
  // A raptor's tail is stiffened by bony rods: it sweeps as one piece from the base.
  const r = rig(root, body, b, { jaw: jawPivot, radius: 1.4, stepRate: 10, bob: 0.1, sway: 0.05, tailWag: 0.45 });
  r.legs = [-1, 1].map((side, i) => {
    // Long shins and a long metatarsus: a sprinter's leg, up on its toes.
    const l = buildLeg(root, skin, {
      x: side * 0.4, y: hip, z: -0.05, pts: [[0, 0.05, 0], [0, -0.7, 0.4], [0, -1.38, -0.08], [0, -1.8, 0.12]],
      w: [0.36, 0.2, 0.12, 0.11], toes: 3, toeLen: 0.4, bend: 1, offset: PAIR[i], amp: 0.6, sickle: true,
    });
    return l;
  });
  return r;
}

function pteranodon(c: Colors): Rig {
  const skin = skinMaterial(c);
  const root = new THREE.Group();
  // On the ground it stands on all fours, torso tilted nose-up, the folded wings reaching down in
  // front as forelimbs (animate() poses them) and the hind legs short under the hips.
  const hip = 1.05;
  const body = group(root, [0, hip, 0]);
  const b = skinnedBody(
    [
      [-1.2, 0, 0.02, 0.02], [-0.9, 0.05, 0.08, 0.08], [-0.5, 0.2, 0.28, 0.3], [0.1, 0.3, 0.36, 0.4, 0.1],
      [0.6, 0.35, 0.3, 0.34], [0.95, 0.55, 0.15, 0.16], [1.25, 0.8, 0.13, 0.14], [1.5, 0.95, 0.17, 0.2],
      [1.75, 0.95, 0.12, 0.12, -0.2], [2.2, 0.9, 0.06, 0.06], [2.7, 0.85, 0.015, 0.015],
    ],
    [-0.6], 0, [0.6, 1.0, 1.45], skin,
  );
  body.add(b.mesh);
  const head = b.fwd[2];
  const jawPivot = jaw(b, skin, [0, 0.86, 1.6], [[-0.05, 0, 0.07, 0.05], [0.1, -0.01, 0.07, 0.05], [0.6, -0.03, 0.04, 0.03], [1.0, -0.05, 0.015, 0.015], [1.05, -0.05, 0.01, 0.01]], 0, 0.02);
  // The crest: a long blade off the back of the skull, pointing backwards in line with the beak, a touch up.
  const crest = attach(b, new THREE.Group(), [0, 1.04, 1.5], head);
  crest.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.3, -1).normalize());
  part(crest, GEO.cone, plainMat(c.accent, 0.6), [0.05, 1.15, 0.2], [0, 0.55, 0]);
  eyes(b, skin, 0.13, 1.02, 1.58, 0.035, head);
  // Wings: a leathery membrane from shoulder to wingtip and back to the hips, with a bony leading edge.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.25);
  wingShape.lineTo(3.4, 0.05);
  wingShape.quadraticCurveTo(1.6, -0.25, 0.1, -0.9);
  wingShape.closePath();
  const membrane = new THREE.MeshStandardMaterial({ color: c.body, roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: 0.94 });
  owned.push(membrane);
  const wings = [-1, 1].map((side) => {
    const geo = new THREE.ShapeGeometry(wingShape, 8);
    geo.rotateX(Math.PI / 2);
    geo.scale(side, 1, 1);
    owned.push(geo);
    const pivot = attach(b, new THREE.Group(), [side * 0.28, 0.45, 0.45], b.fwd[0]);
    part(pivot, geo, membrane, [1, 1, 1]);
    // The arm and wing-finger bones along the leading edge, thickest at the shoulder.
    part(pivot, GEO.sphere, skin, [1.7, 0.07, 0.09], [side * 1.7, 0.01, 0.17], [0, side * 0.06, 0]);
    part(pivot, GEO.sphere, skin, [0.6, 0.1, 0.12], [side * 0.55, 0.01, 0.2], [0, side * 0.06, 0]);
    return { pivot, side };
  });
  const r = rig(root, body, b, { jaw: jawPivot, radius: 1.3, stepRate: 7, bob: 0.04, sway: 0.03, quad: true, lean: -0.32, tailWag: 0.5 });
  r.wings = wings;
  r.legs = [-1, 1].map((side, i) =>
    buildLeg(root, skin, {
      x: side * 0.2, y: hip, z: -0.2, pts: [[0, 0, 0], [0, -0.48, 0.18], [0, -0.88, -0.05], [0, -0.98, 0.05]],
      w: [0.13, 0.08, 0.06, 0.06], toes: 3, toeLen: 0.16, bend: 1, offset: PAIR[i], amp: 0.5,
    }),
  );
  return r;
}

const BUILD: Record<DinoSpec['id'], (c: Colors) => Rig> = {
  trex, tri: triceratops, stego: stegosaurus, brachio: brachiosaurus, spino: spinoraptor, ptera: pteranodon,
};

/** Builds a dinosaur facing +z, standing on y = 0. `colors` overrides the species' own. */
export function buildDino(spec: DinoSpec, colors = spec.colors): Rig {
  const r = BUILD[spec.id](colors);
  r.root.userData.noFade = true; // never thinned out by the see-through effect, even in front of the camera
  r.root.updateMatrixWorld(true);
  // Merge every static part (teeth, claws, eyes, horns, scutes, toes…) into its joint: a few draw calls per animal.
  const moving: THREE.Object3D[] = [r.body, r.head, ...r.tail, ...r.neck, ...r.wings.map((w) => w.pivot)];
  if (r.jaw) moving.push(r.jaw);
  for (const l of r.legs) moving.push(l.pivot, l.knee, l.ankle, l.foot);
  bake(r.root, moving, owned);
  return r;
}

/**
 * Walk cycle, idle breathing and the roar. `move` is 0 (standing) to 1 (full speed); `speed` is the
 * ground speed in units per second, which sets the step rate (without it, the rig's `stepRate` does).
 * Legs swing from the hip; on the forward swing the knee bends to lift the foot, and the ankle and
 * foot counter-rotate so the foot lands flat. Returns true on each footfall, for footstep sounds.
 */
export function animate(r: Rig, dt: number, move: number, t: number, speed = 0): boolean {
  // Stride: a planted foot travels from one end of the swing to the other in half a cycle.
  // Running swings the legs wider. The step rate follows from the stride and the ground speed,
  // so the feet stay put on the ground instead of gliding over it.
  // A galloping quadruped reaches further, and each foot is down for less of the cycle, so the cycle covers
  // more ground: the planted foot must still travel one stride while it's down.
  r.galloping += ((r.quad ? r.gallop : 0) - r.galloping) * (1 - Math.exp(-dt * 5));
  const g = r.galloping < 0.01 ? 0 : r.galloping;
  const duty = 0.5 + (GALLOP.duty - 0.5) * g;
  const reach = Math.min(...r.legs.map((l) => l.rest * Math.sin(l.amp * (0.55 + 0.65 * move) * (1 + 0.6 * g))));
  const stride = 2 * reach * r.root.scale.x;
  r.phase += speed > 0 ? (dt * speed * 2 * Math.PI * duty) / stride : dt * r.stepRate * move;
  // Where it is in the gallop's cycle, 0 at the left hind's footfall; and the moment of flight, when the
  // whole animal is lifted off the ground after the leading fore foot pushes off.
  const c = (((r.phase / (2 * Math.PI)) % 1) + 1) % 1;
  const hop = r.legs[r.legs.length - 1].rest * 0.08 * g * move;
  const flight = c > 0.82 ? Math.sin((Math.PI * (c - 0.82)) / 0.2) : c < 0.02 ? Math.sin((Math.PI * (c + 0.18)) / 0.2) : 0;
  // Ease the legs back under the body when it stops.
  const fade = Math.min(1, move / 0.12);
  // Pushing against a tree or a rock (see PushStyle): eased in and out, with a follow-through when a tree gives.
  const ps = r.pushStyle ? PUSH[r.pushStyle] : null;
  r.strain += (Math.min(1, r.push) - r.strain) * (1 - Math.exp(-dt * 6));
  const pz = ps ? r.strain : 0;
  // `go` runs 0→1 through the follow-through; `env` rises and falls over it; `swing` goes one way then the other.
  const go = r.shove > 0 ? 1 - r.shove : 0;
  const env = r.shove > 0 ? Math.sin(Math.PI * go) : 0;
  const swing = r.shove > 0 ? Math.sin(2 * Math.PI * go) : 0;
  if (ps) r.shove = Math.max(0, r.shove - dt / ps.time);
  else r.shove = 0;
  const side = r.shoveSide;
  // Straining muscles quiver.
  const quiver = Math.sin(t * 31) * 0.012 * pz;
  const style = r.pushStyle;
  const crouch = Math.min(1, r.crouch + (ps ? ps.crouch * pz : 0) + (style === 'chest' ? env * 0.35 : style === 'horns' ? env * 0.2 : 0));
  let drop = 0;
  r.legs.forEach((l, i) => {
    // Galloping, the legs move from the walk's timing into the gallop's, and stay down for less of it.
    const off = g ? l.offset + turn(l.offset, landAt(GALLOP.land[i])) * g : l.offset;
    const ph = warp(r.phase + off, duty);
    // Longer legs swing through a smaller angle for the same stride.
    const swing = Math.sin(ph) * Math.asin(Math.min(1, reach / l.rest)) * fade;
    // The foot travels forward while the swing angle is falling: lift it then (higher, tucked up, at a gallop).
    const lift = Math.max(0, -Math.cos(ph)) * fade * (0.6 + 0.4 * move) * l.lift * (1 + 0.2 * g);
    // Crouch: thigh forward, knee bent, ankle flexed. In the air: the whole leg tucked up.
    const ch = -l.bend * crouch * 0.5;
    const ck = l.bend * crouch * 1.05;
    const ca = -l.bend * crouch * 0.65;
    const hip = swing + ch - l.bend * r.air * 0.55;
    const knee = l.bend * lift * 0.75 + ck + l.bend * r.air * 1.15;
    const ankle = -l.bend * lift * 0.9 + ca - l.bend * r.air * 0.55;
    l.pivot.rotation.x = hip;
    l.knee.rotation.x = knee;
    l.ankle.rotation.x = ankle;
    // Keep the foot level on the ground; let the toes hang in the air.
    l.foot.rotation.x = -(hip + knee + ankle) + lift * 0.35 + r.air * 0.7;
    // A crouching leg is shorter, so the hip comes down to keep the foot planted.
    const d = crouch > 0 ? l.rest - legDrop(l, ch, ck, ca) : 0;
    l.pivot.position.y = l.baseY - d + hop * flight;
    drop = Math.max(drop, d);
  });
  const still = 1 - move;
  const breath = Math.sin(t * 1.6);
  // Weight shift: the body moves out over whichever foot is planted, and the hips swing with the stride.
  // In a biped the first leg (the left) is on the ground while cos(phase) > 0; a quadruped's support
  // pattern turns twice as fast and is led by the hind legs. Standing, the weight drifts slowly from foot to foot.
  // (A gallop has no side-to-side weight shift: the legs of each pair land close together.)
  const sway = (r.quad ? Math.sin(r.phase * 2) * 0.5 : -Math.cos(r.phase)) * (1 - g);
  r.body.position.x = sway * r.sway * move + Math.sin(t * 0.45) * 0.02 * still;
  // The body dips at each footfall (where |sin| peaks for the gait's offsets), rolls onto the planted
  // side and, in bipeds, the pelvis yaws toward the advancing leg.
  const dip = r.quad ? Math.abs(Math.sin(r.phase * 2 + Math.PI / 4)) : Math.abs(Math.sin(r.phase));
  // Galloping, the body sinks as the legs take its weight (most when the fore feet land) and flies with them.
  const gallopY = hop * (flight - 0.45 * Math.max(0, Math.sin(2 * Math.PI * (c - 0.2))));
  r.body.position.y = r.legs[0].baseY - drop - dip * r.bob * move * (1 - g) + gallopY + breath * 0.012 * (0.5 + 0.5 * still);
  r.body.rotation.z = sway * (r.quad ? 0.035 : 0.045) * move + (ps ? ps.roll * pz * side : 0);
  const yaw = r.quad ? 0 : Math.sin(r.phase) * 0.06 * move;
  // The stegosaur's body twists against its tail swipe.
  r.body.rotation.y = yaw - (style === 'shoulder' ? env * 0.12 * side : 0);
  // Breathing: the chest swells while standing; the first neck bone undoes it so the head stays still.
  const swell = 1 + breath * 0.016 * (0.4 + 0.6 * still);
  r.chest.scale.set(swell, swell, 1);
  r.neck[0].scale.set(1 / swell, 1 / swell, 1);
  // The tail counter-swings the hips (it lags the stride down its length) and whips up a little with
  // the body's dip; a stiff tail (tailWag < 1) mostly moves at the base.
  const wag = r.tailWag;
  r.tail.forEach((seg, i) => {
    const along = i / r.tail.length;
    const lag = Math.sin(r.phase - 0.5 - i * 0.55 * wag);
    seg.rotation.y = -yaw * 0.6 + Math.sin(t * 1.1 - i * 0.6) * 0.05 * wag * (0.5 + still) + lag * 0.07 * wag * move * (0.5 + along);
    // In the air the tail lifts to balance; in a crouch it drops.
    seg.rotation.x = Math.sin(t * 0.8 - i * 0.4) * 0.012 + (r.quad ? 0 : Math.cos(r.phase * 2) * 0.012 * move) - r.air * 0.07 + r.crouch * 0.05 + (ps ? ps.tail * pz : 0)
      // Galloping, the tail streams out a little higher and rides the body's rocking, a beat behind down its length.
      + g * move * (0.03 + 0.05 * Math.sin(2 * Math.PI * (c - 0.15) - i * 0.7));
    // The stegosaur's swipe: a whip across, each segment a little behind the one before, and back.
    if (style === 'shoulder' && r.shove > 0) seg.rotation.y += side * 0.5 * Math.sin(Math.PI * THREE.MathUtils.clamp(go * 1.5 - i * 0.12, 0, 1));
  });
  // The neck undoes the pelvis yaw, so the head keeps pointing where the animal is going, and looks around idly.
  const nn = r.neck.length;
  // Shaking something held in the jaws: the head lifts and whips side to side, the whole neck in it, the
  // swing building up and dying away, each neck bone a little behind the one before.
  const th = r.thrash > 0 ? Math.sin(Math.PI * (1 - r.thrash / r.thrashFor)) : 0;
  r.thrash = Math.max(0, r.thrash - dt);
  // Heaving: a quick haul up and back with the jaws shut, held a moment, then let go.
  const hv = r.heave > 0 ? Math.sin(Math.PI * Math.min(1, (1 - r.heave) * 1.4)) : 0;
  r.heave = Math.max(0, r.heave - dt / 0.7);
  // Pushing: the neck bends down to bring the head (or horns) to bear, or back out of the way (a brachiosaur,
  // whose neck then swings back and over through its follow-through).
  // Galloping, the head and neck swing down as the fore feet land and up as the hind feet drive.
  const neckX = g * move * 0.07 * Math.sin(2 * Math.PI * (c - 0.42)) + (ps ? ps.neck * pz : 0) + quiver + (style === 'chest' ? -swing * 0.08 : style === 'horns' ? -env * 0.12 : 0);
  r.neck.forEach((seg, i) => {
    seg.rotation.y = -yaw / nn + Math.sin(t * 0.7 + i * 0.5) * 0.04 * (0.4 + 0.6 * still) + (Math.sin(t * 19 - i * 0.5) * 0.5 * th) / nn;
    seg.rotation.x = neckX;
  });
  // Roar: rear the head back and open wide.
  const roar = r.roaring > 0 ? Math.sin(Math.PI * Math.min(1, (1 - r.roaring) * 1.6)) : 0;
  r.roaring = Math.max(0, r.roaring - dt / r.roarFor);
  // Follow-through: the T-Rex wrenches its head up and aside; the triceratops hooks its horns up and across.
  const toss = style === 'butt' ? 0.6 : style === 'horns' ? 0.95 : 0;
  r.head.rotation.y = Math.sin(t * 19 - nn * 0.5) * 0.28 * th + (style === 'butt' ? 0.35 : style === 'horns' ? 0.3 : 0) * env * side;
  r.head.userData.base ??= r.head.rotation.x;
  // Bite: lunge forward and down, jaws wide open, then snap shut at the halfway point.
  const lunge = r.biting > 0 ? Math.sin(Math.PI * (1 - r.biting)) : 0;
  const gape = r.biting > 0.5 ? Math.sin(Math.PI * (1 - r.biting) * 2) : 0;
  r.biting = Math.max(0, r.biting - dt / 0.45);
  r.body.position.z = lunge * 0.8 - hv * 0.5 + (ps ? ps.bodyZ * pz : 0) + (style === 'shoulder' ? 0 : env * 0.3);
  r.body.rotation.x = lunge * 0.12 - roar * 0.08 - hv * 0.12 + r.lean * (1 - r.spread) + (ps ? ps.pitch * pz : 0) - (toss ? env * 0.06 : 0) + (style === 'chest' ? env * 0.05 : 0)
    // The gallop's rocking: nose up as the hind legs drive, nose down as the fore feet land and take the weight.
    + g * move * 0.075 * Math.sin(2 * Math.PI * (c - 0.3));
  // The head stays level against the body's bob, as a predator's does: it nods against the dip of each
  // step (twice per cycle in a biped), and the jaw hangs a little open at a flat-out run.
  const nod = r.quad ? 0 : -Math.cos(r.phase * 2) * 0.025 * move;
  r.head.rotation.x = r.head.userData.base - roar * 0.45 + lunge * 0.3 + nod + Math.sin(t * 1.3) * 0.015 - th * 0.25 - hv * 0.55 + (ps ? ps.head * pz : 0) + quiver - toss * env;
  r.body.rotation.z += Math.sin(t * 19 + 1.2) * 0.04 * th;
  const pant = Math.max(0, move - 0.7) * 0.25;
  // Jaws clamped shut on whatever they hold.
  // A T-Rex snarls as it wrenches free.
  if (r.jaw) r.jaw.rotation.x = th > 0 || hv > 0 ? 0.08 : Math.max(roar * 0.7, gape * 0.85, pant, style === 'butt' ? env * 0.45 : 0);
  // Wings: on the ground they fold and the animal walks on them, the wing arm reaching down in front
  // like a forelimb and stepping in sequence with the hind legs; in the air they spread, beating in flight.
  if (r.wings.length) {
    r.spread += ((r.wingMode > 0 ? 1 : 0) - r.spread) * Math.min(1, dt * 6);
    const beat = r.wingMode >= 1 ? Math.sin(t * 9) * 0.6 : r.wingMode > 0 ? Math.sin(t * 2) * 0.05 + 0.08 : 0;
    const fold = 1 - r.spread;
    for (const w of r.wings) {
      // The left forelimb follows the left hind leg by a quarter cycle (a lateral-sequence walk).
      const ph = r.phase + (w.side < 0 ? -Math.PI / 2 : Math.PI / 2);
      const step = Math.sin(ph) * 0.35 * fade;
      // The hand stays on the ground through its swing: a straight limb on one pivot reaches less far
      // down the more it is pitched, so its length follows 1/cos of the pitch. It draws up a little while
      // swinging forward, so the hand clears the ground.
      const pitch = -0.12 + step + r.lean;
      const lift = Math.max(0, -Math.cos(ph)) * fade * 0.12;
      const reach = Math.min(0.62, 0.49 / Math.cos(pitch)) - lift;
      w.pivot.scale.x = reach * fold + r.spread;
      w.pivot.scale.z = 0.2 + 0.8 * r.spread;
      w.pivot.rotation.x = (-0.12 + step) * fold;
      w.pivot.rotation.y = -w.side * fold * 0.25;
      w.pivot.rotation.z = w.side * (beat * r.spread - fold * 1.35);
    }
  }
  const step = Math.floor(r.phase / Math.PI);
  const stepped = step !== r.lastStep;
  r.lastStep = step;
  return stepped && move > 0.3;
}

export function disposeDinoAssets() {
  Object.values(GEO).forEach((g) => g.dispose());
  plain.forEach((m) => m.dispose());
  plain.clear();
  skins.forEach((s) => {
    s.mat.dispose();
    s.tex.forEach((t) => t.dispose());
  });
  skins.clear();
  owned.forEach((o) => o.dispose());
  owned.length = 0;
  plateGeo = null;
}
