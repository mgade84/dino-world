/**
 * Lists every Danish phrase the games pass to say(), using the real string tables,
 * and writes public/voice/da/phrases.json ({ clipKey: text }) for generate.py.
 * When you add or change a say() call, extend the matching section below.
 * Runs in the Dockerfile's phrases stage (also via scripts/voice/build.sh).
 */
import './env';
import { writeFileSync, mkdirSync } from 'node:fs';
import { clipKey } from '../../src/engine/clipkey';
import { setLang, UI } from '../../src/i18n';
import { M as dino } from '../../src/game/strings';
import { DINOS, SEA_DINOS } from '../../src/game/species';

setLang('da');

const out = new Set<string>();
const add = (...texts: string[]) => texts.forEach((t) => out.add(t));

// Shell: celebrate() speaks its title.
add(UI.da.greatJob);

// World picker.
add(dino.da.mapPick);
// Jungle: picker, dinosaur names, the cage escape, freeing the others and the finale.
add(dino.da.pick, dino.da.escapeHint, dino.da.escaped, dino.da.done, dino.da.flyHint, ...DINOS.map((d) => d.name.da));
add(...DINOS.map((d) => dino.da.freed(d.name.da)));
// Ocean.
add(dino.da.seaHint, ...SEA_DINOS.map((d) => d.name.da));

const table: Record<string, string> = {};
for (const text of [...out].sort()) {
  const key = clipKey(text);
  if (table[key] && table[key] !== text) throw new Error(`clipKey collision: "${table[key]}" / "${text}"`);
  table[key] = text;
}
mkdirSync('public/voice/da', { recursive: true });
writeFileSync('public/voice/da/phrases.json', JSON.stringify(table, null, 1) + '\n');
console.log(`${Object.keys(table).length} Danish phrases`);
