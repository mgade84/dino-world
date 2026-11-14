import * as THREE from 'three';
import { bake } from './merge';
import { groundY, SHIP, SHIP_DIM } from './world';

/**
 * The cargo ship moored at the quay (MapDef.ship): a long hull with a raked bow, an open hold sunk into the
 * deck with a steel ramp up out of it, a white superstructure over the stern (cabins, the bridge with its
 * wings, the funnel and a radar mast), deck cranes, containers stacked forward of the hold, and a gangway
 * let down onto the quay, with fenders and mooring lines along the quay side. It is built to match
 * shipFloor() in world.ts, which is what walking on it uses. Everything is plain colours, baked into a few
 * meshes (merge.ts).
 */

export interface Ship {
  dispose(): void;
}

export function createShip(scene: THREE.Scene): Ship | null {
  if (!SHIP.on) return null;
  const S = SHIP_DIM;
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (color: string, roughness = 0.7, metalness = 0.2) => {
    const k = `${color}/${roughness}/${metalness}`;
    let m = mats.get(k);
    if (!m) mats.set(k, (m = keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }))));
    return m;
  };
  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  const cyl = keep(new THREE.CylinderGeometry(1, 1, 1, 12));
  const root = new THREE.Group();
  root.position.set(SHIP.x, 0, SHIP.z);
  
  /** A box w (along u) × h × d (along v), its centre at (u, y, v), turned by `rot`. */
  const put = (m: THREE.Material, w: number, h: number, d: number, u: number, y: number, v: number, rot: [number, number, number] = [0, 0, 0], geo: THREE.BufferGeometry = box) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.scale.set(w, h, d);
    mesh.position.set(u, y, v);
    mesh.rotation.set(...rot);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  // ---- The hull: its outline (as shipFloor() has it), its sides from the keel to the deck ----
  const outline: [number, number][] = [[-S.L, -S.B], [S.L - S.bow, -S.B], [S.L, 0], [S.L - S.bow, S.B], [-S.L, S.B]];
  // Shapes are drawn in (u, -v), so that turning them flat puts them at (u, v).
  const shape = (pts: [number, number][]) => new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, -v)));
  /** The hull's sides only, from y0 to y1. */
  function sides(y0: number, y1: number, m: THREE.Material) {
    const geo = new THREE.ExtrudeGeometry(shape(outline), { depth: y1 - y0, bevelEnabled: false });
    // Keep the sides (group 1), drop the caps.
    const g = geo.groups.find((x) => x.materialIndex === 1)!;
    const only = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv'] as const) {
      const a = geo.attributes[name] as THREE.BufferAttribute;
      only.setAttribute(name, new THREE.BufferAttribute(a.array.slice(g.start * a.itemSize, (g.start + g.count) * a.itemSize), a.itemSize));
    }
    geo.dispose();
    only.rotateX(-Math.PI / 2);
    only.translate(0, y0, 0);
    keep(only);
    const mesh = new THREE.Mesh(only, m);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  const navy = mat('#1e2830', 0.6, 0.3);
  sides(-7, 0.9, mat('#6e2620', 0.8, 0.1)); // antifouling red below the waterline
  sides(0.9, 1.3, mat('#d8d4c8', 0.6)); // a white boot-top line
  sides(1.3, S.D, navy);
  // The deck, with the hold cut out of it, and a strip of white along the sheer.
  const h = S.hold;
  const deckShape = shape(outline);
  const hole = new THREE.Path();
  hole.moveTo(h.u0, -h.hv);
  hole.lineTo(h.u0, h.hv);
  hole.lineTo(h.u1, h.hv);
  hole.lineTo(h.u1, -h.hv);
  hole.closePath();
  deckShape.holes.push(hole);
  const deckGeo = keep(new THREE.ShapeGeometry(deckShape));
  deckGeo.rotateX(-Math.PI / 2);
  deckGeo.translate(0, S.D, 0);
  const deck = new THREE.Mesh(deckGeo, mat('#56604c', 0.8, 0.1));
  deck.receiveShadow = true;
  root.add(deck);
  sides(S.D - 0.6, S.D - 0.3, mat('#e2ded2', 0.6));

  // ---- The hold: its floor, its walls (with frames), coamings round the opening, and the ramp out ----
  const hl = h.u1 - h.u0;
  const hc = (h.u0 + h.u1) / 2;
  const holdWall = mat('#5a5e5c', 0.7, 0.3);
  put(mat('#3f4342', 0.85, 0.2), hl, 0.3, h.hv * 2, hc, S.H - 0.15, 0);
  put(holdWall, hl, S.D - S.H, 0.4, hc, (S.D + S.H) / 2, -h.hv - 0.2);
  put(holdWall, hl, S.D - S.H, 0.4, hc, (S.D + S.H) / 2, h.hv + 0.2);
  put(holdWall, 0.4, S.D - S.H, h.hv * 2, h.u0 - 0.2, (S.D + S.H) / 2, 0);
  put(holdWall, 0.4, S.D - S.H, h.hv * 2, h.u1 + 0.2, (S.D + S.H) / 2, 0);
  const frame = mat('#474b4a', 0.7, 0.3);
  for (let u = h.u0 + 4; u < h.u1; u += 4) for (const s of [-1, 1]) put(frame, 0.3, S.D - S.H, 0.5, u, (S.D + S.H) / 2, s * (h.hv - 0.05));
  // Hatch coamings: a raised steel lip round the opening (except where the ramp comes up).
  const lip = mat('#8a6a2a', 0.6, 0.3);
  for (const s of [-1, 1]) put(lip, hl, 0.9, 0.5, hc, S.D + 0.45, s * (h.hv + 0.25));
  put(lip, 0.5, 0.9, h.hv * 2 + 1, h.u0 - 0.25, S.D + 0.45, 0);
  for (const s of [-1, 1]) put(lip, 0.5, 0.9, h.hv - S.rampV, h.u1 + 0.25, S.D + 0.45, s * (S.rampV + (h.hv - S.rampV) / 2 + 0.25));
  // The ramp: a steel plate from the hold floor up to the deck, with kerbs and a handrail along each side.
  const run = h.u1 - S.rampU;
  const rise = S.D - S.H;
  const len = Math.hypot(run, rise);
  const tilt = Math.atan2(rise, run);
  const steel = mat('#6c706e', 0.5, 0.5);
  const yellow = mat('#c9a23a', 0.6, 0.2);
  put(steel, len, 0.35, S.rampV * 2, S.rampU + run / 2, S.H + rise / 2 - 0.1, 0, [0, 0, tilt]);
  for (let k = 1; k < 12; k++) {
    // Cleats across it for grip.
    const t = k / 12;
    put(frame, 0.2, 0.12, S.rampV * 2 - 0.4, S.rampU + run * t, S.H + rise * t + 0.1, 0, [0, 0, tilt]);
  }
  for (const s of [-1, 1]) {
    put(yellow, len, 0.4, 0.25, S.rampU + run / 2, S.H + rise / 2 + 0.15, s * (S.rampV - 0.1), [0, 0, tilt]);
    // Ramp supports down to the hold floor.
    for (const t of [0.35, 0.65, 0.95]) put(frame, 0.4, rise * t, 0.4, S.rampU + run * t, S.H + (rise * t) / 2, s * (S.rampV - 0.5));
  }

  // ---- Bulwarks round the deck's edge (open at the gangway), with a rail on top ----
  const bulwark = mat('#2a343b', 0.6, 0.3);
  const rail = mat('#d8d4c8', 0.5, 0.3);
  const edge = (a: [number, number], b: [number, number], skip?: [number, number]) => {
    const segs: [number, number][] = skip ? [[0, skip[0]], [skip[1], 1]] : [[0, 1]];
    for (const [t0, t1] of segs) {
      const ax = a[0] + (b[0] - a[0]) * t0;
      const az = a[1] + (b[1] - a[1]) * t0;
      const bx = a[0] + (b[0] - a[0]) * t1;
      const bz = a[1] + (b[1] - a[1]) * t1;
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 0.1) continue;
      const ang = -Math.atan2(bz - az, bx - ax);
      put(bulwark, l, S.railH, 0.3, (ax + bx) / 2, S.D + S.railH / 2, (az + bz) / 2, [0, ang, 0]);
      put(rail, l, 0.12, 0.4, (ax + bx) / 2, S.D + S.railH + 0.06, (az + bz) / 2, [0, ang, 0]);
    }
  };
  const gap = S.gang;
  const quayLen = S.L - S.bow + S.L;
  edge([-S.L + S.aft, -S.B + 0.15], [S.L - S.bow, -S.B + 0.15], [(gap.u - gap.hw - (-S.L + S.aft)) / (quayLen - S.aft), (gap.u + gap.hw - (-S.L + S.aft)) / (quayLen - S.aft)]);
  edge([-S.L + S.aft, S.B - 0.15], [S.L - S.bow, S.B - 0.15]);
  edge([S.L - S.bow, -S.B + 0.15], [S.L - 0.3, 0]);
  edge([S.L - S.bow, S.B - 0.15], [S.L - 0.3, 0]);

  // ---- The superstructure over the stern: cabins, the bridge and its wings, the funnel, the mast ----
  const white = mat('#dcd9d0', 0.6, 0.1);
  const glass = mat('#1c2328', 0.2, 0.4);
  const aftC = -S.L + S.aft / 2;
  const decks = 5;
  const dh = S.aftH / decks;
  for (let k = 0; k < decks; k++) {
    // Each deck a little narrower than the one below, with a row of windows (portholes become a band at the top).
    const w = S.aft - 1 - k * 0.6;
    const d = S.B * 2 - 2 - (k === decks - 1 ? -6 : k * 0.4);
    put(white, w, dh, d, aftC, S.D + dh * (k + 0.5), 0);
    const bridge = k === decks - 1;
    put(glass, w + 0.05, bridge ? dh * 0.45 : dh * 0.25, d + 0.05, aftC, S.D + dh * (k + 0.6), 0);
    if (!bridge) for (let u = -w / 2 + 1; u < w / 2 - 0.5; u += 2.2) put(white, 0.6, dh * 0.3, d + 0.1, aftC + u, S.D + dh * (k + 0.6), 0);
  }
  put(white, S.aft - 2, 0.3, S.B * 2 + 6, aftC, S.D + S.aftH + 0.15, 0);
  // The funnel, in the line's colours, and a radar mast.
  const fu = aftC - 4;
  put(mat('#a8382a', 0.6, 0.2), 6, 8, 7, fu, S.D + S.aftH + 4, 0);
  put(mat('#1c1e20', 0.7, 0.2), 6.2, 1.6, 7.2, fu, S.D + S.aftH + 7.6, 0);
  put(mat('#e8e4d8', 0.6, 0.2), 6.1, 1.2, 7.1, fu, S.D + S.aftH + 4.5, 0);
  put(steel, 0.5, 9, 0.5, aftC + 5, S.D + S.aftH + 4.5, 0);
  put(steel, 0.3, 0.3, 6, aftC + 5, S.D + S.aftH + 7, 0);
  put(steel, 0.3, 0.3, 4.5, aftC + 5, S.D + S.aftH + 8.6, 0, [0.15, 0.6, 0]);

  // ---- Deck cranes along the seaward side, their jibs swung over the hold ----
  const craneMat = mat('#b8862a', 0.6, 0.3);
  for (const u of [-38, -6]) {
    const v = S.B - 3.5;
    put(craneMat, 2.6, 6, 2.6, u, S.D + 3, v, [0, 0, 0], cyl);
    put(craneMat, 3.6, 3, 4, u, S.D + 7.2, v);
    put(glass, 1.2, 1.2, 1.6, u + 1.4, S.D + 7.6, v - 1.2);
    const jl = 22;
    const ja = 0.55;
    const j = put(craneMat, 1, 1, jl, u, S.D + 8 + (Math.sin(ja) * jl) / 2, v - (Math.cos(ja) * jl) / 2, [ja, 0, 0]);
    j.scale.set(0.9, 0.9, jl);
    // The hook's wire hanging into the hold.
    const tipY = S.D + 8 + Math.sin(ja) * jl;
    const tipV = v - Math.cos(ja) * jl;
    put(steel, 0.08, tipY - S.D - 2, 0.08, u, (tipY + S.D + 2) / 2, tipV);
    put(yellow, 1, 0.8, 1, u, S.D + 1.6, tipV);
  }

  // ---- Bow: a mooring deck with windlasses, bollards, and the anchor in its hawse ----
  for (const s of [-1, 1]) {
    put(steel, 2.4, 1.4, 2, S.L - S.bow + 6, S.D + 0.7, s * 4);
    put(mat('#2a2c2e', 0.6, 0.4), 0.8, 0.8, 0.8, S.L - S.bow + 3, S.D + 0.4, s * 9);
    put(mat('#2a2c2e', 0.6, 0.4), 2.6, 2.2, 0.6, S.L - S.bow + 4, S.D - 3, s * (S.B - 0.25), [0, 0, 0.3]);
  }

  // ---- The gangway: a broad steel ramp from the deck's edge down to the quay ----
  const qy = groundY(SHIP.x + gap.u, SHIP.z - S.B - gap.len);
  const gr = S.D - qy;
  const gl = Math.hypot(gap.len, gr);
  const gt = Math.atan2(gr, gap.len);
  const gv = -S.B - gap.len / 2;
  put(steel, gap.hw * 2, 0.4, gl, gap.u, qy + gr / 2 - 0.15, gv, [-gt, 0, 0]);
  for (let k = 1; k < 14; k++) {
    const t = k / 14;
    put(frame, gap.hw * 2 - 0.6, 0.12, 0.25, gap.u, S.D - gr * t + 0.08, -S.B - gap.len * t, [-gt, 0, 0]);
  }
  for (const s of [-1, 1]) {
    put(yellow, 0.3, 0.5, gl, gap.u + s * (gap.hw - 0.15), qy + gr / 2 + 0.15, gv, [-gt, 0, 0]);
    for (const t of [0.15, 0.5, 0.85]) put(rail, 0.12, 1.2, 0.12, gap.u + s * (gap.hw - 0.15), S.D - gr * t + 0.7, -S.B - gap.len * t);
    put(rail, 0.12, 0.12, gl, gap.u + s * (gap.hw - 0.15), qy + gr / 2 + 1.3, gv, [-gt, 0, 0]);
  }
  // The hinge at the deck's edge, and the ramp's foot on the quay.
  put(frame, gap.hw * 2 + 1, 0.8, 1, gap.u, S.D - 0.2, -S.B);
  put(frame, gap.hw * 2, 0.3, 1.5, gap.u, qy + 0.15, -S.B - gap.len + 0.5);

  // ---- Fenders between the hull and the quay, and mooring lines out to bollards ----
  const rubber = mat('#1a1b1c', 0.9, 0);
  for (let u = -S.L + 8; u < S.L - S.bow; u += 14) put(rubber, 1.4, 5, 1.4, u, 1.5, -S.B - 1.5, [0, 0, Math.PI / 2], cyl);
  const lineMat = mat('#3a3328', 0.9, 0);
  for (const [u, du] of [[-S.L + 4, -10], [-S.L + 22, -4], [S.L - S.bow - 4, 4], [S.L - S.bow + 8, 10]] as const) {
    const ax = u;
    const az = -S.B + 0.3;
    const bx = u + du;
    const bz = -S.B - 7;
    const by = groundY(SHIP.x + bx, SHIP.z + bz) + 0.6;
    const dir = new THREE.Vector3(bx - ax, by - S.D, bz - az);
    const line = put(lineMat, 0.12, dir.length(), 0.12, (ax + bx) / 2, (S.D + by) / 2, (az + bz) / 2);
    line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    put(mat('#2a2c2e', 0.6, 0.4), 0.7, 1, 0.7, bx, by - 0.1, bz, [0, 0, 0], cyl);
  }

  root.updateMatrixWorld(true);
  bake(root, [], owned);
  scene.add(root);
  return {
    dispose() {
      scene.remove(root);
      owned.forEach((o) => o.dispose());
    },
  };
}
