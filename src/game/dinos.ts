import * as THREE from 'three';
import type { DinoSpec } from './species';

export { DINOS, type DinoSpec } from './species';

/** The moving parts of a dinosaur model, animated by animate(). */
export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  legs: { pivot: THREE.Object3D; offset: number; amp: number }[];
  tail: THREE.Object3D[];
  neck: THREE.Object3D[];
  head: THREE.Object3D;
  jaw: THREE.Object3D | null;
  /** Collision radius. */
  radius: number;
  stepRate: number;
  bob: number;
  phase: number;
  /** Counts down from 1 while roaring. */
  roaring: number;
  /** Counts down from 1 during a bite: lunge forward, jaws snap shut halfway. */
  biting: number;
  /** Wings, for flyers: folded on the ground, spread in the air. */
  wings: { pivot: THREE.Object3D; side: number }[];
  /** 0 folded (walking), 0.5 spread and still (gliding), 1 flapping. */
  wingMode: number;
  spread: number;
  lastStep: number;
}

// Shared by every model; freed by disposeDinoAssets().
const GEO = {
  sphere: new THREE.SphereGeometry(1, 12, 9),
  cone: new THREE.ConeGeometry(1, 1, 8),
  disk: new THREE.CylinderGeometry(1, 1, 1, 14),
};
const mats = new Map<string, THREE.MeshStandardMaterial>();

function mat(color: string) {
  let m = mats.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true });
    mats.set(color, m);
  }
  return m;
}

type V3 = [number, number, number];

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: string, scale: V3, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat(color));
  m.scale.set(...scale);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function group(parent: THREE.Object3D, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(...pos);
  g.rotation.set(...rot);
  parent.add(g);
  return g;
}

/** Big friendly cartoon eyes, one on each side of the head. */
function eyes(head: THREE.Object3D, x: number, y: number, z: number, r: number) {
  for (const side of [-1, 1]) {
    part(head, GEO.sphere, '#ffffff', [r, r, r], [x * side, y, z]);
    part(head, GEO.sphere, '#1b1b1b', [r * 0.58, r * 0.62, r * 0.58], [x * side + side * r * 0.42, y, z + r * 0.45]);
    part(head, GEO.sphere, '#ffffff', [r * 0.18, r * 0.18, r * 0.18], [x * side + side * r * 0.7, y + r * 0.22, z + r * 0.62]);
  }
}

/** A leg hinged at the hip (pivot), reaching down `len` to the ground. */
function leg(parent: THREE.Object3D, pos: V3, len: number, thick: number, color: string, foot: string) {
  const pivot = group(parent, pos);
  part(pivot, GEO.sphere, color, [thick, len * 0.42, thick * 1.05], [0, -len * 0.38, 0]);
  part(pivot, GEO.sphere, color, [thick * 0.72, len * 0.32, thick * 0.75], [0, -len * 0.75, -thick * 0.15]);
  part(pivot, GEO.sphere, foot, [thick * 1.05, thick * 0.4, thick * 1.35], [0, -len + thick * 0.3, thick * 0.35]);
  return pivot;
}

/** A tail of shrinking segments, each hinged on the one before so it can sway. */
function tailChain(parent: THREE.Object3D, pos: V3, segs: number, segLen: number, r0: number, r1: number, color: string) {
  const out: THREE.Object3D[] = [];
  let at: THREE.Object3D = group(parent, pos, [0.12, 0, 0]);
  for (let i = 0; i < segs; i++) {
    const r = r0 + (r1 - r0) * (i / (segs - 1));
    part(at, GEO.sphere, color, [r, r * 0.9, segLen * 0.62], [0, 0, -segLen * 0.45]);
    out.push(at);
    at = group(at, [0, 0, -segLen * 0.8], [-0.04, 0, 0]);
  }
  part(at, GEO.cone, color, [r1 * 0.9, segLen * 0.9, r1 * 0.9], [0, 0, -segLen * 0.1], [-Math.PI / 2, 0, 0]);
  return { segs: out, tip: at };
}

