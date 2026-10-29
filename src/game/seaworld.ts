import * as THREE from 'three';
import { rng } from './world';

/** Half the width of the ocean play area. */
export const SEA_HALF = 120;
const SIZE = 340;

/** Islands poking out of the water: palms and a sandy beach. */
const ISLANDS = [
  { x: 55, z: 50, r: 16 },
  { x: -70, z: 30, r: 12 },
  { x: 20, z: -75, r: 14 },
];
/** Reef pinnacles rising from the seabed (but staying under water). */
const REEFS = [
  { x: -30, z: -25, r: 10, h: 10 },
  { x: 70, z: -30, r: 9, h: 11 },
  { x: -60, z: -75, r: 11, h: 9 },
  { x: -10, z: 70, r: 8, h: 10 },
  { x: 90, z: 15, r: 7, h: 9 },
];
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Seabed height (the water surface is y = 0): gentle dunes, reefs and islands. */
export function floorY(x: number, z: number): number {
  let h = -18 + 1.8 * Math.sin(x * 0.05 + 0.4) * Math.cos(z * 0.045) + 0.9 * Math.sin((x - z) * 0.11);
  for (const r of REEFS) h += r.h * smooth(r.r, r.r * 0.25, Math.hypot(x - r.x, z - r.z));
  for (const i of ISLANDS) {
    const d = Math.hypot(x - i.x, z - i.z);
    h = Math.max(h, -18 + 21 * smooth(i.r + 14, i.r * 0.5, d));
  }
  return h;
}

export interface Ocean {
  group: THREE.Group;
  surface: THREE.Mesh;
  /** A random spot in open water, deeper than `depth`, at least `far` from (fx, fz). */
  openWater(rand: () => number, depth: number, fx: number, fz: number, far: number): THREE.Vector3;
  update(t: number): void;
  dispose(): void;
}

