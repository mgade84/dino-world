const PREFIX = 'dinoworld:';

export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode / storage full: not critical */
  }
}


/** Graphics detail, chosen in settings. 'auto' adapts to how fast frames are drawn. */
export type Quality = 'auto' | 'high' | 'low';
export const getQuality = () => load<Quality>('quality', 'auto');
export const setQuality = (q: Quality) => save('quality', q);
/** Show a frame-rate readout in the game (for checking speed on a device). */
export const getShowFps = () => load('fps', false);
export const setShowFps = (on: boolean) => save('fps', on);
