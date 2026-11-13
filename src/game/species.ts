/** The playable dinosaurs. Kept free of Three.js so the title screen and settings can import it. */
import type { Txt } from '../i18n';

export interface DinoSpec {
  id: 'trex' | 'tri' | 'stego' | 'brachio' | 'spino' | 'ptera';
  name: Txt;
  /** Running speed in world units per second. */
  speed: number;
  /** Flying speed, for dinosaurs that fly while the jump button is held. */
  fly?: number;
  /** How far the camera sits back, relative to a T-Rex. */
  cam: number;
  /** Roar depth: larger is deeper. */
  roar: number;
  /** How hard it pushes when it walks into trees (it knocks them over) and big rocks (it shoves them along); 1 is a T-Rex. None: it can't. */
  shove?: number;
  /** Has a run button (held) instead of jump: twice its speed, for as long as its stamina lasts. */
  run?: boolean;
  colors: { body: string; belly: string; accent: string };
}

export const DINOS: DinoSpec[] = [
  { id: 'trex', name: { en: 'T-Rex', da: 'T-Rex' }, speed: 15, cam: 1.2, roar: 1.3, shove: 1, run: true, colors: { body: '#75644a', belly: '#b9aa8a', accent: '#3a2f22' } },
  { id: 'tri', name: { en: 'Triceratops', da: 'Triceratops' }, speed: 12, cam: 1.1, roar: 1, shove: 1.25, run: true, colors: { body: '#6a5b47', belly: '#b6a688', accent: '#7a3a24' } },
  { id: 'stego', name: { en: 'Stegosaurus', da: 'Stegosaurus' }, speed: 11, cam: 1.1, roar: 0.9, shove: 0.9, run: true, colors: { body: '#59654a', belly: '#b0aa88', accent: '#86402a' } },
  { id: 'brachio', name: { en: 'Brachiosaurus', da: 'Brachiosaurus' }, speed: 11, cam: 1.5, roar: 1.6, shove: 1.6, run: true, colors: { body: '#6a675b', belly: '#b3ab95', accent: '#46443b' } },
  // Velociraptor × Spinosaurus: a raptor's legs and claws with a spinosaur's sail and snout. Twice the fastest.
  { id: 'spino', name: { en: 'Spinoraptor', da: 'Spinoraptor' }, speed: 30, cam: 1.0, roar: 0.75, colors: { body: '#4a524c', belly: '#aea793', accent: '#8a3424' } },
  // Slow on foot, the fastest of all in the air.
  { id: 'ptera', name: { en: 'Pteranodon', da: 'Pteranodon' }, speed: 6, fly: 32, cam: 1.1, roar: 0.6, colors: { body: '#65523f', belly: '#c0b298', accent: '#8f3a24' } },
];

