import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Crown, House } from './maps/types';
import { rng, SCALE } from './world';

/**
 * The upper floors of the city's tall buildings. A map building taller than PODIUM is drawn in two parts:
 * its street level, PODIUM_H metres of shop front built and furnished like any shop (buildings.ts, which
 * can be bitten apart), and above that its upper floors, made here as plain boxes with a painted facade,
 * stepping in at its setbacks and finished with a crown. Nothing up there can be bitten (no dinosaur
 * reaches that high), so every tower in the city is merged into one mesh per facade, plus one for all the
 * roofs and crowns: a whole skyline in a handful of draw calls.
 *
 * Facades are canvases of BAYS × FLOORS window bays, painted in light neutral tones and tinted per
 * building with vertex colours (red or yellow brick, limestone, blue or bronze glass…), with some windows
 * lit from behind on the emissive map; the lights go out in the blackout.
 */

/** Buildings taller than this (in metres) get upper floors. */
export const PODIUM = 6.2;
/** The height of the shop-front storeys underneath them. */
export const PODIUM_H = 5.6;

const BAYS = 4;
const FLOORS = 4;
const CELL = 64;

interface Facade {
  /** Width of one window bay and height of one storey, in metres. */
  bay: number;
  floor: number;
  roughness: number;
  /** Colour of the parapets and plant rooms on its roof, before tinting. */
  trim: string;
  /** Paints one bay of one storey at (x, y) on the canvas, CELL square; returns its window panes, for lighting. */
  paint(g: CanvasRenderingContext2D, x: number, y: number, r: () => number): [number, number, number, number][];
}

const px = (g: CanvasRenderingContext2D, color: string | CanvasGradient, x: number, y: number, w: number, h: number) => {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
};
const grey = (l: number) => {
  const v = Math.round(Math.min(1, l) * 255);
  return `rgb(${v},${v},${v})`;
};

/**
 * The looks, by a map building's `facade`:
 * 0 glass curtain wall, 1 office bands (ribbon windows), 2 brick with punched windows, 3 art-deco stone
 * with piers, 4 flats with balconies, 5 concrete grid.
 */
