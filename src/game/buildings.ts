import * as THREE from 'three';
import { DOCKS, groundY, rng, TOWN } from './world';
import { bake } from './merge';

/**
 * Main Street's buildings (and the boat shed at the docks), each made of pre-broken pieces: wall
 * panels with everything fixed to them (plinth, trim, window frames and sills, signs, awnings,
 * drainpipes, gables) and roof slabs with what stands on them (air-conditioning units, vents, a water
 * tank). Inside, every floor has a slab, a partition into a front and a back room, ceiling lights and
 * furniture: shops, a café and a lobby at street level with storerooms behind, offices and flats
 * upstairs, and a launch on its trailer in the boat shed. A dinosaur biting into a building tears out the pieces nearest its jaws, which drop to the
 * ground as rubble (rubble doesn't block anything). Enough bites and the building counts as wrecked,
 * but it never comes down: at most MAX_TORN of it can be torn away, and a charge only shakes it.
 *
 * Each piece is baked to a mesh or two (merge.ts), and an undamaged building is drawn as one merged
 * mesh per kind of surface; it swaps to its separate pieces on the first hit.
 */

interface Chunk {
  /** The piece: a group at its centre, holding the panel and the detail fixed to it. */
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  /** Loose and falling, or resting as rubble. */
  loose: boolean;
  resting: boolean;
  /** Half its thickness, to rest on the ground. */
  half: number;
  /** Part of the structure (floor slabs): never torn out. */
  fixed: boolean;
}

export interface Building {
  group: THREE.Group;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  hp: number;
  /** Wrecked once it has taken `hp` bites; it still stands (and blocks) either way. */
  state: 'standing' | 'wrecked';
  chunks: Chunk[];
  /** While undamaged, the whole building is drawn as a few merged meshes and the chunks are hidden. */
  intact: THREE.Group | null;
  /** Shakes after a hit. */
  shake: number;
  /** Seconds before it can be hit again (one charge shouldn't count as several hits). */
  cool: number;
}

export interface Town {
  buildings: Building[];
  /** Keeps a circle out of standing buildings. Returns the building it pushed against, or null. */
  collide(p: THREE.Vector3, r: number, vel?: THREE.Vector3): Building | null;
  /**
   * A bite with the jaws at `jaw` (world space): tears out the pieces nearest it. 'wrecked' when this
   * bite wrecked the building, 'bitten' when it took a mouthful, 'solid' when nothing more comes away.
   */
  bite(b: Building, jaw: THREE.Vector3): 'wrecked' | 'bitten' | 'solid';
  /** A charge into it: the building shakes and sheds a little dust, but nothing comes away. */
  bump(b: Building, from: THREE.Vector3): boolean;
  /** Street lamps and lit windows on or off (they go out in the blackout). */
  setLights(on: boolean): void;
  /** Spots on the pavement in front of the buildings, for people to stand. */
  pavement(rand: () => number): THREE.Vector3;
  update(dt: number): void;
  dispose(): void;
}

interface Plan {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  wall: string;
  roof: string;
  /** Cornices, belt courses, corner pilasters and window frames. */
  trim: string;
  hp: number;
  /** A striped canvas awning over the shop front, in this colour (and off-white). A shop has an awning or a sign, not both. */
  awning?: string;
  /** A plain painted sign board over the shop front (no lettering). */
  sign?: string;
  /** Which way the door faces (+1 north, -1 south); by default, the street. */
  front?: number;
  /** A rendered shop with a flat roof behind a parapet, or a corrugated-metal shed with a pitched roof and a roller door. */
  kind?: 'shop' | 'shed';
  /** What stands on a flat roof. */
  top?: ('ac' | 'vent' | 'tank')[];
}

/**
 * Buildings are designed in metres and drawn SCALE times bigger, to match the people (about 2.7 units
 * tall, so 1.5 units a metre). Plans give the centre in world units and the size (w, d, h) in metres.
 */
const SCALE = 1.5;

/**
 * Two rows of buildings facing each other across the road (their street fronts at z 74 and 86, clear of
 * the pavement and lamps), and the boat shed at the docks.
 */
const PLANS: Plan[] = [
  { x: -90, z: 69.5, w: 8, d: 6, h: 4.6, wall: '#a49c8c', roof: '#3a3734', trim: '#d2cbbd', awning: '#6b2f24', hp: 3, top: ['ac', 'vent'] },
  { x: -75, z: 69.5, w: 10, d: 6, h: 6.8, wall: '#8f8a80', roof: '#2f2d2b', trim: '#c4beb2', sign: '#5a2a26', hp: 4, top: ['tank', 'ac', 'vent'] },
  { x: -60, z: 69.5, w: 8, d: 6, h: 4.4, wall: '#b3a892', roof: '#3d3a35', trim: '#e0d7c4', awning: '#2f4a5a', hp: 3, top: ['ac'] },
  { x: -90.75, z: 90.5, w: 9, d: 6, h: 5.2, wall: '#9a9488', roof: '#33302d', trim: '#cfc8ba', awning: '#4a5a2f', hp: 3, top: ['vent', 'ac'] },
  { x: -73.5, z: 90.5, w: 12, d: 6, h: 7.4, wall: '#a39f95', roof: '#2c2a28', trim: '#d6d0c4', sign: '#6a5a2a', hp: 5, top: ['ac', 'ac', 'tank', 'vent'] },
  { x: -57.75, z: 90.5, w: 7, d: 6, h: 4.2, wall: '#ab9f8a', roof: '#3a3632', trim: '#ddd3bf', awning: '#7a5a2a', hp: 3, top: ['vent'] },
  // The boat shed on the docks' landing, its roller door facing the sea.
  { x: DOCKS.x - 9, z: DOCKS.z - 1.5, w: 8, d: 6, h: 4, wall: '#66726a', roof: '#6a5242', trim: '#4a524c', hp: 3, front: 1, kind: 'shed' },
];

const GRAVITY = 30;
/** The most of a building's pieces that can be torn out: what's left always stands. */
const MAX_TORN = 0.45;
/** Wall thickness. */
const PANEL = 0.35;
/** How far a shop's parapet stands above its flat roof. */
const PARAPET = 0.6;
/** How high a shed's ridge stands above its eaves. */
const RISE = 1.6;

type V3 = [number, number, number];

