import * as THREE from 'three';
import { L, type Txt } from '../i18n';
import { createTown } from './buildings';
import { createDocks } from './docks';
import { createFences } from './fences';
import { LEVELS } from './levels';
import { DEFAULT_MAP, drafts, getMap, MAPS, setDraft, type MapDef } from './maps';
import { canon, mapSource } from './maps/source';
import type { CarSpot, House, Pt, Shape, Spot } from './maps/types';
import { disposeMerged } from './merge';
import { CAGE, CAR_COLORS, createCage, createCar, createPerson, disposePark } from './park';
import { area, circle, resample, sdPoly, simplify, soften, toPath } from './shapes';
import { createStation } from './station';
import { buildWorld, groundY, rng, SCALE, toLine, useMap } from './world';

/**
 * The map editor (#/map, #/map/<id>): the real 3D world drawn straight from above, with the map's
 * layout on top to edit. Put down and move cages, buildings, fences, people, guard posts and jeeps; draw roads,
 * hills, lakes, plateaus and volcanoes freehand; reseed the trees and rocks. Changes are kept in this
 * browser as a draft until saved: on the dev server Save writes src/game/maps/<id>.ts, and Download gives
 * the same file anywhere. Try it plays Rampage on the map as it stands. x grows to the right and z
 * downwards, the same way the numbers in the map file read.
 */

const T = {
  en: {
    back: 'Back', newMap: 'New', copy: 'Copy', undo: 'Undo', redo: 'Redo', reseed: 'New trees & rocks', tryIt: 'Try it', save: 'Save', download: 'Download', labels: 'Labels',
    saved: 'Saved', unsaved: 'Unsaved changes', draft: 'Not saved yet', saving: 'Saving…', saveFailed: 'Could not save', updating: 'Updating…', savedTo: 'Saved to', ground: 'ground',
    askName: 'Name of the new map:', newName: 'New island', copyOf: 'Copy of',
    revert: 'Discard changes', revertAsk: 'Discard the unsaved changes to this map?', deleteDraft: 'Delete this map', deleteAsk: 'Delete this map? It was never saved to the project.',
    tools: { select: 'Select', erase: 'Erase', cage: 'Cage', building: 'Building', fence: 'Fence', person: 'Person', guard: 'Guard', car: 'Jeep', road: 'Road', lake: 'Lake', hill: 'Hill', mesa: 'Plateau', volcano: 'Volcano' },
    hints: {
      select: 'Tap something to select it, and drag to move it. Drag empty ground to pan.',
      erase: 'Tap or drag over things to remove them.',
      cage: 'Tap to put a cage. Each one gets a dinosaur.',
      building: 'Pick a kind, then tap to put it down. Select it to turn it round or change its size.',
      fence: 'Drag from one end of the fence to the other.',
      person: 'Tap to put a park visitor.',
      guard: 'Tap to put a ranger’s post.',
      car: 'Tap to park a jeep (on a road it lines up with it). A visitor stands beside each. Select it to turn it.',
      road: 'Draw along the road.',
      lake: 'Draw round the edge of the lake, or tap for a round one.',
      hill: 'Draw along a ridge, or tap for a round hill. A negative height digs a hollow.',
      mesa: 'Draw round the edge of the plateau, or tap for a round one.',
      volcano: 'Draw round the foot of the volcano, or tap for a round one. Bigger ones are taller.',
    },
    pan: 'Pan with two fingers, the right mouse button or Space + drag. Zoom with a pinch or the scroll wheel.',
    kinds: { paddock: 'Paddock (start)', cage: 'Cage', building: 'Building', fence: 'Fence', person: 'Person', guard: 'Guard post', car: 'Jeep', road: 'Road', lake: 'Lake', hill: 'Hill', mesa: 'Plateau', volcano: 'Volcano', town: 'Main Street', power: 'Power station', docks: 'Docks' },
    map: 'Map', nameEn: 'Name (English)', nameDa: 'Name (Danish)', half: 'Half width', shore: 'Shore (z)', relief: 'Rolling hills', reliefSeed: 'Hills seed', trees: 'Trees', palms: 'Share of palms', bushes: 'Bushes', rocks: 'Rocks', seed: 'Jungle seed',
    width: 'Width', height: 'Height', depth: 'Depth', radius: 'Radius', level: 'Ground height', style: 'Colours', hp: 'Bites to wreck', turn: 'Turn round', shop: 'Shop', bigShop: 'Big shop', shed: 'Shed', remove: 'Remove', kind: 'Kind', newSeed: 'New', heading: 'Heading (°)',
    siteMoves: 'Moving it takes the buildings, people, guard posts and jeeps on it along.', sizeNote: 'Size in metres (drawn 1.5 times bigger).',
    sea: 'sea', play: 'Play area', intro: 'opening shot', pier: 'Pier', file: 'File',
  },
  da: {
    back: 'Tilbage', newMap: 'Ny', copy: 'Kopiér', undo: 'Fortryd', redo: 'Gentag', reseed: 'Nye træer og sten', tryIt: 'Prøv den', save: 'Gem', download: 'Hent', labels: 'Navne',
    saved: 'Gemt', unsaved: 'Ikke gemte ændringer', draft: 'Ikke gemt endnu', saving: 'Gemmer…', saveFailed: 'Kunne ikke gemme', updating: 'Opdaterer…', savedTo: 'Gemt i', ground: 'jord',
    askName: 'Navn på det nye kort:', newName: 'Ny ø', copyOf: 'Kopi af',
    revert: 'Kassér ændringer', revertAsk: 'Kassér de ikke gemte ændringer på dette kort?', deleteDraft: 'Slet dette kort', deleteAsk: 'Slet dette kort? Det blev aldrig gemt i projektet.',
    tools: { select: 'Vælg', erase: 'Slet', cage: 'Bur', building: 'Bygning', fence: 'Hegn', person: 'Person', guard: 'Vagt', car: 'Jeep', road: 'Vej', lake: 'Sø', hill: 'Bakke', mesa: 'Plateau', volcano: 'Vulkan' },
    hints: {
      select: 'Tryk på noget for at vælge det, og træk for at flytte det. Træk i tom jord for at flytte kortet.',
      erase: 'Tryk eller træk hen over ting for at fjerne dem.',
      cage: 'Tryk for at sætte et bur. Hvert bur får en dinosaur.',
      building: 'Vælg en slags, og tryk for at sætte den. Vælg den for at vende den eller ændre størrelsen.',
      fence: 'Træk fra den ene ende af hegnet til den anden.',
      person: 'Tryk for at sætte en gæst i parken.',
      guard: 'Tryk for at sætte en vagtpost.',
      car: 'Tryk for at parkere en jeep (på en vej retter den sig efter vejen). Der står en gæst ved hver. Vælg den for at dreje den.',
      road: 'Tegn langs vejen.',
      lake: 'Tegn rundt om søens bred, eller tryk for en rund sø.',
      hill: 'Tegn langs en bakkekam, eller tryk for en rund bakke. En negativ højde graver en lavning.',
      mesa: 'Tegn rundt om plateauets kant, eller tryk for et rundt plateau.',
      volcano: 'Tegn rundt om vulkanens fod, eller tryk for en rund vulkan. Større vulkaner er højere.',
    },
    pan: 'Flyt kortet med to fingre, højre museknap eller mellemrum + træk. Zoom ved at knibe eller med musehjulet.',
    kinds: { paddock: 'Indhegning (start)', cage: 'Bur', building: 'Bygning', fence: 'Hegn', person: 'Person', guard: 'Vagtpost', car: 'Jeep', road: 'Vej', lake: 'Sø', hill: 'Bakke', mesa: 'Plateau', volcano: 'Vulkan', town: 'Hovedgaden', power: 'Kraftværk', docks: 'Havn' },
    map: 'Kort', nameEn: 'Navn (engelsk)', nameDa: 'Navn (dansk)', half: 'Halv bredde', shore: 'Kyst (z)', relief: 'Bølgende bakker', reliefSeed: 'Bakkefrø', trees: 'Træer', palms: 'Andel palmer', bushes: 'Buske', rocks: 'Sten', seed: 'Junglefrø',
    width: 'Bredde', height: 'Højde', depth: 'Dybde', radius: 'Radius', level: 'Jordhøjde', style: 'Farver', hp: 'Bid før den er ødelagt', turn: 'Vend om', shop: 'Butik', bigShop: 'Stor butik', shed: 'Skur', remove: 'Fjern', kind: 'Slags', newSeed: 'Ny', heading: 'Retning (°)',
    siteMoves: 'Flytter du den, kommer bygninger, folk, vagtposter og jeeps på den med.', sizeNote: 'Størrelse i meter (tegnet 1,5 gange større).',
    sea: 'hav', play: 'Spilleområde', intro: 'åbningsbillede', pier: 'Mole', file: 'Fil',
  },
};

