import type { MapDef } from './types';

/** Isla Sonas: made in the map editor (#/map/isla-sonas). */
const map: MapDef = {
  id: 'isla-sonas',
  name: { en: 'Isla Sonas', da: 'Isla Sonas' },
  seed: 35190,
  half: 250,
  relief: { scale: 1, seed: 10.2 },
  hills: [],
  paddock: { x: 38.4, z: -196.8 },
  cages: [],
  lakes: [],
  volcanoes: [],
  mesas: [],
  roads: [],
  shore: 103,
  town: { x: -75, z: 80, w: 48, d: 30, y: 3 },
  power: { x: -95, z: -25, w: 26, d: 22, y: 2.5 },
  docks: { x: 25, z: 94, w: 34, d: 14, y: 1.2 },
  buildings: [
    { x: -90, z: 69.5, w: 8, d: 6, h: 4.6, style: 0, front: 1, hp: 3 },
    { x: -75, z: 69.5, w: 10, d: 6, h: 6.8, style: 1, front: 1, hp: 4 },
    { x: -60, z: 69.5, w: 8, d: 6, h: 4.4, style: 2, front: 1, hp: 3 },
    { x: -90.75, z: 90.5, w: 9, d: 6, h: 5.2, style: 3, front: -1, hp: 3 },
    { x: -73.5, z: 90.5, w: 12, d: 6, h: 7.4, style: 4, front: -1, hp: 5 },
    { x: -57.75, z: 90.5, w: 7, d: 6, h: 4.2, style: 5, front: -1, hp: 3 },
    { x: 16, z: 92.5, w: 8, d: 6, h: 4, style: 6, front: 1, kind: 'shed', hp: 3 },
  ],
  fences: [],
  people: [],
  guards: [],
  plants: { trees: 240, palms: 0.4, bushes: 420, rocks: 70 },
};
export default map;
