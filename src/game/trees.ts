import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Tree models, built in code: a few variants of each kind, each merged into one vertex-coloured,
 * textured geometry so the jungle can be drawn as one InstancedMesh per variant, all sharing one
 * material and one texture painted on a canvas at startup (no asset files).
 *
 * - Broadleaf jungle trees: a flared trunk on buttress roots, branches forking out of it, and leafy
 *   clumps at their ends. Each clump is a lumpy ball covered in a dense leaf texture (darker
 *   underneath, normals bent outward from the canopy so it shades like one soft mass) with sprays
 *   of cut-out leaves sticking out of it, which break up the outline.
 * - Palms: a trunk that leans out and curves back up, ringed with old leaf scars, a crown with
 *   coconuts, and fronds textured with cut-out leaflets, plus dead brown ones under the crown.
 *
 * `lite` variants (for the wall of jungle beyond the play area) use about half the triangles.
 * Geometry is in metres with the ground at y = 0.2 (trees are planted 0.2 below the surface).
 */

type V3 = THREE.Vector3;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const col = (hex: string) => new THREE.Color(hex);

// ---- The texture atlas: 512 × 512 canvas pixels, in regions ----
const SIZE = 512;
type Region = { x: number; y: number; w: number; h: number };
/** Dense, opaque leaves for the clumps' surfaces. */
const DENSE: Region = { x: 0, y: 0, w: 248, h: 512 };
/** A spray of cut-out leaves on a twig, for the cards around the clumps. */
const SPRAY: Region = { x: 256, y: 0, w: 256, h: 256 };
/** One palm frond: midrib down the middle, cut-out leaflets to both sides, base at the top. */
const FROND: Region = { x: 264, y: 264, w: 116, h: 240 };
/** Bark: vertical furrows, for every trunk and branch (and plain enough for coconuts). */
const BARK_TEX: Region = { x: 392, y: 264, w: 112, h: 240 };
/** Atlas uv of a point (s, t in 0..1 across and down) in a region. Canvas y runs down; v runs up. */
const uvIn = (r: Region, s: number, t: number): [number, number] => [(r.x + s * r.w) / SIZE, 1 - (r.y + t * r.h) / SIZE];

/** A leaf shape at the canvas origin, pointing along +x, `len` long. */
function leafPath(g: CanvasRenderingContext2D, len: number, wide: number) {
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.45, -len * wide, len, 0);
  g.quadraticCurveTo(len * 0.45, len * wide, 0, 0);
}
const grey = (l: number, a = 1) => `rgba(${Math.round(l * 255)},${Math.round(l * 255)},${Math.round(l * 255)},${a})`;

/**
 * Paints the atlas in greys (the trees' vertex colours tint it green or brown). Lighter leaves are
 * painted last, so the outer layer of a clump is brightest and the gaps between leaves are dark.
 */