const CSS = `
.me { position: fixed; inset: 0; background: #14191b; color: #e8e4da; font: 14px/1.3 system-ui, sans-serif; display: flex; flex-direction: column; touch-action: none; user-select: none; -webkit-user-select: none; }
.me button, .me select, .me input { font: inherit; color: inherit; background: #263033; border: 1px solid #3a474b; border-radius: 6px; padding: 6px 10px; }
.me button:disabled { opacity: 0.4; }
.me button[aria-pressed="true"] { background: #3d5a4a; border-color: #6a9a7a; }
.me input { width: 100%; box-sizing: border-box; padding: 5px 8px; user-select: text; -webkit-user-select: text; }
.me-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: calc(env(safe-area-inset-top) + 8px) 12px 8px; background: #0d1112; }
.me-status { font-size: 12px; opacity: 0.75; }
.me-read { margin-left: auto; font-family: ui-monospace, monospace; font-size: 12px; min-width: 15em; text-align: right; }
.me-body { flex: 1; display: flex; min-height: 0; }
.me-tools { display: flex; flex-direction: column; gap: 4px; padding: 8px 6px; background: #0d1112; overflow-y: auto; width: 74px; box-sizing: border-box; }
.me-tools button { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px; font-size: 11px; }
.me-tools button span { font-size: 20px; line-height: 1; }
.me-stage { position: relative; flex: 1; overflow: hidden; }
.me-stage canvas, .me-stage svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.me-stage svg text { paint-order: stroke; stroke: rgba(0, 0, 0, 0.75); stroke-linejoin: round; fill: #fff; }
.me-busy { position: absolute; right: 12px; top: 10px; font-size: 12px; background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 6px; pointer-events: none; }
.me-panel { width: 250px; box-sizing: border-box; padding: 10px 12px calc(env(safe-area-inset-bottom) + 12px); background: #0d1112; overflow-y: auto; }
.me-panel h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7; margin: 14px 0 6px; }
.me-panel h2:first-child { margin-top: 0; }
.me-panel p { font-size: 12px; opacity: 0.75; margin: 4px 0 8px; }
.me-row { display: grid; grid-template-columns: 1fr 88px; gap: 6px; align-items: center; margin: 4px 0; font-size: 13px; }
.me-row.wide { grid-template-columns: 1fr; }
.me-row .pair { display: flex; gap: 4px; }
.me-btns { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
`;

type ToolId = keyof typeof T.en.tools;
const TOOLS: [ToolId, string][] = [
  ['select', '👆'], ['erase', '🧽'], ['cage', '🦖'], ['building', '🏠'], ['fence', '⚡'], ['person', '🧍'], ['guard', '👮'], ['car', '🚙'],
  ['road', '🛣️'], ['lake', '💧'], ['hill', '⛰️'], ['mesa', '🏜️'], ['volcano', '🌋'],
];
const LISTS = { cage: 'cages', building: 'buildings', fence: 'fences', person: 'people', guard: 'guards', car: 'cars', road: 'roads', hill: 'hills', lake: 'lakes', mesa: 'mesas', volcano: 'volcanoes' } as const;
type ListKind = keyof typeof LISTS;
type Kind = ListKind | 'paddock' | 'town' | 'power' | 'docks';
interface Sel { k: Kind; i: number }
// The editor reaches into map items generically (move, inspect); they're plain JSON.
type Item = any;
const isList = (k: Kind): k is ListKind => k in LISTS;
const SITES = ['town', 'power', 'docks'] as const;
type SiteKind = (typeof SITES)[number];
const isSite = (k: Kind): k is SiteKind => (SITES as readonly string[]).includes(k);

const PRESETS: { name: 'shop' | 'bigShop' | 'shed'; w: number; d: number; h: number; hp: number; kind?: 'shed' }[] = [
  { name: 'shop', w: 8, d: 6, h: 4.6, hp: 3 },
  { name: 'bigShop', w: 12, d: 6, h: 7.4, hp: 5 },
  { name: 'shed', w: 8, d: 6, h: 4, hp: 3, kind: 'shed' },
];

const r1 = (v: number) => Math.round(v * 10) / 10;
const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;
const outlineOf = (s: Shape, wobble?: number): Pt[] => ('pts' in s ? s.pts : circle(s.x, s.z, s.r, wobble));
const mesaWobble = (i: number) => 0.4 + i * 1.35;
/** A jeep's footprint in metres (it faces +z at heading 0). */
const CAR_W = 2.5;
const CAR_L = 5.2;
const rad = (deg: number) => (deg * Math.PI) / 180;
/** A point in a jeep's own frame: along its length and across it. */
const carLocal = (c: CarSpot, x: number, z: number) => {
  const dx = x - c.x;
  const dz = z - c.z;
  const s = Math.sin(rad(c.a));
  const k = Math.cos(rad(c.a));
  return { along: dx * s + dz * k, across: dx * k - dz * s };
};

/** A new map: the default island's sites and buildings, and nothing else. */
function blank(id: string, name: string): MapDef {
  const base = getMap(DEFAULT_MAP);
  return canon({
    ...clone(base), id, name: { en: name, da: name }, seed: Math.floor(Math.random() * 1e5), relief: { scale: 1, seed: r1(Math.random() * 20) },
    hills: [], cages: [], lakes: [], volcanoes: [], mesas: [], roads: [], fences: [], people: [], guards: [], cars: [],
  });
}

