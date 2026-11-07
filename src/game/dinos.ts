import * as THREE from 'three';
import type { DinoSpec } from './species';

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
}

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
function skinMaterial(c: Colors) {
  const key = `${c.body}${c.belly}${c.accent}`;
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
      const dorsal = (1 - Math.cos(u * Math.PI * 2)) / 2;
      tmp.copy(belly).lerp(body, THREE.MathUtils.smoothstep(dorsal, 0.22, 0.6));
      // Irregular darker bands across the back, broken up by noise.
      const wobble = noise2(u * 8, v * 16, 8, 1) * 2.2 + noise2(u * 16, v * 32, 16, 2) * 0.8;
      const band = Math.sin(v * Math.PI * 2 * 7 + wobble * 2.4);
      if (band > 0.25 && dorsal > 0.45) tmp.lerp(accent, THREE.MathUtils.clamp((band - 0.25) * 1.6, 0, 1) * (dorsal - 0.45) * 1.5);
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
  skins.set(key, { mat, tex: [map, bumpMap] });
  return mat;
}

// ===================== Swept geometry =====================

/** A cross-section on a sweep: centre, half-width (x), half-height, and how much deeper the lower half is. */
interface Ring { p: THREE.Vector3; w: number; h: number; drop: number }

const SIDE = new THREE.Vector3(1, 0, 0);

/**
 * Sweeps a slightly boxy elliptical cross-section along rings whose centres all lie in the yz plane.
 * The section's width is always along x, so the sweep can turn up (necks) or down (legs) freely.
 * u runs round the section from the underside; v is distance along the sweep times `vScale`.
 */
