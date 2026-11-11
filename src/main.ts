import './style.css';
import { dino } from './game';
import { mountSplash } from './splash';
import { mountSettings } from './settings';
import { mountGame } from './shell';
import { drafts, MAPS, setTrial } from './game/maps';
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
  else if (import.meta.env.DEV && id.startsWith('rampage/try/')) {
    // Rampage on a map from the editor (dev server only, like the editor), as it stands (unsaved changes and all); leaving goes back to the editor.
    const mapId = id.slice('rampage/try/'.length);
    setTrial(drafts()[mapId] ?? MAPS.find((m) => m.id === mapId) ?? null);
    const close = mountGame(app, dino, 'rampage', go('map/' + mapId));
    unmount = () => {
      close();
      setTrial(null);
    };
  } else if (import.meta.env.DEV && (id === 'map' || id.startsWith('map/'))) {
    // The map editor (src/game/maps/), on the dev server only: `import.meta.env.DEV` is false in a
    // production build, so this branch and the editor's chunk are dropped from it entirely. It loads
    // Three.js, so it loads lazily.
    let gone = false;
    let close: (() => void) | null = null;
    import('./game/mapedit').then((m) => {
      if (!gone) close = m.mountMapEditor(app, id.split('/')[1] || undefined);
    });
    unmount = () => {
      gone = true;
      close?.();
    };
  }
  else unmount = mountSplash(app, dino, { story: go('story'), rampage: go('rampage'), settings: go('settings') });
}

window.addEventListener('hashchange', route);
route();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
