import type { Txt } from '../../i18n';
import type { Pt } from '../shapes';

/**
 * A world map: everything about the island's layout, as plain data. All positions are in metres on
 * the ground plane, with (0, 0) in the middle of the play area. Edit maps in the browser at
 * #/map/<id> (the map editor), or by hand: the editor draws the map from above with x growing to the
 * right and z growing downwards, and shows the coordinates under the pointer. The sea is always past
 * `shore`, at the bottom of the view ("north" in the code's comments means towards the sea).
 */

export type { Pt } from '../shapes';
export interface Spot { x: number; z: number }
export interface Round extends Spot { r: number }
/** A freehand outline: its corners in order, closed back to the first. */
export interface Outline { pts: Pt[] }
/** A round shape (centre and radius) or a freehand outline. */
export type Shape = Round | Outline;
/** A flattened, clear rectangle: centre, width along x, depth along z, and the height it's levelled to. */
export interface Area extends Spot { w: number; d: number; y: number }
/** A fence line from (x1, z1) to (x2, z2). */
export type Line = [number, number, number, number];
/** A road along a freehand path, `w` wide. */
export interface Road { pts: Pt[]; w: number }
/** A ridge along a freehand path (one point is a round hill): `w` wide at its foot, `h` high (negative digs a hollow). */
export interface Hill { pts: Pt[]; w: number; h: number }
/**
 * A building, square to the axes: centre in world units, size (w along x, d along z, h tall) in metres
 * (drawn 1.5 times bigger, to match the people). `front` is the side with the door (+1 faces +z, the
 * sea; -1 faces -z). `style` picks its colours (STYLES in buildings.ts). A shop has a flat roof, a shed a
 * pitched one and a roller door. `hp` is how many bites wreck it (default 3).
 */
export interface House extends Spot { w: number; d: number; h: number; style: number; front: 1 | -1; kind?: 'shop' | 'shed'; hp?: number }

export interface MapDef {
  id: string;
  /** Shown in the map editor (and any future map picker). */
  name: Txt;
  /** Where the trees, bushes and rocks grow: change it for a different jungle on the same layout. */
  seed: number;
  /** Half the width of the square play area. A wall of jungle grows just outside it. */
  half: number;
  /** Rolling hills everywhere: `scale` 1 is the original island, 0 is flat, 2 twice as hilly; `seed` moves them. */
  relief: { scale: number; seed: number };
  /** Hills and ridges on top of the rolling ground. */
  hills: Hill[];
  /** The hero's paddock (a 14 m cage). The land around it is kept clear. */
  paddock: Spot;
  /** Other dinosaurs' paddocks. Each gets a species, in order (see species.ts). */
  cages: Spot[];
  /** Lakes: a basin with water and a sandy edge. */
  lakes: Shape[];
  /** Volcanoes: a smoking cone on this base (taller the bigger it is) that blocks the way. */
  volcanoes: Shape[];
  /** Plateaus with steep rock walls: too steep to walk up, low enough (`h`, about 3–4) to jump onto. A round one gets an irregular edge. */
  mesas: (Shape & { h: number })[];
  /** Roads, kept clear of trees. */
  roads: Road[];
  /** The north coast: beyond this z the land drops into the sea. */
  shore: number;
  /** Main Street: a levelled, paved square with a road running east–west through it and street lamps. */
  town: Area;
  /** The power station's fenced yard (its fence, with a gate on the east side, is added for you). */
  power: Area;
  /** The docks' landing on the coast; the pier runs north from its centre out to sea. */
  docks: Area;
  /** Buildings: shops and sheds that can be bitten apart. The ground under each is levelled. */
  buildings: House[];
  /** Electric fence lines across the jungle (live or dead per level). */
  fences: Line[];
  /** Park visitors standing about, in every level (more come with the jeeps). */
  people: Spot[];
  /** Rangers' posts. Rampage, and every level that has rangers, puts a ranger at each (and more at random spots if the level wants more). */
  guards: Spot[];
  /** How much grows inside the play area. `palms` is the share of trees that are palms (0–1). */
  plants: { trees: number; palms: number; bushes: number; rocks: number };
}