export function treeTexture(rand: () => number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, SIZE, SIZE);
  const clip = (r: Region) => {
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
  };

  // Dense leaves: a dark tangle, then layer after layer of leaves, each with a darker midrib.
  clip(DENSE);
  g.fillStyle = grey(0.28);
  g.fillRect(DENSE.x, DENSE.y, DENSE.w, DENSE.h);
  for (let layer = 0; layer < 4; layer++) {
    for (let i = 0; i < 260; i++) {
      const x = DENSE.x - 10 + rand() * (DENSE.w + 20);
      const y = DENSE.y - 10 + rand() * (DENSE.h + 20);
      const len = 14 + rand() * 14;
      g.save();
      g.translate(x, y);
      g.rotate(rand() * Math.PI * 2);
      leafPath(g, len, 0.32);
      g.fillStyle = grey(0.42 + layer * 0.15 + rand() * 0.12);
      g.fill();
      g.strokeStyle = grey(0.3 + layer * 0.1, 0.7);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(1, 0);
      g.lineTo(len * 0.9, 0);
      g.stroke();
      g.restore();
    }
  }
  g.restore();

  // A spray: twigs fanning from the bottom centre, leaves along them. Transparent around it.
  clip(SPRAY);
  const cx = SPRAY.x + SPRAY.w / 2;
  const cy = SPRAY.y + SPRAY.h - 14;
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (k - 3) * 0.32 + (rand() - 0.5) * 0.15;
    const reach = 150 + rand() * 60;
    g.strokeStyle = grey(0.45);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
    g.stroke();
    for (let j = 1; j <= 9; j++) {
      const d = (j / 9) * reach;
      for (const side of [-1, 1]) {
        g.save();
        g.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
        g.rotate(a + side * (0.7 + rand() * 0.4));
        leafPath(g, 26 + rand() * 14, 0.34);
        g.fillStyle = grey(0.6 + rand() * 0.4);
        g.fill();
        g.restore();
      }
    }
    // A leaf at the twig's tip.
    g.save();
    g.translate(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
    g.rotate(a);
    leafPath(g, 30, 0.34);
    g.fillStyle = grey(0.85);
    g.fill();
    g.restore();
  }
  g.restore();

  // A frond: narrow leaflets angled towards the tip from a pale midrib, with gaps between them.
  clip(FROND);
  const mid = FROND.x + FROND.w / 2;
  for (let j = 0; j < 30; j++) {
    const y = FROND.y + 4 + (j / 30) * FROND.h;
    for (const side of [-1, 1]) {
      g.save();
      g.translate(mid, y);
      // Pointing out and down the canvas (towards the tip), a little longer than half the width.
      g.rotate(Math.PI / 2 - side * (Math.PI / 2 - 0.55 - rand() * 0.12));
      leafPath(g, FROND.w * 0.62, 0.09);
      g.fillStyle = grey(0.7 + rand() * 0.3);
      g.fill();
      g.restore();
    }
  }
  g.fillStyle = grey(0.95);
  g.fillRect(mid - 2, FROND.y, 4, FROND.h);
  g.restore();

  // Bark: light grey with dark, wavering vertical furrows and a few pale lichen spots.
  clip(BARK_TEX);
  g.fillStyle = grey(0.85);
  g.fillRect(BARK_TEX.x, BARK_TEX.y, BARK_TEX.w, BARK_TEX.h);
  for (let i = 0; i < 40; i++) {
    let x = BARK_TEX.x + rand() * BARK_TEX.w;
    g.strokeStyle = grey(0.45 + rand() * 0.25);
    g.lineWidth = 1 + rand() * 3;
    g.beginPath();
    g.moveTo(x, BARK_TEX.y);
    for (let y = BARK_TEX.y; y <= BARK_TEX.y + BARK_TEX.h; y += 12) {
      x += (rand() - 0.5) * 4;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 30; i++) {
    g.fillStyle = grey(0.95 + rand() * 0.05, 0.6);
    g.beginPath();
    g.arc(BARK_TEX.x + rand() * BARK_TEX.w, BARK_TEX.y + rand() * BARK_TEX.h, 1 + rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- Geometry ----

/** Builds a non-indexed part from flat arrays, with smooth normals from an index. */
function part(pos: number[], cols: number[], uvs: number[], idx: number[]) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

/**
 * A tapered tube along `path` (open at both ends), `sides` around, with bark wrapped round it
 * (mirrored halfway, so there's no seam) and repeating every `repeat` metres along it.
 */
function tube(path: V3[], radii: number[], sides: number, colour: (ring: number, k: number) => THREE.Color, repeat = 2.5) {
  const pos: number[] = [];
  const cols: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const t = v();
  const n = v();
  const b = v();
  let prev: V3 | null = null;
  let along = 0;
  // The bark repeats down the region, so wrap its v by hand (atlas regions can't tile).
  const barkV = (d: number) => {
    const f = (d / repeat) % 2;
    return f > 1 ? 2 - f : f;
  };
  path.forEach((p, i) => {
    t.subVectors(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
    if (!prev) n.crossVectors(Math.abs(t.z) > 0.9 ? v(1, 0, 0) : v(0, 0, 1), t).normalize();
    // Carry the frame along the bend so the tube doesn't twist.
    else n.copy(prev).addScaledVector(t, -prev.dot(t)).normalize();
    prev = n.clone();
    b.crossVectors(t, n);
    if (i > 0) along += p.distanceTo(path[i - 1]);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const r = radii[i];
      pos.push(p.x + (n.x * Math.cos(a) + b.x * Math.sin(a)) * r, p.y + (n.y * Math.cos(a) + b.y * Math.sin(a)) * r, p.z + (n.z * Math.cos(a) + b.z * Math.sin(a)) * r);
      const c = colour(i, k);
      cols.push(c.r, c.g, c.b);
      uvs.push(...uvIn(BARK_TEX, Math.abs((k / sides) * 2 - 1), barkV(along)));
    }
  });
  for (let i = 0; i < path.length - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k;
      const a2 = i * sides + ((k + 1) % sides);
      idx.push(a, a2, a + sides, a2, a2 + sides, a + sides);
    }
  }
  return part(pos, cols, uvs, idx);
}

/** A rough noise from a position, so vertices that share a position move together. */
const hash = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * A clump of leaves: a lumpy ball covered in dense leaves (each facet mapped to its own patch of
 * the texture, seen straight on, so nothing stretches), varying in green, darker underneath, with
 * normals pointing out from the canopy's `heart`, and `sprays` cut-out leaf cards poking out of it.
 */
function clump(centre: V3, r: number, squash: number, heart: V3, rand: () => number, greens: THREE.Color[], sprays: number) {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 1);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const p = geo.attributes.position;
  const seed = rand() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // The solid core sits inside the sprays, which make the outline.
    const k = 0.82 * (1 + (hash(x + seed, y, z) - 0.5) * 0.45 + Math.sin(x * 4 + seed) * Math.sin(z * 4 - seed) * 0.1);
    // Flatter underneath, like a real crown.
    p.setXYZ(i, centre.x + x * r * k, centre.y + y * r * squash * k * (y < 0 ? 0.7 : 1), centre.z + z * r * k);
  }
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const colours = new Float32Array(pos.count * 3);
  const uvs = new Float32Array(pos.count * 2);
  const face = v();
  const out = v();
  const c = new THREE.Color();
  const low = centre.y - r * squash;
  const shadeAt = (y: number) => 0.6 + 0.65 * THREE.MathUtils.clamp((y - low) / (r * squash * 2), 0, 1);
  const PX = 150; // texture pixels per metre on the clumps
  for (let f = 0; f < pos.count; f += 3) {
    const shade = greens[Math.floor(rand() * greens.length)];
    const vary = 0.85 + rand() * 0.3;
    // Project the facet along its own normal, around its centre, onto a random spot in the leaves.
    face.fromBufferAttribute(nor, f);
    const ax = Math.abs(face.x) > Math.abs(face.y) ? (Math.abs(face.x) > Math.abs(face.z) ? 0 : 2) : Math.abs(face.y) > Math.abs(face.z) ? 1 : 2;
    const [ua, va] = ax === 0 ? ['z', 'y'] : ax === 1 ? ['x', 'z'] : ['x', 'y'];
    const pts = [f, f + 1, f + 2].map((j) => v().fromBufferAttribute(pos, j));
    const mid = pts[0].clone().add(pts[1]).add(pts[2]).divideScalar(3);
    const sx = DENSE.x + 70 + rand() * (DENSE.w - 140);
    const sy = DENSE.y + 70 + rand() * (DENSE.h - 140);
    for (let j = 0; j < 3; j++) {
      const q = pts[j];
      const px = THREE.MathUtils.clamp(sx + (q[ua as 'x'] - mid[ua as 'x']) * PX, DENSE.x + 2, DENSE.x + DENSE.w - 2);
      const py = THREE.MathUtils.clamp(sy - (q[va as 'y'] - mid[va as 'y']) * PX, DENSE.y + 2, DENSE.y + DENSE.h - 2);
      uvs.set([px / SIZE, 1 - py / SIZE], (f + j) * 2);
      face.fromBufferAttribute(nor, f + j);
      out.copy(q).sub(heart).normalize();
      face.multiplyScalar(0.35).addScaledVector(out, 0.65).normalize();
      nor.setXYZ(f + j, face.x, face.y, face.z);
      c.copy(shade).multiplyScalar(vary * shadeAt(q.y));
      colours.set([c.r, c.g, c.b], (f + j) * 3);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  // Sprays of leaves standing out of the surface, mostly on the top and sides.
  const parts: THREE.BufferGeometry[] = [geo];
  const pos2: number[] = [];
  const cols2: number[] = [];
  const uvs2: number[] = [];
  const idx2: number[] = [];
  const d = v();
  const side = v();
  const up = v();
  for (let i = 0; i < sprays; i++) {
    // Evenly round the clump (a spiral), a little jittered, fewer underneath.
    const fy = 1 - ((i + 0.5) / sprays) * 1.7;
    const ring = Math.sqrt(Math.max(0, 1 - fy * fy));
    const az = i * 2.39996 + rand() * 0.6;
    d.set(Math.cos(az) * ring, fy, Math.sin(az) * ring).normalize();
    const root = centre.clone().add(v(d.x * r * 0.55, d.y * r * squash * 0.55, d.z * r * 0.55));
    const size = r * (0.8 + rand() * 0.35);
    // The card leans out along d, turned at random about it.
    side.crossVectors(d, Math.abs(d.y) > 0.9 ? v(1, 0, 0) : v(0, 1, 0)).normalize().applyAxisAngle(d, rand() * Math.PI * 2);
    up.crossVectors(side, d).normalize().multiplyScalar(0.3).addScaledVector(d, 1).normalize();
    const shade = greens[Math.floor(rand() * greens.length)];
    const o = pos2.length / 3;
    const corners: [number, number][] = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
    for (const [s, h] of corners) {
      const q = root.clone().addScaledVector(side, s * size).addScaledVector(up, h * size);
      pos2.push(q.x, q.y, q.z);
      c.copy(shade).multiplyScalar(shadeAt(q.y) * 1.05);
      cols2.push(c.r, c.g, c.b);
      uvs2.push(...uvIn(SPRAY, s + 0.5, 1 - h));
    }
    idx2.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  if (sprays) {
    const cards = part(pos2, cols2, uvs2, idx2);
    // Light the cards like the clump around them.
    const cp = cards.attributes.position;
    const cn = cards.attributes.normal;
    for (let i = 0; i < cp.count; i++) {
      out.fromBufferAttribute(cp, i).sub(heart).normalize();
      cn.setXYZ(i, out.x, out.y, out.z);
    }
    parts.push(cards);
  }
  return parts;
}

/** A plain coloured solid (a coconut, the palm's crown shaft), smooth-shaded, with a bark texture. */
function lump(centre: V3, r: number, sy: number, colour: THREE.Color, detail: number) {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, detail);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo.scale(1, sy, 1);
  geo.translate(centre.x, centre.y, centre.z);
  geo = mergeVertices(geo);
  geo.computeVertexNormals();
  geo = geo.toNonIndexed();
  const n = geo.attributes.position.count;
  const cols = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const p = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    cols.set([colour.r, colour.g, colour.b], i * 3);
    const a = Math.atan2(p.getZ(i) - centre.z, p.getX(i) - centre.x);
    uvs.set(uvIn(BARK_TEX, Math.abs(a / Math.PI), 0.5 + (p.getY(i) - centre.y) / (r * sy * 4)), i * 2);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geo;
}

const BARK = col('#55473a');
const BARK_DARK = col('#3a3026');
const MOSS = col('#45562f');
// Brighter than the leaves look: the texture darkens them.
const LEAVES = ['#3d6a36', '#4a733c', '#375d32', '#527d40', '#41683a', '#5e8a42'].map(col);

/** A broadleaf jungle tree, about 7 m tall and 7 m across. */
function broadleaf(rand: () => number, lite: boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const h = 3.4 + rand() * 0.6;
  const lx = (rand() - 0.5) * 0.6;
  const lz = (rand() - 0.5) * 0.6;
  const wob = rand() * 6;
  const trunk = [0, 0.15, 0.4, 0.7, 1].map((k) => v(lx * k * k + Math.sin(k * 3 + wob) * 0.08, -0.1 + k * (h + 0.1), lz * k * k));
  const along = (k: number) => {
    const f = k * (trunk.length - 1);
    const i = Math.min(trunk.length - 2, Math.floor(f));
    return trunk[i].clone().lerp(trunk[i + 1], f - i);
  };
  // Bark, with moss creeping up the bottom.
  const bark = (ring: number, rings: number) => BARK.clone().lerp(BARK_DARK, rand() * 0.3).lerp(MOSS, Math.max(0, 0.6 - ring / (rings - 1)) * 0.8);
  parts.push(tube(trunk, [0.78, 0.5, 0.42, 0.36, 0.3], 8, (i) => bark(i, trunk.length)));
  if (!lite) {
    // Buttress roots spreading over the ground.
    const nr = 4 + Math.floor(rand() * 2);
    for (let j = 0; j < nr; j++) {
      const a = (j / nr) * Math.PI * 2 + rand() * 0.6;
      const d = 1.3 + rand() * 0.5;
      const dir = (s: number, y: number) => v(Math.cos(a) * s, y, Math.sin(a) * s);
      parts.push(tube([dir(0.2, 1.1), dir(0.7, 0.45), dir(d, 0.12)], [0.24, 0.15, 0.05], 4, (i) => bark(i, 2), 1));
    }
  }
  // Branches forking out of the top of the trunk, each ending in clumps of leaves.
  const heart = v(lx, h + 1.2, lz);
  const nb = lite ? 3 : 4;
  const sprays = lite ? 9 : 16;
  for (let j = 0; j < nb; j++) {
    const a = (j / nb) * Math.PI * 2 + rand() * 0.8;
    const start = along(0.72 + rand() * 0.28);
    const out = 1.6 + rand() * 0.9;
    const up = 0.9 + rand() * 0.8;
    const mid = start.clone().add(v(Math.cos(a) * out * 0.45, up * 0.65, Math.sin(a) * out * 0.45));
    const end = start.clone().add(v(Math.cos(a) * out, up, Math.sin(a) * out));
    parts.push(tube([start, mid, end], [0.2, 0.13, 0.07], 5, () => BARK.clone().lerp(BARK_DARK, rand() * 0.4), 1.2));
    const r = (1.35 + rand() * 0.5) * (lite ? 1.2 : 1);
    parts.push(...clump(end.clone().add(v(0, 0.45, 0)), r, 0.72, heart, rand, LEAVES, sprays));
    if (!lite && j % 2 === 0) {
      const off = v(Math.cos(a + 0.9) * r * 0.7, r * 0.35, Math.sin(a + 0.9) * r * 0.7);
      parts.push(...clump(end.clone().add(off), r * 0.7, 0.7, heart, rand, LEAVES, 9));
    }
  }
  // The crown's top, over the trunk.
  parts.push(...clump(trunk[trunk.length - 1].clone().add(v(0, 1.3, 0)), lite ? 2 : 1.7, 0.75, heart, rand, LEAVES, sprays));
  return finish(parts);
}

const FROND_GREEN = col('#4c7838');
const FROND_OLD = col('#62773a');
const FROND_DEAD = col('#7a6440');
const PALM_BARK = col('#7a7062');
const PALM_SCAR = col('#564c40');

/**
 * One palm frond from `base`: a midrib arching out towards `a` (radians around the trunk), rising
 * at `rise` and bending down by `droop` over `len` metres. The leaflets are in the texture; the
 * geometry folds down either side of the midrib, the way leaflets hang.
 */
function frond(base: V3, a: number, len: number, rise: number, droop: number, colour: THREE.Color, steps: number, wide = 1) {
  const pos: number[] = [];
  const cols: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const out = v(Math.cos(a), 0, Math.sin(a));
  const side = v(-Math.sin(a), 0, Math.cos(a));
  const p = base.clone();
  const tan = v();
  const c = new THREE.Color();
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const ang = rise - droop * s * s;
    tan.copy(out).multiplyScalar(Math.cos(ang)).add(v(0, Math.sin(ang), 0));
    if (i > 0) p.addScaledVector(tan, len / steps);
    const w = len * 0.24 * wide * Math.sin(Math.PI * Math.min(1, 0.1 + s * 0.95));
    for (const sgn of [-1, 0, 1]) {
      const q = p.clone();
      if (sgn) q.addScaledVector(side, sgn * w).add(v(0, -w * 0.5, 0));
      pos.push(q.x, q.y, q.z);
      // Lighter, yellower towards the tip.
      c.copy(colour).lerp(col('#7d8c48'), s * 0.3);
      cols.push(c.r, c.g, c.b);
      uvs.push(...uvIn(FROND, (sgn + 1) / 2, s));
    }
    if (i > 0) {
      const o = (i - 1) * 3;
      idx.push(o, o + 1, o + 3, o + 1, o + 4, o + 3, o + 1, o + 2, o + 4, o + 2, o + 5, o + 4);
    }
  }
  return part(pos, cols, uvs, idx);
}

/** A coconut palm, 5.5–6.5 m tall, its trunk leaning out and curving back up. */
function palm(rand: () => number, lite: boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const h = 5.4 + rand() * 0.9;
  const bend = 0.8 + rand() * 0.8;
  const rings = lite ? 7 : 13;
  const path: V3[] = [];
  const radii: number[] = [];
  for (let i = 0; i < rings; i++) {
    const k = i / (rings - 1);
    path.push(v(bend * (1 - (1 - k) * (1 - k)), -0.1 + k * (h + 0.1), 0));
    const r = THREE.MathUtils.lerp(0.25, 0.17, k) + Math.max(0, 0.12 - k) * 0.9;
    radii.push(r * (i % 2 ? 1.07 : 1));
  }
  parts.push(tube(path, radii, lite ? 6 : 7, (i) => (i % 2 ? PALM_BARK : PALM_SCAR).clone().multiplyScalar(0.9 + rand() * 0.2), 1.5));
  const top = path[rings - 1];
  // The crown shaft, where the fronds come out.
  parts.push(lump(top.clone().add(v(0, 0.15, 0)), 0.3, 1.3, col('#5a6638'), lite ? 0 : 1));
  if (!lite) {
    for (let j = 0; j < 4; j++) {
      const a = j * 1.7 + rand();
      parts.push(lump(top.clone().add(v(Math.cos(a) * 0.26, -0.22 - rand() * 0.12, Math.sin(a) * 0.26)), 0.15, 1.1, col('#5e5832'), 0));
    }
  }
  const n = lite ? 7 : 10;
  const steps = lite ? 6 : 10;
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2 + rand() * 0.35;
    // Young fronds stand up, old ones spread flat and droop more.
    const young = j % 3 === 0;
    const colour = young ? FROND_GREEN : FROND_GREEN.clone().lerp(FROND_OLD, rand() * 0.7);
    parts.push(frond(top.clone().add(v(0, 0.3, 0)), a, 3.8 + rand() * 0.8, young ? 0.9 : 0.45 + rand() * 0.25, young ? 1.3 : 1.8, colour, steps));
  }
  if (!lite) {
    // A couple of dead fronds hanging down against the trunk.
    for (let j = 0; j < 2; j++) parts.push(frond(top.clone(), rand() * Math.PI * 2, 2.6, -1.05, 0.25, FROND_DEAD, 6, 0.45));
  }
  return finish(parts);
}

