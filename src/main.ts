import './style.css';
import { dino } from './game';

const games = [dino];
import { mountMenu } from './menu';
import { mountSettings } from './settings';
import { mountGame } from './shell';
import { unlockAudio } from './engine/audio';

const app = document.getElementById('app')!;

// iOS only allows audio to start from a user gesture; also re-resumes after
// the context gets interrupted (e.g. app switch).
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click']) {
  window.addEventListener(ev, unlockAudio, { capture: true, passive: true });
}

// Safari ignores user-scalable=no; stop pinch-zoom and long-press menus here.
for (const ev of ['gesturestart', 'gesturechange', 'contextmenu']) {
  document.addEventListener(ev, (e) => e.preventDefault());
}

let unmount: (() => void) | null = null;

function route() {
  unmount?.();
  unmount = null;
  const id = location.hash.replace(/^#\/?/, '');
  const def = games.find((g) => g.id === id);
  const home = () => (location.hash = '#/');
  if (id === 'settings') unmount = mountSettings(app, home, route);
  else if (def) unmount = mountGame(app, def, home);
  else unmount = mountMenu(app, games, (g) => (location.hash = '#/' + g.id), () => (location.hash = '#/settings'));
}

window.addEventListener('hashchange', route);
route();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
