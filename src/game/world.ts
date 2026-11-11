import * as THREE from 'three';
import { setWind, treeGeometries, treeMaterial, treeTexture } from './trees';
import { getMap, type MapDef } from './maps';
import type { Hill, House, Road, Shape } from './maps/types';
import { area, boxOf, centroid, circle, coastAt, nearestOnPoly, outBox, resample, sdPoly, toPath, type Box, type CoastStroke, type Pt } from './shapes';

/** Buildings are designed in metres and drawn this many times bigger, to match the people. */
export const SCALE = 1.5;

/** Half the width of the square play area; a wall of jungle grows beyond it. */
export let HALF = 125;
/** Size of the ground plane: the play area, the wall of jungle and a margin. */
let GROUND = 360;
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

// ---- The current map's layout (maps/*.ts), set by useMap() before a level is built ----
// These objects and arrays are filled in place, so modules that hold on to them stay up to date.

/** A closed outline with its bounding box (for skipping it cheaply when far away). */
export interface Poly { pts: Pt[]; box: Box }
/** The map in use. */
export let MAP: MapDef = getMap();
export const LAKES: Poly[] = [];
/** Volcanoes: the base outline, its centre and average radius. */
export const VOLCANOES: (Poly & { c: Pt; r: number })[] = [];
/** Flat-topped plateaus with steep rock walls: too steep to walk up, low enough to jump onto. */
export const MESAS: (Poly & { h: number })[] = [];
/** Hills and ridges along freehand paths. */
export const HILLS: (Hill & { box: Box })[] = [];
/** Roads along freehand paths. */
export const ROADS: (Road & { box: Box })[] = [];
/** The map's buildings (buildings.ts builds them). */
export const HOUSES: House[] = [];
/** The hero's paddock (park.ts builds its cage here). */
export const PADDOCK = { x: 0, z: 0 };
/** Clearings kept free of plants and rocks for the other dinosaurs' cages. */
export const CAGE_SPOTS: Circle[] = [];
/** Room kept clear round each of the map's jeeps (and the visitor beside it). */
const CAR_SPOTS: Circle[] = [];

/** A flattened, clear rectangle: centre, width along x, depth along z, and the height it is levelled to. */
export interface Site { x: number; z: number; w: number; d: number; y: number }
/** Main Street, with a road along x. */
export const TOWN: Site = { x: 0, z: 0, w: 0, d: 0, y: 0 };
/** The power station: generators inside a fenced yard with its gate on the east side. */
export const POWER: Site = { x: 0, z: 0, w: 0, d: 0, y: 0 };
/** The docks' landing, on the north coast. */
export const DOCKS: Site = { x: 0, z: 0, w: 0, d: 0, y: 0 };
/** The shore at the docks: the pier runs out to sea (+z) from here. (The coast itself is coastDist().) */
export let SHORE = 103;
/** The coastline: the map's straight `shore` and the strokes painted on it, with coastDist() sampled on a grid for speed. */
const COAST = { line: 103, strokes: [] as CoastStroke[], boxes: [] as Box[], grid: null as Float32Array | null, n: 0, half: 0 };
const COAST_STEP = 2;
/** The docks' pier, out over the sea: its centre line, start, end, width and deck height (level with the landing). */
export const PIER = { x: 0, z0: 0, z1: 0, w: 4.4, deck: 0 };
const SITES = [TOWN, POWER, DOCKS];
/** The levelled ground under each building (in world units, a little bigger than the building). */
const PADS: Site[] = [];
/** Electric fence lines, as [x1, z1, x2, z2]; kept clear of trees and rocks. */
export const FENCE_LINES: [number, number, number, number][] = [];
const RELIEF = { scale: 1, seed: 0 };

/** A shape's outline: a freehand one as it is, a round one as a circle (`wobble` gives it an irregular edge). */
const outlineOf = (s: Shape, wobble?: number): Pt[] => ('pts' in s ? s.pts.map((p) => [p[0], p[1]] as Pt) : circle(s.x, s.z, s.r, wobble));

