import * as THREE from 'three';

/** Half the width of the square play area; a wall of jungle grows beyond it. */
export const HALF = 125;
const GROUND = 360;
const CELL = 10;

export interface Circle { x: number; z: number; r: number; }

/** Small fast PRNG, so the jungle comes out the same every time. */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LAKE: Circle = { x: 45, z: -35, r: 20 };
export const VOLCANO: Circle = { x: -75, z: -70, r: 21 };
/** Clearings kept free of plants and rocks for the other dinosaurs' cages. */
export const CAGE_SPOTS: Circle[] = [
  { x: 40, z: 30, r: 13 },
  { x: -50, z: -15, r: 13 },
  { x: 85, z: -15, r: 13 },
  { x: -15, z: 95, r: 13 },
];

/** Flat-topped plateaus with steep rock walls: too steep to walk up, low enough to jump onto. */
const MESAS = [
  { x: -35, z: 45, r: 15, h: 3.4, seed: 0.4 },
  { x: 70, z: 60, r: 13, h: 3.6, seed: 1.9 },
  { x: -78, z: 18, r: 12, h: 3.2, seed: 3.1 },
  { x: 15, z: -82, r: 16, h: 3.0, seed: 4.6 },
  { x: 98, z: -58, r: 11, h: 3.8, seed: 5.8 },
];
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Terrain height: rolling hills, a basin for the lake, and the plateaus. */
export function groundY(x: number, z: number): number {
  let h = 4 * Math.sin(x * 0.035 + 1) * Math.cos(z * 0.04 - 0.5) + 2 * Math.sin(x * 0.07 - z * 0.05) + 0.9 * Math.sin((x + z) * 0.13);
  h += 2.5;
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  h = h + (Math.max(h, 1) - h) * smooth(LAKE.r + 28, LAKE.r + 10, dl); // no dips beside the lake
  h = h + (-1.2 - h) * smooth(LAKE.r + 12, LAKE.r - 3, dl);
  for (const m of MESAS) {
    const a = Math.atan2(z - m.z, x - m.x);
    const edge = m.r * (1 + 0.16 * Math.sin(3 * a + m.seed) + 0.09 * Math.sin(5 * a + m.seed * 2));
    h += m.h * smooth(edge + 1.6, edge - 0.6, Math.hypot(x - m.x, z - m.z));
  }
  return h;
}

/** Steepness (rise over run) at a point. */
export function slopeAt(x: number, z: number): number {
  const e = 0.6;
  return Math.hypot(groundY(x + e, z) - groundY(x - e, z), groundY(x, z + e) - groundY(x, z - e)) / (2 * e);
}

export interface World {
  group: THREE.Group;
  /** Pushes a circle at (x, z) out of trees, rocks and the volcano; clamps it to the play area. */
  collide(p: THREE.Vector3, r: number): void;
  inWater(x: number, z: number): boolean;
  /** A random open spot at least `clear` from any obstacle. */
  openSpot(rand: () => number, clear: number): THREE.Vector3;
  update(t: number, dt: number): void;
  dispose(): void;
}

