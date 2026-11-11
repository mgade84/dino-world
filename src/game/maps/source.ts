import type { MapDef } from './types';

/**
 * A map as the source of its file in src/game/maps/: readable TypeScript, numbers to the centimetre, short
 * arrays and objects on one line. The editor saves and downloads maps in this form.
 */
export function mapSource(def: MapDef): string {
  const map = canon(def);
  const num = (v: number) => String(Math.round(v * 100) / 100);
  const key = (k: string) => (/^[a-z_$][\w$]*$/i.test(k) ? k : JSON.stringify(k));
  /** One line, if it fits; null if not. */
  const inline = (v: unknown): string => {
    if (typeof v === 'number') return num(v);
    if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    if (typeof v === 'boolean' || v === null) return String(v);
    if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
    const entries = Object.entries(v as object).filter(([, x]) => x !== undefined);
    return entries.length ? `{ ${entries.map(([k, x]) => `${key(k)}: ${inline(x)}`).join(', ')} }` : '{}';
  };
  const block = (v: unknown, indent: string): string => {
    const one = inline(v);
    if (indent.length + one.length <= 110 || typeof v !== 'object' || v === null) return one;
    const inner = indent + '  ';
    if (Array.isArray(v)) {
      // A long list of points: several to a line.
      if (v.every((p) => Array.isArray(p) && p.every((n) => typeof n === 'number'))) {
        const lines: string[] = [];
        let line = '';
        for (const p of v) {
          const s = inline(p) + ',';
          if (line && inner.length + line.length + s.length > 110) {
            lines.push(inner + line.trimEnd());
            line = '';
          }
          line += s + ' ';
        }
        if (line) lines.push(inner + line.trimEnd());
        return `[\n${lines.join('\n')}\n${indent}]`;
      }
      return `[\n${v.map((x) => inner + block(x, inner) + ',').join('\n')}\n${indent}]`;
    }
    const entries = Object.entries(v as object).filter(([, x]) => x !== undefined);
    return `{\n${entries.map(([k, x]) => `${inner}${key(k)}: ${block(x, inner)},`).join('\n')}\n${indent}}`;
  };
  const name = map.name.en.replace(/\*\//g, '');
  return `import type { MapDef } from './types';

/** ${name}: made in the map editor (#/map/${map.id}). */
const map: MapDef = ${block(map, '')};
export default map;
`;
}

const ORDER: (keyof MapDef)[] = [
  'id', 'name', 'seed', 'half', 'relief', 'hills', 'paddock', 'cages', 'lakes', 'volcanoes', 'mesas', 'roads',
  'shore', 'coast', 'town', 'power', 'docks', 'buildings', 'fences', 'people', 'guards', 'cars', 'plants',
];

/** The map with its fields in the usual order, filling in any a hand-written file left out. */
export function canon(m: MapDef): MapDef {
  const filled = { hills: [], roads: [], buildings: [], people: [], guards: [], cars: [], coast: [], ...(m as Partial<MapDef>) } as MapDef;
  const out: Record<string, unknown> = {};
  for (const k of ORDER) out[k] = filled[k];
  return JSON.parse(JSON.stringify(out)) as MapDef;
}