export const FACADES: Facade[] = [
  {
    bay: 3, floor: 3.6, roughness: 0.25, trim: '#9aa0a6',
    paint(g, x, y, r) {
      // Glass from floor to ceiling, a slightly lighter spandrel at each floor, thin mullions.
      const l = 0.3 + r() * 0.06;
      const grad = g.createLinearGradient(x, y, x + CELL, y + CELL);
      grad.addColorStop(0, grey(l + 0.08));
      grad.addColorStop(1, grey(l - 0.04));
      px(g, grad, x, y, CELL, CELL);
      px(g, grey(0.42), x, y + CELL - 9, CELL, 9);
      px(g, grey(0.75), x, y, 2, CELL);
      px(g, grey(0.72), x + CELL / 2 - 1, y, 1, CELL - 9);
      px(g, grey(0.75), x, y + CELL - 10, CELL, 1);
      return [[x + 2, y, CELL - 2, CELL - 10]];
    },
  },
  {
    bay: 3.2, floor: 3.6, roughness: 0.6, trim: '#c8c4bc',
    paint(g, x, y, r) {
      // A concrete band at sill height, a strip of dark glass above it with mullions.
      px(g, grey(0.82 + r() * 0.04), x, y, CELL, CELL);
      px(g, grey(0.18 + r() * 0.05), x, y + 4, CELL, 36);
      for (let k = 0; k < 3; k++) px(g, grey(0.5), x + k * 21, y + 4, 2, 36);
      px(g, grey(0.68), x, y + 40, CELL, 2);
      return [[x + 2, y + 4, CELL - 2, 36]];
    },
  },
  {
    bay: 3, floor: 3.2, roughness: 0.85, trim: '#b8b0a8',
    paint(g, x, y, r) {
      // Brick courses in pale mortar, and two sash windows with white frames and stone sills.
      px(g, grey(0.92), x, y, CELL, CELL);
      for (let row = 0; row < CELL; row += 4) {
        const shift = (row / 4) % 2 ? 4 : 0;
        for (let col = -shift; col < CELL; col += 8) {
          const a = Math.max(0, col);
          const b = Math.min(CELL, col + 7);
          if (b > a) px(g, grey(0.72 + r() * 0.12), x + a, y + row, b - a, 3);
        }
      }
      const panes: [number, number, number, number][] = [];
      for (const wx of [10, 38]) {
        px(g, grey(0.95), x + wx - 2, y + 12, 20, 34);
        px(g, grey(0.15 + r() * 0.06), x + wx, y + 14, 16, 30);
        px(g, grey(0.95), x + wx, y + 28, 16, 2);
        px(g, grey(0.88), x + wx - 3, y + 46, 22, 3);
        panes.push([x + wx, y + 14, 16, 30]);
      }
      return panes;
    },
  },
  {
    bay: 2.6, floor: 3.6, roughness: 0.75, trim: '#d8d0c0',
    paint(g, x, y, r) {
      // Limestone, with a pier up each side running the whole height, a tall window between, and a carved spandrel under it.
      px(g, grey(0.86 + r() * 0.04), x, y, CELL, CELL);
      px(g, grey(0.96), x, y, 10, CELL);
      px(g, grey(0.7), x + 10, y, 2, CELL);
      px(g, grey(0.16 + r() * 0.05), x + 18, y + 4, 40, 44);
      px(g, grey(0.6), x + 37, y + 4, 2, 44);
      px(g, grey(0.66), x + 18, y + 50, 40, 12);
      for (let k = 0; k < 4; k++) px(g, grey(0.78), x + 21 + k * 10, y + 53, 5, 6);
      return [[x + 18, y + 4, 40, 44]];
    },
  },
  {
    bay: 3.6, floor: 3, roughness: 0.7, trim: '#e0dcd4',
    paint(g, x, y, r) {
      // Rendered wall, a sliding door behind a balcony: its slab, glass or rail front, and a divider.
      px(g, grey(0.9 + r() * 0.05), x, y, CELL, CELL);
      px(g, grey(0.2 + r() * 0.06), x + 8, y + 8, 46, 42);
      px(g, grey(0.55), x + 30, y + 8, 2, 42);
      px(g, grey(0.98), x, y + 50, CELL, 6);
      const glassy = r() < 0.5;
      px(g, glassy ? grey(0.55) : grey(0.3), x, y + 36, CELL, 14);
      if (!glassy) for (let k = 2; k < CELL; k += 6) px(g, grey(0.9), x + k, y + 36, 1, 14);
      px(g, grey(0.98), x + CELL - 3, y + 6, 3, 50);
      return [[x + 8, y + 8, 46, 28]];
    },
  },
  {
    bay: 3, floor: 3.3, roughness: 0.9, trim: '#a8a49c',
    paint(g, x, y, r) {
      // Board-marked concrete, a deep square window with its reveal in shadow.
      px(g, grey(0.74 + r() * 0.05), x, y, CELL, CELL);
      for (let k = 0; k < CELL; k += 8) px(g, grey(0.7), x, y + k, CELL, 1);
      px(g, grey(0.4), x + 12, y + 10, 40, 40);
      px(g, grey(0.13 + r() * 0.05), x + 18, y + 16, 34, 34);
      return [[x + 18, y + 16, 34, 34]];
    },
  },
];

/** One facade's texture and its lit windows. */
function facadeTextures(f: Facade, seed: number) {
  const r = rng(seed);
  const make = () => {
    const c = document.createElement('canvas');
    c.width = BAYS * CELL;
    c.height = FLOORS * CELL;
    return [c, c.getContext('2d')!] as const;
  };
  const [cc, g] = make();
  const [ec, e] = make();
  e.fillStyle = '#000';
  e.fillRect(0, 0, ec.width, ec.height);
  for (let j = 0; j < FLOORS; j++) for (let i = 0; i < BAYS; i++) {
    const panes = f.paint(g, i * CELL, j * CELL, r);
    for (const [x, y, w, h] of panes) {
      if (r() > 0.27) continue;
      // A lit room: warm (now and then the cold light of an office), sometimes half hidden by a blind.
      // A long ribbon window is lit only along one room's stretch of it.
      const lw = w > 40 ? w * (0.3 + r() * 0.4) : w;
      const lx = x + r() * (w - lw);
      const blind = r() < 0.4 ? h * (0.3 + r() * 0.4) : 0;
      e.fillStyle = r() < 0.2 ? '#9fb8d8' : '#e8a050';
      e.globalAlpha = 0.45 + r() * 0.4;
      e.fillRect(lx, y + blind, lw, h - blind);
      e.globalAlpha = 1;
    }
  }
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(ec);
  emissive.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  return { map, emissive };
}