export function mountMapEditor(root: HTMLElement, id = DEFAULT_MAP): () => void {
  const t = L(T);
  const projectMap = MAPS.find((m) => m.id === id);
  let projectSrc = projectMap ? mapSource(projectMap) : null;
  const stored = drafts()[id];
  if (!projectMap && !stored) {
    location.replace('#/map/' + DEFAULT_MAP);
    return () => {};
  }
  let map: MapDef = canon(stored ?? projectMap!);
  // A draft that matches the file (saved, then reloaded) isn't a draft any more.
  if (stored && projectSrc === mapSource(map)) setDraft(null, id);

  const style = document.createElement('style');
  style.textContent = CSS;
  const el = document.createElement('div');
  el.className = 'me';
  const ids = [...new Set([...MAPS.map((m) => m.id), ...Object.keys(drafts())])];
  const names = (mid: string) => L((drafts()[mid] ?? MAPS.find((m) => m.id === mid)!).name) + (drafts()[mid] ? ' *' : '');
  el.innerHTML = `
    <div class="me-bar">
      <button data-a="back">← ${t.back}</button>
      <select data-a="pick">${ids.map((m) => `<option value="${m}"${m === id ? ' selected' : ''}>${esc(names(m))}</option>`).join('')}</select>
      <button data-a="new">${t.newMap}</button>
      <button data-a="copy">${t.copy}</button>
      <button data-a="undo">↶ ${t.undo}</button>
      <button data-a="redo">↷ ${t.redo}</button>
      <button data-a="reseed">🎲 ${t.reseed}</button>
      <button data-a="try">▶ ${t.tryIt}</button>
      ${import.meta.env.DEV ? `<button data-a="save">💾 ${t.save}</button>` : ''}
      <button data-a="download">⬇ ${t.download}</button>
      <button data-a="labels" aria-pressed="true">${t.labels}</button>
      <span class="me-status"></span>
      <span class="me-read"></span>
    </div>
    <div class="me-body">
      <div class="me-tools">${TOOLS.map(([k, icon]) => `<button data-tool="${k}"><span>${icon}</span>${t.tools[k]}</button>`).join('')}</div>
      <div class="me-stage"><svg xmlns="http://www.w3.org/2000/svg"></svg><div class="me-busy" hidden>${t.updating}</div></div>
      <div class="me-panel"></div>
    </div>`;
  root.append(style, el);
  const $ = <E extends HTMLElement>(q: string) => el.querySelector<E>(q)!;
  const stage = $('.me-stage');
  const svg = el.querySelector('svg')!;
  const read = $('.me-read');
  const status = $('.me-status');
  const panelEl = $('.me-panel');
  const busy = $('.me-busy');

  // ---- Editing state, undo and the draft kept in this browser ----
  let tool: ToolId = 'select';
  let sel: Sel | null = null;
  const opts = { roadW: 7, hillW: 30, hillH: 5, mesaH: 3.5, preset: 0 };
  const undo: string[] = [];
  const redo: string[] = [];
  let note = '';
  const snap = () => JSON.stringify(map);
  const dirty = () => projectSrc !== mapSource(map);
  function persist() {
    if (dirty()) setDraft(map);
    else setDraft(null, map.id);
  }
  function changed(rebuild = true) {
    persist();
    if (rebuild) scheduleBuild();
    refreshBar();
    panel();
    draw();
  }
  function commit(before: string, rebuild = true) {
    if (before === snap()) return;
    undo.push(before);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
    note = '';
    changed(rebuild);
  }
  function step(from: string[], to: string[]) {
    const s = from.pop();
    if (!s) return;
    to.push(snap());
    map = JSON.parse(s) as MapDef;
    sel = null;
    changed();
  }
  function refreshBar() {
    $<HTMLButtonElement>('[data-a="undo"]').disabled = !undo.length;
    $<HTMLButtonElement>('[data-a="redo"]').disabled = !redo.length;
    status.textContent = note || (!projectSrc ? t.draft : dirty() ? t.unsaved : t.saved);
    el.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  }

  // ---- Items: find, move and remove them generically ----
  const cars = () => (map.cars ??= []);
  const get = (s: Sel): Item => (isList(s.k) ? (map[LISTS[s.k]] as unknown[])[s.i] : map[s.k]);
  const removable = (k: Kind) => isList(k);
  function remove(s: Sel) {
    if (isList(s.k)) (map[LISTS[s.k]] as unknown[]).splice(s.i, 1);
  }
  function translate(s: Sel, dx: number, dz: number) {
    const o = get(s);
    if (s.k === 'fence') {
      o[0] += dx;
      o[1] += dz;
      o[2] += dx;
      o[3] += dz;
    } else if (o.pts) for (const p of o.pts as Pt[]) (p[0] += dx), (p[1] += dz);
    else (o.x += dx), (o.z += dz);
  }
  const inRect = (x: number, z: number, cx: number, cz: number, w: number, d: number) => Math.abs(x - cx) < w / 2 && Math.abs(z - cz) < d / 2;
  const insideShape = (s: Shape, x: number, z: number, wobble?: number) => sdPoly(x, z, outlineOf(s, wobble)) < 0;
  /** What's under a point, topmost first: small things before big ones. */
  function pick(x: number, z: number, onlyRemovable = false): Sel | null {
    const tol = 10 * px;
    const last = <V>(list: V[], hit: (v: V, i: number) => boolean) => {
      for (let i = list.length - 1; i >= 0; i--) if (hit(list[i], i)) return i;
      return -1;
    };
    const tests: [Kind, () => number][] = [
      ['person', () => last(map.people, (p) => Math.hypot(x - p.x, z - p.z) < Math.max(1.4, tol))],
      ['guard', () => last(map.guards, (p) => Math.hypot(x - p.x, z - p.z) < Math.max(1.4, tol))],
      ['car', () => last(cars(), (c) => {
        const l = carLocal(c, x, z);
        return Math.abs(l.along) < Math.max(CAR_L / 2, tol) && Math.abs(l.across) < Math.max(CAR_W / 2, tol);
      })],
      ['fence', () => last(map.fences, (l) => toLine(x, z, l) < Math.max(1.5, tol * 0.8))],
      ['building', () => last(map.buildings, (b) => inRect(x, z, b.x, b.z, b.w * SCALE, b.d * SCALE))],
      ['cage', () => last(map.cages, (c) => inRect(x, z, c.x, c.z, CAGE.half * 2, CAGE.half * 2))],
      ['paddock', () => (inRect(x, z, map.paddock.x, map.paddock.z, CAGE.half * 2, CAGE.half * 2) ? 0 : -1)],
      ['volcano', () => last(map.volcanoes, (v) => insideShape(v, x, z))],
      ['mesa', () => last(map.mesas, (m, i) => insideShape(m, x, z, mesaWobble(i)))],
      ['road', () => last(map.roads, (r) => toPath(x, z, r.pts) < Math.max(r.w / 2, tol))],
      ['lake', () => last(map.lakes, (l) => insideShape(l, x, z))],
      ['docks', () => (inRect(x, z, map.docks.x, map.docks.z, map.docks.w, map.docks.d) ? 0 : -1)],
      ['power', () => (inRect(x, z, map.power.x, map.power.z, map.power.w, map.power.d) ? 0 : -1)],
      ['town', () => (inRect(x, z, map.town.x, map.town.z, map.town.w, map.town.d) ? 0 : -1)],
      ['hill', () => last(map.hills, (h) => toPath(x, z, h.pts) < Math.max(h.w / 2, tol))],
    ];
    for (const [k, test] of tests) {
      if (onlyRemovable && !removable(k)) continue;
      const i = test();
      if (i >= 0) return { k, i };
    }
    return null;
  }
  /** Things standing on a site, which move with it. */
  function onSite(k: SiteKind): Sel[] {
    const s = map[k];
    const out: Sel[] = [];
    const add = (kind: ListKind, list: Spot[]) => list.forEach((p, i) => inRect(p.x, p.z, s.x, s.z, s.w + 2, s.d + 2) && out.push({ k: kind, i }));
    add('building', map.buildings);
    add('person', map.people);
    add('guard', map.guards);
    add('car', cars());
    return out;
  }

  // ---- Putting things down ----
  function place(k: Tool, x: number, z: number): Sel | null {
    x = r1(x);
    z = r1(z);
    if (k === 'cage') return { k, i: map.cages.push({ x, z }) - 1 };
    if (k === 'person') return { k, i: map.people.push({ x, z }) - 1 };
    if (k === 'guard') return { k, i: map.guards.push({ x, z }) - 1 };
    if (k === 'car') {
      // On (or by) a road, it lines up with the road; elsewhere it faces +z.
      let a = 0;
      let best = Infinity;
      for (const r of map.roads) {
        for (let j = 1; j < r.pts.length; j++) {
          const [ax, az] = r.pts[j - 1];
          const [bx, bz] = r.pts[j];
          const d = toPath(x, z, [r.pts[j - 1], r.pts[j]]);
          if (d < r.w / 2 + 3 && d < best) {
            best = d;
            a = Math.round((Math.atan2(bx - ax, bz - az) * 180) / Math.PI);
          }
        }
      }
      return { k, i: cars().push({ x, z, a }) - 1 };
    }
    if (k === 'building') {
      const p = PRESETS[opts.preset];
      const shops = map.buildings.filter((b) => b.kind !== 'shed').length;
      const town = map.town;
      const front: 1 | -1 = inRect(x, z, town.x, town.z, town.w, town.d) && z > town.z ? -1 : 1;
      const b: House = { x, z, w: p.w, d: p.d, h: p.h, style: p.kind ? 6 : shops % 6, front, hp: p.hp };
      if (p.kind) b.kind = p.kind;
      return { k, i: map.buildings.push(b) - 1 };
    }
    return null;
  }
  type Tool = ToolId;
  /** A finished freehand stroke or outline, tidied up; a tap makes a round one. */
  function finishDrawing(k: Tool, raw: Pt[]) {
    let len = 0;
    for (let i = 1; i < raw.length; i++) len += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    const tidy = (pts: Pt[]) => pts.map(([x, z]) => [r1(x), r1(z)] as Pt);
    const tap = len < 3;
    const [x, z] = raw[0];
    if (k === 'road') {
      if (tap) return;
      map.roads.push({ pts: tidy(simplify(soften(resample(raw, 1), false), 0.25)), w: opts.roadW });
      sel = { k: 'road', i: map.roads.length - 1 };
    } else if (k === 'hill') {
      map.hills.push({ pts: tap ? [[r1(x), r1(z)]] : tidy(simplify(soften(resample(raw, 1.5), false), 0.4)), w: opts.hillW, h: opts.hillH });
      sel = { k: 'hill', i: map.hills.length - 1 };
    } else if (k === 'lake' || k === 'mesa' || k === 'volcano') {
      const outline = tap ? null : tidy(simplify(soften(resample(raw, 1.5, true), true), 0.35));
      if (outline && (outline.length < 3 || Math.abs(area(outline)) < 40)) return;
      const shape: Shape = outline ? { pts: outline } : { x: r1(x), z: r1(z), r: k === 'volcano' ? 16 : 12 };
      if (k === 'lake') sel = { k, i: map.lakes.push(shape) - 1 };
      else if (k === 'volcano') sel = { k, i: map.volcanoes.push(shape) - 1 };
      else sel = { k, i: map.mesas.push({ ...shape, h: opts.mesaH }) - 1 };
    }
  }

  // ---- The 3D world, rebuilt (a moment after the last change) as the game would build it ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  // The world stands still: draw its shadows once per rebuild, not every time the view pans.
  renderer.shadowMap.autoUpdate = false;
  stage.prepend(renderer.domElement);
  const hemi = new THREE.HemisphereLight('#c4d0d6', '#4a5040', 1.7);
  const sun = new THREE.DirectionalLight('#e0e6ea', 1.6);
  sun.position.set(60, 160, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(4096);
  sun.shadow.bias = -0.0005;
  let scene = new THREE.Scene();
  let parts: { dispose(): void }[] = [];
  let buildTimer = 0;
  function teardown() {
    parts.forEach((p) => p.dispose());
    parts = [];
    disposePark();
    disposeMerged();
  }
  function build() {
    buildTimer = 0;
    teardown();
    useMap(clone(map));
    const s = new THREE.Scene();
    s.background = new THREE.Color('#1c2a2e');
    const reach = map.half + 40;
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
    s.add(hemi, sun, sun.target);
    const world = buildWorld();
    world.setTreeDetail(true);
    world.update(0, 0);
    s.add(world.group);
    parts.push(world, createTown(s), createStation(s), createDocks(s, () => 0.5), createFences(s, true));
    for (const c of [createCage(), ...map.cages.map((c) => createCage(c.x, c.z))]) s.add(c.group);
    const rand = rng(5);
    const stand = (at: Spot, kind: 'visitor' | 'ranger') => {
      const p = createPerson(rand, kind);
      p.group.position.set(at.x, groundY(at.x, at.z), at.z);
      p.group.rotation.y = rand() * Math.PI * 2;
      s.add(p.group);
    };
    map.people.forEach((p) => stand(p, 'visitor'));
    map.guards.forEach((p) => stand(p, 'ranger'));
    cars().forEach((c, i) => {
      const car = createCar(CAR_COLORS[i % CAR_COLORS.length], i % 2 ? '#ffffff' : '#2f2f2f');
      car.group.position.set(c.x, groundY(c.x, c.z), c.z);
      car.group.rotation.y = rad(c.a);
      s.add(car.group);
    });
    scene = s;
    renderer.shadowMap.needsUpdate = true;
    busy.hidden = true;
    draw();
  }
  function scheduleBuild() {
    busy.hidden = false;
    clearTimeout(buildTimer);
    // Long enough for the "Updating" badge to show before the page stalls for the rebuild.
    buildTimer = window.setTimeout(build, 120);
  }

  // ---- The view: centre and width in metres; the camera looks straight down, x right, z down ----
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
  camera.up.set(0, 0, -1);
  const full = map.half * 2 + 30;
  const view = { cx: 0, cz: 0, span: full };
  let w = 1;
  let h = 1;
  /** Metres per screen pixel. */
  let px = 1;
  let labels = true;
  let queued = 0;
  const extent = () => ({ sx: view.span * Math.max(1, w / h), sz: view.span * Math.max(1, h / w) });
  function draw() {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      const { sx, sz } = extent();
      px = sx / w;
      Object.assign(camera, { left: -sx / 2, right: sx / 2, top: sz / 2, bottom: -sz / 2 });
      camera.position.set(view.cx, 300, view.cz);
      camera.lookAt(view.cx, 0, view.cz);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      svg.setAttribute('viewBox', `${view.cx - sx / 2} ${view.cz - sz / 2} ${sx} ${sz}`);
      svg.innerHTML = overlay(view.cx - sx / 2, view.cz - sz / 2, sx, sz);
    });
  }
  function resize() {
    w = Math.max(1, stage.clientWidth);
    h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    draw();
  }

  // ---- The layout on top, in world units ----
  const n = (v: number) => String(r1(v));
  const path = (pts: Pt[], closed: boolean) => (pts.length ? 'M' + pts.map((p) => `${p[0]} ${p[1]}`).join('L') + (closed ? 'Z' : '') : '');
  function overlay(x0: number, z0: number, sx: number, sz: number) {
    const out: string[] = [];
    const font = 12 * px;
    const HI = '#ffe14a';
    const isSel = (k: Kind, i = 0) => !!sel && sel.k === k && sel.i === i;
    const stroke = (colour: string, width: number, dash = '') =>
      `stroke="${colour}" stroke-width="${width * px}"${dash ? ` stroke-dasharray="${dash.split(' ').map((d) => +d * px).join(' ')}"` : ''}`;
    const line = (x1: number, z1: number, x2: number, z2: number, colour: string, width = 1.5, dash = '') =>
      out.push(`<line x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}" ${stroke(colour, width, dash)} stroke-linecap="round"/>`);
    const rect = (cx: number, cz: number, rw: number, rd: number, colour: string, selected = false, dash = '', fill = 'none') =>
      out.push(`<rect x="${cx - rw / 2}" y="${cz - rd / 2}" width="${rw}" height="${rd}" fill="${fill}" ${stroke(selected ? HI : colour, selected ? 3 : 2, dash)}/>`);
    const shape = (pts: Pt[], colour: string, fill: string, selected: boolean, dash = '') =>
      out.push(`<path d="${path(pts, true)}" fill="${fill}" ${stroke(selected ? HI : colour, selected ? 3 : 2, dash)}/>`);
    const text = (x: number, z: number, s: string, size = 1, anchor = 'middle', weight = 600) => {
      if (labels) out.push(`<text x="${x}" y="${z}" font-size="${font * size}" stroke-width="${3 * px}" text-anchor="${anchor}" font-weight="${weight}" dominant-baseline="middle">${esc(s)}</text>`);
    };
    const dot = (x: number, z: number, r: number, fill: string, selected: boolean) =>
      out.push(`<circle cx="${x}" cy="${z}" r="${Math.max(r, 4 * px)}" fill="${fill}" ${stroke(selected ? HI : '#000', selected ? 3 : 1.5)}/>`);

    // Grid, finer when zoomed in, numbered along the top and left edges.
    const gstep = sx > 160 ? 25 : sx > 60 ? 10 : 5;
    for (let gx = Math.ceil(x0 / gstep) * gstep; gx <= x0 + sx; gx += gstep) {
      line(gx, z0, gx, z0 + sz, gx === 0 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.13)', 1);
      out.push(`<text x="${gx}" y="${z0 + 10 * px}" font-size="${font * 0.85}" stroke-width="${3 * px}" text-anchor="middle" dominant-baseline="middle">${gx}</text>`);
    }
    for (let gz = Math.ceil(z0 / gstep) * gstep; gz <= z0 + sz; gz += gstep) {
      line(x0, gz, x0 + sx, gz, gz === 0 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.13)', 1);
      out.push(`<text x="${x0 + 6 * px}" y="${gz}" font-size="${font * 0.85}" stroke-width="${3 * px}" text-anchor="start" dominant-baseline="middle">${gz}</text>`);
    }
    out.push(`<text x="${x0 + sx - 8 * px}" y="${z0 + 10 * px}" font-size="${font}" stroke-width="${3 * px}" text-anchor="end" dominant-baseline="middle">x →</text>`);
    out.push(`<text x="${x0 + 6 * px}" y="${z0 + sz - 12 * px}" font-size="${font}" stroke-width="${3 * px}" text-anchor="start" dominant-baseline="middle">z ↓</text>`);

    const H = map.half;
    rect(0, 0, H * 2, H * 2, '#e8d36a', false, '6 4');
    text(-H + 4, -H - 5, `${t.play} ±${H}`, 1, 'start');
    line(-H - 30, map.shore, H + 30, map.shore, '#7fd0e6', 2, '8 5');
    text(H - 4, map.shore + 5, `z ${n(map.shore)} · ${t.sea} ↓`, 1, 'end');

    // Ground shapes first, then roads, then things standing on the ground.
    map.hills.forEach((hl, i) => {
      const sel_ = isSel('hill', i);
      const d = path(hl.pts.length === 1 ? [hl.pts[0], [hl.pts[0][0] + 0.01, hl.pts[0][1]]] : hl.pts, false);
      out.push(`<path d="${d}" fill="none" stroke="${hl.h < 0 ? 'rgba(120,160,255,0.22)' : 'rgba(230,190,110,0.22)'}" stroke-width="${hl.w}" stroke-linecap="round" stroke-linejoin="round"/>`);
      out.push(`<path d="${d}" fill="none" ${stroke(sel_ ? HI : '#e6c878', sel_ ? 3 : 1.5, '5 4')} stroke-linecap="round"/>`);
      text(hl.pts[0][0], hl.pts[0][1] - 4 * px - font, `${t.kinds.hill} ${hl.h > 0 ? '+' : ''}${n(hl.h)}`, 0.85, 'middle', 400);
    });
    map.lakes.forEach((l, i) => {
      const pts = outlineOf(l);
      shape(pts, '#7fd0e6', 'rgba(127,208,230,0.12)', isSel('lake', i));
      text(...centre(pts), t.kinds.lake);
    });
    map.mesas.forEach((m, i) => {
      const pts = outlineOf(m, mesaWobble(i));
      shape(pts, '#d2a878', 'rgba(210,168,120,0.1)', isSel('mesa', i), '6 4');
      text(...centre(pts), `${t.kinds.mesa} h ${n(m.h)}`);
    });
    map.volcanoes.forEach((v, i) => {
      const pts = outlineOf(v);
      shape(pts, '#ff8a3a', 'rgba(255,138,58,0.12)', isSel('volcano', i));
      text(...centre(pts), t.kinds.volcano);
    });
    map.roads.forEach((r, i) => {
      const d = path(r.pts, false);
      out.push(`<path d="${d}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="${r.w}" stroke-linecap="round" stroke-linejoin="round"/>`);
      out.push(`<path d="${d}" fill="none" ${stroke(isSel('road', i) ? HI : 'rgba(255,255,255,0.7)', isSel('road', i) ? 3 : 1.2, '6 5')}/>`);
    });
    const site = (k: SiteKind) => {
      const s = map[k];
      rect(s.x, s.z, s.w, s.d, '#ffffff', isSel(k));
      text(s.x, s.z - s.d / 2 - 5, `${t.kinds[k]} · y ${n(s.y)}`);
    };
    SITES.forEach(site);
    const pier = map.docks;
    rect(pier.x, (map.shore - 6 + map.shore + 21) / 2, 4.4, 27, '#d8c79a');
    text(pier.x + 5, map.shore + 18, t.pier, 0.85, 'start', 400);
    map.buildings.forEach((b, i) => {
      const bw = b.w * SCALE;
      const bd = b.d * SCALE;
      rect(b.x, b.z, bw, bd, '#f0dcb4', isSel('building', i), '', 'rgba(240,220,180,0.12)');
      // A thick mark along the side with the door.
      const fz = b.z + (b.front * bd) / 2;
      line(b.x - bw / 4, fz, b.x + bw / 4, fz, isSel('building', i) ? HI : '#f0dcb4', 4);
    });
    // The power station's own fence, then the map's fences (with handles on the ends of a selected one).
    const P = map.power;
    const [pw, pe, ps, pn] = [P.x - P.w / 2, P.x + P.w / 2, P.z - P.d / 2, P.z + P.d / 2];
    for (const [a, b, c, d] of [[pw, pn, pe, pn], [pw, ps, pe, ps], [pw, ps, pw, pn], [pe, ps, pe, P.z - 4], [pe, P.z + 4, pe, pn]]) line(a, b, c, d, '#c84848', 2);
    map.fences.forEach(([x1, z1, x2, z2], i) => {
      const s_ = isSel('fence', i);
      line(x1, z1, x2, z2, s_ ? HI : '#ff5a5a', s_ ? 3.5 : 2.5);
      if (s_) for (const [hx, hz] of [[x1, z1], [x2, z2]]) out.push(`<circle cx="${hx}" cy="${hz}" r="${7 * px}" fill="${HI}" ${stroke('#000', 1.5)}/>`);
    });
    rect(map.paddock.x, map.paddock.z, CAGE.half * 2, CAGE.half * 2, '#9cf08a', isSel('paddock'));
    text(map.paddock.x, map.paddock.z + CAGE.half + 5, t.kinds.paddock);
    map.cages.forEach((c, i) => {
      rect(c.x, c.z, CAGE.half * 2, CAGE.half * 2, '#c8b0ff', isSel('cage', i));
      text(c.x, c.z + CAGE.half + 5, `${t.kinds.cage} ${i + 1}`);
    });
    map.people.forEach((p, i) => dot(p.x, p.z, 0.9, '#ffffff', isSel('person', i)));
    map.guards.forEach((p, i) => dot(p.x, p.z, 0.9, '#4aa8ff', isSel('guard', i)));
    cars().forEach((c, i) => {
      const s_ = isSel('car', i);
      const f = [Math.sin(rad(c.a)), Math.cos(rad(c.a))];
      const sd = [f[1], -f[0]];
      const corner = (l: number, w_: number): Pt => [c.x + f[0] * l + sd[0] * w_, c.z + f[1] * l + sd[1] * w_];
      const body = [corner(CAR_L / 2, CAR_W / 2), corner(CAR_L / 2, -CAR_W / 2), corner(-CAR_L / 2, -CAR_W / 2), corner(-CAR_L / 2, CAR_W / 2)];
      shape(body, '#ffb84a', 'rgba(255,184,74,0.2)', s_);
      // An arrow out of the front, so the heading reads at any zoom.
      const tip = corner(CAR_L / 2 + Math.max(1.5, 10 * px), 0);
      line(c.x, c.z, tip[0], tip[1], s_ ? HI : '#ffb84a', 2.5);
    });

    // Each level on this map: where the dinosaur starts (and which way it faces), and the opening shot.
    LEVELS.forEach((lv, i) => {
      if ((lv.map ?? DEFAULT_MAP) !== map.id || !labels) return;
      const name = `${i + 1}. ${L(lv.name as Txt)}`;
      const { from, to, look } = lv.intro;
      line(from[0], from[2], to[0], to[2], 'rgba(255,216,74,0.6)', 1.2, '4 3');
      line(to[0], to[2], look[0], look[2], 'rgba(255,216,74,0.3)', 1, '2 3');
      text(from[0], from[2] - 4, `${name}: ${t.intro}`, 0.75, 'middle', 400);
      if (Array.isArray(lv.start)) {
        const [x, z, hd] = lv.start;
        out.push(`<circle cx="${x}" cy="${z}" r="${5 * px}" fill="#4af0ff" ${stroke('#000', 1.5)}/>`);
        line(x, z, x + Math.sin(hd) * 18 * px, z + Math.cos(hd) * 18 * px, '#4af0ff', 3);
        text(x, z + 12 * px, name, 0.85);
      } else text(map.paddock.x, map.paddock.z - CAGE.half - 5 - i * 1.4 * font, name, 0.85);
    });

    // What's being drawn right now.
    if (gesture?.kind === 'draw') {
      const g = gesture;
      if (g.tool === 'road' || g.tool === 'hill') {
        const wide = g.tool === 'road' ? opts.roadW : opts.hillW;
        out.push(`<path d="${path(g.pts, false)}" fill="none" stroke="rgba(255,225,74,0.25)" stroke-width="${wide}" stroke-linecap="round" stroke-linejoin="round"/>`);
        out.push(`<path d="${path(g.pts, false)}" fill="none" ${stroke(HI, 2)}/>`);
      } else out.push(`<path d="${path(g.pts, true)}" fill="rgba(255,225,74,0.15)" ${stroke(HI, 2)}/>`);
    } else if (gesture?.kind === 'fence') line(gesture.a[0], gesture.a[1], gesture.b[0], gesture.b[1], HI, 3);
    return out.join('');
  }
  const centre = (pts: Pt[]): [number, number] => {
    let x = 0;
    let z = 0;
    for (const p of pts) (x += p[0]), (z += p[1]);
    return [x / pts.length, z / pts.length];
  };

  // ---- The side panel: the tool's options, then the selected thing (or the map) ----
  function panel() {
    panelEl.innerHTML = '';
    const h2 = (s: string) => panelEl.appendChild(Object.assign(document.createElement('h2'), { textContent: s }));
    const para = (s: string) => panelEl.appendChild(Object.assign(document.createElement('p'), { textContent: s }));
    const button = (label: string, on: () => void, pressed?: boolean) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
      b.addEventListener('click', on);
      return b;
    };
    const buttons = (...bs: HTMLButtonElement[]) => {
      const row = document.createElement('div');
      row.className = 'me-btns';
      row.append(...bs);
      panelEl.appendChild(row);
    };
    /** A number (or text) field; `set` changes the map (and is undoable) or, with `live`, just an option. */
    const field = (label: string, value: number | string, set: (v: number & string) => void, o: { step?: number; text?: boolean; opt?: boolean; extra?: HTMLButtonElement } = {}) => {
      const row = document.createElement('label');
      row.className = o.text ? 'me-row wide' : 'me-row';
      const input = document.createElement('input');
      input.type = o.text ? 'text' : 'number';
      if (!o.text) input.step = String(o.step ?? 0.5);
      input.value = typeof value === 'number' ? n(value) : value;
      input.addEventListener('change', () => {
        const v = o.text ? input.value.trim() : parseFloat(input.value);
        if (typeof v === 'number' && !isFinite(v)) return;
        if (typeof v === 'string' && !v) return;
        if (o.opt) return set(v as number & string);
        const before = snap();
        set(v as number & string);
        commit(before);
      });
      const pair = document.createElement('span');
      pair.className = 'pair';
      pair.append(input);
      if (o.extra) pair.append(o.extra);
      row.append(Object.assign(document.createElement('span'), { textContent: label }), pair);
      panelEl.appendChild(row);
    };
    const edit = (fn: () => void) => () => {
      const before = snap();
      fn();
      commit(before);
    };

    h2(t.tools[tool]);
    para(t.hints[tool]);
    if (tool === 'building') buttons(...PRESETS.map((p, i) => button(t[p.name], () => ((opts.preset = i), panel()), opts.preset === i)));
    if (tool === 'road') field(t.width, opts.roadW, (v) => (opts.roadW = Math.max(2, v)), { opt: true });
    if (tool === 'hill') {
      field(t.width, opts.hillW, (v) => (opts.hillW = Math.max(4, v)), { opt: true, step: 1 });
      field(t.height, opts.hillH, (v) => (opts.hillH = v), { opt: true });
    }
    if (tool === 'mesa') field(t.height, opts.mesaH, (v) => (opts.mesaH = v), { opt: true, step: 0.1 });

    if (sel) {
      const s = sel;
      const o = get(s);
      h2(t.kinds[s.k]);
      if (s.k === 'fence') {
        ['x1', 'z1', 'x2', 'z2'].forEach((label, j) => field(label, o[j], (v) => (o[j] = v)));
      } else if (!o.pts) {
        field('x', o.x, (v) => (o.x = v));
        field('z', o.z, (v) => (o.z = v));
      }
      if (s.k === 'car') {
        field(t.heading, o.a, (v) => (o.a = Math.round((((v % 360) + 360) % 360))), { step: 15 });
        // z grows downwards on screen, so a bigger heading turns it anticlockwise there.
        buttons(button('↺ 45°', edit(() => (o.a = (o.a + 45) % 360))), button('↻ 45°', edit(() => (o.a = (o.a + 315) % 360))));
      }
      if ('r' in o) field(t.radius, o.r, (v) => (o.r = Math.max(2, v)));
      if (s.k === 'building') {
        field(t.width, o.w, (v) => (o.w = Math.max(3, v)));
        field(t.depth, o.d, (v) => (o.d = Math.max(3, v)));
        field(t.height, o.h, (v) => (o.h = Math.max(2.5, v)), { step: 0.2 });
        field(t.hp, o.hp ?? 3, (v) => (o.hp = Math.max(1, Math.round(v))), { step: 1 });
        field(t.style, o.style, (v) => (o.style = Math.round(v)), { step: 1 });
        para(t.sizeNote);
        buttons(
          button(t.turn, edit(() => (o.front = -o.front))),
          button(t.shop, edit(() => delete o.kind), o.kind !== 'shed'),
          button(t.shed, edit(() => (o.kind = 'shed')), o.kind === 'shed'),
        );
      }
      if (isSite(s.k)) {
        field(t.width, o.w, (v) => (o.w = Math.max(6, v)));
        field(t.depth, o.d, (v) => (o.d = Math.max(6, v)));
        field(t.level, o.y, (v) => (o.y = v), { step: 0.1 });
        para(t.siteMoves);
      }
      if (s.k === 'road') field(t.width, o.w, (v) => (o.w = Math.max(2, v)));
      if (s.k === 'hill') {
        field(t.width, o.w, (v) => (o.w = Math.max(4, v)), { step: 1 });
        field(t.height, o.h, (v) => (o.h = v));
      }
      if (s.k === 'mesa') field(t.height, o.h, (v) => (o.h = v), { step: 0.1 });
      if (removable(s.k)) buttons(button(`🗑 ${t.remove}`, edit(() => {
        remove(s);
        sel = null;
      })));
      return;
    }

    h2(t.map);
    field(t.nameEn, map.name.en, (v) => (map.name.en = v), { text: true });
    field(t.nameDa, map.name.da, (v) => (map.name.da = v), { text: true });
    field(t.half, map.half, (v) => (map.half = THREE.MathUtils.clamp(v, 50, 250)), { step: 5 });
    field(t.shore, map.shore, (v) => (map.shore = v), { step: 1 });
    field(t.relief, map.relief.scale, (v) => (map.relief.scale = Math.max(0, v)), { step: 0.1 });
    field(t.reliefSeed, map.relief.seed, (v) => (map.relief.seed = v), { step: 0.1, extra: button('🎲', edit(() => (map.relief.seed = r1(Math.random() * 20)))) });
    field(t.trees, map.plants.trees, (v) => (map.plants.trees = Math.max(0, Math.round(v))), { step: 10 });
    field(t.palms, map.plants.palms, (v) => (map.plants.palms = THREE.MathUtils.clamp(v, 0, 1)), { step: 0.05 });
    field(t.bushes, map.plants.bushes, (v) => (map.plants.bushes = Math.max(0, Math.round(v))), { step: 10 });
    field(t.rocks, map.plants.rocks, (v) => (map.plants.rocks = Math.max(0, Math.round(v))), { step: 5 });
    field(t.seed, map.seed, (v) => (map.seed = Math.round(v)), { step: 1, extra: button('🎲', reseed) });
    para(`${t.file}: src/game/maps/${map.id}.ts`);
    if (projectSrc && dirty()) {
      buttons(button(t.revert, () => {
        if (!confirm(t.revertAsk)) return;
        const before = snap();
        map = canon(projectMap!);
        commit(before);
      }));
    } else if (!projectSrc) {
      buttons(button(`🗑 ${t.deleteDraft}`, () => {
        if (!confirm(t.deleteAsk)) return;
        setDraft(null, map.id);
        location.hash = '#/map/' + DEFAULT_MAP;
      }));
    }
  }

  // ---- The top bar ----
  const reseed = () => {
    const before = snap();
    map.seed = Math.floor(Math.random() * 1e5);
    commit(before);
  };
  function newId(name: string) {
    let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    if (!/^[a-z]/.test(base)) base = 'island-' + base;
    base = base.replace(/-+$/, '');
    if (['index', 'types', 'source'].includes(base)) base += '-map';
    const taken = new Set([...MAPS.map((m) => m.id), ...Object.keys(drafts())]);
    let out = base;
    for (let k = 2; taken.has(out); k++) out = `${base}-${k}`;
    return out;
  }
  function open(next: MapDef) {
    setDraft(next);
    location.hash = '#/map/' + next.id;
  }
  function download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([mapSource(map)], { type: 'text/plain' }));
    a.download = `${map.id}.ts`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function saveToProject() {
    if (!import.meta.env.DEV) return;
    note = t.saving;
    refreshBar();
    try {
      const source = mapSource(map);
      const res = await fetch('/__maps/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: map.id, source }) });
      if (!res.ok) throw new Error(await res.text());
      const { file } = (await res.json()) as { file: string };
      projectSrc = source;
      setDraft(null, map.id);
      note = `${t.savedTo} ${file}`;
    } catch (err) {
      note = `${t.saveFailed}: ${String((err as Error).message ?? err)}`;
    }
    refreshBar();
    panel();
  }
  const actions: Record<string, () => void> = {
    back: () => (location.hash = '#/'),
    new: () => {
      const name = prompt(t.askName, t.newName)?.trim();
      if (name) open(blank(newId(name), name));
    },
    copy: () => {
      const name = prompt(t.askName, `${t.copyOf} ${L(map.name)}`)?.trim();
      if (name) open({ ...clone(map), id: newId(name), name: { en: name, da: name } });
    },
    undo: () => step(undo, redo),
    redo: () => step(redo, undo),
    reseed,
    try: () => {
      persist();
      location.hash = '#/rampage/try/' + map.id;
    },
    save: () => void saveToProject(),
    download,
    labels: () => {
      labels = !labels;
      $('[data-a="labels"]').setAttribute('aria-pressed', String(labels));
      draw();
    },
  };
  el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.a!]?.()));
  $<HTMLSelectElement>('[data-a="pick"]').addEventListener('change', (e) => (location.hash = '#/map/' + (e.target as HTMLSelectElement).value));
  el.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      tool = b.dataset.tool as ToolId;
      if (tool !== 'select') sel = null;
      refreshBar();
      panel();
      draw();
    }),
  );

  // ---- Pointer gestures: select and drag, put down, draw, erase; pan and zoom ----
  type Gesture =
    | { kind: 'pan'; moved: boolean }
    | { kind: 'move'; sels: Sel[]; last: Pt; before: string; moved: boolean }
    | { kind: 'end'; i: number; end: 0 | 1; before: string }
    | { kind: 'draw'; tool: ToolId; pts: Pt[] }
    | { kind: 'fence'; a: Pt; b: Pt }
    | { kind: 'erase'; before: string };
  let gesture: Gesture | null = null;
  let spaceHeld = false;
  const pointers = new Map<number, { x: number; y: number }>();
  const toWorld = (cx: number, cy: number): Pt => {
    const r = stage.getBoundingClientRect();
    const { sx, sz } = extent();
    return [view.cx + ((cx - r.left) / w - 0.5) * sx, view.cz + ((cy - r.top) / h - 0.5) * sz];
  };
  const zoom = (k: number, cx: number, cy: number) => {
    const before = toWorld(cx, cy);
    view.span = THREE.MathUtils.clamp(view.span * k, 15, full * 1.5);
    const after = toWorld(cx, cy);
    view.cx += before[0] - after[0];
    view.cz += before[1] - after[1];
    draw();
  };
  function eraseAt([x, z]: Pt) {
    const hit = pick(x, z, true);
    if (!hit) return;
    remove(hit);
    sel = null;
    draw();
  }
  function onDown(e: PointerEvent) {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size > 1) {
      // A second finger: pinch and pan instead, dropping what the first had started.
      if (gesture?.kind === 'move' || gesture?.kind === 'end' || gesture?.kind === 'erase') {
        map = JSON.parse(gesture.before) as MapDef;
        changed(false);
      }
      gesture = { kind: 'pan', moved: true };
      draw();
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || e.button === 2 || spaceHeld) {
      gesture = { kind: 'pan', moved: true };
      return;
    }
    const before = snap();
    if (tool === 'select') {
      // A selected fence's ends can be dragged on their own.
      if (sel?.k === 'fence') {
        const f = map.fences[sel.i];
        for (const end of [0, 1] as const) {
          if (Math.hypot(p[0] - f[end * 2], p[1] - f[end * 2 + 1]) < 10 * px) {
            gesture = { kind: 'end', i: sel.i, end, before };
            return;
          }
        }
      }
      const hit = pick(p[0], p[1]);
      if (!hit) {
        gesture = { kind: 'pan', moved: false };
        return;
      }
      sel = hit;
      panel();
      draw();
      gesture = { kind: 'move', sels: [hit, ...(isSite(hit.k) ? onSite(hit.k) : [])], last: p, before, moved: false };
    } else if (tool === 'erase') {
      gesture = { kind: 'erase', before };
      eraseAt(p);
    } else if (tool === 'cage' || tool === 'building' || tool === 'person' || tool === 'guard' || tool === 'car') {
      const placed = place(tool, p[0], p[1]);
      if (!placed) return;
      sel = placed;
      gesture = { kind: 'move', sels: [placed], last: p, before, moved: true };
      panel();
      draw();
    } else if (tool === 'fence') gesture = { kind: 'fence', a: p, b: p };
    else gesture = { kind: 'draw', tool, pts: [p] };
  }
  function onMove(e: PointerEvent) {
    const p = toWorld(e.clientX, e.clientY);
    read.textContent = `x ${n(p[0])}  z ${n(p[1])}  ${t.ground} ${n(groundY(p[0], p[1]))}`;
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([pid]) => pid !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      // Pan by half the finger's movement (the other finger's moves do the other half), and zoom by the spread.
      view.cx -= ((e.clientX - prev.x) / 2 / w) * extent().sx;
      view.cz -= ((e.clientY - prev.y) / 2 / h) * extent().sz;
      if (before > 0 && after > 0) zoom(before / after, (e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
      draw();
    } else if (gesture?.kind === 'pan') {
      if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 0) gesture.moved = true;
      view.cx -= ((e.clientX - prev.x) / w) * extent().sx;
      view.cz -= ((e.clientY - prev.y) / h) * extent().sz;
      draw();
    } else if (gesture?.kind === 'move') {
      const dx = p[0] - gesture.last[0];
      const dz = p[1] - gesture.last[1];
      if (!gesture.moved && Math.hypot(dx, dz) < 4 * px) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        return;
      }
      gesture.moved = true;
      for (const s of gesture.sels) translate(s, dx, dz);
      gesture.last = p;
      draw();
    } else if (gesture?.kind === 'end') {
      map.fences[gesture.i][gesture.end * 2] = r1(p[0]);
      map.fences[gesture.i][gesture.end * 2 + 1] = r1(p[1]);
      draw();
    } else if (gesture?.kind === 'draw') {
      const last = gesture.pts[gesture.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > Math.max(0.5, 3 * px)) gesture.pts.push(p);
      draw();
    } else if (gesture?.kind === 'fence') {
      gesture.b = p;
      draw();
    } else if (gesture?.kind === 'erase') eraseAt(p);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  function onUp(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size) return;
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (g.kind === 'pan') {
      if (!g.moved && tool === 'select') {
        sel = null;
        panel();
      }
      draw();
    } else if (g.kind === 'move') {
      if (g.moved) {
        // Tidy the numbers the drag left behind.
        for (const s of g.sels) {
          const o = get(s);
          if (s.k === 'fence') for (let j = 0; j < 4; j++) o[j] = r1(o[j]);
          else if (o.pts) o.pts = (o.pts as Pt[]).map(([x, z]) => [r1(x), r1(z)]);
          else (o.x = r1(o.x)), (o.z = r1(o.z));
        }
      }
      commit(g.before);
      draw();
    } else if (g.kind === 'end' || g.kind === 'erase') commit(g.before);
    else if (g.kind === 'fence') {
      if (Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) >= 3) {
        const before = snap();
        map.fences.push([r1(g.a[0]), r1(g.a[1]), r1(g.b[0]), r1(g.b[1])]);
        sel = { k: 'fence', i: map.fences.length - 1 };
        commit(before);
      }
      draw();
    } else if (g.kind === 'draw') {
      const before = snap();
      finishDrawing(g.tool, g.pts);
      commit(before);
      draw();
    }
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    zoom(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY);
  };
  const typing = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement;
  const onKey = (e: KeyboardEvent) => {
    if (typing()) return;
    if (e.type === 'keyup') {
      if (e.code === 'Space') spaceHeld = false;
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') {
      spaceHeld = true;
      e.preventDefault();
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      step(e.shiftKey ? redo : undo, e.shiftKey ? undo : redo);
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      step(redo, undo);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel && removable(sel.k)) {
      e.preventDefault();
      const before = snap();
      remove(sel);
      sel = null;
      commit(before);
    } else if (e.key === 'Escape') {
      gesture = null;
      sel = null;
      panel();
      draw();
    }
  };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('resize', resize);
  refreshBar();
  panel();
  resize();
  build();

  return () => {
    cancelAnimationFrame(queued);
    clearTimeout(buildTimer);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('resize', resize);
    teardown();
    renderer.dispose();
    el.remove();
    style.remove();
  };
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
