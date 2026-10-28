import type { GameDef } from '../../types';
import { S } from './strings';

/** Three.js is only downloaded when this game is opened. */
export const dino: GameDef = {
  id: 'dino',
  title: { en: 'Dino World', da: 'Dinoverden' },
  emoji: '🦖',
  color: '#2d9d4f',
  age: '4+',
  start(ctx) {
    const loading = document.createElement('div');
    loading.className = 'dn-loading';
    loading.textContent = S().loading;
    ctx.shell.appendChild(loading);
    let cleanup: (() => void) | null = null;
    let dead = false;
    import('./game')
      .then((m) => {
        if (dead) return;
        loading.remove();
        cleanup = m.runDino(ctx);
      })
      .catch((err) => {
        console.error(err);
        loading.textContent = S().loadFailed;
      });
    return () => {
      dead = true;
      cleanup?.();
      loading.remove();
    };
  },
};
