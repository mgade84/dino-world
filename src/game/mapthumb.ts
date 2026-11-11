import { boxOf, circle, coastAt, type Pt } from './shapes';
import type { MapDef, Shape } from './maps/types';

/**
 * A small top-down sketch of a map as inline SVG (no Three.js), for the Rampage map picker: land, sea,
 * lakes, plateaus, volcanoes, roads, the sites, buildings and paddocks. Drawn like the editor: x to the
 * right, z downwards, so the sea is at the bottom.
 */
export function mapThumb(m: MapDef): string {
  const h = m.half;
  const n = (v: number) => (Math.round(v * 10) / 10).toString();
  const pts = (s: Shape): Pt[] => ('pts' in s ? s.pts : circle(s.x, s.z, s.r, undefined, 28));
  const poly = (p: Pt[], attrs: string) => `<polygon points="${p.map(([x, z]) => `${n(x)},${n(z)}`).join(' ')}" ${attrs}/>`;
  const line = (p: Pt[], attrs: string) =>
    p.length > 1 ? `<polyline points="${p.map(([x, z]) => `${n(x)},${n(z)}`).join(' ')}" fill="none" stroke-linecap="round" stroke-linejoin="round" ${attrs}/>` : '';
  const rect = (x: number, z: number, w: number, d: number, attrs: string) =>
    `<rect x="${n(x - w / 2)}" y="${n(z - d / 2)}" width="${n(w)}" height="${n(d)}" ${attrs}/>`;
  // Sea, then the land on it: a coarse grid of the painted coast, each row's land as runs of rectangles.
  const out: string[] = [rect(0, 0, 2 * h, 2 * h, 'fill="#1d3a4a"')];
  const strokes = m.coast ?? [];
  const boxes = strokes.map((s) => boxOf(s.pts, s.w / 2));
  const cells = 64;
  const cell = (2 * h) / cells;
  for (let j = 0; j < cells; j++) {
    const z = -h + (j + 0.5) * cell;
    for (let i = 0; i < cells; ) {
      if (coastAt(m.shore, strokes, -h + (i + 0.5) * cell, z, boxes) >= 0) {
        i++;
        continue;
      }
      let k = i;
      while (k < cells && coastAt(m.shore, strokes, -h + (k + 0.5) * cell, z, boxes) < 0) k++;
      out.push(`<rect x="${n(-h + i * cell)}" y="${n(-h + j * cell)}" width="${n((k - i) * cell + 0.3)}" height="${n(cell + 0.3)}" fill="#2f4a2a"/>`);
      i = k;
    }
  }
  for (const s of m.mesas) out.push(poly(pts(s), 'fill="#6b5a42"'));
  for (const s of m.lakes) out.push(poly(pts(s), 'fill="#2d6478" stroke="#a89a6a" stroke-width="1.5"'));
  for (const r of m.roads) out.push(line(r.pts, `stroke="#7a6a52" stroke-width="${n(r.w)}"`));
  for (const a of [m.town, m.power, m.docks]) out.push(rect(a.x, a.z, a.w, a.d, 'fill="#5a5f5c"'));
  for (const b of m.buildings) out.push(rect(b.x, b.z, b.w * 1.5, b.d * 1.5, 'fill="#c9b48a"'));
  for (const s of m.volcanoes) {
    const p = pts(s);
    const c = p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]);
    const r = p.reduce((a, q) => a + Math.hypot(q[0] - c[0], q[1] - c[1]), 0) / p.length;
    out.push(poly(p, 'fill="#3a2f2b"'), `<circle cx="${n(c[0])}" cy="${n(c[1])}" r="${n(Math.max(2.5, r * 0.24))}" fill="#c8401e"/>`);
  }
  for (const c of m.cars ?? []) out.push(`<circle cx="${n(c.x)}" cy="${n(c.z)}" r="2.2" fill="#f4b63a"/>`);
  for (const c of m.cages) out.push(rect(c.x, c.z, 14, 14, 'fill="none" stroke="#d8d8c8" stroke-width="1.5"'));
  out.push(rect(m.paddock.x, m.paddock.z, 14, 14, 'fill="none" stroke="#c8401e" stroke-width="2.5"'));
  return `<span class="dn-thumb"><svg viewBox="${-h} ${-h} ${2 * h} ${2 * h}" aria-hidden="true">${out.join('')}</svg></span>`;
}
