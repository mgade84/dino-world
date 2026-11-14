import * as THREE from 'three';
import type { Pile } from './maps/types';
import { floorY } from './world';

/**
 * Shipping containers (MapDef.containers): stacks of steel boxes on the quay and on a ship's deck, every one
 * an instance of one InstancedMesh (a corrugated-steel texture, tinted per box). They are solid blocks: each
 * has a rectangular footprint, and a box only ever rests on the ground or on whatever is under its footprint,
 * stops against any box beside it when it falls or is shoved, and never passes into another.
 *
 * A big dinosaur walking into a stack shoves the whole stack along, slowly; shove it off the edge of the deck
 * or into the hold and down it goes. Biting a box crumples it (it is crushed a little lower, bulges, is knocked
 * askew and darkens, and bits of steel fly off it), and brings the top of its stack tumbling down; a box on its
 * own is rolled over onto its side, where there is room. Charging into a stack shakes its top box loose.
 * Anything else just bumps into them, as into a wall.
 */

/** A box's size in world units: width (across), height and length (along its heading). */
export const BOX = { w: 3.7, h: 3.9, l: 9 };
const GRAVITY = 30;
/** How fast the biggest pushers move a stack (units a second, times their shove power). */
const PUSH = 2.6;
/** How much a box is crushed for each dent, and the most it can be. */
const CRUSH = 0.06;
const MAX_DENTS = 4;
const FRAGMENTS = 64;

export interface Box {
  /** The middle of its footprint, its underside, and which way its length points (radians round from +z). */
  x: number;
  z: number;
  y: number;
  heading: number;
  /** Rolled about its length: 0 standing, ±π/2 lying on a side. `flat` once it lies on its side. */
  roll: number;
  flat: boolean;
  /** What it rests on (null: the ground or the deck). */
  on: Box | null;
  state: 'rest' | 'fall' | 'tip';
  /** Falling: its velocity, and the roll it is turning towards (a box knocked off lands on its side). */
  vx: number;
  vy: number;
  vz: number;
  rollTo: number;
  /** Tipping over about its bottom edge: the edge's position, how far over (0..π/2), how fast, and which way. */
  pivot: THREE.Vector3;
  tip: number;
  spin: number;
  side: number;
  /** Knocked about; each dent crushes it a little, and it leans a little askew. */
  wrecked: boolean;
  dent: number;
  lean: number;
  color: THREE.Color;
  /** Seconds before a charge can shake it again. */
  cool: number;
}

/** What happened this frame, for the game's sounds and shakes. */
export interface BoxEvent { kind: 'land' | 'splash'; x: number; z: number; hard: number }

export interface Containers {
  boxes: Box[];
  /**
   * Bumps a body `r` across, its feet at p.y and moving at `vel`, against the boxes at its level: pushes it back
   * out, or, with `power` (a big dinosaur), shoves the stack it walks into. Returns how far it shoved one (0: none).
   */
  contact(p: THREE.Vector3, r: number, vel: THREE.Vector3, dt: number, power: number): number;
  /** Keeps someone on foot out of the boxes. */
  block(p: THREE.Vector3, r: number): void;
  /** The box a dinosaur at p facing `facing` could bite, within `reach`, and the point it would bite. */
  biteable(p: THREE.Vector3, facing: THREE.Vector3, reach: number): { box: Box; at: THREE.Vector3 } | null;
  /** A bite: crumples the box and brings the top of its stack down (or rolls a lone box over). 'wrecked' if that wrecked one. */
  bite(box: Box, from: THREE.Vector3): 'wrecked' | 'dented';
  /** A charge into a stack: its top box may come loose. True if one did. */
  charge(box: Box, from: THREE.Vector3): boolean;
  update(dt: number, events: BoxEvent[]): void;
  dispose(): void;
}

const COLOURS = ['#8a2a22', '#2a4a6a', '#3a5a3a', '#b8862a', '#6a6e70', '#2a6a6a', '#7a4a2a', '#c8c4b8', '#a0522d', '#3b4f7a'];