/** Switches the world to `map`. Call before building anything for a level. */
export function useMap(map: MapDef) {
  MAP = map;
  HALF = map.half;
  GROUND = (map.half + 55) * 2;
  COAST.line = map.shore;
  Object.assign(RELIEF, map.relief);
  Object.assign(PADDOCK, map.paddock);
  Object.assign(TOWN, map.town);
  Object.assign(POWER, map.power);
  Object.assign(DOCKS, map.docks);
  COAST.strokes = (map.coast ?? []).map((s) => ({ ...s, pts: s.pts.map((p) => [p[0], p[1]] as Pt) }));
  COAST.boxes = COAST.strokes.map((s) => boxOf(s.pts, s.w / 2));
  COAST.grid = null;
  if (COAST.strokes.length) {
    const half = GROUND / 2;
    const n = Math.ceil((half * 2) / COAST_STEP) + 1;
    const grid = new Float32Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) grid[j * n + i] = coastRaw(-half + i * COAST_STEP, -half + j * COAST_STEP);
    Object.assign(COAST, { grid, n, half });
  }
  // The pier starts where the land ends, heading +z from the docks.
  let shore = DOCKS.z;
  while (shore < DOCKS.z + 150 && coastDist(DOCKS.x, shore) < 0) shore += 0.5;
  SHORE = shore;
  Object.assign(PIER, { x: DOCKS.x, z0: SHORE - 6, z1: SHORE + 21, deck: DOCKS.y });
  const fill = <T>(list: T[], items: T[]) => list.splice(0, list.length, ...items);
  fill(LAKES, map.lakes.map((l) => {
    const pts = outlineOf(l);
    return { pts, box: boxOf(pts) };
  }));
  fill(VOLCANOES, map.volcanoes.map((v) => {
    const pts = outlineOf(v);
    const c = centroid(pts);
    return { pts, box: boxOf(pts), c, r: pts.reduce((s, p) => s + Math.hypot(p[0] - c[0], p[1] - c[1]), 0) / pts.length };
  }));
  fill(MESAS, map.mesas.map((m, i) => {
    const pts = outlineOf(m, 0.4 + i * 1.35);
    return { pts, box: boxOf(pts), h: m.h };
  }));
  fill(HILLS, map.hills.map((h) => ({ ...h, pts: h.pts.map((p) => [p[0], p[1]] as Pt), box: boxOf(h.pts, h.w / 2) })));
  fill(ROADS, map.roads.map((r) => ({ ...r, pts: r.pts.map((p) => [p[0], p[1]] as Pt), box: boxOf(r.pts, r.w / 2) })));
  fill(HOUSES, map.buildings.map((b) => ({ ...b })));
  fill(CAGE_SPOTS, map.cages.map((c) => ({ ...c, r: 13 })));
  fill(CAR_SPOTS, (map.cars ?? []).map((c) => ({ x: c.x, z: c.z, r: 6.5 })));
  // Each building stands on a pad levelled to the ground at its centre.
  fill(PADS, []);
  fill(PADS, HOUSES.map((b) => ({ x: b.x, z: b.z, w: b.w * SCALE + 1, d: b.d * SCALE + 1, y: groundY(b.x, b.z) })));
  // The power station's perimeter, with a gate gap in the middle of the east side.
  const [w, e, s, n] = [POWER.x - POWER.w / 2, POWER.x + POWER.w / 2, POWER.z - POWER.d / 2, POWER.z + POWER.d / 2];
  fill(FENCE_LINES, [
    ...map.fences.map((l) => [...l] as [number, number, number, number]),
    [w, n, e, n],
    [w, s, e, s],
    [w, s, w, n],
    [e, s, e, POWER.z - 4],
    [e, POWER.z + 4, e, n],
  ]);
}