function finish(parts: THREE.BufferGeometry[]) {
  const geo = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  geo.computeBoundingSphere();
  return geo;
}

export interface TreeKinds {
  broadleaf: THREE.BufferGeometry[];
  palm: THREE.BufferGeometry[];
  /** Cheaper ones for the far wall of jungle. */
  broadleafLite: THREE.BufferGeometry;
  palmLite: THREE.BufferGeometry;
}

export function treeGeometries(rand: () => number): TreeKinds {
  return {
    broadleaf: [broadleaf(rand, false), broadleaf(rand, false)],
    palm: [palm(rand, false), palm(rand, false)],
    broadleafLite: broadleaf(rand, true),
    palmLite: palm(rand, true),
  };
}

/** Storm wind, shared by every tree material: seconds, for the sway. */
const wind = { uWind: { value: 0 } };
export const setWind = (t: number) => (wind.uWind.value = t);

/**
 * The one material every tree uses: the atlas with its cut-out leaves (alpha-tested, so no sorting,
 * and the shadows get the holes too), tinted by the vertex colours, both sides lit alike (light
 * comes through leaves). Vertices sway in the wind, more the higher they are. Each tree sways at
 * its own pace, phase, strength and direction (all from where it stands), with slow, uneven gusts,
 * and a gentler flutter in the leaves.
 */