/** Corrugated steel: ribs, a frame round the edge, rust streaks; light greys, tinted per box. */
function steelTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8c8c8';
  g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 8) {
    g.fillStyle = '#e8e8e8';
    g.fillRect(x, 0, 3, 128);
    g.fillStyle = '#9a9a9a';
    g.fillRect(x + 5, 0, 2, 128);
  }
  g.strokeStyle = '#7a7a7a';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 122);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = 'rgba(110,70,40,0.25)';
    g.fillRect(Math.random() * 120, 4, 2 + Math.random() * 3, 20 + Math.random() * 60);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A rectangle on the ground: centre, unit axes along (ux, uz) and across (uz, -ux), and half its length and width. */
interface Rect { x: number; z: number; ux: number; uz: number; hl: number; hw: number }

/** Do two rectangles overlap (by more than `margin`)? Separating axes: each one's two edges. */
function overlap(a: Rect, b: Rect, margin = 0.05) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [nx, nz] of [[a.ux, a.uz], [a.uz, -a.ux], [b.ux, b.uz], [b.uz, -b.ux]]) {
    const d = Math.abs(dx * nx + dz * nz);
    const ra = a.hl * Math.abs(a.ux * nx + a.uz * nz) + a.hw * Math.abs(a.uz * nx - a.ux * nz);
    const rb = b.hl * Math.abs(b.ux * nx + b.uz * nz) + b.hw * Math.abs(b.uz * nx - b.ux * nz);
    if (d > ra + rb - margin) return false;
  }
  return true;
}