export function buildWorld(): World {
  const rand = rng(7);
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const lambert = (o: THREE.MeshLambertMaterialParameters) => keep(new THREE.MeshLambertMaterial(o));

  // ---- Obstacles, bucketed in a grid for cheap collision checks ----
  const grid = new Map<string, Circle[]>();
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  function addCollider(c: Circle) {
    const cx = Math.floor(c.x / CELL);
    const cz = Math.floor(c.z / CELL);
    const k = key(cx, cz);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(c);
  }
  function near(x: number, z: number, fn: (c: Circle) => void) {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) grid.get(key(cx + i, cz + j))?.forEach(fn);
  }
  function blocked(x: number, z: number, clear: number) {
    if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.r + clear) return true;
    if (CAGE_SPOTS.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + clear)) return true;
    let hit = false;
    near(x, z, (c) => {
      if (Math.hypot(x - c.x, z - c.z) < c.r + clear) hit = true;
    });
    return hit;
  }
  const inLake = (x: number, z: number, pad = 0) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + pad;

  // ---- Ground: hills and cliffs; patchy greens, dirt, sand and rock painted into vertex colours ----
  const groundGeo = keep(new THREE.PlaneGeometry(GROUND, GROUND, 200, 200));
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const grassA = new THREE.Color('#5cae3d');
  const grassB = new THREE.Color('#3f8f34');
  const dirt = new THREE.Color('#b8a06a');
  const sand = new THREE.Color('#e8d7a0');
  const rock = new THREE.Color('#8c7158');
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 0.045) * Math.cos(z * 0.06) + Math.sin((x + z) * 0.11) * 0.45 + Math.sin(x * 0.21 - z * 0.17) * 0.2;
    tmp.copy(grassA).lerp(grassB, THREE.MathUtils.clamp(n * 0.5 + 0.5, 0, 1));
    const d = Math.sin(x * 0.03 + 1.3) * Math.sin(z * 0.035 - 0.4);
    if (d > 0.55) tmp.lerp(dirt, THREE.MathUtils.clamp((d - 0.55) * 4, 0, 0.8));
    const lake = Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.r;
    if (lake < 6) tmp.lerp(sand, THREE.MathUtils.clamp(1 - lake / 6, 0, 1));
    tmp.lerp(rock, smooth(0.7, 1.1, slopeAt(x, z)));
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
    pos.setY(i, groundY(x, z));
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, lambert({ vertexColors: true, flatShading: true }));
  ground.receiveShadow = true;
  group.add(ground);

  // ---- Lake, with lily pads ----
  const lakeGeo = keep(new THREE.CircleGeometry(LAKE.r, 48));
  lakeGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(lakeGeo, keep(new THREE.MeshStandardMaterial({ color: '#3fa9e0', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 })));
  water.position.set(LAKE.x, 0.04, LAKE.z);
  water.receiveShadow = true;
  group.add(water);

  // ---- Volcano, with a glowing crater and puffs of smoke ----
  const volcano = new THREE.Mesh(keep(new THREE.CylinderGeometry(5, VOLCANO.r, 24, 18, 1, true)), lambert({ color: '#7a5a48', flatShading: true }));
  const vy = groundY(VOLCANO.x, VOLCANO.z) - 1;
  volcano.position.set(VOLCANO.x, vy + 12, VOLCANO.z);
  volcano.castShadow = volcano.receiveShadow = true;
  const lava = new THREE.Mesh(keep(new THREE.CircleGeometry(5, 18)), keep(new THREE.MeshBasicMaterial({ color: '#ff6a1a' })));
  lava.rotation.x = -Math.PI / 2;
  lava.position.set(VOLCANO.x, vy + 23.6, VOLCANO.z);
  group.add(volcano, lava);
  const smokeMat = keep(new THREE.MeshLambertMaterial({ color: '#cfc8c4', transparent: true, opacity: 0.6, depthWrite: false }));
  const smokeGeo = keep(new THREE.IcosahedronGeometry(1, 1));
  const smoke = Array.from({ length: 7 }, (_, i) => {
    const m = new THREE.Mesh(smokeGeo, smokeMat);
    m.userData.t = i / 7;
    group.add(m);
    return m;
  });

  // ---- Plants and rocks: one InstancedMesh per kind ----
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s3 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  function instanced(geo: THREE.BufferGeometry, material: THREE.Material, list: { p: V3; s: V3; r?: V3; c?: string }[], shadow = true) {
    const mesh = new THREE.InstancedMesh(keep(geo), material, list.length);
    list.forEach((it, i) => {
      e.set(...(it.r ?? [0, 0, 0]));
      m4.compose(p3.set(...it.p), q.setFromEuler(e), s3.set(...it.s));
      mesh.setMatrixAt(i, m4);
      if (it.c) mesh.setColorAt(i, tmp.set(it.c));
    });
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  type V3 = [number, number, number];
  const trunks: { p: V3; s: V3; r?: V3 }[] = [];
  const canopies: { p: V3; s: V3; r?: V3; c: string }[] = [];
  const fronds: { p: V3; s: V3; r: V3; c: string }[] = [];
  const bushes: { p: V3; s: V3; r?: V3; c: string }[] = [];
  const rocks: { p: V3; s: V3; r: V3; c: string }[] = [];
  const flowers: { p: V3; s: V3; c: string }[] = [];
  const greens = ['#2e8b3a', '#3c9e43', '#2a7a35', '#4caf50', '#378e3c'];
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

  function tree(x: number, z: number, scale: number) {
    const g = groundY(x, z) - 0.2;
    if (rand() < 0.4) {
      // Palm: a leaning trunk and drooping fronds.
      const h = (4.2 + rand() * 1.8) * scale;
      const lean = (rand() - 0.5) * 0.25;
      trunks.push({ p: [x, g + h / 2, z], s: [0.35, h, 0.35], r: [lean, 0, lean] });
      const top: V3 = [x + Math.sin(lean) * h * 0.5, g + h, z - Math.sin(lean) * h * 0.5];
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rand();
        fronds.push({ p: [top[0] + Math.sin(a) * 1.2, top[1] - 0.3, top[2] + Math.cos(a) * 1.2], s: [0.75, 0.1, 2.6], r: [0.5, a, 0], c: pick(greens) });
      }
      addCollider({ x, z, r: 0.9 });
    } else {
      // Jungle tree: thick trunk, two leafy blobs.
      const h = (2.2 + rand() * 1.4) * scale;
      trunks.push({ p: [x, g + h / 2, z], s: [0.6 * scale, h, 0.6 * scale] });
      const r = (1.9 + rand() * 1.1) * scale;
      canopies.push({ p: [x, g + h + r * 0.55, z], s: [r, r * 0.8, r], r: [0, rand() * 3, 0], c: pick(greens) });
      canopies.push({ p: [x + (rand() - 0.5) * r, g + h + r * 1.05, z + (rand() - 0.5) * r], s: [r * 0.65, r * 0.55, r * 0.65], c: pick(greens) });
      addCollider({ x, z, r: 1.1 * scale });
    }
  }

  // Wall of trees around the edge.
  for (let a = 0; a < Math.PI * 2; a += 0.018) {
    for (const ring of [HALF + 6, HALF + 13, HALF + 21]) {
      const rr = ring + (rand() - 0.5) * 5;
      const x = Math.max(-HALF - 30, Math.min(HALF + 30, Math.cos(a) * rr * 1.42));
      const z = Math.max(-HALF - 30, Math.min(HALF + 30, Math.sin(a) * rr * 1.42));
      if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 3) continue;
      if (rand() < 0.55) tree(x, z, 1.2 + rand() * 0.4);
    }
  }
  // Scattered jungle, keeping a clearing at the start and room around the lake and volcano.
  for (let tries = 0, n = 0; n < 240 && tries < 5000; tries++) {
    const x = (rand() * 2 - 1) * (HALF - 4);
    const z = (rand() * 2 - 1) * (HALF - 4);
    if (Math.hypot(x, z) < 22 || inLake(x, z, 5) || blocked(x, z, 5) || slopeAt(x, z) > 0.6) continue;
    tree(x, z, 0.85 + rand() * 0.5);
    n++;
  }
  for (let n = 0, tries = 0; n < 420 && tries < 6000; tries++) {
    const x = (rand() * 2 - 1) * (HALF + 8);
    const z = (rand() * 2 - 1) * (HALF + 8);
    if (inLake(x, z, 1) || blocked(x, z, 1) || slopeAt(x, z) > 0.7) continue;
    const s = 0.7 + rand() * 1.1;
    bushes.push({ p: [x, groundY(x, z) + s * 0.15, z], s: [s * 1.3, s * 0.5, s * 1.2], r: [0, rand() * 3, 0], c: pick(greens) });
    n++;
  }
  for (let n = 0, tries = 0; n < 70 && tries < 2000; tries++) {
    const x = (rand() * 2 - 1) * HALF;
    const z = (rand() * 2 - 1) * HALF;
    if (Math.hypot(x, z) < 14 || inLake(x, z, 2) || blocked(x, z, 3)) continue;
    const s = 0.6 + rand() * 1.8;
    rocks.push({ p: [x, groundY(x, z) + s * 0.15, z], s: [s * 1.3, s, s * 1.1], r: [rand(), rand() * 3, rand()], c: pick(['#8d8a86', '#a19c95', '#77736e']) });
    if (s > 1.3) addCollider({ x, z, r: s * 1.1 });
    n++;
  }
  for (let n = 0; n < 260; n++) {
    const x = (rand() * 2 - 1) * HALF;
    const z = (rand() * 2 - 1) * HALF;
    if (inLake(x, z, 1)) continue;
    flowers.push({ p: [x, groundY(x, z) + 0.2, z], s: [0.28, 0.28, 0.28], c: pick(['#ff5d8f', '#ffd166', '#ffffff', '#b388ff', '#ff9f1c']) });
  }
  for (let n = 0; n < 14; n++) {
    const a = rand() * Math.PI * 2;
    const d = rand() * (LAKE.r - 3);
    flowers.push({ p: [LAKE.x + Math.cos(a) * d, 0.08, LAKE.z + Math.sin(a) * d], s: [1.1, 0.05, 1.1], c: '#5fbf4a' });
  }

  const flat = { flatShading: true };
  instanced(new THREE.CylinderGeometry(1, 1, 1, 7), lambert({ color: '#7b5434', ...flat }), trunks);
  instanced(new THREE.IcosahedronGeometry(1, 0), lambert({ color: '#ffffff', ...flat }), canopies);
  const frondGeo = new THREE.BoxGeometry(1, 1, 1);
  frondGeo.translate(0, 0, 0.45);
  instanced(frondGeo, lambert({ color: '#ffffff', ...flat }), fronds);
  instanced(new THREE.IcosahedronGeometry(1, 0), lambert({ color: '#ffffff', ...flat }), bushes);
  instanced(new THREE.DodecahedronGeometry(1, 0), lambert({ color: '#ffffff', ...flat }), rocks);
  instanced(new THREE.SphereGeometry(1, 6, 4), lambert({ color: '#ffffff' }), flowers, false);

  const vt = new THREE.Vector3();
  return {
    group,
    collide(p, r) {
      near(p.x, p.z, (c) => {
        vt.set(p.x - c.x, 0, p.z - c.z);
        const d = vt.length();
        const min = c.r + r;
        if (d < min && d > 1e-4) p.addScaledVector(vt.divideScalar(d), min - d);
      });
      vt.set(p.x - VOLCANO.x, 0, p.z - VOLCANO.z);
      const dv = vt.length();
      if (dv < VOLCANO.r + r) p.addScaledVector(vt.divideScalar(dv || 1), VOLCANO.r + r - dv);
      p.x = THREE.MathUtils.clamp(p.x, -HALF, HALF);
      p.z = THREE.MathUtils.clamp(p.z, -HALF, HALF);
    },
    inWater: (x, z) => inLake(x, z, -1) && groundY(x, z) < 0,
    openSpot(r, clear) {
      for (let i = 0; i < 400; i++) {
        const x = (r() * 2 - 1) * (HALF - 8);
        const z = (r() * 2 - 1) * (HALF - 8);
        if (!inLake(x, z, 3) && !blocked(x, z, clear) && slopeAt(x, z) < 0.4) return new THREE.Vector3(x, groundY(x, z), z);
      }
      return new THREE.Vector3(0, groundY(0, 8), 8);
    },
    update(t) {
      for (const m of smoke) {
        const k = (t * 0.12 + m.userData.t) % 1;
        m.position.set(VOLCANO.x + Math.sin(k * 6 + m.userData.t * 9) * 2, vy + 25 + k * 22, VOLCANO.z + k * 6);
        m.scale.setScalar(2 + k * 5);
      }
      (lava.material as THREE.MeshBasicMaterial).color.setHSL(0.05 + Math.sin(t * 2) * 0.015, 1, 0.55);
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
