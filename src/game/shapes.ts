/**
 * Flat 2D geometry on the ground plane (x, z) for the world maps' freehand shapes: outlines (lakes,
 * plateaus, volcanoes) and strokes (roads, hills). No Three.js here: the map data and the editor's
 * maths use it too.
 */

export type Pt = [number, number];
/** A bounding box: min x, min z, max x, max z. */
export type Box = [number, number, number, number];

export function boxOf(pts: Pt[], pad = 0): Box {
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}

/** How far outside a box a point is (0 or less inside). */
export const outBox = (b: Box, x: number, z: number) => Math.max(b[0] - x, x - b[2], b[1] - z, z - b[3]);

/** Distance from a point to the segment a–b. */
function toSeg(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = dx * dx + dz * dz;
  const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/** Distance from a point to a stroke (an open path; a single point is a dot). */
export function toPath(x: number, z: number, pts: Pt[]): number {
  if (pts.length === 1) return Math.hypot(x - pts[0][0], z - pts[0][1]);
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, toSeg(x, z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return d;
}

/** Signed distance to a closed outline: positive outside, negative inside. */
export function sdPoly(x: number, z: number, pts: Pt[]): number {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, az] = pts[j];
    const [bx, bz] = pts[i];
    d = Math.min(d, toSeg(x, z, ax, az, bx, bz));
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside ? -d : d;
}

/** The nearest point on a closed outline's edge. */
export function nearestOnPoly(x: number, z: number, pts: Pt[]): Pt {
  let best: Pt = pts[0];
  let bd = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, az] = pts[j];
    const [bx, bz] = pts[i];
    const dx = bx - ax;
    const dz = bz - az;
    const len = dx * dx + dz * dz;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < bd) {
      bd = d;
      best = [px, pz];
    }
  }
  return best;
}

/** Signed area (positive when the corners run anticlockwise in x/z). */
export function area(pts: Pt[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

/** The centre of mass of a closed outline. */
export function centroid(pts: Pt[]): Pt {
  const a = area(pts);
  if (Math.abs(a) < 1e-6) {
    const n = pts.length;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    cx += (pts[j][0] + pts[i][0]) * f;
    cz += (pts[j][1] + pts[i][1]) * f;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

/** Points every `step` metres along a path (closed: back round to the start). */
export function resample(pts: Pt[], step: number, closed = false): Pt[] {
  const src = closed ? [...pts, pts[0]] : pts;
  if (src.length < 2) return pts.map((p) => [p[0], p[1]]);
  const out: Pt[] = [[src[0][0], src[0][1]]];
  let carry = 0;
  for (let i = 1; i < src.length; i++) {
    const [ax, az] = src[i - 1];
    const [bx, bz] = src[i];
    const len = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    while (t <= len) {
      out.push([ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  const last = src[src.length - 1];
  const end = out[out.length - 1];
  if (closed) {
    if (Math.hypot(end[0] - src[0][0], end[1] - src[0][1]) < step * 0.5) out.pop();
  } else if (Math.hypot(end[0] - last[0], end[1] - last[1]) > step * 0.25) out.push([last[0], last[1]]);
  return out;
}

/** Rounds the corners of a freehand path (Chaikin's corner cutting). */
export function soften(pts: Pt[], closed: boolean): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = closed ? [] : [pts[0]];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Drops points that a straight line would pass within `tol` of (Ramer–Douglas–Peucker). */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = toSeg(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A circle as an outline; `wobble` (a seed) makes it an irregular plateau edge instead. */
export function circle(x: number, z: number, r: number, wobble?: number, n = 48): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = wobble === undefined ? 1 : 1 + 0.16 * Math.sin(3 * a + wobble) + 0.09 * Math.sin(5 * a + wobble * 2);
    return [x + Math.cos(a) * r * k, z + Math.sin(a) * r * k] as Pt;
  });
}