export function buildOcean(): Ocean {
  const rand = rng(11);
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // ---- Seabed: sand with darker patches, rocky reef tops, pale beaches ----
  const geo = keep(new THREE.PlaneGeometry(SIZE, SIZE, 170, 170));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const sand = new THREE.Color('#d9c48f');
  const dark = new THREE.Color('#9e8f63');
  const rock = new THREE.Color('#7d6f66');
  const beach = new THREE.Color('#f3e3b0');
  const grass = new THREE.Color('#62b04a');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = floorY(x, z);
    c.copy(sand).lerp(dark, smooth(-0.3, 0.8, Math.sin(x * 0.08) * Math.cos(z * 0.07)));
    c.lerp(rock, smooth(-13, -9, y));
    if (y > -2) c.copy(beach).lerp(grass, smooth(1.2, 2.4, y));
    col.set([c.r, c.g, c.b], i * 3);
    pos.setY(i, y);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const floor = new THREE.Mesh(geo, keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  floor.receiveShadow = true;
  group.add(floor);

  // ---- Sea surface, seen from above and below ----
  const surfGeo = keep(new THREE.PlaneGeometry(SIZE * 2, SIZE * 2, 1, 1));
  surfGeo.rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(surfGeo, keep(new THREE.MeshStandardMaterial({
    color: '#2f9fd8', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false,
  })));
  group.add(surface);

  // ---- Kelp, coral, rocks and island palms: one InstancedMesh per kind ----
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s3 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  type V3 = [number, number, number];
  function instanced(g: THREE.BufferGeometry, material: THREE.Material, list: { p: V3; s: V3; r?: V3; c: string }[]) {
    const mesh = new THREE.InstancedMesh(keep(g), material, list.length);
    list.forEach((it, i) => {
      e.set(...(it.r ?? [0, 0, 0]));
      mesh.setMatrixAt(i, m4.compose(p3.set(...it.p), q.setFromEuler(e), s3.set(...it.s)));
      mesh.setColorAt(i, c.set(it.c));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  const kelp: { p: V3; s: V3; r: V3; c: string }[] = [];
  const coral: { p: V3; s: V3; r: V3; c: string }[] = [];
  const rocks: { p: V3; s: V3; r: V3; c: string }[] = [];
  const trunks: { p: V3; s: V3; r: V3; c: string }[] = [];
  const fronds: { p: V3; s: V3; r: V3; c: string }[] = [];
  for (let n = 0; n < 900; n++) {
    const x = (rand() * 2 - 1) * (SEA_HALF + 20);
    const z = (rand() * 2 - 1) * (SEA_HALF + 20);
    const y = floorY(x, z);
    if (y > -3) continue;
    const k = rand();
    if (k < 0.45) {
      // Kelp: tall wavy ribbons; never quite reaching the surface.
      const h = Math.min(-y - 2, 4 + rand() * 9);
      kelp.push({ p: [x, y + h / 2, z], s: [0.35, h, 0.12], r: [0, rand() * 3, (rand() - 0.5) * 0.15], c: pick(['#3d8b3d', '#5aa832', '#2f7a4a', '#7fb03b']) });
    } else if (k < 0.85) {
      const s = 0.6 + rand() * 1.6;
      coral.push({ p: [x, y + s * 0.4, z], s: [s, s * (0.6 + rand() * 0.8), s], r: [0, rand() * 3, 0], c: pick(['#ff6f91', '#ff9f43', '#ffd166', '#c77dff', '#4cc9f0', '#ff5d5d']) });
    } else {
      const s = 0.8 + rand() * 2.2;
      rocks.push({ p: [x, y + s * 0.2, z], s: [s * 1.3, s, s * 1.1], r: [rand(), rand() * 3, rand()], c: pick(['#8a8178', '#6f6862', '#9b928a']) });
    }
  }
  for (const isle of ISLANDS) {
    for (let n = 0; n < 7; n++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * isle.r * 0.6;
      const x = isle.x + Math.cos(a) * d;
      const z = isle.z + Math.sin(a) * d;
      const y = floorY(x, z);
      const h = 5 + rand() * 2.5;
      const lean = (rand() - 0.5) * 0.3;
      trunks.push({ p: [x, y + h / 2, z], s: [0.3, h, 0.3], r: [lean, 0, lean], c: '#7b5434' });
      for (let f = 0; f < 7; f++) {
        const b = (f / 7) * Math.PI * 2;
        fronds.push({ p: [x + Math.sin(lean) * h * 0.5 + Math.sin(b) * 1.2, y + h - 0.3, z - Math.sin(lean) * h * 0.5 + Math.cos(b) * 1.2], s: [0.75, 0.1, 2.6], r: [0.5, b, 0], c: pick(['#2e8b3a', '#3c9e43', '#4caf50']) });
      }
    }
  }
  const lambert = () => keep(new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }));
  instanced(new THREE.BoxGeometry(1, 1, 1), lambert(), kelp);
  instanced(new THREE.IcosahedronGeometry(1, 0), lambert(), coral);
  instanced(new THREE.DodecahedronGeometry(1, 0), lambert(), rocks);
  instanced(new THREE.CylinderGeometry(1, 1, 1, 7), lambert(), trunks);
  const frondGeo = new THREE.BoxGeometry(1, 1, 1);
  frondGeo.translate(0, 0, 0.45);
  instanced(frondGeo, lambert(), fronds);

  return {
    group,
    surface,
    openWater(r, depth, fx, fz, far) {
      for (let i = 0; i < 400; i++) {
        const x = (r() * 2 - 1) * (SEA_HALF - 10);
        const z = (r() * 2 - 1) * (SEA_HALF - 10);
        if (floorY(x, z) < -depth && Math.hypot(x - fx, z - fz) > far) return new THREE.Vector3(x, 0, z);
      }
      return new THREE.Vector3(0, 0, -20);
    },
    update(t) {
      // A slow swell: the whole surface rises and falls a touch.
      surface.position.y = Math.sin(t * 0.8) * 0.08;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
