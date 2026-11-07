/**
 * Lists every Danish phrase the game passes to say(), using the real string tables,
 * and writes public/voice/da/phrases.json ({ clipKey: text }) for generate.py.
 * When you add or change a say() call, extend the matching section below.
 * Runs in the Dockerfile's phrases stage (also via scripts/voice/build.sh).
 */
import './env';
import { writeFileSync, mkdirSync } from 'node:fs';
import { clipKey } from '../../src/engine/clipkey';
import { setLang } from '../../src/i18n';
import { M as dino } from '../../src/game/strings';
import { DINOS } from '../../src/game/species';
import { LEVELS } from '../../src/game/levels';

setLang('da');

const out = new Set<string>();
const add = (...texts: (string | undefined)[]) => texts.forEach((t) => t && out.add(t));

// Park radio: every story level's lines (spoken through radio() in game.ts).
for (const lv of LEVELS) {
  const r = lv.radio;
  add(r.start.da, r.done.da, r.fail?.da, r.escaped?.da);
}
// Radio call when a caged dinosaur breaks free.
add(...DINOS.map((d) => dino.da.freed(d.name.da)));

const table: Record<string, string> = {};
for (const text of [...out].sort()) {
  const key = clipKey(text);
  if (table[key] && table[key] !== text) throw new Error(`clipKey collision: "${table[key]}" / "${text}"`);
  table[key] = text;
}
mkdirSync('public/voice/da', { recursive: true });
writeFileSync('public/voice/da/phrases.json', JSON.stringify(table, null, 1) + '\n');
console.log(`${Object.keys(table).length} Danish phrases`);