function rig(root: THREE.Group, body: THREE.Group, head: THREE.Object3D, o: Partial<Rig>): Rig {
  return {
    root, body, head, legs: [], tail: [], neck: [], jaw: null,
    radius: 2, stepRate: 6, bob: 0.1, phase: 0, roaring: 0, biting: 0, lastStep: 0, wings: [], wingMode: 0, spread: 0,
    ...o,
  };
}

function trex(c: DinoSpec['colors']): Rig {
  const root = new THREE.Group();
  const hip = 2.3;
  const body = group(root, [0, hip, 0]);
  part(body, GEO.sphere, c.body, [1.05, 1.0, 1.65], [0, 0.25, 0.1], [-0.15, 0, 0]);
  part(body, GEO.sphere, c.belly, [0.85, 0.72, 1.35], [0, -0.1, 0.35], [-0.15, 0, 0]);
  for (let k = 0; k < 4; k++) part(body, GEO.sphere, c.accent, [0.5 - k * 0.06, 0.12, 0.32], [0, 1.15 - k * 0.07, 0.9 - k * 0.55], [-0.15, 0, 0]);

  const neck = group(body, [0, 0.75, 1.25], [-0.2, 0, 0]);
  part(neck, GEO.sphere, c.body, [0.6, 0.72, 0.62], [0, 0.25, 0.2]);
  const head = group(neck, [0, 0.85, 0.45]);
  part(head, GEO.sphere, c.body, [0.78, 0.66, 1.0], [0, 0, 0.35]);
  part(head, GEO.sphere, c.body, [0.62, 0.46, 0.72], [0, -0.12, 1.0]);
  for (const side of [-1, 1]) for (const z of [0.85, 1.15, 1.42]) {
    part(head, GEO.cone, '#ffffff', [0.07, 0.18, 0.07], [side * (0.48 - (z - 0.85) * 0.25), -0.5, z], [Math.PI, 0, 0]);
  }
  const jaw = group(head, [0, -0.38, 0.3]);
  part(jaw, GEO.sphere, c.belly, [0.55, 0.22, 0.85], [0, 0, 0.5]);
  eyes(head, 0.47, 0.25, 0.55, 0.24);

  for (const side of [-1, 1]) {
    const arm = group(body, [side * 0.78, 0.05, 1.15], [-0.9, 0, side * 0.2]);
    part(arm, GEO.sphere, c.body, [0.15, 0.42, 0.16], [0, -0.32, 0]);
  }
  const t = tailChain(body, [0, 0.2, -1.35], 4, 0.95, 0.72, 0.22, c.body);
  const r = rig(root, body, head, { jaw, tail: t.segs, neck: [neck], radius: 1.8, stepRate: 7.5, bob: 0.16 });
  r.legs = [-1, 1].map((side, i) => ({
    pivot: leg(root, [side * 0.68, hip, -0.15], hip, 0.5, c.body, c.accent), offset: i * Math.PI, amp: 0.65,
  }));
  return r;
}

