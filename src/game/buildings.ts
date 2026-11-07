import * as THREE from 'three';
import { DOCKS, groundY, rng, TOWN } from './world';
import { bake } from './merge';

/**
 * Main Street's buildings (and the boat shed at the docks), each made of pre-broken pieces: wall
 * panels with everything fixed to them (plinth, trim, window frames and sills, signs, awnings,
 * drainpipes, gables) and roof slabs with what stands on them (air-conditioning units, vents, a water
 * tank). A charging dinosaur knocks pieces loose; enough hits and the whole building comes down into
 * rubble, in a cloud of dust. Rubble doesn't block anything.
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
}

export interface Building {
  group: THREE.Group;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  hp: number;
  state: 'standing' | 'rubble';
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
  /** A hit from `from` (the dinosaur). Knocks panels loose; true if this brought the building down. */
  hit(b: Building, from: THREE.Vector3): boolean;
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

/** Two rows of buildings facing each other across the road, and the boat shed at the docks. */
const PLANS: Plan[] = [
  { x: -92, z: 70.5, w: 9, d: 7, h: 4.6, wall: '#a49c8c', roof: '#3a3734', trim: '#d2cbbd', awning: '#6b2f24', hp: 3, top: ['ac', 'vent'] },
  { x: -79, z: 70, w: 11, d: 8, h: 6.8, wall: '#8f8a80', roof: '#2f2d2b', trim: '#c4beb2', sign: '#5a2a26', hp: 4, top: ['tank', 'ac', 'vent'] },
  { x: -65, z: 70.5, w: 9, d: 7, h: 4.4, wall: '#b3a892', roof: '#3d3a35', trim: '#e0d7c4', awning: '#2f4a5a', hp: 3, top: ['ac'] },
  { x: -90, z: 89.5, w: 10, d: 7, h: 5.2, wall: '#9a9488', roof: '#33302d', trim: '#cfc8ba', awning: '#4a5a2f', hp: 3, top: ['vent', 'ac'] },
  { x: -73, z: 90, w: 14, d: 8, h: 7.4, wall: '#a39f95', roof: '#2c2a28', trim: '#d6d0c4', sign: '#6a5a2a', hp: 5, top: ['ac', 'ac', 'tank', 'vent'] },
  { x: -58, z: 89.5, w: 8, d: 6, h: 4.2, wall: '#ab9f8a', roof: '#3a3632', trim: '#ddd3bf', awning: '#7a5a2a', hp: 3, top: ['vent'] },
  // The boat shed on the docks' landing, its roller door facing the sea.
  { x: DOCKS.x - 10, z: DOCKS.z - 1, w: 8, d: 6, h: 4, wall: '#66726a', roof: '#6a5242', trim: '#4a524c', hp: 3, front: 1, kind: 'shed' },
];

const GRAVITY = 30;
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
  const glass = mat('#1e2a30', 0.1, 0.5);
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
  function piece(b: Building, at: V3, half: number) {
    const obj = new THREE.Group();
    obj.position.set(...at);
    b.group.add(obj);
    b.chunks.push({ obj, vel: new THREE.Vector3(), spin: new THREE.Vector3(), loose: false, resting: false, half });
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

  const buildings: Building[] = PLANS.map((p, index) => {
    const rand = rng(31 + index * 17);
    const shed = p.kind === 'shed';
    const group = new THREE.Group();
    const base = Math.min(groundY(p.x - p.w / 2, p.z - p.d / 2), groundY(p.x + p.w / 2, p.z + p.d / 2), groundY(p.x, p.z));
    group.position.set(p.x, base, p.z);
    scene.add(group);
    const b: Building = {
      group, minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2,
      height: p.h, hp: p.hp, state: 'standing', chunks: [], intact: null, shake: 0, cool: 0,
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
        if (b.state !== 'standing') continue;
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
    hit(b, from) {
      if (b.state !== 'standing' || b.cool > 0) return false;
      // First hit: swap the merged building for its separate panels.
      if (b.intact) {
        b.group.remove(b.intact);
        b.intact = null;
        for (const c of b.chunks) c.obj.visible = true;
      }
      b.cool = 0.7;
      b.hp--;
      b.shake = 1;
      // Knock loose the panels nearest the impact.
      const local = from.clone().sub(b.group.position);
      const near = b.chunks
        .filter((c) => !c.loose)
        .sort((a, c) => a.obj.position.distanceToSquared(local) - c.obj.position.distanceToSquared(local))
        .slice(0, 3 + Math.floor(Math.random() * 3));
      for (const c of near) loosen(c, b, from, 7);
      puff(tmp.set(THREE.MathUtils.clamp(from.x, b.minX, b.maxX), b.group.position.y + 0.8, THREE.MathUtils.clamp(from.z, b.minZ, b.maxZ)), 3, 2);
      if (b.hp > 0) return false;
      // Collapse: everything comes down, roof first, walls spilling outwards.
      b.state = 'rubble';
      for (const c of [...b.chunks]) loosen(c, b, from, 3.5);
      puff(tmp.set((b.minX + b.maxX) / 2, b.group.position.y + 1, (b.minZ + b.maxZ) / 2), 10, Math.max(b.maxX - b.minX, b.maxZ - b.minZ));
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
