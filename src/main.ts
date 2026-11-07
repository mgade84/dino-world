import './style.css';
import { dino } from './game';
import { mountSplash } from './splash';
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
  const home = () => (location.hash = '#/');
  const go = (to: string) => () => (location.hash = '#/' + to);
  if (id === 'settings') unmount = mountSettings(app, home, route);
  else if (id === 'story' || id === 'rampage') unmount = mountGame(app, dino, id, home);
  else unmount = mountSplash(app, dino, { story: go('story'), rampage: go('rampage'), settings: go('settings') });
}

window.addEventListener('hashchange', route);
route();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