function triceratops(c: DinoSpec['colors']): Rig {
  const root = new THREE.Group();
  const hip = 1.55;
  const body = group(root, [0, hip, 0]);
  part(body, GEO.sphere, c.body, [1.3, 1.05, 1.9], [0, 0.25, 0]);
  part(body, GEO.sphere, c.belly, [1.1, 0.75, 1.6], [0, -0.12, 0.05]);
  const head = group(body, [0, 0.25, 1.85], [0.15, 0, 0]);
  part(head, GEO.sphere, c.body, [0.78, 0.72, 0.9], [0, 0, 0.45]);
  part(head, GEO.sphere, c.accent, [0.36, 0.32, 0.42], [0, -0.2, 1.2]);
  part(head, GEO.disk, c.accent, [1.35, 0.12, 1.25], [0, 0.55, 0.05], [Math.PI / 2 - 0.55, 0, 0]);
  for (let k = 0; k < 7; k++) {
    const a = -1.25 + (k / 6) * 2.5;
    part(head, GEO.sphere, c.body, [0.16, 0.16, 0.08], [Math.sin(a) * 1.3, 0.55 + Math.cos(a) * 1.1, -0.05 - Math.cos(a) * 0.5]);
  }
  for (const side of [-1, 1]) part(head, GEO.cone, '#fff4d9', [0.13, 0.95, 0.13], [side * 0.36, 0.48, 0.85], [Math.PI / 2 - 0.45, 0, 0]);
  part(head, GEO.cone, '#fff4d9', [0.1, 0.42, 0.1], [0, 0.12, 1.3], [Math.PI / 2 - 0.7, 0, 0]);
  eyes(head, 0.52, 0.18, 0.7, 0.19);
  const t = tailChain(body, [0, 0.15, -1.75], 3, 0.8, 0.6, 0.2, c.body);
  const r = rig(root, body, head, { tail: t.segs, radius: 2, stepRate: 6.5, bob: 0.07 });
  r.legs = ([[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]] as const).map(([sx, sz, off]) => ({
    pivot: leg(root, [sx * 0.78, hip, sz * 1.05], hip, 0.34, c.body, c.belly), offset: off, amp: 0.5,
  }));
  return r;
}

function stegosaurus(c: DinoSpec['colors']): Rig {
  const root = new THREE.Group();
  const hip = 1.65;
  const body = group(root, [0, hip, 0]);
  part(body, GEO.sphere, c.body, [1.1, 1.0, 2.0], [0, 0.35, -0.1], [0.08, 0, 0]);
  part(body, GEO.sphere, c.belly, [0.9, 0.7, 1.7], [0, 0.0, 0.0], [0.08, 0, 0]);
  for (let k = 0; k < 7; k++) {
    const z = 1.15 - k * 0.48;
    const h = 0.55 + Math.sin((k / 6) * Math.PI) * 0.55;
    const y = 1.2 + Math.sin(((k + 1) / 8) * Math.PI) * 0.18;
    const side = k % 2 ? 1 : -1;
    part(body, GEO.cone, c.accent, [0.09, h, 0.42], [side * 0.14, y + h * 0.35, z], [0, 0, side * 0.12]);
  }
  const head = group(body, [0, -0.15, 1.9], [0.2, 0, 0]);
  part(head, GEO.sphere, c.body, [0.42, 0.4, 0.7], [0, 0, 0.35]);
  eyes(head, 0.3, 0.12, 0.45, 0.14);
  const t = tailChain(body, [0, 0.35, -2.0], 4, 0.8, 0.55, 0.16, c.body);
  for (const side of [-1, 1]) for (const z of [0, -0.35]) {
    part(t.tip, GEO.cone, '#fff4d9', [0.08, 0.7, 0.08], [side * 0.25, 0.2, z], [0.2, 0, -side * 1.0]);
  }
  const r = rig(root, body, head, { tail: t.segs, radius: 2, stepRate: 6, bob: 0.07 });
  r.legs = ([[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]] as const).map(([sx, sz, off]) => ({
    pivot: leg(root, [sx * 0.7, hip, sz * 1.1], hip, 0.32, c.body, c.belly), offset: off, amp: 0.5,
  }));
  return r;
}