function sweep(rings: Ring[], sides = 16, vScale = 0.25) {
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
      uvArr.set([k / S, along * vScale], j * 2);
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

/** A tapered limb segment from `a` to `b` (in the yz plane), with a muscle bulge near the top. */
function limb(parent: THREE.Object3D, mat: THREE.Material, a: V3, b: V3, w0: number, w1: number, bulge = 1.12) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const rings: Ring[] = [0, 0.12, 0.35, 0.7, 1].map((t) => {
    const w = (w0 + (w1 - w0) * t) * (t > 0.05 && t < 0.6 ? bulge : 1);
    return { p: A.clone().lerp(B, t), w, h: w * 1.05, drop: 0 };
  });
  // Round the ends off slightly so joints read as joints.
  rings[0].w *= 0.85;
  rings[0].h *= 0.85;
  const mesh = new THREE.Mesh(sweep(rings, 12, 0.5), mat);
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
function eyes(b: Body, skin: THREE.Material, x: number, y: number, z: number, r: number, bone?: THREE.Bone) {
  for (const side of [-1, 1]) {
    const g = attach(b, new THREE.Group(), [x * side, y, z], bone);
    part(g, GEO.sphere, eyeMat(), [r * 0.75, r, r]);
    part(g, GEO.sphere, plainMat('#8a5a1c', 0.2), [r * 0.3, r * 0.45, r * 0.45], [side * r * 0.55, 0, r * 0.2]);
    part(g, GEO.sphere, skin, [r * 1.35, r * 0.55, r * 1.9], [side * -r * 0.15, r * 0.75, 0], [0.15, 0, 0]);
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
  const m = new THREE.Mesh(sweep(rings, 14, 0.4), skin);
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
}

function buildLeg(root: THREE.Object3D, skin: THREE.Material, d: LegDef): Leg {
  const [p0, p1, p2, p3] = d.pts;
  const rel = (a: V3, b: V3): V3 => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const pivot = group(root, [d.x, d.y, d.z]);
  limb(pivot, skin, p0, p1, d.w[0], d.w[1], 1.18);
  const knee = group(pivot, p1);
  limb(knee, skin, [0, 0, 0], rel(p1, p2), d.w[1], d.w[2]);
  const ankle = group(knee, rel(p1, p2));
  limb(ankle, skin, [0, 0, 0], rel(p2, p3), d.w[2], d.w[3], 1.0);
  const foot = group(ankle, rel(p2, p3));
  // Toes fan out forward from the foot and reach down to the ground.
  const above = d.y + p3[1];
  for (let k = 0; k < d.toes; k++) {
    const spread = d.toes === 1 ? 0 : (k / (d.toes - 1) - 0.5) * 0.9;
    const toe = group(foot, [Math.sin(spread) * d.w[3] * 0.5, 0, 0], [0, spread, 0]);
    const tip: V3 = [0, -above + d.w[3] * 0.28, d.toeLen];
    limb(toe, skin, [0, 0, 0], tip, d.w[3] * 0.55, d.w[3] * 0.28, 1);
    if (d.claws !== false) part(toe, GEO.cone, ivory(), [d.w[3] * 0.18, d.toeLen * 0.35, d.w[3] * 0.18], [0, tip[1] + 0.02, tip[2] + d.toeLen * 0.12], [Math.PI / 2 + 0.25, 0, 0]);
  }
  return { pivot, knee, ankle, foot, bend: d.bend, offset: d.offset, amp: d.amp };
}

/** Two legs (bipeds) or four (quadrupeds) with the usual diagonal gait. */
const PAIR = [0, Math.PI];

function rig(root: THREE.Group, body: THREE.Group, b: Body, o: Partial<Rig>): Rig {
  return {
    root, body, head: b.fwd[b.fwd.length - 1], legs: [], tail: b.tail, neck: b.fwd.slice(1, -1), jaw: null,
    radius: 2, stepRate: 6, bob: 0.1, phase: 0, roaring: 0, biting: 0, lastStep: 0, wings: [], wingMode: 0, spread: 0,
    ...o,
  };
}

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
  const hip = 2.5;
  const body = group(root, [0, hip, 0]);
  const b = skinnedBody(
    [
      [-5.3, -0.3, 0.02, 0.02], [-4.6, -0.18, 0.12, 0.14], [-3.6, 0, 0.22, 0.27], [-2.6, 0.15, 0.34, 0.42],
      [-1.7, 0.3, 0.5, 0.6], [-0.9, 0.42, 0.68, 0.8, 0.1], [-0.2, 0.45, 0.8, 0.94, 0.15], [0.5, 0.4, 0.84, 1.0, 0.25],
      [1.2, 0.48, 0.76, 0.9, 0.2], [1.8, 0.75, 0.58, 0.7, 0.1], [2.25, 1.08, 0.48, 0.56], [2.6, 1.36, 0.5, 0.58, -0.35],
      [3.0, 1.42, 0.47, 0.52, -0.45], [3.4, 1.36, 0.39, 0.44, -0.45], [3.8, 1.25, 0.3, 0.35, -0.4], [4.15, 1.14, 0.22, 0.27, -0.35],
      [4.38, 1.08, 0.12, 0.16, -0.3], [4.47, 1.06, 0.03, 0.05],
    ],
    [-1.0, -1.9, -2.9, -4.0], -0.2, [1.0, 1.75, 2.2, 2.55], skin,
  );
  body.add(b.mesh);
  const jawPivot = jaw(b, skin, [0, 1.0, 2.62], [[-0.1, 0, 0.36, 0.2], [0.05, -0.06, 0.42, 0.21], [0.6, -0.1, 0.36, 0.18], [1.2, -0.08, 0.26, 0.13], [1.62, -0.03, 0.14, 0.07], [1.75, -0.02, 0.03, 0.03]], 8, 0.11);
  teeth(b.fwd[3], [0.36, 1.42 - 0.52 * 0.55 - 1.36 + 0.05, 2.85 - 2.55], [0.16, 1.14 - 0.27 * 0.65 - 1.36 + 0.03, 4.15 - 2.55], 9, 0.16, false);
  eyes(b, skin, 0.38, 1.68, 2.88, 0.075, b.fwd[3]);
  for (const side of [-1, 1]) part(attach(b, new THREE.Group(), [side * 0.12, 1.24, 4.32], b.fwd[3]), GEO.sphere, eyeMat(), [0.035, 0.03, 0.05]);
  scutes(b, plainMat(c.accent, 0.7), -3.8, 1.6, 14, 0.14);
  // Little two-fingered arms under the chest.
  for (const side of [-1, 1]) {
    const arm = attach(b, new THREE.Group(), [side * 0.56, 0.05, 1.45], b.fwd[0]);
    arm.rotation.set(0.5, 0, side * 0.2);
    limb(arm, skin, [0, 0, 0], [0, -0.42, 0.12], 0.13, 0.09);
    const fore = group(arm, [0, -0.42, 0.12], [-1.1, 0, 0]);
    limb(fore, skin, [0, 0, 0], [0, -0.32, 0.05], 0.08, 0.06);
    for (const dx of [-0.04, 0.04]) part(fore, GEO.cone, ivory(), [0.025, 0.12, 0.025], [dx, -0.38, 0.08], [Math.PI - 0.6, 0, 0]);
  }
  const r = rig(root, body, b, { jaw: jawPivot, radius: 1.8, stepRate: 6.2, bob: 0.12 });
  r.legs = [-1, 1].map((side, i) =>
    buildLeg(root, skin, {
      x: side * 0.6, y: hip, z: -0.15, pts: [[0, 0.1, 0], [0, -1.0, 0.55], [0, -1.95, 0.05], [0, -2.36, 0.22]],
      w: [0.6, 0.32, 0.17, 0.15], toes: 3, toeLen: 0.6, bend: 1, offset: PAIR[i], amp: 0.42,
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
      [-0.6, 0.35, 0.92, 0.94, 0.2], [0.3, 0.35, 1.0, 0.96, 0.3], [1.1, 0.25, 0.86, 0.84, 0.2], [1.7, 0.12, 0.56, 0.56],
      [2.1, 0.08, 0.5, 0.52], [2.5, -0.02, 0.46, 0.5, -0.1], [2.9, -0.18, 0.33, 0.38], [3.25, -0.34, 0.18, 0.22], [3.45, -0.44, 0.05, 0.07],
    ],
    [-1.4, -2.3, -3.0], -0.6, [1.0, 1.8, 2.15], skin,
  );
  body.add(b.mesh);
  const head = b.fwd[2];
  const jawPivot = jaw(b, skin, [0, -0.18, 2.4], [[-0.1, 0, 0.3, 0.16], [0.1, -0.05, 0.34, 0.17], [0.55, -0.12, 0.24, 0.13], [0.9, -0.2, 0.1, 0.07], [1.0, -0.22, 0.03, 0.03]], 0, 0.05);
  // Frill: a broad bony shield swept up and back from the skull, its edge studded with knobs.
  const frill = attach(b, new THREE.Group(), [0, 0.45, 2.05], head);
  frill.rotation.x = -0.95;
  part(frill, GEO.sphere, skin, [1.25, 1.05, 0.1], [0, 0.55, 0]);
  for (let k = 0; k < 11; k++) {
    const a = -1.35 + (k / 10) * 2.7;
    part(frill, GEO.cone, plainMat(c.accent, 0.6), [0.09, 0.22, 0.09], [Math.sin(a) * 1.22, 0.55 + Math.cos(a) * 1.02, 0], [0, 0, -a]);
  }
  const horn = plainMat('#d6cbb0', 0.5);
  for (const side of [-1, 1]) {
    const h = attach(b, new THREE.Group(), [side * 0.3, 0.42, 2.55], head);
    h.rotation.set(Math.PI / 2 - 0.35, 0, -side * 0.12);
    part(h, GEO.cone, horn, [0.1, 1.15, 0.1], [0, 0.55, 0]);
  }
  part(attach(b, new THREE.Group(), [0, 0.12, 3.15], head), GEO.cone, horn, [0.07, 0.36, 0.07], [0, 0.15, 0], [0.45, 0, 0]);
  part(attach(b, new THREE.Group(), [0, -0.32, 3.3], head), GEO.cone, plainMat('#2e2720', 0.5), [0.12, 0.3, 0.1], [0, 0, 0.1], [Math.PI / 2 + 0.6, 0, 0]);
  eyes(b, skin, 0.4, 0.28, 2.55, 0.06, head);
  const r = rig(root, body, b, { jaw: jawPivot, radius: 2, stepRate: 6, bob: 0.06 });
  r.legs = ([[-1, 1.05, 0, -1], [1, 1.05, Math.PI, -1], [-1, -0.85, Math.PI, 1], [1, -0.85, 0, 1]] as const).map(([sx, z, off, bend]) =>
    buildLeg(root, skin, bend < 0
      ? { x: sx * 0.72, y: hip - 0.15, z, pts: [[0, 0, 0], [0, -0.7, -0.15], [0, -1.38, 0.05], [0, -1.56, 0.1]], w: [0.4, 0.26, 0.2, 0.22], toes: 4, toeLen: 0.2, bend, offset: off, amp: 0.4, claws: false }
      : { x: sx * 0.75, y: hip, z, pts: [[0, 0.05, 0], [0, -0.75, 0.3], [0, -1.4, -0.12], [0, -1.7, 0.05]], w: [0.52, 0.3, 0.2, 0.22], toes: 4, toeLen: 0.22, bend, offset: off, amp: 0.4, claws: false }),
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
  for (let k = 0; k < 13; k++) {
    const z = -2.8 + k * 0.38;
    const size = 0.35 + Math.sin(((k + 0.5) / 13) * Math.PI) * 0.65;
    const side = k % 2 ? 1 : -1;
    const g = attach(b, new THREE.Group(), [side * 0.08, b.spineY(z) + b.spineH(z) * 0.85, z]);
    g.rotation.z = side * 0.08;
    const m = part(g, plate(), plateMat, [1, size, size]);
    m.position.z = -size * 0.1;
  }
  // The thagomizer: four tail spikes.
  for (const side of [-1, 1]) for (const z of [-3.05, -3.4]) {
    const g = attach(b, new THREE.Group(), [side * 0.1, b.spineY(z) + 0.05, z]);
    g.rotation.set(-0.35, 0, -side * 1.05);
    part(g, GEO.cone, ivory(), [0.07, 0.75, 0.07], [0, 0.38, 0]);
  }
  eyes(b, skin, 0.17, -0.38, 2.95, 0.04, b.fwd[2]);
  const r = rig(root, body, b, { radius: 2, stepRate: 5.5, bob: 0.06 });
  r.legs = ([[-1, 1.15, 0, -1], [1, 1.15, Math.PI, -1], [-1, -0.6, Math.PI, 1], [1, -0.6, 0, 1]] as const).map(([sx, z, off, bend]) =>
    buildLeg(root, skin, bend < 0
      ? { x: sx * 0.55, y: hip - 0.6, z, pts: [[0, 0, 0], [0, -0.5, -0.08], [0, -1.08, 0.04], [0, -1.22, 0.08]], w: [0.3, 0.22, 0.17, 0.19], toes: 4, toeLen: 0.18, bend, offset: off, amp: 0.38, claws: false }
      : { x: sx * 0.6, y: hip, z, pts: [[0, 0.05, 0], [0, -0.85, 0.25], [0, -1.55, -0.1], [0, -1.8, 0.05]], w: [0.46, 0.28, 0.2, 0.22], toes: 3, toeLen: 0.22, bend, offset: off, amp: 0.38, claws: false }),
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
      [-1.0, 0.65, 0.96, 1.0, 0.15], [0.2, 0.85, 1.1, 1.15, 0.25], [1.3, 1.02, 0.95, 1.0, 0.15], [2.0, 1.55, 0.55, 0.6],
      [2.45, 2.35, 0.42, 0.45], [2.8, 3.3, 0.35, 0.38], [3.1, 4.3, 0.3, 0.32], [3.35, 5.2, 0.27, 0.28], [3.62, 5.72, 0.3, 0.3],
      [4.0, 5.8, 0.27, 0.26, -0.2], [4.35, 5.7, 0.19, 0.18, -0.2], [4.55, 5.6, 0.05, 0.06],
    ],
    [-2.1, -3.2, -4.2], -1.0, [1.0, 2.0, 2.45, 2.8, 3.1, 3.55], skin,
  );
  body.add(b.mesh);
  const head = b.fwd[b.fwd.length - 1];
  part(attach(b, new THREE.Group(), [0, 6.02, 3.75], head), GEO.sphere, skin, [0.2, 0.16, 0.3]);
  eyes(b, skin, 0.24, 5.86, 3.88, 0.045, head);
  const r = rig(root, body, b, { radius: 2.4, stepRate: 4, bob: 0.08 });
  r.legs = ([[-1, 1.2, 0, -1], [1, 1.2, Math.PI, -1], [-1, -1.1, Math.PI, 1], [1, -1.1, 0, 1]] as const).map(([sx, z, off, bend]) =>
    buildLeg(root, skin, bend < 0
      ? { x: sx * 0.8, y: hip + 0.45, z, pts: [[0, 0, 0], [0, -1.55, -0.1], [0, -3.0, 0.05], [0, -3.18, 0.1]], w: [0.48, 0.36, 0.3, 0.33], toes: 4, toeLen: 0.16, bend, offset: off, amp: 0.3, claws: false }
      : { x: sx * 0.82, y: hip, z, pts: [[0, 0.05, 0], [0, -1.3, 0.2], [0, -2.52, -0.05], [0, -2.72, 0.05]], w: [0.62, 0.38, 0.3, 0.33], toes: 4, toeLen: 0.18, bend, offset: off, amp: 0.3, claws: false }),
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
  for (const side of [-1, 1]) {
    const arm = attach(b, new THREE.Group(), [side * 0.36, 0.2, 1.05], b.fwd[0]);
    arm.rotation.set(0.3, 0, side * 0.25);
    limb(arm, skin, [0, 0, 0], [0, -0.45, 0.15], 0.1, 0.07);
    const fore = group(arm, [0, -0.45, 0.15], [-0.9, 0, 0]);
    limb(fore, skin, [0, 0, 0], [0, -0.42, 0.05], 0.07, 0.05);
    for (const dx of [-0.04, 0, 0.04]) part(fore, GEO.cone, ivory(), [0.022, 0.14, 0.022], [dx, -0.5, 0.08], [Math.PI - 0.6, 0, 0]);
  }
  const r = rig(root, body, b, { jaw: jawPivot, radius: 1.4, stepRate: 10, bob: 0.1 });
  r.legs = [-1, 1].map((side, i) => {
    const l = buildLeg(root, skin, {
      x: side * 0.4, y: hip, z: -0.05, pts: [[0, 0.05, 0], [0, -0.75, 0.4], [0, -1.45, -0.05], [0, -1.8, 0.12]],
      w: [0.36, 0.2, 0.12, 0.11], toes: 3, toeLen: 0.4, bend: 1, offset: PAIR[i], amp: 0.6,
    });
    // The sickle claw, held off the ground.
    part(l.foot, GEO.cone, ivory(), [0.05, 0.3, 0.05], [side * -0.08, 0.02, 0.1], [-0.4, 0, 0]);
    return l;
  });
  return r;
}

function pteranodon(c: Colors): Rig {
  const skin = skinMaterial(c);
  const root = new THREE.Group();
  const hip = 1.25;
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
  const crest = attach(b, new THREE.Group(), [0, 1.08, 1.45], head);
  crest.rotation.x = -Math.PI / 2 - 0.35;
  part(crest, GEO.cone, plainMat(c.accent, 0.6), [0.06, 1.1, 0.2], [0, 0.55, 0]);
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
    part(pivot, GEO.sphere, skin, [1.7, 0.05, 0.06], [side * 1.7, 0.01, 0.17], [0, side * 0.06, 0]);
    return { pivot, side };
  });
  const r = rig(root, body, b, { jaw: jawPivot, radius: 1.3, stepRate: 7, bob: 0.06 });
  r.wings = wings;
  r.legs = [-1, 1].map((side, i) =>
    buildLeg(root, skin, {
      x: side * 0.2, y: hip, z: -0.2, pts: [[0, 0, 0], [0, -0.55, 0.2], [0, -1.02, -0.05], [0, -1.18, 0.05]],
      w: [0.14, 0.09, 0.06, 0.06], toes: 3, toeLen: 0.18, bend: 1, offset: PAIR[i], amp: 0.5,
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
  r.root.updateMatrixWorld(true);
  return r;
}

/**
 * Walk cycle, idle breathing and the roar. `move` is 0 (standing) to 1 (full speed).
 * Legs swing from the hip; on the forward swing the knee bends to lift the foot, and the ankle and
 * foot counter-rotate so the foot lands flat. Returns true on each footfall, for footstep sounds.
 */
export function animate(r: Rig, dt: number, move: number, t: number): boolean {
  r.phase += dt * r.stepRate * move;
  for (const l of r.legs) {
    const ph = r.phase + l.offset;
    const swing = Math.sin(ph) * l.amp * move;
    // The foot travels forward while the swing angle is falling: lift it then.
    const lift = Math.max(0, -Math.cos(ph)) * move;
    l.pivot.rotation.x = swing;
    l.knee.rotation.x = l.bend * lift * 0.75;
    l.ankle.rotation.x = -l.bend * lift * 0.9;
    l.foot.rotation.x = -(swing + l.bend * lift * 0.75 - l.bend * lift * 0.9) + lift * 0.35;
  }
  // Heavy animals: the body dips on each footfall and rolls a little from side to side.
  r.body.position.y = r.legs[0].pivot.position.y - Math.abs(Math.sin(r.phase)) * r.bob * move + Math.sin(t * 1.6) * 0.02;
  r.body.rotation.z = Math.sin(r.phase) * 0.03 * move;
  r.tail.forEach((seg, i) => {
    seg.rotation.y = Math.sin(t * 1.1 - i * 0.6) * 0.06 + Math.sin(r.phase - i * 0.55) * 0.08 * move;
    seg.rotation.x = Math.sin(t * 0.8 - i * 0.4) * 0.015;
  });
  r.neck.forEach((seg, i) => {
    seg.rotation.y = Math.sin(t * 0.7 + i * 0.5) * 0.04;
  });
  // Roar: rear the head back and open wide.
  const roar = r.roaring > 0 ? Math.sin(Math.PI * Math.min(1, (1 - r.roaring) * 1.6)) : 0;
  r.roaring = Math.max(0, r.roaring - dt / 1.6);
  r.head.rotation.y = 0;
  r.head.userData.base ??= r.head.rotation.x;
  // Bite: lunge forward and down, jaws wide open, then snap shut at the halfway point.
  const lunge = r.biting > 0 ? Math.sin(Math.PI * (1 - r.biting)) : 0;
  const gape = r.biting > 0.5 ? Math.sin(Math.PI * (1 - r.biting) * 2) : 0;
  r.biting = Math.max(0, r.biting - dt / 0.45);
  r.body.position.z = lunge * 0.8;
  r.body.rotation.x = lunge * 0.12 - roar * 0.08;
  // The head stays level against the body's bob, as a predator's does.
  r.head.rotation.x = r.head.userData.base - roar * 0.45 + lunge * 0.3 + Math.sin(r.phase * 2) * 0.02 * move + Math.sin(t * 1.3) * 0.02;
  if (r.jaw) r.jaw.rotation.x = Math.max(roar * 0.7, gape * 0.85);
  // Wings: tucked down for walking, spread out in the air, beating while it flies.
  if (r.wings.length) {
    r.spread += ((r.wingMode > 0 ? 1 : 0) - r.spread) * Math.min(1, dt * 6);
    const beat = r.wingMode >= 1 ? Math.sin(t * 9) * 0.6 : r.wingMode > 0 ? Math.sin(t * 2) * 0.05 + 0.08 : 0;
    for (const w of r.wings) {
      w.pivot.scale.x = 0.22 + 0.78 * r.spread;
      w.pivot.rotation.z = w.side * (beat * r.spread - (1 - r.spread) * 1.05);
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