/** How far outside a site's rectangle a point is (negative inside). */
export const outside = (s: Site, x: number, z: number) => Math.max(Math.abs(x - s.x) - s.w / 2, Math.abs(z - s.z) - s.d / 2);
/** Distance from a point to a fence line. */
export function toLine(x: number, z: number, [x1, z1, x2, z2]: [number, number, number, number]) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
}
/** How far outside the town rectangle a point is (negative inside). */
export const outsideTown = (x: number, z: number) => outside(TOWN, x, z);

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Signed distance to the coast, worked out from the outlines: negative on land, positive at sea. */
const coastRaw = (x: number, z: number) => coastAt(COAST.line, COAST.strokes, x, z, COAST.boxes);
/** Signed distance to the coast: negative on land, positive out at sea (from the grid where there is one). */
export function coastDist(x: number, z: number) {
  const g = COAST.grid;
  if (!g) return coastRaw(x, z);
  const fx = (x + COAST.half) / COAST_STEP;
  const fz = (z + COAST.half) / COAST_STEP;
  const n = COAST.n;
  if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return coastRaw(x, z);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const a = g[j * n + i];
  const b = g[j * n + i + 1];
  const c = g[(j + 1) * n + i];
  const d = g[(j + 1) * n + i + 1];
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/** Signed distance to the nearest lake's shore (negative in the water), or a big number when there's none within `far`. */
function lakeEdge(x: number, z: number, far: number) {
  let d = 1e9;
  for (const l of LAKES) if (outBox(l.box, x, z) < far) d = Math.min(d, sdPoly(x, z, l.pts));
  return d;
}

/** Terrain height: rolling hills, ridges, a basin for each lake, and the plateaus. */
export function groundY(x: number, z: number): number {
  const k = RELIEF.seed;
  let h = (4 * Math.sin(x * 0.035 + 1 + k) * Math.cos(z * 0.04 - 0.5 + k * 0.7) + 2 * Math.sin(x * 0.07 - z * 0.05 + k * 1.3) + 0.9 * Math.sin((x + z) * 0.13 + k * 2.1)) * RELIEF.scale;
  h += 2.5;
  for (const hill of HILLS) if (outBox(hill.box, x, z) < 0) h += hill.h * smooth(hill.w / 2, 0, toPath(x, z, hill.pts));
  for (const lake of LAKES) {
    if (outBox(lake.box, x, z) > 28) continue;
    const dl = sdPoly(x, z, lake.pts);
    h = h + (Math.max(h, 1) - h) * smooth(28, 10, dl); // no dips beside the lake
    h = h + (-1.2 - h) * smooth(12, -3, dl);
  }
  for (const m of MESAS) if (outBox(m.box, x, z) < 1.6) h += m.h * smooth(1.6, -0.6, sdPoly(x, z, m.pts));
  // A beach along every coast: the land eases down to just above the water.
  const cd = coastDist(x, z);
  h += (0.6 - h) * smooth(-14, -3, cd);
  // Main Street, the power station and the docks are levelled, easing back into the hills around them; so is the ground under each building.
  for (const site of SITES) h += (site.y - h) * smooth(12, 0, outside(site, x, z));
  for (const pad of PADS) {
    const o = outside(pad, x, z);
    if (o < 5) h += (pad.y - h) * smooth(5, 0, o);
  }
  // Past the waterline, the sea floor.
  h += (-3.5 - h) * smooth(-3, 8, cd);
  return h;
}

// Everything above is declared by now (useMap levels the building pads with groundY).
useMap(MAP);

/** What something walking stands on: the ground, or the pier's deck where that is higher. */
export function floorY(x: number, z: number): number {
  const g = groundY(x, z);
  return Math.abs(x - PIER.x) < PIER.w / 2 && z > PIER.z0 && z < PIER.z1 ? Math.max(g, PIER.deck) : g;
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
  /** Full tree models (roots, coconuts, more leaves) or the cheap ones everywhere, for the graphics setting. */
  setTreeDetail(full: boolean): void;
  dispose(): void;
}

/** Pushes each vertex in or out a little (the same amount for vertices that share a position), for organic shapes. */
function lumpy(geo: THREE.BufferGeometry, amount: number, seed: number) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 1.3) * Math.sin(v.z * 3.3 + seed * 0.7);
    v.multiplyScalar(1 + n * amount);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * A dirt track, painted on a canvas: wet mud with two darker tyre ruts (tread marks and puddles in them),
 * a strip of grass down the middle and soft edges that fade into the ground. `u` runs across the road,
 * `v` along it (one repeat is TRACK metres); `rough` is its roughness map, slick in the ruts.
 */