function brachiosaurus(c: DinoSpec['colors']): Rig {
  const root = new THREE.Group();
  const hip = 2.6;
  const body = group(root, [0, hip, 0]);
  part(body, GEO.sphere, c.body, [1.3, 1.2, 2.0], [0, 0.45, 0], [-0.18, 0, 0]);
  part(body, GEO.sphere, c.belly, [1.1, 0.9, 1.7], [0, 0.1, 0.1], [-0.18, 0, 0]);
  const neck: THREE.Object3D[] = [];
  let at: THREE.Object3D = group(body, [0, 1.0, 1.45], [-0.5, 0, 0]);
  for (let k = 0; k < 5; k++) {
    const r = 0.5 - k * 0.04;
    part(at, GEO.sphere, c.body, [r, r, 0.75], [0, 0, 0.55]);
    part(at, GEO.sphere, c.belly, [r * 0.7, r * 0.6, 0.6], [0, -r * 0.45, 0.55]);
    neck.push(at);
    at = group(at, [0, 0, 1.0], [-0.14, 0, 0]);
  }
  const head = group(at, [0, 0.05, 0.25], [1.15, 0, 0]);
  part(head, GEO.sphere, c.body, [0.5, 0.42, 0.78], [0, 0, 0.4]);
  part(head, GEO.sphere, c.accent, [0.3, 0.22, 0.3], [0, 0.35, 0.15]);
  eyes(head, 0.34, 0.15, 0.45, 0.16);
  const t = tailChain(body, [0, 0.35, -1.95], 4, 0.95, 0.6, 0.15, c.body);
  for (let k = 0; k < 3; k++) part(body, GEO.sphere, c.accent, [0.42, 0.12, 0.42], [(k - 1) * 0.55, 1.55 - Math.abs(k - 1) * 0.12, -0.3 + k * 0.3]);
  const r = rig(root, body, head, { tail: t.segs, neck, radius: 2.4, stepRate: 4.2, bob: 0.1 });
  r.legs = ([[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]] as const).map(([sx, sz, off]) => ({
    pivot: leg(root, [sx * 0.8, hip, sz * 1.2], hip, 0.4, c.body, c.belly), offset: off, amp: 0.42,
  }));
  return r;
}

/** Velociraptor body, legs and claws; Spinosaurus sail and crocodile snout. */
function spinoraptor(c: DinoSpec['colors']): Rig {
  const root = new THREE.Group();
  const hip = 2.0;
  const body = group(root, [0, hip, 0]);
  part(body, GEO.sphere, c.body, [0.68, 0.72, 1.45], [0, 0.2, 0.1], [-0.12, 0, 0]);
  part(body, GEO.sphere, c.belly, [0.55, 0.5, 1.2], [0, -0.05, 0.25], [-0.12, 0, 0]);
  // The sail: a thin membrane with spines poking just above its edge.
  part(body, GEO.sphere, c.accent, [0.12, 1.45, 1.25], [0, 0.85, -0.05], [-0.12, 0, 0]);
  for (let k = 0; k < 9; k++) {
    const z = -1.0 + (k / 8) * 2.0;
    const top = 1.45 * Math.sqrt(Math.max(0, 1 - (z / 1.25) ** 2));
    part(body, GEO.cone, '#b8323a', [0.07, top + 0.25, 0.07], [0, 0.85 + (top + 0.25) / 2 - 0.1, z - 0.05 + z * 0.12]);
  }
  for (let k = 0; k < 3; k++) part(body, GEO.sphere, '#16786d', [0.5 - k * 0.08, 0.06, 0.2], [0, 0.72 - k * 0.04, 0.95 - k * 0.7], [-0.12, 0, 0]);

  const neck = group(body, [0, 0.45, 1.3], [-0.35, 0, 0]);
  part(neck, GEO.sphere, c.body, [0.32, 0.36, 0.55], [0, 0.1, 0.3]);
  const head = group(neck, [0, 0.35, 0.65], [0.3, 0, 0]);
  part(head, GEO.sphere, c.body, [0.42, 0.4, 0.58], [0, 0.05, 0.2]);
  part(head, GEO.sphere, c.body, [0.24, 0.2, 0.85], [0, -0.05, 0.95]);
  part(head, GEO.sphere, c.accent, [0.12, 0.08, 0.22], [0, 0.18, 0.5]);
  for (const side of [-1, 1]) for (const z of [0.7, 0.95, 1.2, 1.45]) {
    part(head, GEO.cone, '#ffffff', [0.04, 0.12, 0.04], [side * 0.17, -0.2, z], [Math.PI, 0, 0]);
  }
  const jaw = group(head, [0, -0.2, 0.25]);
  part(jaw, GEO.sphere, c.belly, [0.2, 0.1, 0.95], [0, 0, 0.7]);
  eyes(head, 0.3, 0.2, 0.32, 0.17);

  for (const side of [-1, 1]) {
    const arm = group(body, [side * 0.5, -0.05, 1.05], [-0.6, 0, side * 0.25]);
    part(arm, GEO.sphere, c.body, [0.12, 0.42, 0.13], [0, -0.32, 0]);
    for (const dx of [-0.05, 0.05]) part(arm, GEO.cone, '#fff4d9', [0.035, 0.18, 0.035], [dx, -0.72, 0.06], [Math.PI - 0.5, 0, 0]);
  }
  const t = tailChain(body, [0, 0.15, -1.3], 5, 0.85, 0.48, 0.12, c.body);
  const r = rig(root, body, head, { jaw, tail: t.segs, neck: [neck], radius: 1.4, stepRate: 11, bob: 0.13 });
  r.legs = [-1, 1].map((side, i) => {
    const pivot = leg(root, [side * 0.48, hip, -0.1], hip, 0.34, c.body, c.belly);
    // The raptor's sickle claw, raised off the ground.
    part(pivot, GEO.cone, '#fff4d9', [0.06, 0.32, 0.06], [side * 0.1, -hip + 0.28, 0.25], [-0.6, 0, 0]);
    return { pivot, offset: i * Math.PI, amp: 0.85 };
  });
  return r;
}

