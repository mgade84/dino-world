import type { GameDef } from '../../types';
import { say, sfx } from '../../engine/audio';
import { S } from './strings';
import './dino.css';

type World = 'land' | 'ocean';

/** Pick a world, then its dinosaur. Three.js and each world are only downloaded when chosen. */
export const dino: GameDef = {
  id: 'dino',
  title: { en: 'Dino World', da: 'Dinoverden' },
  emoji: '🦖',
  color: '#2d9d4f',
  age: '4+',
  start(ctx) {
    let cleanup: (() => void) | null = null;
    let picker: HTMLElement | null = null;
    let dead = false;
    const loading = document.createElement('div');
    loading.className = 'dn-loading';

    function pickWorld() {
      picker = document.createElement('div');
      picker.className = 'dn-pick dn-worlds';
      picker.style.setProperty('--top', `${ctx.topInset}px`);
      picker.innerHTML = `
        <h2>${S().mapPick}</h2>
        <div class="dn-cards">
          <button class="dn-card" data-w="land" style="--c:#2d9d4f"><span class="dn-world-art">🌴🦖</span><span>${S().land}</span></button>
          <button class="dn-card" data-w="ocean" style="--c:#1f8fd0"><span class="dn-world-art">🌊🐟</span><span>${S().ocean}</span></button>
        </div>`;
      picker.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-w]');
        if (!b) return;
        sfx.tap();
        picker?.remove();
        picker = null;
        open(b.dataset.w as World);
      });
      ctx.shell.appendChild(picker);
      say(S().mapPick);
    }

    function open(world: World) {
      loading.textContent = S().loading;
      ctx.shell.appendChild(loading);
      const run = world === 'ocean' ? import('./sea').then((m) => m.runSea) : import('./game').then((m) => m.runDino);
      run
        .then((start) => {
          if (dead) return;
          loading.remove();
          cleanup = start(ctx, { onMap: changeWorld });
        })
        .catch((err) => {
          console.error(err);
          loading.textContent = S().loadFailed;
        });
    }

    function changeWorld() {
      cleanup?.();
      cleanup = null;
      pickWorld();
    }

    pickWorld();
    return () => {
      dead = true;
      cleanup?.();
      picker?.remove();
      loading.remove();
    };
  },
};