const TRACK = 10;
function trackTextures() {
  const W = 128;
  const H = 512;
  const r = rng(91);
  const make = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return [c, c.getContext('2d')!] as const;
  };
  const [cc, g] = make();
  const [rc, rg] = make();
  // Mud, mottled.
  g.fillStyle = '#56462f';
  g.fillRect(0, 0, W, H);
  rg.fillStyle = '#d0d0d0';
  rg.fillRect(0, 0, W, H);
  const blot = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, style: string) => {
    ctx.fillStyle = style;
    ctx.beginPath();
    // Drawn three times over the seam so the texture tiles along v.
    for (const dy of [-H, 0, H]) ctx.ellipse(x, y + dy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let i = 0; i < 900; i++) {
    const l = 0.75 + r() * 0.5;
    blot(g, r() * W, r() * H, 2 + r() * 7, 2 + r() * 9, `rgba(${Math.round(86 * l)},${Math.round(70 * l)},${Math.round(47 * l)},0.5)`);
  }
  // Grass down the middle and creeping in at the edges.
  for (let i = 0; i < 700; i++) {
    const edge = r() < 0.45;
    const x = edge ? (r() < 0.5 ? r() * 22 : W - r() * 22) : W / 2 + (r() - 0.5) * 26 * (0.6 + r() * 0.6);
    const gr = 0.8 + r() * 0.4;
    blot(g, x, r() * H, 1 + r() * 3, 2 + r() * 5, `rgba(${Math.round(58 * gr)},${Math.round(86 * gr)},${Math.round(44 * gr)},0.75)`);
  }
  // Two ruts: darker, wetter, wandering a little, with tread marks across them and puddles.
  for (const u of [0.3, 0.7]) {
    const wob = r() * 6;
    for (let y = -8; y < H + 8; y += 2) {
      const x = W * u + Math.sin((y / H) * Math.PI * 2 * 2 + wob) * 2.5 + Math.sin((y / H) * Math.PI * 2 * 5 + wob) * 1;
      g.fillStyle = 'rgba(52,41,29,0.5)';
      g.fillRect(x - 10, y, 20, 3);
      g.fillStyle = 'rgba(42,33,24,0.55)';
      g.fillRect(x - 7, y, 14, 3);
      rg.fillStyle = 'rgba(70,70,70,0.6)';
      rg.fillRect(x - 8, y, 16, 3);
      if (y % 8 === 0) {
        g.fillStyle = 'rgba(30,24,18,0.45)';
        g.fillRect(x - 7, y, 14, 2);
      }
    }
    for (let i = 0; i < 3; i++) {
      const x = W * u + (r() - 0.5) * 4;
      const y = r() * H;
      const rx = 3.5 + r() * 2.5;
      const ry = 8 + r() * 16;
      blot(g, x, y, rx, ry, 'rgba(48,40,30,0.6)');
      blot(rg, x, y, rx, ry, 'rgba(10,10,10,0.9)');
    }
  }
  // Soft edges.
  const fade = g.createLinearGradient(0, 0, W, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.13, 'rgba(0,0,0,1)');
  fade.addColorStop(0.87, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  const rough = new THREE.CanvasTexture(rc);
  for (const t of [map, rough]) {
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  return { map, rough };
}

export function buildWorld(): World {
  const rand = rng(MAP.seed);
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
    if (VOLCANOES.some((v) => outBox(v.box, x, z) < clear && sdPoly(x, z, v.pts) < clear)) return true;
    if (CAGE_SPOTS.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + clear)) return true;
    if (CAR_SPOTS.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + clear)) return true;
    if (SITES.some((site) => outside(site, x, z) < 4 + clear)) return true;
    if (PADS.some((pad) => outside(pad, x, z) < 2 + clear)) return true;
    if (ROADS.some((r) => outBox(r.box, x, z) < 1.5 + clear && toPath(x, z, r.pts) < r.w / 2 + 1.5 + clear)) return true;
    if (coastDist(x, z) > -7 - clear) return true; // the sea and the beach
    if (FENCE_LINES.some((l) => toLine(x, z, l) < 3 + clear)) return true;
    let hit = false;
    near(x, z, (c) => {
      if (Math.hypot(x - c.x, z - c.z) < c.r + clear) hit = true;
    });
    return hit;
  }
  const inLake = (x: number, z: number, pad = 0) => lakeEdge(x, z, pad) < pad;

  // ---- Ground: hills and cliffs; patchy greens, dirt, sand and rock painted into vertex colours ----
  const groundGeo = keep(new THREE.PlaneGeometry(GROUND, GROUND, 200, 200));
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  // Rain-soaked: dark grass, muddy tracks, wet sand and slick rock.
  const grassA = new THREE.Color('#3d5a2e');
  const grassB = new THREE.Color('#2b4524');
  const dirt = new THREE.Color('#4f4232');
  const sand = new THREE.Color('#7d7058');
  const rock = new THREE.Color('#544a40');
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 0.045) * Math.cos(z * 0.06) + Math.sin((x + z) * 0.11) * 0.45 + Math.sin(x * 0.21 - z * 0.17) * 0.2;
    tmp.copy(grassA).lerp(grassB, THREE.MathUtils.clamp(n * 0.5 + 0.5, 0, 1));
    const d = Math.sin(x * 0.03 + 1.3) * Math.sin(z * 0.035 - 0.4);
    if (d > 0.55) tmp.lerp(dirt, THREE.MathUtils.clamp((d - 0.55) * 4, 0, 0.8));
    const lake = lakeEdge(x, z, 6);
    if (lake < 6) tmp.lerp(sand, THREE.MathUtils.clamp(1 - lake / 6, 0, 1));
    // Sand along the coast.
    tmp.lerp(sand, smooth(-11, -5, coastDist(x, z)));
    // Muddy verges along the roads.
    for (const r of ROADS) {
      if (outBox(r.box, x, z) > 3) continue;
      const dr = toPath(x, z, r.pts) - r.w / 2;
      if (dr < 3) tmp.lerp(dirt, 0.5 * smooth(3, 0, dr));
    }
    tmp.lerp(rock, smooth(0.7, 1.1, slopeAt(x, z)));
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
    pos.setY(i, groundY(x, z));
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 })));
  ground.receiveShadow = true;
  ground.userData.noFade = true; // the see-through effect leaves the ground, roads and water alone
  group.add(ground);

  // ---- Main Street: a wet asphalt road with kerbs and pavements ----
  const asphalt = keep(new THREE.MeshStandardMaterial({ color: '#2a2c2d', roughness: 0.35, metalness: 0.1 }));
  const paving = keep(new THREE.MeshStandardMaterial({ color: '#6a665e', roughness: 0.7 }));
  const slab = (w: number, d: number, mat: THREE.Material, x: number, z: number, y: number) => {
    const geo = keep(new THREE.PlaneGeometry(w, d));
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.userData.noFade = true;
    group.add(m);
  };
  slab(TOWN.w + 6, TOWN.d - 2, paving, TOWN.x, TOWN.z, TOWN.y + 0.03);
  slab(TOWN.w + 40, 7, asphalt, TOWN.x, TOWN.z, TOWN.y + 0.06);
  const stripe = keep(new THREE.MeshBasicMaterial({ color: '#8a8470' }));
  for (let k = -5; k <= 5; k++) slab(2.2, 0.18, stripe, TOWN.x + k * 5, TOWN.z, TOWN.y + 0.08);

  // ---- Roads: dirt tracks, a ribbon draped over the ground along each path ----
  const track = ROADS.length ? trackTextures() : null;
  const roadMat = track
    ? keep(new THREE.MeshStandardMaterial({
        map: keep(track.map), roughnessMap: keep(track.rough), roughness: 1, metalness: 0,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
      }))
    : null;
  for (const road of ROADS) {
    const line = resample(road.pts, 1.5);
    if (!roadMat || line.length < 2) continue;
    // A bit wider than the road itself, for the edges to fade out over.
    const w = road.w * 1.25;
    const across = 6;
    const verts: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    let along = 0;
    line.forEach(([x, z], i) => {
      if (i) along += Math.hypot(x - line[i - 1][0], z - line[i - 1][1]);
      // Square to the path, averaged over the segments either side.
      const [ax, az] = line[Math.max(0, i - 1)];
      const [bx, bz] = line[Math.min(line.length - 1, i + 1)];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      for (let j = 0; j <= across; j++) {
        const o = (j / across - 0.5) * w;
        const px = x + nx * o;
        const pz = z + nz * o;
        verts.push(px, groundY(px, pz) + 0.1, pz);
        uvs.push(j / across, along / TRACK);
        if (i && j) {
          const a = (i - 1) * (across + 1) + j - 1;
          const b = i * (across + 1) + j - 1;
          index.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    });
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    // Wound either way depending on the path's direction, so the material draws both sides.
    const m = new THREE.Mesh(geo, roadMat);
    m.receiveShadow = true;
    m.renderOrder = 1; // after the ground, which it blends onto
    m.userData.noFade = true;
    group.add(m);
  }

  // ---- Lakes, with lily pads ----
  const waterMat = keep(new THREE.MeshStandardMaterial({ color: '#2c4146', roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.94 }));
  for (const lake of LAKES) {
    // The shape is drawn in (x, -z) so that laying it flat puts it at (x, z).
    const lakeGeo = keep(new THREE.ShapeGeometry(new THREE.Shape(lake.pts.map(([x, z]) => new THREE.Vector2(x, -z)))));
    lakeGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(lakeGeo, waterMat);
    water.position.y = 0.04;
    water.receiveShadow = true;
    water.userData.noFade = true;
    group.add(water);
  }

  // ---- The sea: every square of a grid that comes within a few metres of the coast (its edge is under the
  // beach), out well past the end of the ground ----
  const seaGeo = keep(new THREE.BufferGeometry());
  {
    const reach = GROUND / 2 + 120;
    const step = 4;
    const cells = Math.ceil((reach * 2) / step);
    const verts: number[] = [];
    const index: number[] = [];
    const ids = new Map<number, number>();
    const vid = (i: number, j: number) => {
      const key = i * (cells + 1) + j;
      let v = ids.get(key);
      if (v === undefined) {
        v = verts.length / 3;
        verts.push(-reach + i * step, 0, -reach + j * step);
        ids.set(key, v);
      }
      return v;
    };
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        const x = -reach + i * step;
        const z = -reach + j * step;
        const wet = Math.max(coastDist(x, z), coastDist(x + step, z), coastDist(x, z + step), coastDist(x + step, z + step), coastDist(x + step / 2, z + step / 2));
        if (wet < -4) continue;
        const a = vid(i, j);
        const b = vid(i + 1, j);
        const c = vid(i + 1, j + 1);
        const d = vid(i, j + 1);
        index.push(a, d, b, b, d, c);
      }
    }
    seaGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    seaGeo.setAttribute('normal', new THREE.Float32BufferAttribute(verts.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    seaGeo.setIndex(index);
  }
  const sea = new THREE.Mesh(seaGeo, keep(new THREE.MeshStandardMaterial({ color: '#233438', roughness: 0.1, metalness: 0.35 })));
  sea.position.y = 0.02;
  sea.receiveShadow = true;
  sea.userData.noFade = true;
  group.add(sea);

  // ---- Volcanoes, with a glowing crater and puffs of smoke ----
  const rockMat = lambert({ color: '#3e3430', flatShading: true });
  const lavaMat = keep(new THREE.MeshBasicMaterial({ color: '#ff6a1a' }));
  const lavaGeo = keep(new THREE.CircleGeometry(5, 18));
  const smokeMat = keep(new THREE.MeshLambertMaterial({ color: '#5c5a5a', transparent: true, opacity: 0.55, depthWrite: false }));
  const smokeGeo = keep(new THREE.IcosahedronGeometry(1, 1));
  const smoke: { m: THREE.Mesh; x: number; z: number; y: number; s: number; t: number }[] = [];
  for (const v of VOLCANOES) {
    const [cx, cz] = v.c;
    // As tall as the original island's (24 over a 21 m base) for its size, with a crater about a quarter as wide as the base.
    const tall = v.r * (24 / 21);
    const crater = THREE.MathUtils.clamp(v.r * 0.24, 2.5, 7);
    const vy = groundY(cx, cz) - 1;
    const top = vy + tall;
    // Rings from the base outline (sunk into the ground) up to the crater's rim, steepening towards the top.
    const base = resample(v.pts, Math.max(1.5, (Math.PI * 2 * v.r) / 40), true);
    const rings = 7;
    const verts: number[] = [];
    const index: number[] = [];
    const n = base.length;
    for (let k = 0; k <= rings; k++) {
      const f = k / rings;
      base.forEach(([bx, bz], i) => {
        const a = Math.atan2(bz - cz, bx - cx);
        const rx = cx + Math.cos(a) * crater;
        const rz = cz + Math.sin(a) * crater;
        // A little lumpiness on the flanks (none at the foot or the rim).
        const bump = Math.sin(a * 5 + k * 1.7) * Math.sin(k * 0.9 + i) * 0.9 * Math.sin(f * Math.PI);
        const x = bx + (rx - bx) * f + Math.cos(a) * bump;
        const z = bz + (rz - bz) * f + Math.sin(a) * bump;
        const by = groundY(bx, bz) - 1;
        verts.push(x, by + (top - by) * Math.pow(f, 1.5), z);
        if (k) {
          const j = (i + 1) % n;
          const a0 = (k - 1) * n + i;
          const a1 = (k - 1) * n + j;
          const b0 = k * n + i;
          const b1 = k * n + j;
          index.push(a0, b0, a1, a1, b0, b1);
        }
      });
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(index);
    // Outlines can be drawn either way round: make the faces point outwards.
    if (area(base) < 0) {
      for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
      geo.setIndex(index);
    }
    geo.computeVertexNormals();
    const volcano = new THREE.Mesh(geo, rockMat);
    volcano.castShadow = volcano.receiveShadow = true;
    const lava = new THREE.Mesh(lavaGeo, lavaMat);
    lava.rotation.x = -Math.PI / 2;
    lava.scale.setScalar(crater / 5);
    lava.position.set(cx, top - 0.4, cz);
    group.add(volcano, lava);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(smokeGeo, smokeMat);
      group.add(m);
      smoke.push({ m, x: cx, z: cz, y: top, s: crater / 5, t: i / 7 });
    }
  }

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
  const bushes: { p: V3; s: V3; r?: V3; c: string }[] = [];
  const rocks: { p: V3; s: V3; r: V3; c: string }[] = [];
  const flowers: { p: V3; s: V3; c: string }[] = [];
  const greens = ['#2c4a28', '#35532c', '#283f24', '#3d5a30', '#2f4a2a'];
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

  // Trees: a few modelled variants of each kind (trees.ts), one InstancedMesh each.
  const kinds = treeGeometries(rand);
  const variants = [...kinds.broadleaf, kinds.broadleafLite, ...kinds.palm, kinds.palmLite];
  const planted: { p: V3; s: V3; r: V3; c: string }[][] = variants.map(() => []);
  const tints = ['#ffffff', '#e6efdc', '#f6ffe6', '#dfe5d4', '#fff2dc'];
  /** A tree; `far` ones (beyond the play area) use the cheap model, have no collider, and draw on `r`. */
  function tree(x: number, z: number, scale: number, far = false, r = rand) {
    const g = groundY(x, z) - 0.2;
    const isPalm = r() < MAP.plants.palms;
    const k = isPalm ? kinds.broadleaf.length + 1 : 0;
    const which = k + (far ? kinds.broadleaf.length : Math.floor(r() * kinds.broadleaf.length));
    const s = isPalm ? scale : scale * 1.05;
    planted[which].push({ p: [x, g, z], s: [s * (0.9 + r() * 0.2), s * (0.9 + r() * 0.25), s * (0.9 + r() * 0.2)], r: [0, r() * Math.PI * 2, 0], c: tints[Math.floor(r() * tints.length)] });
    if (!far) addCollider({ x, z, r: isPalm ? 0.9 : 1.1 * scale });
  }

  // Dense jungle all round outside the play area, out to the end of the ground (not on the sea side):
  // a band of trees packed close along the edge, then a canopy of leafy masses (far cheaper than trees)
  // with a few trees standing out of it. It has its own random numbers, so the play area's jungle
  // doesn't move when the band changes.
  const wild = rng(MAP.seed * 31 + 5);
  const canopy: { p: V3; s: V3; r: V3; c: string }[] = [];
  const darkGreens = ['#22381f', '#2a4224', '#1f3320', '#30492a', '#263d22'];
  const EDGE = GROUND / 2;
  const CELLW = 4.6;
  for (let gx = -EDGE; gx < EDGE; gx += CELLW) {
    for (let gz = -EDGE; gz < EDGE; gz += CELLW) {
      const x = gx + wild() * CELLW;
      const z = gz + wild() * CELLW;
      const out = Math.max(Math.abs(x), Math.abs(z)) - HALF;
      if (out < 3 || coastDist(x, z) > -6) continue;
      if (out < 22) {
        if (wild() < 0.9) tree(x, z, 1.2 + wild() * 0.5, true, wild);
        continue;
      }
      if (wild() < 0.2) tree(x, z, 1.5 + wild() * 0.5, true, wild);
      const w = 3.6 + wild() * 1.6;
      canopy.push({ p: [x, groundY(x, z) + 4.5 + wild() * 1.5, z], s: [w, 3.8 + wild() * 1.6, w * (0.85 + wild() * 0.3)], r: [0, wild() * 3, 0], c: darkGreens[Math.floor(wild() * darkGreens.length)] });
    }
  }
  // Scattered jungle, keeping a clearing at the start and room around the lake and volcano.
  for (let tries = 0, n = 0; n < MAP.plants.trees && tries < MAP.plants.trees * 20; tries++) {
    const x = (rand() * 2 - 1) * (HALF - 4);
    const z = (rand() * 2 - 1) * (HALF - 4);
    if (Math.hypot(x - PADDOCK.x, z - PADDOCK.z) < 22 || inLake(x, z, 5) || blocked(x, z, 5) || slopeAt(x, z) > 0.6) continue;
    tree(x, z, 0.85 + rand() * 0.5);
    n++;
  }
  for (let n = 0, tries = 0; n < MAP.plants.bushes && tries < MAP.plants.bushes * 15; tries++) {
    const x = (rand() * 2 - 1) * (HALF + 8);
    const z = (rand() * 2 - 1) * (HALF + 8);
    if (inLake(x, z, 1) || blocked(x, z, 1) || slopeAt(x, z) > 0.7) continue;
    const s = 0.7 + rand() * 1.1;
    bushes.push({ p: [x, groundY(x, z) + s * 0.15, z], s: [s * 1.3, s * 0.6, s * 1.2], r: [0, rand() * 3, 0], c: pick(greens) });
    n++;
  }
  for (let n = 0, tries = 0; n < MAP.plants.rocks && tries < MAP.plants.rocks * 30; tries++) {
    const x = (rand() * 2 - 1) * HALF;
    const z = (rand() * 2 - 1) * HALF;
    if (Math.hypot(x - PADDOCK.x, z - PADDOCK.z) < 14 || inLake(x, z, 2) || blocked(x, z, 3)) continue;
    const s = 0.6 + rand() * 1.8;
    rocks.push({ p: [x, groundY(x, z) + s * 0.15, z], s: [s * 1.3, s, s * 1.1], r: [rand(), rand() * 3, rand()], c: pick(['#57544f', '#64605a', '#4a4743']) });
    if (s > 1.3) addCollider({ x, z, r: s * 1.1 });
    n++;
  }
  for (const lake of LAKES) {
    const [x0, z0, x1, z1] = lake.box;
    for (let n = 0, tries = 0, want = Math.round(Math.abs(area(lake.pts)) / 90); n < want && tries < want * 20; tries++) {
      const x = x0 + rand() * (x1 - x0);
      const z = z0 + rand() * (z1 - z0);
      if (sdPoly(x, z, lake.pts) > -3) continue;
      flowers.push({ p: [x, 0.08, z], s: [1.1, 0.05, 1.1], c: '#34502c' });
      n++;
    }
  }

  const flat = { flatShading: true };
  const treeMat = keep(treeMaterial(keep(treeTexture(rand))));
  /** The play area's trees, with their full model and the cheap one they swap to at low detail. */
  const detailed: { mesh: THREE.InstancedMesh; full: THREE.BufferGeometry; lite: THREE.BufferGeometry }[] = [];
  variants.forEach((geo, i) => {
    const lite = geo === kinds.broadleafLite || geo === kinds.palmLite;
    if (!planted[i].length) {
      keep(geo); // a lite model may still be swapped in, so free it with the rest
      return;
    }
    // The far wall casts no shadows: it's outside the play area, and the shadow pass would draw it all.
    const mesh = instanced(geo, treeMat, planted[i], !lite);
    if (!lite) detailed.push({ mesh, full: geo, lite: kinds.broadleaf.includes(geo) ? kinds.broadleafLite : kinds.palmLite });
  });
  instanced(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.25, 12), lambert({ color: '#ffffff' }), bushes);
  if (canopy.length) instanced(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.3, 7), lambert({ color: '#ffffff' }), canopy, false);
  instanced(lumpy(new THREE.DodecahedronGeometry(1, 1), 0.18, 13), lambert({ color: '#ffffff', ...flat }), rocks);
  instanced(new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2), lambert({ color: '#ffffff' }), flowers, false);

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
      for (const v of VOLCANOES) {
        if (outBox(v.box, p.x, p.z) > r) continue;
        const sd = sdPoly(p.x, p.z, v.pts);
        if (sd >= r) continue;
        // Out to the nearest point of the base, and on past it by r.
        const [nx, nz] = nearestOnPoly(p.x, p.z, v.pts);
        vt.set(nx - p.x, 0, nz - p.z);
        const d = vt.length();
        if (d < 1e-4) continue;
        vt.divideScalar(d);
        if (sd > 0) vt.negate();
        p.set(nx + vt.x * r, p.y, nz + vt.z * r);
      }
      p.x = THREE.MathUtils.clamp(p.x, -HALF, HALF);
      p.z = THREE.MathUtils.clamp(p.z, -HALF, HALF);
    },
    inWater: (x, z) => (inLake(x, z, -1) || coastDist(x, z) > 0) && groundY(x, z) < 0,
    openSpot(r, clear) {
      for (let i = 0; i < 400; i++) {
        const x = (r() * 2 - 1) * (HALF - 8);
        const z = (r() * 2 - 1) * (HALF - 8);
        if (!inLake(x, z, 3) && !blocked(x, z, clear) && slopeAt(x, z) < 0.4) return new THREE.Vector3(x, groundY(x, z), z);
      }
      return new THREE.Vector3(PADDOCK.x, groundY(PADDOCK.x, PADDOCK.z + 20), PADDOCK.z + 20);
    },
    setTreeDetail(full) {
      for (const d of detailed) {
        const geo = full ? d.full : d.lite;
        if (d.mesh.geometry === geo) continue;
        d.mesh.geometry = geo;
        d.mesh.computeBoundingSphere();
        d.mesh.computeBoundingBox();
      }
    },
    update(t) {
      setWind(t);
      for (const { m, x, z, y, s, t: off } of smoke) {
        const k = (t * 0.12 + off) % 1;
        m.position.set(x + Math.sin(k * 6 + off * 9) * 2 * s, y + 1 + k * 22 * s, z + k * 6 * s);
        m.scale.setScalar((2 + k * 5) * s);
      }
      lavaMat.color.setHSL(0.05 + Math.sin(t * 2) * 0.015, 1, 0.55);
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