/** Long beak, a crest swept back, and big wing membranes that fold away for walking. */
function pteranodon(c: DinoSpec['colors']): Rig {
  const root = new THREE.Group();
  const hip = 1.3;
  const body = group(root, [0, hip, 0]);
  part(body, GEO.sphere, c.body, [0.45, 0.5, 0.95], [0, 0.25, 0], [-0.2, 0, 0]);
  part(body, GEO.sphere, c.belly, [0.36, 0.36, 0.8], [0, 0.1, 0.1], [-0.2, 0, 0]);
  const neck = group(body, [0, 0.55, 0.75], [-0.5, 0, 0]);
  part(neck, GEO.sphere, c.body, [0.2, 0.2, 0.45], [0, 0, 0.3]);
  const head = group(neck, [0, 0.05, 0.7], [0.6, 0, 0]);
  part(head, GEO.sphere, c.body, [0.28, 0.27, 0.42], [0, 0, 0.1]);
  part(head, GEO.cone, '#e8c15a', [0.13, 1.5, 0.1], [0, -0.05, 0.95], [Math.PI / 2, 0, 0]);
  const jaw = group(head, [0, -0.12, 0.2]);
  part(jaw, GEO.cone, '#d4a943', [0.1, 1.25, 0.08], [0, 0, 0.7], [Math.PI / 2, 0, 0]);
  part(head, GEO.cone, c.accent, [0.08, 1.3, 0.22], [0, 0.35, -0.55], [-Math.PI / 2 - 0.55, 0, 0]);
  eyes(head, 0.22, 0.1, 0.18, 0.12);
  const wings = [-1, 1].map((side) => {
    const pivot = group(body, [side * 0.32, 0.45, 0.25]);
    part(pivot, GEO.sphere, c.belly, [1.7, 0.035, 0.7], [side * 1.7, 0, -0.15]);
    part(pivot, GEO.sphere, c.body, [1.75, 0.07, 0.07], [side * 1.75, 0.02, 0.45]);
    part(pivot, GEO.sphere, c.accent, [0.3, 0.04, 0.3], [side * 3.2, 0.01, 0.2]);
    return { pivot, side };
  });
  const t = tailChain(body, [0, 0.15, -0.85], 2, 0.45, 0.22, 0.08, c.body);
  const r = rig(root, body, head, { jaw, tail: t.segs, neck: [neck], radius: 1.3, stepRate: 7, bob: 0.07 });
  r.wings = wings;
  r.legs = [-1, 1].map((side, i) => ({ pivot: leg(root, [side * 0.25, hip, -0.2], hip, 0.18, c.body, '#e8c15a'), offset: i * Math.PI, amp: 0.6 }));
  return r;
}

