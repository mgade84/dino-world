import { load, save } from '../../engine/storage';
import type { MapDef } from './types';

export type { MapDef } from './types';

export const DEFAULT_MAP = 'kessick';

/**
 * Every world map: each file in this folder (other than this one, types.ts and source.ts) default-exports a
 * MapDef, and is picked up automatically. Make and change them in the map editor (#/map/<id>), which
 * saves them here when it runs on the dev server; a level plays on one with `map: '<id>'` in levels.ts
 * (its `start` and `intro` positions are on that map).
 */
const files = import.meta.glob<{ default: MapDef }>(['./*.ts', '!./index.ts', '!./types.ts', '!./source.ts'], { eager: true });
export const MAPS: MapDef[] = Object.values(files)
  .map((f) => f.default)
  .sort((a, b) => (a.id === DEFAULT_MAP ? -1 : b.id === DEFAULT_MAP ? 1 : a.id.localeCompare(b.id)));

export const getMap = (id = DEFAULT_MAP): MapDef => MAPS.find((m) => m.id === id) ?? MAPS[0];

// ---- The editor's unsaved maps, kept in this browser ----
const DRAFTS = 'mapdrafts';
export const drafts = () => load<Record<string, MapDef>>(DRAFTS, {});
export function setDraft(map: MapDef | null, id = map?.id) {
  if (!id) return;
  const all = drafts();
  if (map) all[id] = map;
  else delete all[id];
  save(DRAFTS, all);
}

/** A map being tried out from the editor: Rampage plays on it instead of the default while set. */
let trial: MapDef | null = null;
export const setTrial = (map: MapDef | null) => (trial = map);
export const trialMap = () => trial;