export function createContainers(scene: THREE.Scene, piles: Pile[]): Containers {
  const boxes: Box[] = [];
  /** How much of its height a box keeps after its dents. */
  const squash = (b: Box) => 1 - CRUSH * Math.min(b.dent, MAX_DENTS);
  /** How tall it stands (lying on its side, it is as tall as it was wide), crushed by its dents. */
  const height = (b: Box) => (b.flat ? BOX.w : BOX.h) * squash(b);
  const top = (b: Box) => b.y + height(b);
  /** Its footprint, optionally moved, turned or laid on its side. */
  const rect = (b: Box, x = b.x, z = b.z, heading = b.heading, flat = b.flat): Rect => ({
    x, z, ux: Math.sin(heading), uz: Math.cos(heading), hl: BOX.l / 2, hw: (flat ? BOX.h : BOX.w) / 2,
  });
  /** Do two boxes' heights overlap, with `a`'s underside at `ay`? */
  const besides = (a: Box, ay: number, o: Box) => ay < top(o) - 0.15 && ay + height(a) > o.y + 0.15;

  piles.forEach((pile, k) => {
    let below: Box | null = null;
    for (let i = 0; i < Math.max(1, Math.round(pile.n)); i++) {
      const box: Box = {
        x: pile.x, z: pile.z, y: below ? top(below) : floorY(pile.x, pile.z), heading: (pile.a * Math.PI) / 180,
        roll: 0, flat: false, on: below, state: 'rest', vx: 0, vy: 0, vz: 0, rollTo: 0,
        pivot: new THREE.Vector3(), tip: 0, spin: 0, side: 1, wrecked: false, dent: 0, lean: 0,
        color: new THREE.Color(COLOURS[(k * 7 + i * 3) % COLOURS.length]), cool: 0,
      };
      boxes.push(box);
      below = box;
    }
  });

  const tex = steelTexture();
  const geo = new THREE.BoxGeometry(BOX.w, BOX.h, BOX.l);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.3 });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, boxes.length));
  mesh.count = boxes.length;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Bits of torn steel, flung off a bitten box: a pool of small plates, recycled oldest first.
  const fragGeo = new THREE.BoxGeometry(0.7, 0.08, 0.55);
  const fragMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.4 });
  const frags = new THREE.InstancedMesh(fragGeo, fragMat, FRAGMENTS);
  frags.castShadow = true;
  frags.frustumCulled = false;
  scene.add(frags);
  const bits = Array.from({ length: FRAGMENTS }, () => ({
    p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, rest: false, color: new THREE.Color(),
  }));
  let nextBit = 0;
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < FRAGMENTS; i++) {
    frags.setMatrixAt(i, hidden);
    frags.setColorAt(i, new THREE.Color('#888'));
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qy = new THREE.Quaternion();
  const qz = new THREE.Quaternion();
  const qx = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const X = new THREE.Vector3(1, 0, 0);
  const scale = new THREE.Vector3();
  const at = new THREE.Vector3();
  const off = new THREE.Vector3();
  const col = new THREE.Color();

  /** The nearest point of its footprint to (x, z), how far that is (negative inside), and the way out from it. */
  function near(b: Box, x: number, z: number) {
    const f = rect(b);
    const dx = x - f.x;
    const dz = z - f.z;
    const along = THREE.MathUtils.clamp(dx * f.ux + dz * f.uz, -f.hl, f.hl);
    const acrossRaw = dx * f.uz - dz * f.ux;
    const across = THREE.MathUtils.clamp(acrossRaw, -f.hw, f.hw);
    const cx = f.x + along * f.ux + across * f.uz;
    const cz = f.z + along * f.uz - across * f.ux;
    let nx = x - cx;
    let nz = z - cz;
    let d = Math.hypot(nx, nz);
    if (d < 1e-4) {
      // Inside: out through the nearer long side.
      const s = acrossRaw >= 0 ? 1 : -1;
      nx = f.uz * s;
      nz = -f.ux * s;
      d = -(f.hw - Math.abs(acrossRaw));
    } else {
      nx /= d;
      nz /= d;
    }
    return { d, nx, nz, cx, cz, f };
  }
  /** Is `o` somewhere up the stack resting on `b`? */
  function isAbove(o: Box, b: Box) {
    for (let x = o.on; x; x = x.on) if (x === b) return true;
    return false;
  }
  const above = (b: Box) => boxes.find((o) => o.on === b && o.state === 'rest') ?? null;
  const bottom = (b: Box) => {
    let x = b;
    while (x.on) x = x.on;
    return x;
  };
  const topOf = (b: Box) => {
    let x = b;
    for (let n = above(x); n; n = above(x)) x = n;
    return x;
  };

  /** What a box with its underside at `y` would rest on: the ground or deck under its middle, or the highest box under its footprint. */
  function support(b: Box, y: number, r = rect(b)) {
    let s = floorY(r.x, r.z);
    let on: Box | null = null;
    for (const o of boxes) {
      if (o === b || o.state !== 'rest' || isAbove(o, b)) continue;
      const t = top(o);
      if (t > s && t <= y + 0.3 && overlap(r, rect(o))) {
        s = t;
        on = o;
      }
    }
    return { y: s, on };
  }
  /** Would `b`'s footprint `r`, its underside at `y`, run into a box beside it (not one it stands on or carries)? */
  function bumps(b: Box, r: Rect, y: number) {
    for (const o of boxes) {
      if (o === b || o.state === 'fall' || isAbove(o, b) || isAbove(b, o)) continue;
      if (besides(b, y, o) && overlap(r, rect(o))) return true;
    }
    return false;
  }

  function place(b: Box, i: number) {
    qy.setFromAxisAngle(Y, b.heading);
    const sq = squash(b);
    const bulge = 1 + (1 - sq) * 0.35;
    if (b.state === 'tip') {
      // Rolling over about its bottom edge.
      const a = -b.side * b.tip;
      qz.setFromAxisAngle(Z, a);
      q.copy(qy).multiply(qz);
      off.set((-b.side * BOX.w) / 2, (BOX.h * sq) / 2, 0).applyQuaternion(q);
      at.copy(b.pivot).add(off);
      scale.set(bulge, sq, 1);
    } else {
      // Knocked askew a little by its dents.
      qz.setFromAxisAngle(Z, b.roll + b.lean);
      qx.setFromAxisAngle(X, b.lean * 0.6);
      q.copy(qy).multiply(qz).multiply(qx);
      const h = b.state === 'fall' && !b.flat ? BOX.h * sq : height(b);
      at.set(b.x, b.y + h / 2, b.z);
      // Crushed along whichever of its sides now points up.
      if (b.flat) scale.set(sq, bulge, 1);
      else scale.set(bulge, sq, 1);
    }
    m4.compose(at, q, scale);
    mesh.setMatrixAt(i, m4);
    col.copy(b.color).multiplyScalar(1 - Math.min(0.45, b.dent * 0.12));
    mesh.setColorAt(i, col);
  }
  function placeAll() {
    boxes.forEach(place);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  placeAll();

  /** Would a stack's bottom box, moved to (x, z) and turned to `heading`, run into a wall or a box beside it? */
  function blocked(b: Box, x: number, z: number, heading: number) {
    const r = rect(b, x, z, heading);
    // A wall: ground or deck standing well above its underside (the ship's superstructure, a quay from the water).
    for (const s of [-0.45, 0, 0.45]) for (const t of [-0.8, 0, 0.8]) {
      if (floorY(x + r.ux * BOX.l * s + r.uz * r.hw * t, z + r.uz * BOX.l * s - r.ux * r.hw * t) > b.y + 1.5) return true;
    }
    // Boxes beside it, or beside anything it carries.
    for (const o of boxes) {
      if (o.state === 'fall' || o === b || isAbove(o, b)) continue;
      if (besides(b, b.y, o) && overlap(r, rect(o))) return true;
    }
    return false;
  }

  /** Moves a stack (from its bottom box) by (dx, dz), turning it by `turn`, carrying everything on it along. */
  function shove(b: Box, dx: number, dz: number, turn: number): boolean {
    if (blocked(b, b.x + dx, b.z + dz, b.heading + turn)) {
      if (turn === 0) return false;
      return shove(b, dx, dz, 0);
    }
    // Everything it carries must have room too.
    const carried = boxes.filter((o) => isAbove(o, b));
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const moved = (o: Box) => {
      const rx = o.x - b.x;
      const rz = o.z - b.z;
      return { x: b.x + rx * c + rz * s + dx, z: b.z - rx * s + rz * c + dz };
    };
    for (const o of carried) {
      const m = moved(o);
      const r = rect(o, m.x, m.z, o.heading + turn);
      for (const w of boxes) {
        if (w === b || w === o || w.state === 'fall' || carried.includes(w)) continue;
        if (besides(o, o.y, w) && overlap(r, rect(w))) return turn ? shove(b, dx, dz, 0) : false;
      }
    }
    for (const o of [b, ...carried]) {
      const m = moved(o);
      o.x = m.x;
      o.z = m.z;
      o.heading += turn;
    }
    return true;
  }

  /** Sends a box off the top of its stack, away from `from`, tumbling onto its side as it falls. */
  function knockOff(b: Box, from: THREE.Vector3, power: number) {
    const ax = b.x - from.x;
    const az = b.z - from.z;
    const l = Math.hypot(ax, az) || 1;
    b.on = null;
    b.state = 'fall';
    b.vx = (ax / l) * power;
    b.vz = (az / l) * power;
    b.vy = 2.5;
    const across = (ax / l) * Math.cos(b.heading) - (az / l) * Math.sin(b.heading);
    b.side = across >= 0 ? 1 : -1;
    b.rollTo = -b.side * (Math.PI / 2);
    b.wrecked = true;
  }

  /** Crumples a box where the jaws close on it: crushed and askew, darker, and bits of steel flying. */
  function crumple(b: Box, from: THREE.Vector3) {
    b.dent = Math.min(MAX_DENTS + 2, b.dent + 1);
    b.lean = THREE.MathUtils.clamp(b.lean + (Math.random() - 0.5) * 0.06, -0.08, 0.08);
    const n = near(b, from.x, from.z);
    const y = Math.min(top(b) - 0.3, Math.max(b.y + 0.5, from.y + 2.5));
    for (let k = 0; k < 6; k++) {
      const f = bits[nextBit];
      frags.setColorAt(nextBit, f.color.copy(b.color).multiplyScalar(0.8 + Math.random() * 0.3));
      nextBit = (nextBit + 1) % FRAGMENTS;
      f.p.set(n.cx + (Math.random() - 0.5) * 1.5, y + (Math.random() - 0.5) * 1.2, n.cz + (Math.random() - 0.5) * 1.5);
      f.v.set(n.nx * (2 + Math.random() * 4) + (Math.random() - 0.5) * 3, 3 + Math.random() * 4, n.nz * (2 + Math.random() * 4) + (Math.random() - 0.5) * 3);
      f.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      f.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      f.life = 8 + Math.random() * 4;
      f.rest = false;
    }
    if (frags.instanceColor) frags.instanceColor.needsUpdate = true;
  }

  const tmp = new THREE.Vector3();
  return {
    boxes,
    contact(p, r, vel, dt, power) {
      let moved = 0;
      for (const b of boxes) {
        if (b.state !== 'rest') continue;
        if (p.y > top(b) - 0.6 || p.y < b.y - 2.5) continue;
        const n = near(b, p.x, p.z);
        if (n.d >= r) continue;
        const pen = r - n.d;
        const into = -(vel.x * n.nx + vel.z * n.nz);
        let m = 0;
        // Only a box at the dinosaur's own level gets shoved (it pushes the whole stack from its bottom box).
        if (power > 0 && into > 0.5 && !b.on) {
          const step = Math.min(pen, PUSH * power * dt);
          // Off-centre, the stack turns a little.
          const lever = ((n.cx - n.f.x) * -n.nz - (n.cz - n.f.z) * -n.nx) / n.f.hl;
          if (shove(b, -n.nx * step, -n.nz * step, lever * step * 0.04)) m = step;
        }
        p.x += n.nx * (pen - m);
        p.z += n.nz * (pen - m);
        moved += m;
      }
      return moved;
    },
    block(p, r) {
      for (const b of boxes) {
        if (b.state !== 'rest' || p.y > top(b) - 0.6 || p.y < b.y - 2.5) continue;
        const n = near(b, p.x, p.z);
        if (n.d < r) {
          p.x += n.nx * (r - n.d);
          p.z += n.nz * (r - n.d);
        }
      }
    },
    biteable(p, facing, reach) {
      let best: { box: Box; at: THREE.Vector3 } | null = null;
      let bd = Infinity;
      for (const b of boxes) {
        if (b.state !== 'rest' || p.y > top(b) + 2 || p.y < b.y - 3) continue;
        const n = near(b, p.x, p.z);
        if (n.d > reach || n.d >= bd) continue;
        if (n.d > 1e-3 && -(n.nx * facing.x + n.nz * facing.z) < 0.4) continue;
        bd = n.d;
        best = { box: b, at: tmp.set(n.cx, p.y, n.cz).clone() };
      }
      return best;
    },
    bite(box, from) {
      const was = box.wrecked;
      crumple(box, from);
      box.wrecked = true;
      const t = topOf(box);
      if (t !== box) {
        // The top of its stack comes down.
        knockOff(t, from, 4.5);
        return 'wrecked';
      }
      if (!box.flat && !box.on && box.dent >= 2) {
        // A box on its own, bitten again: over onto its far side, if there's room there.
        const ax = box.x - from.x;
        const az = box.z - from.z;
        const side = ax * Math.cos(box.heading) - az * Math.sin(box.heading) >= 0 ? 1 : -1;
        const ux = Math.sin(box.heading);
        const uz = Math.cos(box.heading);
        const o = (BOX.w / 2 + BOX.h / 2) * side;
        const lying = rect(box, box.x + uz * o, box.z - ux * o, box.heading, true);
        if (!bumps(box, lying, box.y)) {
          box.side = side;
          box.pivot.set(box.x + uz * (BOX.w / 2) * side, box.y, box.z - ux * (BOX.w / 2) * side);
          box.state = 'tip';
          box.tip = 0;
          box.spin = 0.8;
        }
      }
      return was ? 'dented' : 'wrecked';
    },
    charge(box, from) {
      const t = topOf(bottom(box));
      if (t === bottom(box) || t.cool > 0) return false;
      t.cool = 1;
      knockOff(t, from, 3.5);
      return true;
    },
    update(dt, events) {
      let changed = false;
      for (const b of boxes) {
        b.cool = Math.max(0, b.cool - dt);
        if (b.state === 'rest') {
          // It rests on the highest thing under its footprint. If that's gone (shoved off the deck's edge, into
          // the hold, or the box under it knocked away), it falls; if it sank a little (a box under it crushed), it settles.
          const s = support(b, b.y);
          if (s.y < b.y - 0.35) {
            b.on = null;
            b.state = 'fall';
            b.vx = b.vz = b.vy = 0;
            b.rollTo = b.roll;
            changed = true;
          } else if (Math.abs(s.y - b.y) > 1e-3 || s.on !== b.on) {
            b.y = s.y;
            b.on = s.on;
            changed = true;
          }
          continue;
        }
        changed = true;
        if (b.state === 'tip') {
          b.spin += (4 * Math.sin(b.tip) + 1.2) * dt;
          b.tip += b.spin * dt;
          if (b.tip >= Math.PI / 2) {
            // On its side: its middle is now a half height plus a half width out from where it stood.
            const ux = Math.sin(b.heading);
            const uz = Math.cos(b.heading);
            const o = (BOX.w / 2 + BOX.h / 2) * b.side;
            b.x += uz * o;
            b.z -= ux * o;
            b.roll = -b.side * (Math.PI / 2);
            b.flat = true;
            b.state = 'rest';
            events.push({ kind: 'land', x: b.x, z: b.z, hard: 0.7 });
          }
          continue;
        }
        // Falling: it lies down as it goes (if it was knocked off), and stops against anything beside it.
        b.roll += (b.rollTo - b.roll) * Math.min(1, dt * 5);
        const flatNow = Math.abs(b.rollTo) > 1;
        const nx = b.x + b.vx * dt;
        const nz = b.z + b.vz * dt;
        if (bumps(b, rect(b, nx, nz, b.heading, flatNow), b.y)) {
          b.vx = b.vz = 0;
        } else {
          b.x = nx;
          b.z = nz;
        }
        b.vy -= GRAVITY * dt;
        const ny = b.y + b.vy * dt;
        const s = support(b, b.y, rect(b, b.x, b.z, b.heading, flatNow));
        if (ny <= s.y) {
          const hard = Math.min(1, -b.vy / 20);
          b.y = s.y;
          b.on = s.on;
          b.roll = b.rollTo;
          b.flat = flatNow;
          b.state = 'rest';
          b.vx = b.vz = b.vy = 0;
          // A hard landing dents it too.
          if (hard > 0.5) b.dent = Math.min(MAX_DENTS + 2, b.dent + 1);
          events.push({ kind: s.y < 0 && !s.on ? 'splash' : 'land', x: b.x, z: b.z, hard });
        } else b.y = ny;
      }
      if (changed) placeAll();

      // Bits of steel: flung out, spinning, then lying where they fell (on the ground or a box), and gone in a while.
      let anyBits = false;
      bits.forEach((f, i) => {
        if (f.life <= 0) return;
        anyBits = true;
        f.life -= dt;
        if (!f.rest) {
          f.v.y -= GRAVITY * dt;
          f.p.addScaledVector(f.v, dt);
          f.r.x += f.spin.x * dt;
          f.r.y += f.spin.y * dt;
          f.r.z += f.spin.z * dt;
          let g = floorY(f.p.x, f.p.z);
          for (const b of boxes) if (b.state === 'rest' && top(b) > g && top(b) <= f.p.y + 0.5 && near(b, f.p.x, f.p.z).d <= 0) g = top(b);
          if (f.p.y <= g + 0.04) {
            f.p.y = g + 0.04;
            f.rest = true;
            f.r.x = (Math.random() - 0.5) * 0.3;
            f.r.z = (Math.random() - 0.5) * 0.3;
          }
        }
        const k = f.life < 1 ? Math.max(0, f.life) : 1;
        m4.compose(f.p, q.setFromEuler(f.r), scale.set(k, k, k));
        frags.setMatrixAt(i, f.life > 0 ? m4 : hidden);
      });
      if (anyBits) frags.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh, frags);
      mesh.dispose();
      frags.dispose();
      geo.dispose();
      fragGeo.dispose();
      mat.dispose();
      fragMat.dispose();
      tex.dispose();
    },
  };
}