export function createTown(scene: THREE.Scene): Town {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  const cyl = keep(new THREE.CylinderGeometry(1, 1, 1, 12));
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (color: string, roughness = 0.85, metalness = 0) => {
    const k = `${color}/${roughness}/${metalness}`;
    let m = mats.get(k);
    if (!m) mats.set(k, (m = keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }))));
    return m;
  };
  /** A colour darkened or lightened by `k`, in steps of 2% so the material cache stays small. */
  const shade = (color: string, k: number) => '#' + new THREE.Color(color).multiplyScalar(Math.round(k * 50) / 50).getHexString();
  // Window glass you can see into the rooms through.
  const glass = keep(new THREE.MeshStandardMaterial({ color: '#2a3a42', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.42, depthWrite: false }));
  // Lit windows: warm light behind the glass, put out in the blackout (setLights).
  const litGlass = keep(new THREE.MeshStandardMaterial({ color: '#2a2a24', roughness: 0.1, metalness: 0.5, emissive: '#ffc977', emissiveIntensity: 0.9 }));
  litGlass.userData.dynamic = true;
  const door = mat('#3e3227');
  const stone = mat('#5d5a54');
  const concrete = mat('#7d7a73');
  const metal = mat('#8a8e8c', 0.5, 0.5);
  const darkMetal = mat('#3d4140', 0.5, 0.5);
  const canvas = mat('#d8d2c4');
  const dustMat = keep(new THREE.MeshLambertMaterial({ color: '#8d877d', transparent: true, opacity: 0.32, depthWrite: false }));
  const dustGeo = keep(new THREE.IcosahedronGeometry(1, 1));
  const dust: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, size: V3, at: V3, rot: V3 = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.scale.set(...size);
    mesh.position.set(...at);
    mesh.rotation.set(...rot);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** A new piece of `b`, centred at `at` (building space). Fill it, then call done(). */
  function piece(b: Building, at: V3, half: number, fixed = false) {
    const obj = new THREE.Group();
    obj.position.set(...at);
    b.group.add(obj);
    b.chunks.push({ obj, vel: new THREE.Vector3(), spin: new THREE.Vector3(), loose: false, resting: false, half: half * SCALE, fixed });
    return obj;
  }

  /** A flat prism: a polygon in x/y, `depth` thick along z and centred on it. */
  function prism(points: [number, number][], depth: number) {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = keep(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }));
    geo.translate(0, 0, -depth / 2);
    return geo;
  }

  /** A window: glass (lit or not) in a frame with a mullion and transom, a sill, and a rain stain under it. */
  function windowAt(f: THREE.Object3D, p: Plan, wall: string, cx: number, cy: number, gw: number, gh: number, lit: boolean) {
    const z = PANEL / 2;
    const trim = mat(p.trim);
    put(f, box, lit ? litGlass : glass, [gw, gh, 0.04], [cx, cy, z + 0.01]);
    for (const s of [-1, 1]) {
      put(f, box, trim, [0.1, gh + 0.2, 0.1], [cx + s * (gw / 2 + 0.05), cy, z + 0.05]);
      put(f, box, trim, [gw + 0.2, 0.1, 0.1], [cx, cy + s * (gh / 2 + 0.05), z + 0.05]);
    }
    put(f, box, trim, [0.06, gh, 0.06], [cx, cy, z + 0.04]);
    put(f, box, trim, [gw, 0.06, 0.06], [cx, cy + gh * 0.2, z + 0.04]);
    put(f, box, trim, [gw + 0.34, 0.09, 0.22], [cx, cy - gh / 2 - 0.13, z + 0.11]);
    put(f, box, mat(shade(wall, 0.78)), [gw * 0.7, Math.min(0.7, gh * 0.6), 0.01], [cx, cy - gh / 2 - 0.18 - Math.min(0.35, gh * 0.3), z + 0.005]);
  }

  /** A striped awning `len` deep over a stretch of shop front `width` wide, its top edge at `top`. */
  function awningAt(f: THREE.Object3D, color: string, width: number, top: number, stripes: number) {
    const len = 1.5;
    const tilt = 0.25;
    const sw = width / stripes;
    for (let k = 0; k < stripes; k++) {
      const m = k % 2 ? canvas : mat(color);
      const x = -width / 2 + sw * (k + 0.5);
      put(f, box, m, [sw, 0.05, len], [x, top - (len / 2) * Math.sin(tilt), PANEL / 2 + (len / 2) * Math.cos(tilt)], [tilt, 0, 0]);
      put(f, box, m, [sw, 0.2, 0.04], [x, top - len * Math.sin(tilt) - 0.1, PANEL / 2 + len * Math.cos(tilt)]);
    }
    for (const s of [-1, 1]) put(f, box, darkMetal, [0.04, 0.04, len * 1.02], [s * (width / 2 - 0.05), top - (len / 2) * Math.sin(tilt) - 0.05, PANEL / 2 + (len / 2) * Math.cos(tilt)], [tilt, 0, 0]);
  }

  // ---- Interiors ----
  // Every floor has a slab, a partition with a doorway splitting it into a front and a back room, and
  // ceiling lights (on the lit-window material, so they go out in the blackout). Furniture stands in
  // pieces of its own, so a bite can drag a desk or a shelf out through the hole it made. Slabs never
  // come away: the building keeps its floors however much is torn out of it.
  const wood = mat('#6b4f36');
  const darkWood = mat('#4a3626');
  const paleWood = mat('#9a7b58');
  const plaster = mat('#c9c2b2');
  const tile = mat('#8f8a80');
  const black = mat('#232526');
  const offWhite = mat('#d9d6cf');
  const green = mat('#3f5a34');
  const FABRIC = ['#5a6470', '#6e5a4a', '#4f5e4a', '#7a6a52', '#3f4a5a', '#6a4a4a'];
  const GOODS = ['#a33a2a', '#2f5f8a', '#c9a23a', '#4f7a3a', '#8a8a82', '#d0c8b0', '#6a4a7a'];
  const ring = keep(new THREE.TorusGeometry(0.32, 0.07, 6, 14));

  interface Room { b: Building; front: number; y: number; w: number; d: number; vc: number; h: number; rand: () => number }
  /** A piece standing in `room` at room-local (x, z), where +z points to the street; turned by `turn`. */
  function item(room: Room, x: number, z: number, turn = 0, half = 0.3) {
    const obj = piece(room.b, [room.front > 0 ? x : -x, room.y, room.front * (room.vc + z)], half);
    obj.rotation.y = (room.front > 0 ? 0 : Math.PI) + turn;
    return obj;
  }
  const pick = <T,>(r: () => number, list: T[]) => list[Math.floor(r() * list.length)];

  function table(o: THREE.Object3D, w: number, d: number, h: number, top: THREE.Material, legs = darkWood, z = 0) {
    put(o, box, top, [w, 0.05, d], [0, h - 0.025, z]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(o, box, legs, [0.05, h - 0.05, 0.05], [sx * (w / 2 - 0.06), (h - 0.05) / 2, z + sz * (d / 2 - 0.06)]);
  }
  /** A chair facing +z (its back on the -z side), at (x, z) in `o`, turned by `turn`. */
  function chair(o: THREE.Object3D, x: number, z: number, turn: number, seat: THREE.Material) {
    const c = new THREE.Group();
    c.position.set(x, 0, z);
    c.rotation.y = turn;
    o.add(c);
    put(c, box, seat, [0.44, 0.06, 0.44], [0, 0.45, 0]);
    put(c, box, seat, [0.44, 0.45, 0.05], [0, 0.7, -0.2]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(c, box, black, [0.04, 0.42, 0.04], [sx * 0.19, 0.21, sz * 0.19]);
  }
  /** Shelves `w` long and `d` deep against a wall behind them (-z), with goods on each board. */
  function shelves(o: THREE.Object3D, r: () => number, w: number, d: number, h: number, frame: THREE.Material, boards: number) {
    for (const s of [-1, 1]) put(o, box, frame, [0.04, h, d], [s * (w / 2 - 0.02), h / 2, 0]);
    put(o, box, frame, [w, h, 0.02], [0, h / 2, -d / 2 + 0.01]);
    for (let k = 0; k < boards; k++) {
      const y = 0.12 + (k * (h - 0.2)) / (boards - 1);
      put(o, box, frame, [w - 0.06, 0.03, d], [0, y, 0]);
      if (k === boards - 1) break;
      // Goods: a row of boxes and tins of different sizes.
      for (let x = -w / 2 + 0.12; x < w / 2 - 0.15; ) {
        const gw = 0.12 + r() * 0.22;
        const gh = Math.min(0.12 + r() * 0.25, (h - 0.2) / (boards - 1) - 0.06);
        if (r() < 0.85) put(o, box, mat(pick(r, GOODS)), [gw, gh, d * (0.5 + r() * 0.3)], [x + gw / 2, y + 0.015 + gh / 2, 0]);
        x += gw + 0.03;
      }
    }
  }
  function plant(o: THREE.Object3D, x: number, z: number, h: number) {
    put(o, cyl, mat('#6a4a36'), [0.18, 0.35, 0.18], [x, 0.175, z]);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      put(o, box, green, [0.12, h, 0.3], [x + Math.cos(a) * 0.08, 0.35 + h / 2, z + Math.sin(a) * 0.08], [0.25 * Math.sin(a), a, 0.25 * Math.cos(a)]);
    }
  }

  /** What goes in a room. Room-local: x across (-w/2..w/2), z from the back (-d/2) to the street side (d/2). */
  type RoomKind = 'shop' | 'cafe' | 'lobby' | 'store' | 'office' | 'flat';
  function furnish(room: Room, kind: RoomKind) {
    const { w, d, h, rand: r } = room;
    const tall = Math.min(2, h - 0.35);
    if (kind === 'shop') {
      // Shelving down both side walls, a counter at the back with a till, and a display table.
      const len = Math.min(d - 1.4, 4);
      for (const s of [-1, 1]) shelves(item(room, s * (w / 2 - 0.25), 0.1, -s * Math.PI / 2), r, len, 0.45, tall, wood, 4);
      const cw = Math.min(2.4, w * 0.4);
      const counter = item(room, w * 0.15, -d / 2 + 0.9);
      put(counter, box, darkWood, [cw, 0.95, 0.6], [0, 0.475, 0]);
      put(counter, box, paleWood, [cw + 0.1, 0.05, 0.7], [0, 0.975, 0]);
      put(counter, box, black, [0.35, 0.22, 0.3], [cw * 0.3, 1.11, 0]);
      put(counter, box, black, [0.3, 0.2, 0.04], [cw * 0.3, 1.3, -0.08], [-0.4, 0, 0]);
      const disp = item(room, -w * 0.1, d * 0.12);
      table(disp, 1.4, 0.9, 0.8, paleWood);
      for (let k = 0; k < 6; k++) put(disp, box, mat(pick(r, GOODS)), [0.2 + r() * 0.2, 0.08 + r() * 0.18, 0.2 + r() * 0.15], [-0.5 + (k % 3) * 0.5, 0.88, k < 3 ? -0.2 : 0.2]);
    } else if (kind === 'cafe') {
      // Small round tables with chairs, and a counter with a coffee machine at the back.
      const cols = Math.max(1, Math.floor((w - 1) / 2.2));
      for (let i = 0; i < cols; i++) for (const z of [d * 0.22, -d * 0.12]) {
        if (z < -d / 2 + 2) continue;
        const t = item(room, -w / 2 + 1.1 + ((w - 2.2) * (i + 0.5)) / cols, z);
        put(t, cyl, offWhite, [0.45, 0.04, 0.45], [0, 0.74, 0]);
        put(t, cyl, black, [0.04, 0.72, 0.04], [0, 0.36, 0]);
        put(t, cyl, black, [0.25, 0.03, 0.25], [0, 0.015, 0]);
        const seat = mat(pick(r, FABRIC));
        chair(t, -0.65, 0, Math.PI / 2, seat);
        chair(t, 0.65, 0, -Math.PI / 2, seat);
        if (r() < 0.6) put(t, cyl, offWhite, [0.05, 0.09, 0.05], [0.1, 0.81, 0.05]);
      }
      const counter = item(room, 0, -d / 2 + 0.7);
      const cw = Math.min(3, w * 0.6);
      put(counter, box, darkWood, [cw, 0.95, 0.6], [0, 0.475, 0]);
      put(counter, box, tile, [cw + 0.1, 0.05, 0.7], [0, 0.975, 0]);
      put(counter, box, metal, [0.5, 0.45, 0.4], [-cw * 0.3, 1.225, -0.05]);
      put(counter, box, black, [0.42, 0.1, 0.1], [-cw * 0.3, 1.2, 0.17]);
      for (let k = 0; k < 4; k++) put(counter, cyl, offWhite, [0.05, 0.1, 0.05], [cw * 0.1 + k * 0.14, 1.05, 0.1]);
      put(counter, box, black, [Math.min(1.6, cw * 0.6), 0.6, 0.04], [cw * 0.15, Math.min(h - 0.5, 2), -0.32]);
    } else if (kind === 'lobby') {
      // A reception desk, a row of waiting chairs and two plants.
      const desk = item(room, 0, -d / 2 + 1.3);
      const dw = Math.min(3, w * 0.45);
      put(desk, box, paleWood, [dw, 1.05, 0.5], [0, 0.525, 0.1]);
      put(desk, box, darkWood, [dw - 0.2, 0.75, 0.6], [0, 0.375, -0.35]);
      put(desk, box, black, [0.5, 0.32, 0.04], [dw * 0.25, 0.94, -0.3]);
      chair(desk, dw * 0.25, -0.95, 0, mat('#3a3a3a'));
      const row = item(room, w / 2 - 0.4, 0, -Math.PI / 2);
      const seat = mat(pick(r, FABRIC));
      for (let k = 0; k < 4; k++) chair(row, -1.05 + k * 0.7, 0, 0, seat);
      const plants = item(room, -w / 2 + 0.5, d / 2 - 0.6);
      plant(plants, 0, 0, 0.9);
    } else if (kind === 'store') {
      // Steel shelving along the back wall, and stacked crates and boxes.
      const n = Math.max(1, Math.floor((w - 1) / 2.2));
      for (let i = 0; i < n; i++) shelves(item(room, -w / 2 + 1.1 + ((w - 2.2) * (i + 0.5)) / n, -d / 2 + 0.3), r, 1.9, 0.5, tall, darkMetal, 4);
      const stack = item(room, w * 0.2, d * 0.1);
      for (let k = 0; k < 5; k++) {
        const s = 0.5 + r() * 0.2;
        put(stack, box, mat(pick(r, ['#8a6a44', '#7a5e3a', '#9a7a50'])), [s, s * 0.8, s], [(k % 2) * 0.65 - 0.3, s * 0.4 + (k > 2 ? 0.6 : 0), Math.floor(k / 2) * 0.5 - 0.3], [0, r() * 0.4, 0]);
      }
    } else if (kind === 'office') {
      // Desks with monitors and chairs, a filing cabinet, and a whiteboard on the back wall.
      const n = Math.max(1, Math.min(4, Math.floor((w - 1) / 1.9)));
      for (let i = 0; i < n; i++) {
        const desk = item(room, -w / 2 + 1 + ((w - 2) * (i + 0.5)) / n, 0.2);
        table(desk, 1.4, 0.7, 0.75, paleWood, metal);
        put(desk, box, black, [0.55, 0.34, 0.04], [0, 1.0, -0.15]);
        put(desk, box, black, [0.06, 0.2, 0.06], [0, 0.82, -0.18]);
        put(desk, box, mat('#3a3a3a'), [0.45, 0.02, 0.15], [0, 0.76, 0.1]);
        if (r() < 0.6) put(desk, box, offWhite, [0.22, 0.02, 0.3], [0.45, 0.76, 0.05], [0, r(), 0]);
        chair(desk, 0, 0.65, Math.PI, mat('#2e3238'));
      }
      const cab = item(room, w / 2 - 0.4, -d / 2 + 0.4);
      put(cab, box, mat('#6a6e70', 0.5, 0.5), [0.5, 1.3, 0.6], [0, 0.65, 0]);
      for (let k = 0; k < 4; k++) put(cab, box, darkMetal, [0.15, 0.03, 0.02], [0, 0.25 + k * 0.32, 0.31]);
      const board = item(room, -w * 0.15, -d / 2 + 0.05, 0, 0.1);
      put(board, box, offWhite, [Math.min(2, w * 0.35), 0.9, 0.04], [0, 1.45, 0]);
      put(board, box, metal, [Math.min(2, w * 0.35) + 0.08, 0.05, 0.08], [0, 0.98, 0.02]);
    } else {
      // A flat: a bed against the side wall, a wardrobe, a bedside table, and a sofa on a rug.
      const cover = mat(pick(r, FABRIC));
      const bed = item(room, -w / 2 + 1.05, -d / 2 + 1.2);
      put(bed, box, darkWood, [1.5, 0.3, 2.05], [0, 0.15, 0]);
      put(bed, box, offWhite, [1.4, 0.18, 1.95], [0, 0.39, 0]);
      put(bed, box, cover, [1.42, 0.06, 1.3], [0, 0.5, 0.3]);
      for (const s of [-1, 1]) put(bed, box, offWhite, [0.55, 0.12, 0.35], [s * 0.35, 0.54, -0.75]);
      put(bed, box, darkWood, [1.5, 0.9, 0.06], [0, 0.45, -1.03]);
      put(bed, box, wood, [0.45, 0.5, 0.4], [1.05, 0.25, -0.75]);
      const ward = item(room, w / 2 - 0.4, -d / 2 + 0.9, -Math.PI / 2);
      put(ward, box, wood, [1.2, tall, 0.6], [0, tall / 2, 0]);
      put(ward, box, darkWood, [0.02, tall - 0.1, 0.01], [0, tall / 2, 0.305]);
      for (const s of [-1, 1]) put(ward, box, metal, [0.03, 0.18, 0.03], [s * 0.08, tall * 0.55, 0.32]);
      if (d > 4) {
        const sofa = item(room, w * 0.1, d / 2 - 1.1, Math.PI);
        const fab = mat(pick(r, FABRIC));
        put(sofa, box, mat(pick(r, ['#6a5a48', '#4a5048', '#7a6a5a'])), [2.4, 0.01, 1.6], [0, 0.005, 0.9]);
        put(sofa, box, fab, [1.9, 0.42, 0.85], [0, 0.21, 0]);
        put(sofa, box, fab, [1.9, 0.45, 0.2], [0, 0.65, -0.33]);
        for (const s of [-1, 1]) put(sofa, box, fab, [0.18, 0.6, 0.85], [s * 0.95, 0.3, 0]);
        table(sofa, 0.9, 0.5, 0.42, wood, darkWood, 1.1);
      }
    }
  }

  /** Slabs, partitions, lights and furniture for a shop building of `rows` floors. */
  function interior(b: Building, p: Plan, index: number, rows: number, rowH: number, front: number, rand: () => number) {
    const ix = p.w / 2 - PANEL;
    const iz = p.d / 2 - PANEL;
    // The front room takes 60% of the depth.
    const vs = -p.d * 0.1;
    const street: RoomKind = (['shop', 'cafe', 'shop', 'cafe', 'lobby', 'shop'] as RoomKind[])[index % 6];
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const h = r === rows - 1 ? p.h - 0.26 - y : rowH - 0.22;
      // The floor (a slab upstairs, a tiled or boarded floor downstairs) and the ceiling lights: fixed.
      const floor = piece(b, [0, y, 0], 0.11, true);
      if (r > 0) put(floor, box, concrete, [ix * 2, 0.22, iz * 2], [0, -0.11, 0]);
      put(floor, box, r === 0 ? tile : mat(pick(rand, ['#7a5e42', '#6a5a4a', '#5a5048'])), [ix * 2, 0.04, iz * 2], [0, 0.02, 0]);
      for (const v of [(vs + iz) / 2, (vs - iz) / 2]) {
        for (const x of ix > 4 ? [-ix / 2, ix / 2] : [0]) put(floor, box, litGlass, [0.9, 0.05, 0.35], [x, h - 0.03, front * v]);
      }
      // The partition between front and back rooms, with a doorway off-centre.
      const wall = piece(b, [0, y + h / 2, front * vs], 0.08);
      const dx = ix * 0.45;
      const dw = 1;
      const dh = Math.min(2.05, h - 0.15);
      const left = ix + dx - dw / 2;
      const right = ix - dx - dw / 2;
      put(wall, box, plaster, [left, h, 0.12], [-ix + left / 2, 0, 0]);
      put(wall, box, plaster, [right, h, 0.12], [ix - right / 2, 0, 0]);
      put(wall, box, plaster, [dw, h - dh, 0.12], [dx, dh / 2, 0]);
      const base = { b, front, y, w: ix * 2, rand, h };
      furnish({ ...base, d: iz - vs, vc: (iz + vs) / 2 }, r === 0 ? street : r % 2 ? 'office' : 'flat');
      furnish({ ...base, d: vs + iz, vc: (vs - iz) / 2 }, r === 0 ? 'store' : r % 2 ? 'flat' : 'office');
    }
  }

  /** The boat shed: a concrete floor, a launch on its trailer, a workbench, drums, and gear on the walls. */
  function shedInterior(b: Building, p: Plan, front: number, rand: () => number) {
    const ix = p.w / 2 - PANEL;
    const iz = p.d / 2 - PANEL;
    const floor = piece(b, [0, 0, 0], 0.05, true);
    put(floor, box, concrete, [ix * 2, 0.06, iz * 2], [0, 0.03, 0]);
    for (const x of [-ix / 2, ix / 2]) put(floor, box, litGlass, [0.9, 0.05, 0.3], [x, p.h - 0.2, 0]);
    const room: Room = { b, front, y: 0, w: ix * 2, d: iz * 2, vc: 0, h: p.h, rand };
    // A small launch on a trailer, its bow to the door.
    const boat = item(room, -ix * 0.15, 0.2, 0, 0.6);
    for (const s of [-1, 1]) put(boat, box, darkMetal, [0.08, 0.08, 4.2], [s * 0.6, 0.35, 0]);
    for (const s of [-1, 1]) for (const z of [-0.6, 0.4]) put(boat, cyl, black, [0.3, 0.2, 0.3], [s * 0.75, 0.3, z], [0, 0, Math.PI / 2]);
    put(boat, box, mat('#c9c6bd', 0.5), [1.7, 0.7, 3.6], [0, 0.85, -0.1]);
    put(boat, box, mat('#c9c6bd', 0.5), [1.2, 0.7, 0.9], [0, 0.85, 1.9], [0, Math.PI / 4, 0]).scale.set(0.9, 0.7, 0.9);
    put(boat, box, mat('#2a3a44', 0.5), [1.72, 0.18, 3.62], [0, 0.6, -0.1]);
    put(boat, box, mat('#a6a39a', 0.6), [1.2, 0.8, 1.2], [0, 1.6, -0.6]);
    put(boat, box, glass, [1.22, 0.3, 1.0], [0, 1.75, -0.55]);
    // A workbench along the side wall, with a vice and tools.
    const bench = item(room, ix - 0.45, -iz * 0.3, -Math.PI / 2);
    table(bench, 2.2, 0.75, 0.9, paleWood, darkMetal);
    put(bench, box, darkMetal, [2.2, 0.03, 0.6], [0, 0.25, 0]);
    put(bench, box, mat('#3a5a7a', 0.5, 0.5), [0.2, 0.18, 0.25], [-0.8, 0.99, 0.1]);
    put(bench, box, mat('#8a2a24', 0.5, 0.5), [0.5, 0.25, 0.25], [0.5, 1.02, -0.1]);
    put(bench, box, wood, [1.8, 0.9, 0.03], [0, 1.6, -0.36]);
    for (let k = 0; k < 5; k++) put(bench, box, darkMetal, [0.04, 0.3 + rand() * 0.2, 0.03], [-0.7 + k * 0.35, 1.6, -0.33]);
    // Oil drums in a corner.
    const drums = item(room, -ix + 0.7, -iz + 0.7, 0, 0.45);
    for (let k = 0; k < 3; k++) put(drums, cyl, mat(pick(rand, ['#2f4a6a', '#7a2a24', '#4a5a34'])), [0.29, 0.88, 0.29], [(k % 2) * 0.62, 0.44, Math.floor(k / 2) * 0.62]);
    // Shelves of gear, and life rings on the wall.
    const gear = item(room, ix * 0.35, -iz + 0.3);
    shelves(gear, rand, 2, 0.5, 1.9, darkMetal, 4);
    const rings = item(room, -ix + 0.08, iz * 0.3, Math.PI / 2, 0.1);
    for (let k = 0; k < 2; k++) put(rings, ring, mat(k ? '#c9c6bd' : '#b8452a'), [1, 1, 1], [-0.5 + k * 0.9, 1.6, 0]);
  }

  const buildings: Building[] = PLANS.map((p, index) => {
    const rand = rng(31 + index * 17);
    const shed = p.kind === 'shed';
    const group = new THREE.Group();
    const hw = (p.w * SCALE) / 2;
    const hd = (p.d * SCALE) / 2;
    const base = Math.min(groundY(p.x - hw, p.z - hd), groundY(p.x + hw, p.z + hd), groundY(p.x, p.z));
    group.position.set(p.x, base, p.z);
    group.scale.setScalar(SCALE);
    scene.add(group);
    const b: Building = {
      group, minX: p.x - hw, maxX: p.x + hw, minZ: p.z - hd, maxZ: p.z + hd,
      height: p.h * SCALE, hp: p.hp, state: 'standing', chunks: [], intact: null, shake: 0, cool: 0,
    };
    // The street-facing side gets the door and shop windows (a shed's roller door faces the sea).
    const front = p.front ?? (p.z < TOWN.z ? 1 : -1);
    const rows = Math.max(2, Math.round(p.h / 2.3));
    const rowH = p.h / rows;
    const trim = mat(p.trim);
    // Each face in its own frame: x along the face (seen from outside), y up, z out of the wall.
    const faces: { len: number; n: [number, number]; off: number; rot: number }[] = [
      { len: p.w, n: [0, 1], off: p.d / 2, rot: 0 },
      { len: p.w, n: [0, -1], off: p.d / 2, rot: Math.PI },
      { len: p.d, n: [1, 0], off: p.w / 2, rot: Math.PI / 2 },
      { len: p.d, n: [-1, 0], off: p.w / 2, rot: -Math.PI / 2 },
    ];
    for (const face of faces) {
      const cols = Math.max(2, Math.round(face.len / 2.6));
      const cw = face.len / cols;
      const isFront = face.n[1] === front;
      const isBack = face.n[1] === -front;
      const isGable = face.n[0] !== 0;
      const doorCol = Math.floor(cols / 2);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Panel centre along the face (from its middle, in the face's own x) and up.
          const u = -face.len / 2 + cw * (c + 0.5);
          const v = rowH * (r + 0.5);
          const inset = face.off - PANEL / 2;
          // The face's x axis in building space is (cos rot, -sin rot), its outward normal n.
          const at: V3 = [face.n[0] * inset + Math.cos(face.rot) * u, v, face.n[1] * inset - Math.sin(face.rot) * u];
          const obj = piece(b, at, PANEL / 2);
          const f = new THREE.Group();
          f.rotation.y = face.rot;
          obj.add(f);
          const top = r === rows - 1;
          // Weathering: every panel a slightly different shade, darker low down where the rain splashes.
          const wall = shade(p.wall, (0.93 + rand() * 0.09) * (r === 0 ? 0.94 : 1));
          const z = PANEL / 2;
          if (shed) {
            // Corrugated metal: a sheet with ribs, on a concrete upstand, rust running down from the bottom.
            const isDoor = isFront && c === doorCol;
            const doorTop = Math.min(p.h - 0.5, 3.3);
            const lo = -rowH / 2;
            const doorHere = isDoor ? Math.max(0, Math.min(rowH, doorTop - r * rowH)) : 0;
            const dw = cw * 0.86;
            if (doorHere > 0) {
              // The roller door: horizontal slats between steel guides.
              put(f, box, mat(shade('#7a7d78', 0.95 + rand() * 0.05), 0.6, 0.3), [dw, doorHere, PANEL * 0.5], [0, lo + doorHere / 2, 0]);
              for (let y = lo + 0.12; y < lo + doorHere; y += 0.24) put(f, box, darkMetal, [dw, 0.04, 0.05], [0, y, z * 0.5 + 0.02]);
              for (const s of [-1, 1]) {
                put(f, box, mat(wall, 0.6, 0.3), [(cw - dw) / 2, rowH, PANEL], [s * (cw / 2 - (cw - dw) / 4), 0, 0]);
                put(f, box, darkMetal, [0.1, doorHere, 0.14], [s * (dw / 2 + 0.02), lo + doorHere / 2, z]);
              }
              if (doorHere < rowH) put(f, box, mat(wall, 0.6, 0.3), [dw, rowH - doorHere, PANEL], [0, lo + doorHere + (rowH - doorHere) / 2, 0]);
              // The roller drum's housing over the door.
              if (doorHere < rowH || top) put(f, box, darkMetal, [dw + 0.2, 0.42, 0.45], [0, lo + doorHere + 0.21, z + 0.1]);
            } else {
              put(f, box, mat(wall, 0.6, 0.3), [cw, rowH, PANEL], [0, 0, 0]);
            }
            if (!doorHere) {
              const n = Math.floor(cw / 0.32);
              // No ribs behind the gable window or the side door (they'd poke through).
              const gap = r === 0 && c === 0 ? (isGable ? 0.6 : isBack ? 0.6 : 0) : 0;
              for (let k = 0; k < n; k++) {
                const x = -cw / 2 + (cw / n) * (k + 0.5);
                if (Math.abs(x) < gap) continue;
                put(f, box, mat(shade(wall, 0.9), 0.6, 0.3), [0.08, rowH, 0.05], [x, 0, z + 0.025]);
                if (r === 0 && rand() < 0.35) put(f, box, mat(shade('#6b4a32', 0.9 + rand() * 0.2)), [0.085, 0.3 + rand() * 0.6, 0.055], [x, lo + 0.6, z + 0.026]);
              }
            }
            if (r === 0 && !doorHere) put(f, box, concrete, [cw, 0.4, PANEL + 0.1], [0, lo + 0.2, 0.02]);
            // A small window in each gable end, and a side door at the back.
            if (r === 0 && isGable && c === 0) windowAt(f, p, wall, 0, 0.15, 0.9, 0.7, false);
            if (r === 0 && isBack && c === 0) {
              put(f, box, door, [0.9, 1.9, 0.06], [0, lo + 0.4 + 0.95, z + 0.03]);
              put(f, box, trim, [1.1, 0.1, 0.1], [0, lo + 0.4 + 1.95, z + 0.05]);
              put(f, box, concrete, [1.2, 0.2, 0.6], [0, lo + 0.1, z + 0.3]);
            }
            // Gables: the end walls rise to the ridge, ribs and all.
            if (top && isGable) {
              const half = face.len / 2;
              const height = (x: number) => RISE * (1 - Math.abs(x) / half);
              const u0 = u - cw / 2;
              const u1 = u + cw / 2;
              const pts: [number, number][] = [[u0 - u, 0], [u1 - u, 0], [u1 - u, height(u1)]];
              if (u0 < 0 && u1 > 0) pts.push([-u, RISE]);
              pts.push([u0 - u, height(u0)]);
              put(f, prism(pts, PANEL), mat(wall, 0.6, 0.3), [1, 1, 1], [0, rowH / 2, 0]);
              const n = Math.floor(cw / 0.32);
              for (let k = 0; k < n; k++) {
                const x = -cw / 2 + (cw / n) * (k + 0.5);
                const hgt = height(u + x);
                if (hgt > 0.1) put(f, box, mat(shade(wall, 0.9), 0.6, 0.3), [0.08, hgt, 0.05], [x, rowH / 2 + hgt / 2, z + 0.025]);
              }
            }
            continue;
          }
          // A rendered shop: the wall panel, a stone plinth, a belt course between floors, and a
          // cornice and a parapet with coping at the top.
          put(f, box, mat(wall), [cw, rowH, PANEL], [0, 0, 0]);
          if (r === 0) put(f, box, stone, [cw, 0.45, 0.1], [0, -rowH / 2 + 0.225, z + 0.05]);
          if (!top) put(f, box, trim, [cw, 0.14, 0.12], [0, rowH / 2 - 0.07, z + 0.06]);
          else {
            put(f, box, mat(shade(wall, 0.97)), [cw, PARAPET, PANEL], [0, rowH / 2 + PARAPET / 2, 0]);
            put(f, box, trim, [cw, 0.12, PANEL + 0.22], [0, rowH / 2 + PARAPET + 0.06, 0.03]);
            put(f, box, trim, [cw, 0.24, 0.26], [0, rowH / 2 - 0.02, z + 0.13]);
            // Rain streaks down from the cornice.
            if (rand() < 0.5) put(f, box, mat(shade(wall, 0.8)), [0.25 + rand() * 0.5, rowH * 0.45, 0.01], [(rand() - 0.5) * cw * 0.7, rowH * 0.2, z + 0.005]);
          }
          // Corner pilasters.
          if (c === 0) put(f, box, trim, [0.32, rowH, 0.08], [-cw / 2 + 0.16, 0, z + 0.04]);
          if (c === cols - 1) put(f, box, trim, [0.32, rowH, 0.08], [cw / 2 - 0.16, 0, z + 0.04]);
          // A drainpipe down one back corner, with a hopper head under the parapet.
          if (isBack && c === 0) {
            put(f, cyl, darkMetal, [0.07, rowH + (top ? 0 : 0.01), 0.07], [-cw / 2 + 0.5, 0, z + 0.12]);
            if (top) put(f, box, darkMetal, [0.26, 0.24, 0.22], [-cw / 2 + 0.5, rowH / 2 - 0.12, z + 0.12]);
          }
          if (isFront && r === 0) {
            const lo = -rowH / 2;
            if (c === doorCol) {
              // The door: a panelled leaf in a frame, a fanlight over it, and a step.
              const dh = Math.min(2.1, rowH - (p.sign ? 0.65 : 0.35));
              put(f, box, door, [cw * 0.42, dh, 0.06], [0, lo + 0.12 + dh / 2, z + 0.02]);
              put(f, box, mat(shade('#3e3227', 1.25)), [cw * 0.3, dh * 0.3, 0.02], [0, lo + 0.12 + dh * 0.72, z + 0.06]);
              for (const s of [-1, 1]) put(f, box, trim, [0.12, dh + 0.14, 0.12], [s * (cw * 0.21 + 0.06), lo + 0.12 + dh / 2 + 0.07, z + 0.06]);
              put(f, box, trim, [cw * 0.42 + 0.36, 0.14, 0.14], [0, lo + 0.12 + dh + 0.07, z + 0.07]);
              if (rowH - dh > 0.9) put(f, box, glass, [cw * 0.38, 0.3, 0.04], [0, lo + dh + 0.42, z + 0.01]);
              put(f, box, concrete, [cw * 0.62, 0.16, 0.7], [0, lo + 0.08, z + 0.35]);
            } else {
              // A shop window over a kick plate, with a mullion and a sill.
              const gh = Math.min(1.6, rowH - 0.62 - (p.sign ? 0.75 : 0.45));
              const bottom = lo + 0.62;
              put(f, box, glass, [cw * 0.78, gh, 0.04], [0, bottom + gh / 2, z + 0.01]);
              for (const s of [-1, 1]) {
                put(f, box, trim, [0.12, gh + 0.24, 0.12], [s * (cw * 0.39 + 0.06), bottom + gh / 2, z + 0.06]);
                put(f, box, trim, [cw * 0.78 + 0.24, 0.12, 0.12], [0, bottom + gh / 2 + s * (gh / 2 + 0.06), z + 0.06]);
              }
              put(f, box, trim, [0.07, gh, 0.07], [0, bottom + gh / 2, z + 0.04]);
              put(f, box, trim, [cw * 0.78 + 0.3, 0.08, 0.26], [0, bottom - 0.12, z + 0.13]);
            }
            // The sign board and the awning run along the whole front, a stretch on each panel.
            if (p.sign) put(f, box, mat(p.sign), [cw, 0.5, 0.1], [0, rowH / 2 - 0.33, z + 0.06]);
            if (p.awning) awningAt(f, p.awning, cw, rowH / 2 - 0.1, Math.max(3, Math.round(cw / 0.5)));
          } else if (r > 0 || (c + r) % 2 === 0 || isFront) {
            // Upper floors have windows all round (some lit); the ground floor has a few at the sides and back.
            const gw = Math.min(cw * 0.48, 1.3);
            const gh = Math.min(rowH * 0.5, 1.4);
            windowAt(f, p, wall, 0, 0.05, gw, gh, r > 0 && rand() < 0.35);
          }
        }
      }
    }
    if (shed) {
      // Pitched roof of corrugated sheets (two per slope), with a ridge cap and gutters at the eaves.
      const over = 0.4;
      const run = p.d / 2 + over;
      const tilt = Math.atan2(RISE, p.d / 2);
      const len = run / Math.cos(tilt);
      const sheet = mat(p.roof, 0.6, 0.3);
      for (const side of [-1, 1]) for (const sx of [-1, 1]) {
        // Each sheet covers half the length, with a little overhang at the ends.
        const halfW = p.w / 2 + 0.3;
        // Halfway from the ridge (z 0, eaves height + RISE) down to the eave overhang (z ±run).
        const obj = piece(b, [(sx * halfW) / 2, p.h + RISE - (run / 2) * Math.tan(tilt) + 0.05, (side * run) / 2], 0.06);
        const f = new THREE.Group();
        f.rotation.x = side * tilt;
        obj.add(f);
        put(f, box, sheet, [halfW, 0.08, len], [0, 0, 0]);
        const n = Math.round(halfW / 0.34);
        for (let k = 0; k < n; k++) {
          const rust = rand() < 0.25;
          put(f, box, rust ? mat(shade('#7a4a2e', 0.9 + rand() * 0.2)) : mat(shade(p.roof, 0.88), 0.6, 0.3), [0.07, 0.06, len], [-halfW / 2 + (halfW / n) * (k + 0.5), 0.07, 0]);
        }
        put(f, box, darkMetal, [halfW, 0.14, 0.4], [0, 0.1, -side * (len / 2 - 0.18)]);
        put(f, box, darkMetal, [halfW, 0.14, 0.16], [0, -0.1, side * (len / 2 + 0.04)]);
      }
    } else {
      // Flat roof: four slabs inside the parapet, with what stands on them.
      const sw = p.w / 2 - PANEL;
      const sd = p.d / 2 - PANEL;
      const slabs: THREE.Object3D[] = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const obj = piece(b, [(sx * sw) / 2, p.h - 0.13, (sz * sd) / 2], 0.13);
        put(obj, box, mat(shade(p.roof, 0.95 + rand() * 0.1)), [sw, 0.26, sd], [0, 0, 0]);
        slabs.push(obj);
      }
      (p.top ?? []).forEach((kind, k) => {
        const s = slabs[k % slabs.length];
        const ox = (rand() - 0.5) * Math.max(0, sw - 2.4);
        const oz = (rand() - 0.5) * Math.max(0, sd - 2.4);
        const y = 0.13;
        if (kind === 'ac') {
          put(s, box, metal, [1.3, 0.8, 1], [ox, y + 0.4, oz]);
          put(s, cyl, darkMetal, [0.36, 0.04, 0.36], [ox, y + 0.82, oz]);
          put(s, box, darkMetal, [1.4, 0.08, 1.1], [ox, y + 0.04, oz]);
          put(s, cyl, darkMetal, [0.05, 1.2, 0.05], [ox + 0.55, y + 0.25, oz + 0.6], [Math.PI / 2, 0, 0]);
        } else if (kind === 'vent') {
          for (let i = 0; i < 2; i++) {
            put(s, cyl, metal, [0.1, 0.6, 0.1], [ox + i * 0.6, y + 0.3, oz]);
            put(s, cyl, darkMetal, [0.16, 0.08, 0.16], [ox + i * 0.6, y + 0.64, oz]);
          }
          put(s, box, concrete, [0.9, 0.35, 0.9], [ox - 0.7, y + 0.17, oz + 0.6]);
        } else {
          // A water tank on a steel stand.
          for (const lx of [-1, 1]) for (const lz of [-1, 1]) put(s, box, darkMetal, [0.1, 1.1, 0.1], [ox + lx * 0.55, y + 0.55, oz + lz * 0.55]);
          put(s, box, darkMetal, [1.3, 0.08, 1.3], [ox, y + 1.12, oz]);
          put(s, cyl, mat('#6a6e6a', 0.7, 0.3), [0.75, 1.3, 0.75], [ox, y + 1.81, oz]);
          put(s, cyl, darkMetal, [0.78, 0.08, 0.78], [ox, y + 2.5, oz]);
        }
      });
    }
    if (shed) shedInterior(b, p, front, rand);
    else interior(b, p, index, rows, rowH, front, rand);
    // Each piece becomes a mesh or two; then the whole building is drawn merged until it is first hit.
    const intact = new THREE.Group();
    for (const c of b.chunks) {
      bake(c.obj, [], owned);
      const copy = c.obj.clone();
      intact.add(copy);
      c.obj.visible = false;
    }
    bake(intact, [], owned);
    group.add(intact);
    b.intact = intact;
    return b;
  });

  // Street lamps along both pavements.
  const lampOn = keep(new THREE.MeshStandardMaterial({ color: '#fff1c8', emissive: '#ffd98a', emissiveIntensity: 2.2 }));
  const lampOff = mat('#3a3833', 0.5);
  const poleMat = mat('#2d2f31', 0.5, 0.6);
  const heads: THREE.Mesh[] = [];
  for (let k = -2; k <= 2; k++) for (const side of [-1, 1]) {
    const x = TOWN.x + k * 10 + (side > 0 ? 5 : 0);
    const z = TOWN.z + side * 4.1;
    const pole = new THREE.Mesh(box, poleMat);
    pole.scale.set(0.16, 5.5, 0.16);
    pole.position.set(x, groundY(x, z) + 2.75, z);
    pole.castShadow = true;
    scene.add(pole);
    const arm = new THREE.Mesh(box, poleMat);
    arm.scale.set(0.1, 0.1, 1.2);
    arm.position.set(x, groundY(x, z) + 5.45, z - side * 0.55);
    scene.add(arm);
    const head = new THREE.Mesh(box, lampOn);
    head.scale.set(0.45, 0.18, 0.7);
    head.position.set(x, groundY(x, z) + 5.35, z - side * 1.05);
    scene.add(head);
    heads.push(pole, arm, head);
  }
  // Poles and arms as one mesh, lamp heads as another (its material switches with the power).
  const lampGroup = new THREE.Group();
  for (const m of heads) {
    scene.remove(m);
    lampGroup.add(m);
  }
  scene.add(lampGroup);
  bake(lampGroup, [], owned);
  const headMesh = lampGroup.children.find((m) => (m as THREE.Mesh).material === lampOn) as THREE.Mesh;

  const tmp = new THREE.Vector3();

  function loosen(c: Chunk, b: Building, from: THREE.Vector3, power: number) {
    if (c.loose) return;
    c.loose = true;
    // Move it out of the building group into world space so it can fly free.
    c.obj.getWorldPosition(tmp);
    b.group.remove(c.obj);
    c.obj.position.copy(tmp);
    c.obj.scale.multiplyScalar(SCALE);
    scene.add(c.obj);
    const away = tmp.clone().sub(from).setY(0).normalize();
    c.vel.copy(away).multiplyScalar(power * (0.4 + Math.random() * 0.8)).setY(2 + Math.random() * power * 0.5);
    c.spin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  }

  function puff(at: THREE.Vector3, n: number, size: number) {
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(dustGeo, dustMat);
      mesh.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * size, Math.random() * size * 0.4, (Math.random() - 0.5) * size));
      mesh.scale.setScalar(0.5 + Math.random() * Math.min(size, 6) * 0.15);
      scene.add(mesh);
      dust.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3), life: 1.2 + Math.random() * 0.9 });
    }
  }

  return {
    buildings,
    collide(p, r, vel) {
      let hit: Building | null = null;
      for (const b of buildings) {
        if (p.y > b.group.position.y + b.height + 0.5) continue; // on (or over) the roof
        const cx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
        const cz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-4) {
          p.x = cx + (dx / d) * r;
          p.z = cz + (dz / d) * r;
          if (vel) {
            const into = -(vel.x * dx + vel.z * dz) / d;
            if (into > 0) vel.addScaledVector(tmp.set(dx / d, 0, dz / d), into);
          }
        } else {
          // Centre inside: push out the nearest way.
          const ex = Math.min(p.x - b.minX, b.maxX - p.x);
          const ez = Math.min(p.z - b.minZ, b.maxZ - p.z);
          if (ex < ez) p.x = p.x - b.minX < b.maxX - p.x ? b.minX - r : b.maxX + r;
          else p.z = p.z - b.minZ < b.maxZ - p.z ? b.minZ - r : b.maxZ + r;
        }
        hit = b;
      }
      return hit;
    },
    bite(b, jaw) {
      b.shake = Math.max(b.shake, 0.5);
      const torn = b.chunks.filter((c) => c.loose).length;
      const room = Math.floor(b.chunks.filter((c) => !c.fixed).length * MAX_TORN) - torn;
      // The point on the wall the jaws close on, for the dust.
      const at = tmp.set(THREE.MathUtils.clamp(jaw.x, b.minX, b.maxX), jaw.y, THREE.MathUtils.clamp(jaw.z, b.minZ, b.maxZ));
      puff(at, 2, 1.5);
      if (room <= 0) return 'solid';
      // First bite: swap the merged building for its separate pieces.
      if (b.intact) {
        b.group.remove(b.intact);
        b.intact = null;
        for (const c of b.chunks) c.obj.visible = true;
      }
      // Tear out the pieces nearest the jaws (measured in the building's own, unscaled space).
      const local = jaw.clone().sub(b.group.position).divideScalar(SCALE);
      const near = b.chunks
        .filter((c) => !c.loose && !c.fixed)
        .sort((a, c) => a.obj.position.distanceToSquared(local) - c.obj.position.distanceToSquared(local))
        .slice(0, Math.min(room, 2 + Math.floor(Math.random() * 2)));
      // Wrenched out towards the jaws (a negative push pulls) and dropped.
      for (const c of near) loosen(c, b, jaw, -2.5);
      b.hp--;
      if (b.hp === 0 && b.state === 'standing') {
        b.state = 'wrecked';
        return 'wrecked';
      }
      return 'bitten';
    },
    bump(b, from) {
      if (b.cool > 0) return false;
      b.cool = 0.7;
      b.shake = 1;
      puff(tmp.set(THREE.MathUtils.clamp(from.x, b.minX, b.maxX), b.group.position.y + 0.8, THREE.MathUtils.clamp(from.z, b.minZ, b.maxZ)), 3, 2);
      return true;
    },
    setLights(on) {
      headMesh.material = on ? lampOn : lampOff;
      litGlass.emissiveIntensity = on ? 0.9 : 0;
    },
    pavement(rand) {
      const row = rand() < 0.5 ? -1 : 1;
      const x = TOWN.x + (rand() - 0.5) * (TOWN.w - 4);
      const z = TOWN.z + row * (4.6 + rand() * 1.2);
      return new THREE.Vector3(x, groundY(x, z), z);
    },
    update(dt) {
      for (const b of buildings) {
        b.cool = Math.max(0, b.cool - dt);
        if (b.shake > 0) {
          b.shake = Math.max(0, b.shake - dt * 3);
          b.group.rotation.z = Math.sin(b.shake * 40) * 0.012 * b.shake;
        }
        for (const c of b.chunks) {
          if (!c.loose || c.resting) continue;
          const m = c.obj;
          c.vel.y -= GRAVITY * dt;
          m.position.addScaledVector(c.vel, dt);
          m.rotation.x += c.spin.x * dt;
          m.rotation.y += c.spin.y * dt;
          m.rotation.z += c.spin.z * dt;
          const floor = groundY(m.position.x, m.position.z) + c.half;
          if (m.position.y <= floor) {
            m.position.y = floor;
            if (Math.abs(c.vel.y) < 3) {
              // Settle flat-ish, as rubble.
              c.resting = true;
              m.rotation.x = Math.round(m.rotation.x / (Math.PI / 2)) * (Math.PI / 2) + (Math.random() - 0.5) * 0.3;
              m.rotation.z = Math.round(m.rotation.z / (Math.PI / 2)) * (Math.PI / 2) + (Math.random() - 0.5) * 0.3;
            } else {
              c.vel.y *= -0.25;
              c.vel.x *= 0.5;
              c.vel.z *= 0.5;
              c.spin.multiplyScalar(0.5);
            }
          }
        }
      }
      for (let i = dust.length - 1; i >= 0; i--) {
        const d = dust[i];
        d.life -= dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        d.vel.multiplyScalar(1 - dt * 0.8);
        // Billow out, then thin away at the end.
        d.mesh.scale.multiplyScalar(d.life > 0.5 ? 1 + dt * 0.35 : 1 - dt * 3);
        if (d.life <= 0) {
          scene.remove(d.mesh);
          dust.splice(i, 1);
        }
      }
    },
    dispose() {
      for (const b of buildings) {
        scene.remove(b.group);
        for (const c of b.chunks) scene.remove(c.obj);
      }
      dust.forEach((d) => scene.remove(d.mesh));
      scene.remove(lampGroup);
      owned.forEach((o) => o.dispose());
    },
  };
}
