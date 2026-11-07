import { load, save } from './engine/storage';

export type Lang = 'en' | 'da';
export type Txt = Record<Lang, string>;

export const LANGS: { id: Lang; flag: string; label: string }[] = [
  { id: 'en', flag: '🇬🇧', label: 'English' },
  { id: 'da', flag: '🇩🇰', label: 'Dansk' },
];

const deviceLang: Lang = navigator.language?.toLowerCase().startsWith('da') ? 'da' : 'en';
let lang: Lang = load<Lang>('lang', deviceLang);
document.documentElement.lang = lang;

export const getLang = () => lang;

export function setLang(l: Lang) {
  lang = l;
  save('lang', l);
  document.documentElement.lang = l;
}


/** Picks the current language's entry: L({ en: 'dog', da: 'hund' }), or a whole message table. */
export function L<T>(m: Record<Lang, T>): T {
  return m[lang];
}

const en = {
  home: 'Back to title screen',
  sound: 'Sound on/off',
  language: 'Language',
  settings: 'Settings',
  hold: 'Hold for 3 seconds',
  soundLabel: 'Sound',
  app: 'App',
  refresh: 'Refresh app',
  refreshHint: 'Loads the newest version',
  on: 'On',
  off: 'Off',
  progress: 'Story progress',
  progressHint: (done: number, total: number) => `Levels completed: ${done} of ${total}`,
  resetProgress: 'Reset progress',
  sure: 'Tap again to reset',
};

/** Shell, splash and settings strings. Games keep their own tables next to their code. */
export const UI: Record<Lang, typeof en> = {
  en,
  da: {
    home: 'Tilbage til titelskærmen',
    sound: 'Lyd til/fra',
    language: 'Sprog',
    settings: 'Indstillinger',
    hold: 'Hold inde i 3 sekunder',
    soundLabel: 'Lyd',
    app: 'App',
    refresh: 'Opdater app',
    refreshHint: 'Henter den nyeste version',
    on: 'Til',
    off: 'Fra',
    progress: 'Historien',
    progressHint: (done: number, total: number) => `Gennemførte baner: ${done} af ${total}`,
    resetProgress: 'Nulstil',
    sure: 'Tryk igen for at nulstille',
  },
};