export interface Towers {
  /** Lit windows and the masts' beacons on or off (they go out in the blackout). */
  setLights(on: boolean): void;
  dispose(): void;
}

/** The height a tall building's upper floors actually reach (whole storeys of its facade), in metres. */
export function towerTop(b: House) {
  const f = FACADES[facadeOf(b)];
  return PODIUM_H + Math.max(1, Math.round((b.h - PODIUM_H) / f.floor)) * f.floor;
}
const facadeOf = (b: House) => ((Math.round(b.facade ?? 1) % FACADES.length) + FACADES.length) % FACADES.length;

/** How the height splits between the tiers, bottom to top, for each number of setbacks. */
const SPLITS = [[1], [0.68, 0.32], [0.52, 0.28, 0.2], [0.44, 0.24, 0.18, 0.14]];

/** Builds the upper floors of every tall building in `list`, each standing on the ground at `y` (world units). */
export function buildTowers(scene: THREE.Scene, list: { b: House; y: number }[]): Towers {
  const owned: { dispose(): void }[] = [];
  const parts = FACADES.map(() => [] as THREE.BufferGeometry[]);
  const roofs: THREE.BufferGeometry[] = [];
  const beacons: THREE.BufferGeometry[] = [];
  const col = new THREE.Color();

  /** Gives a geometry a flat vertex colour and adds it to `into`. */
  function add(into: THREE.BufferGeometry[], geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, x: number, y: number, z: number, rotY = 0) {
    if (rotY) geo.rotateY(rotY);
    geo.translate(x, y, z);
    col.set(color);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    into.push(geo.index ? geo.toNonIndexed() : geo);
    if (geo.index) geo.dispose();
  }
  /** A box `w` × `h` × `d` (world units) standing on y, centred on (x, z). */
  const block = (into: THREE.BufferGeometry[], color: THREE.ColorRepresentation, x: number, y: number, z: number, w: number, h: number, d: number) =>
    add(into, new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z);

  /** The four walls of one tier: (x0..x1, z0..z1) from y0 to y1 (world units), its facade from storey `v0` up. */
  function walls(f: number, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, v0: number, ou: number, ov: number, tint: string) {
    const F = FACADES[f];
    const uW = BAYS * F.bay * SCALE;
    const vH = FLOORS * F.floor * SCALE;
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    // Each face anticlockwise seen from outside: from corner a to corner b along the ground.
    const faces: [number, number, number, number, number, number][] = [
      [x0, z1, x1, z1, 0, 1],
      [x1, z1, x1, z0, 1, 0],
      [x1, z0, x0, z0, 0, -1],
      [x0, z0, x0, z1, -1, 0],
    ];
    for (const [ax, az, bx, bz, nx, nz] of faces) {
      const len = Math.hypot(bx - ax, bz - az);
      // Start each face on a whole bay, so the windows meet the corners the same way all round.
      const u0 = ou;
      const u1 = ou + len / uW;
      const va = ov + v0 / FLOORS;
      const vb = va + (y1 - y0) / vH;
      const q = [[ax, y0, az, u0, va], [bx, y0, bz, u1, va], [bx, y1, bz, u1, vb], [ax, y1, az, u0, vb]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [x, y, z, u, v] = q[k];
        pos.push(x, y, z);
        nor.push(nx, 0, nz);
        uv.push(u, v);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    add(parts[f], geo, tint, 0, 0, 0);
  }

  /** A flat roof on a tier: the slab, and a parapet round its edge. */
  function roof(x0: number, x1: number, z0: number, z1: number, y: number, trim: string) {
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    block(roofs, '#3a3936', cx, y, cz, w - 0.1, 0.2, d - 0.1);
    const t = 0.35;
    const h = 1.3;
    block(roofs, trim, cx, y, z1 - t / 2, w, h, t);
    block(roofs, trim, cx, y, z0 + t / 2, w, h, t);
    block(roofs, trim, x1 - t / 2, y, cz, t, h, d - t * 2);
    block(roofs, trim, x0 + t / 2, y, cz, t, h, d - t * 2);
  }

  /** What stands on the top tier. */
  function crown(kind: Crown, x0: number, x1: number, z0: number, z1: number, y: number, tint: string, trim: string, r: () => number) {
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const m = Math.min(w, d);
    const plant = (s: number) => {
      // A plant room, and air-conditioning units beside it.
      const pw = m * s;
      block(roofs, trim, cx + (r() - 0.5) * (w - pw) * 0.5, y, cz + (r() - 0.5) * (d - pw) * 0.5, pw, 4.2, pw * 0.8);
      for (let k = 0; k < 3; k++) block(roofs, '#7d807e', x0 + 2 + r() * (w - 4), y, z0 + 2 + r() * (d - 4), 1.8, 1.2, 1.4);
    };
    if (kind === 'flat') plant(0.4);
    else if (kind === 'tank') {
      // A timber water tank with a conical cap, up on a steel stand.
      plant(0.3);
      const tx = x0 + w * 0.7;
      const tz = z0 + d * 0.3;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(roofs, '#2f3231', tx + sx * 1.6, y, tz + sz * 1.6, 0.25, 3.5, 0.25);
      block(roofs, '#2f3231', tx, y + 3.4, tz, 3.8, 0.25, 3.8);
      add(roofs, new THREE.CylinderGeometry(2.1, 2.1, 4.2, 12), '#6a4e36', tx, y + 3.65 + 2.1, tz);
      add(roofs, new THREE.ConeGeometry(2.3, 1.4, 12), '#4a3a2c', tx, y + 3.65 + 4.2 + 0.7, tz);
    } else if (kind === 'mast') {
      // A plant room with a radio mast on it, guyed, with a red beacon at the top.
      plant(0.45);
      const mh = 14 + r() * 12;
      add(roofs, new THREE.CylinderGeometry(0.18, 0.4, mh, 6), '#8a8e8c', cx, y + 4.2 + mh / 2, cz);
      for (let k = 0; k < 3; k++) add(roofs, new THREE.CylinderGeometry(0.5, 0.5, 0.15, 8), '#8a8e8c', cx, y + 4.2 + mh * (0.3 + k * 0.25), cz);
      add(beacons, new THREE.SphereGeometry(0.45, 8, 6), '#ff2a14', cx, y + 4.2 + mh + 0.3, cz);
    } else if (kind === 'spire') {
      // Stepped tiers narrowing to a tall pointed spire, in the building's own stone or metal.
      let s = 0.62;
      let yy = y;
      for (let k = 0; k < 3; k++) {
        const hh = 3.5 - k * 0.6;
        block(roofs, k % 2 ? trim : tint, cx, yy, cz, w * s, hh, d * s);
        yy += hh;
        s *= 0.68;
      }
      const sh = 10 + m * 0.45;
      add(roofs, new THREE.ConeGeometry(m * s * 0.55, sh, 4), tint, cx, yy + sh / 2, cz, Math.PI / 4);
      add(beacons, new THREE.SphereGeometry(0.3, 6, 5), '#ff2a14', cx, yy + sh, cz);
    } else if (kind === 'helipad') {
      // A raised deck with a yellow ring and an H.
      const pw = m * 0.8;
      block(roofs, '#4a4c4c', cx, y, cz, pw, 1.4, pw);
      add(roofs, new THREE.CylinderGeometry(pw * 0.42, pw * 0.42, 0.06, 32), '#c9a23a', cx, y + 1.43, cz);
      add(roofs, new THREE.CylinderGeometry(pw * 0.38, pw * 0.38, 0.08, 32), '#4a4c4c', cx, y + 1.44, cz);
      for (const sx of [-1, 1]) block(roofs, '#d8d6cf', cx + sx * pw * 0.12, y + 1.42, cz, pw * 0.05, 0.1, pw * 0.36);
      block(roofs, '#d8d6cf', cx, y + 1.42, cz, pw * 0.24, 0.1, pw * 0.05);
    } else {
      // A glass pyramid over the top floor.
      const ph = m * 0.55;
      add(roofs, new THREE.ConeGeometry((m / 2) * Math.SQRT2 * 0.92, ph, 4), '#6f8796', cx, y + ph / 2, cz, Math.PI / 4);
    }
  }

  list.forEach(({ b, y: ground }, index) => {
    const r = rng(101 + index * 37);
    const f = facadeOf(b);
    const F = FACADES[f];
    const tint = b.tint ?? '#d8d4cc';
    const trim = '#' + new THREE.Color(F.trim).multiply(new THREE.Color(tint)).multiplyScalar(1.1).getHexString();
    const top = towerTop(b);
    const storeys = Math.round((top - PODIUM_H) / F.floor);
    const tiers = SPLITS[Math.max(0, Math.min(3, Math.round(b.setbacks ?? 0)))];
    // Set a little in from the shop front's walls, so its parapet shows as a ledge.
    let hw = (b.w / 2 - 0.25) * SCALE;
    let hd = (b.d / 2 - 0.25) * SCALE;
    const step = Math.min(b.w, b.d) * 0.11 * SCALE;
    // A random start in the facade's pattern, so neighbours don't light the same windows.
    const ou = Math.floor(r() * BAYS) / BAYS;
    const ov = Math.floor(r() * FLOORS) / FLOORS;
    let floor = 0;
    let y = ground + PODIUM_H * SCALE;
    tiers.forEach((share, k) => {
      const last = k === tiers.length - 1;
      const n = last ? storeys - floor : Math.max(1, Math.round(storeys * share));
      if (n <= 0) return;
      const y1 = y + n * F.floor * SCALE;
      walls(f, b.x - hw, b.x + hw, b.z - hd, b.z + hd, y, y1, floor, ou, ov, tint);
      roof(b.x - hw, b.x + hw, b.z - hd, b.z + hd, y1, trim);
      if (last) crown(b.crown ?? 'flat', b.x - hw, b.x + hw, b.z - hd, b.z + hd, y1 + 0.2, tint, trim, r);
      floor += n;
      y = y1;
      hw = Math.max(hw * 0.5, hw - step);
      hd = Math.max(hd * 0.5, hd - step);
    });
  });

  const group = new THREE.Group();
  const mats: THREE.MeshStandardMaterial[] = [];
  parts.forEach((list, f) => {
    if (!list.length) return;
    const tex = facadeTextures(FACADES[f], 7 + f * 13);
    owned.push(tex.map, tex.emissive);
    const m = new THREE.MeshStandardMaterial({
      map: tex.map, emissiveMap: tex.emissive, emissive: '#ffffff', emissiveIntensity: 0.7, vertexColors: true, roughness: FACADES[f].roughness, metalness: f === 0 ? 0.25 : 0,
    });
    m.userData.dynamic = true;
    mats.push(m);
    owned.push(m);
    const geo = mergeGeometries(list)!;
    list.forEach((g) => g.dispose());
    owned.push(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const beaconMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: '#ff2a14', emissiveIntensity: 1.6 });
  owned.push(roofMat, beaconMat);
  for (const [list, m] of [[roofs, roofMat], [beacons, beaconMat]] as const) {
    if (!list.length) continue;
    const geo = mergeGeometries(list as THREE.BufferGeometry[])!;
    list.forEach((g) => g.dispose());
    owned.push(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = m === roofMat;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  scene.add(group);

  return {
    setLights(on) {
      for (const m of mats) m.emissiveIntensity = on ? 0.7 : 0;
      beaconMat.emissiveIntensity = on ? 1.6 : 0;
    },
    dispose() {
      scene.remove(group);
      owned.forEach((o) => o.dispose());
    },
  };
}