export function treeMaterial(map: THREE.Texture) {
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = 'uniform float uWind;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float up = max(transformed.y - 1.0, 0.0);
        vec3 at = vec3(0.0);
        // A tree pushed over (its up axis tipped towards the ground) lies still.
        float upright = 1.0;
        #ifdef USE_INSTANCING
          at = instanceMatrix[3].xyz;
          upright = smoothstep(0.55, 0.97, instanceMatrix[1].y / length(instanceMatrix[1].xyz));
        #endif
        // Four random numbers per tree, from where it stands.
        vec4 rnd = fract(sin(vec4(at.x * 12.99 + at.z * 78.23, at.x * 39.35 + at.z * 11.13, at.x * 73.16 + at.z * 52.27, at.x * 27.71 + at.z * 61.91)) * 43758.55);
        float pace = 0.55 + rnd.x * 0.45;
        float t = uWind * pace + rnd.y * 40.0;
        // Uneven gusts: two slow waves out of step, so strong and calm spells come at random.
        float gust = 0.45 + 0.35 * sin(uWind * 0.13 + rnd.z * 6.28) + 0.25 * sin(uWind * 0.31 + rnd.w * 6.28);
        float swayA = sin(t * 0.8) + 0.45 * sin(t * 1.37 + 2.0) + 0.2 * sin(t * 2.71 + rnd.z * 6.28);
        float swayB = sin(t * 0.63 + 1.3) + 0.35 * sin(t * 1.91 + rnd.w * 6.28);
        float k = up * up * 0.005 * gust * (0.7 + rnd.z * 0.6) * upright;
        float dir = rnd.w * 6.28;
        float flutter = sin(uWind * (2.6 + rnd.x) + position.x * 2.1 + position.z * 1.7 + rnd.y * 6.28) * up * 0.01 * (0.5 + gust) * (0.3 + 0.7 * upright);
        transformed.x += (cos(dir) * swayA - sin(dir) * swayB * 0.5) * k + flutter;
        transformed.z += (sin(dir) * swayA + cos(dir) * swayB * 0.5) * k + flutter * 0.6;
        transformed.y += flutter * 0.5;
      }`,
    );
    // Leaves let light through: light a leaf's back like its front instead of in black shadow.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal *= faceDirection;');
  };
  // Keep the swaying program apart from other Lambert programs (the see-through patch wraps this).
  m.customProgramCacheKey = function (this: THREE.Material) {
    return 'tree-sway' + this.onBeforeCompile.toString();
  };
  return m;
}