const BUILD: Record<DinoSpec['id'], (c: DinoSpec['colors']) => Rig> = {
  trex, tri: triceratops, stego: stegosaurus, brachio: brachiosaurus, spino: spinoraptor, ptera: pteranodon,
};

/** Builds a dinosaur facing +z, standing on y = 0. `colors` overrides the species' own. */
export function buildDino(spec: DinoSpec, colors = spec.colors): Rig {
  return BUILD[spec.id](colors);
}

/**
 * Walk cycle, idle breathing and the roar. `move` is 0 (standing) to 1 (full speed).
 * Returns true on each footfall, for footstep sounds.
 */
export function animate(r: Rig, dt: number, move: number, t: number): boolean {
  r.phase += dt * r.stepRate * move;
  for (const l of r.legs) l.pivot.rotation.x = Math.sin(r.phase + l.offset) * l.amp * move;
  r.body.position.y = r.legs[0].pivot.position.y + Math.abs(Math.cos(r.phase)) * r.bob * move + Math.sin(t * 2.2) * 0.025;
  r.body.rotation.z = Math.sin(r.phase) * 0.05 * move;
  r.tail.forEach((seg, i) => {
    seg.rotation.y = Math.sin(t * 1.8 - i * 0.7) * 0.1 + Math.sin(r.phase - i * 0.6) * 0.14 * move;
  });
  r.neck.forEach((seg, i) => {
    seg.rotation.y = Math.sin(t * 0.9 + i * 0.5) * 0.05;
  });
  // Roar: rear the head back and open wide.
  const roar = r.roaring > 0 ? Math.sin(Math.PI * Math.min(1, (1 - r.roaring) * 1.6)) : 0;
  r.roaring = Math.max(0, r.roaring - dt / 1.4);
  r.head.rotation.y = 0;
  r.head.userData.base ??= r.head.rotation.x;
  // Bite: lunge forward and down, jaws wide open, then snap shut at the halfway point.
  const lunge = r.biting > 0 ? Math.sin(Math.PI * (1 - r.biting)) : 0;
  const gape = r.biting > 0.5 ? Math.sin(Math.PI * (1 - r.biting) * 2) : 0;
  r.biting = Math.max(0, r.biting - dt / 0.45);
  r.body.position.z = lunge * 0.8;
  r.body.rotation.x = lunge * 0.12;
  r.head.rotation.x = r.head.userData.base - roar * 0.5 + lunge * 0.3 + Math.sin(r.phase * 2) * 0.04 * move + Math.sin(t * 1.3) * 0.03;
  if (r.jaw) r.jaw.rotation.x = Math.max(roar * 0.65, gape * 0.85);
  // Wings: tucked down for walking, spread out in the air, beating while it flies.
  if (r.wings.length) {
    r.spread += ((r.wingMode > 0 ? 1 : 0) - r.spread) * Math.min(1, dt * 6);
    const beat = r.wingMode >= 1 ? Math.sin(t * 11) * 0.65 : r.wingMode > 0 ? Math.sin(t * 2) * 0.05 + 0.08 : 0;
    for (const w of r.wings) {
      w.pivot.scale.x = 0.22 + 0.78 * r.spread;
      w.pivot.rotation.z = w.side * (beat * r.spread - (1 - r.spread) * 1.05);
    }
  }
  const step = Math.floor(r.phase / Math.PI);
  const stepped = step !== r.lastStep;
  r.lastStep = step;
  return stepped && move > 0.3;
}

export function disposeDinoAssets() {
  Object.values(GEO).forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  mats.clear();
}
