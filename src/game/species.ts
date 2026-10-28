/** The playable dinosaurs. Kept free of Three.js so scripts/voice can read the names. */
import type { Txt } from '../../i18n';

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
  colors: { body: string; belly: string; accent: string };
}

export const DINOS: DinoSpec[] = [
  { id: 'trex', name: { en: 'T-Rex', da: 'T-Rex' }, speed: 15, cam: 1, roar: 1.2, colors: { body: '#4caf50', belly: '#d4edb0', accent: '#2e7d32' } },
  { id: 'tri', name: { en: 'Triceratops', da: 'Triceratops' }, speed: 12, cam: 1, roar: 1, colors: { body: '#ff9433', belly: '#ffe0b2', accent: '#ffcf5c' } },
  { id: 'stego', name: { en: 'Stegosaurus', da: 'Stegosaurus' }, speed: 11, cam: 1, roar: 0.9, colors: { body: '#9575cd', belly: '#e1d5f5', accent: '#ff8fb1' } },
  { id: 'brachio', name: { en: 'Brachiosaurus', da: 'Brachiosaurus' }, speed: 11, cam: 1.35, roar: 1.6, colors: { body: '#42a5f5', belly: '#c7e6fd', accent: '#1e6fbf' } },
  // Velociraptor × Spinosaurus: a raptor's legs and claws with a spinosaur's sail and snout. Twice the fastest.
  { id: 'spino', name: { en: 'Spinoraptor', da: 'Spinoraptor' }, speed: 30, cam: 1.15, roar: 0.75, colors: { body: '#23a99a', belly: '#d9f5ef', accent: '#ff5a5f' } },
  // Slow on foot, the fastest of all in the air.
  { id: 'ptera', name: { en: 'Pteranodon', da: 'Pteranodon' }, speed: 6, fly: 32, cam: 1.1, roar: 0.6, colors: { body: '#9c7b6b', belly: '#efdccb', accent: '#ff5a3c' } },
];
