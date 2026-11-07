/** Story progress, saved on the device: how far the story has got and which dinosaurs are free to play in Rampage. */
import { load, save } from '../engine/storage';
import { DINOS, type DinoSpec } from './species';
import { HERO, LEVELS } from './levels';

type Id = DinoSpec['id'];
interface Saved { done: number; unlocked: Id[]; best?: number }

function read(): Saved {
  const s = load<Partial<Saved>>('progress', {});
  const done = typeof s.done === 'number' ? Math.max(0, Math.min(LEVELS.length, Math.floor(s.done))) : 0;
  const known = new Set(DINOS.map((d) => d.id));
  const unlocked = (Array.isArray(s.unlocked) ? s.unlocked : []).filter((id) => known.has(id));
  const best = typeof s.best === 'number' && s.best > 0 ? Math.floor(s.best) : 0;
  return { done, unlocked: [HERO, ...unlocked.filter((id) => id !== HERO)], best };
}

/** How many story levels have been finished, in order. */
export const levelsDone = () => read().done;

/** A level can be played once every level before it is done and it has been built. */
export const levelOpen = (i: number) => i <= read().done && LEVELS[i]?.ready === true;

export function completeLevel(i: number) {
  const s = read();
  if (i + 1 > s.done) save('progress', { ...s, done: i + 1 });
}

export const unlockedDinos = () => read().unlocked;

/** True if it was newly unlocked. */
export function unlockDino(id: Id): boolean {
  const s = read();
  if (s.unlocked.includes(id)) return false;
  save('progress', { ...s, unlocked: [...s.unlocked, id] });
  return true;
}

/** Rampage opens once the hero has broken out of the paddock. */
export const rampageOpen = () => read().done >= 1;

/** Rampage's best score. */
export const rampageBest = () => read().best ?? 0;

/** True if it beat the best. */
export function recordRampage(score: number): boolean {
  const s = read();
  if (score <= (s.best ?? 0)) return false;
  save('progress', { ...s, best: Math.floor(score) });
  return true;
}

export function resetProgress() {
  save('progress', { done: 0, unlocked: [HERO], best: 0 });
}
