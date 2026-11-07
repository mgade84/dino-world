import * as THREE from 'three';
import { DOCKS, groundY, TOWN } from './world';
import { bake } from './merge';

/**
 * Main Street's buildings (and the boat shed at the docks), each made of pre-broken pieces: wall panels, window glass and roof slabs.
 * A charging dinosaur knocks panels loose; enough hits and the whole building comes down into rubble,
 * in a cloud of dust. Rubble doesn't block anything.
 */

interface Chunk {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  /** Loose and falling, or resting as rubble. */
  loose: boolean;
  resting: boolean;
  /** Half its height, to rest on the ground. */
  half: number;
}

export interface Building {
  group: THREE.Group;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  hp: number;
  state: 'standing' | 'rubble';
  chunks: Chunk[];
  /** While undamaged, the whole building is drawn as a few merged meshes and the chunks are hidden. */
  intact: THREE.Group | null;
  /** Shakes after a hit. */
  shake: number;
  /** Seconds before it can be hit again (one charge shouldn't count as several hits). */
  cool: number;
}

export interface Town {
  buildings: Building[];
  /** Keeps a circle out of standing buildings. Returns the building it pushed against, or null. */
  collide(p: THREE.Vector3, r: number, vel?: THREE.Vector3): Building | null;
  /** A hit from `from` (the dinosaur). Knocks panels loose; true if this brought the building down. */
  hit(b: Building, from: THREE.Vector3): boolean;
  /** Street lamps on or off (they go out in the blackout). */
  setLights(on: boolean): void;
  /** Spots on the pavement in front of the buildings, for people to stand. */
  pavement(rand: () => number): THREE.Vector3;
  update(dt: number): void;
  dispose(): void;
}

interface Plan { x: number; z: number; w: number; d: number; h: number; wall: string; roof: string; awning?: string; hp: number; /** Which way the door faces (+1 north, -1 south); by default, the street. */ front?: number }

/** Two rows of buildings facing each other across the road. */
const PLANS: Plan[] = [
  { x: -92, z: 70.5, w: 9, d: 7, h: 4.6, wall: '#a49c8c', roof: '#3a3734', awning: '#6b2f24', hp: 3 },
  { x: -79, z: 70, w: 11, d: 8, h: 6.8, wall: '#8f8a80', roof: '#2f2d2b', hp: 4 },
  { x: -65, z: 70.5, w: 9, d: 7, h: 4.4, wall: '#b3a892', roof: '#3d3a35', awning: '#2f4a5a', hp: 3 },
  { x: -90, z: 89.5, w: 10, d: 7, h: 5.2, wall: '#9a9488', roof: '#33302d', awning: '#4a5a2f', hp: 3 },
  { x: -73, z: 90, w: 14, d: 8, h: 7.4, wall: '#a39f95', roof: '#2c2a28', hp: 5 },
  { x: -58, z: 89.5, w: 8, d: 6, h: 4.2, wall: '#ab9f8a', roof: '#3a3632', hp: 3 },
  // The boat shed on the docks' landing, its doors facing the sea.
  { x: DOCKS.x - 10, z: DOCKS.z - 1, w: 8, d: 6, h: 4, wall: '#6a675e', roof: '#2e2c2a', hp: 3, front: 1 },
];

const GRAVITY = 30;
const PANEL = 0.35;

export function createTown(scene: THREE.Scene): Town {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (color: string, roughness = 0.85, metalness = 0) => {
    const k = `${color}/${roughness}`;
    let m = mats.get(k);
    if (!m) mats.set(k, (m = keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }))));
    return m;
  };
  const glass = mat('#27343a', 0.08, 0.4);
  const frame = mat('#3c3a36', 0.6);
  const door = mat('#41352a', 0.7);
  const dustMat = keep(new THREE.MeshLambertMaterial({ color: '#8d877d', transparent: true, opacity: 0.32, depthWrite: false }));
  const dustGeo = keep(new THREE.IcosahedronGeometry(1, 1));
  const dust: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  function chunk(b: Building, m: THREE.Material, size: [number, number, number], at: [number, number, number]) {
    const mesh = new THREE.Mesh(box, m);
    mesh.scale.set(...size);
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    b.group.add(mesh);
    b.chunks.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), loose: false, resting: false, half: Math.min(...size) / 2 });
  }

  const buildings: Building[] = PLANS.map((p) => {
    const group = new THREE.Group();
    const base = Math.min(groundY(p.x - p.w / 2, p.z - p.d / 2), groundY(p.x + p.w / 2, p.z + p.d / 2), groundY(p.x, p.z));
    group.position.set(p.x, base, p.z);
    scene.add(group);
    const b: Building = {
      group, minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2,
      height: p.h, hp: p.hp, state: 'standing', chunks: [], intact: null, shake: 0, cool: 0,
    };
    const wall = mat(p.wall);
    // The street-facing side gets the door and shop windows.
    const front = p.front ?? (p.z < TOWN.z ? 1 : -1);
    const rows = Math.max(2, Math.round(p.h / 2.3));
    const rowH = p.h / rows;
    const faces: { len: number; n: [number, number]; axis: 'x' | 'z'; off: number }[] = [
      { len: p.w, n: [0, 1], axis: 'x', off: p.d / 2 },
      { len: p.w, n: [0, -1], axis: 'x', off: p.d / 2 },
      { len: p.d, n: [1, 0], axis: 'z', off: p.w / 2 },
      { len: p.d, n: [-1, 0], axis: 'z', off: p.w / 2 },
    ];
    for (const f of faces) {
      const cols = Math.max(2, Math.round(f.len / 2.6));
      const colW = f.len / cols;
      const isFront = f.axis === 'x' && f.n[1] === front;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const s = -f.len / 2 + colW * (c + 0.5);
          const y = rowH * (r + 0.5);
          const pos: [number, number, number] = f.axis === 'x' ? [s, y, f.n[1] * (f.off - PANEL / 2)] : [f.n[0] * (f.off - PANEL / 2), y, s];
          const size: [number, number, number] = f.axis === 'x' ? [colW, rowH, PANEL] : [PANEL, rowH, colW];
          chunk(b, wall, size, pos);
          // Windows on upper rows and the street front; a door in the middle of the front's ground row.
          const out = (k: number): [number, number, number] =>
            f.axis === 'x' ? [pos[0], pos[1], pos[2] + f.n[1] * k] : [pos[0] + f.n[0] * k, pos[1], pos[2]];
          if (isFront && r === 0 && c === Math.floor(cols / 2)) {
            const at = out(0.2);
            at[1] = rowH * 0.42;
            chunk(b, door, f.axis === 'x' ? [colW * 0.45, rowH * 0.82, 0.08] : [0.08, rowH * 0.82, colW * 0.45], at);
          } else if (isFront || r > 0 || (c + r) % 2 === 0) {
            const wide = isFront && r === 0 ? 0.78 : 0.5;
            chunk(b, glass, f.axis === 'x' ? [colW * wide, rowH * 0.48, 0.06] : [0.06, rowH * 0.48, colW * wide], out(0.2));
            chunk(b, frame, f.axis === 'x' ? [colW * wide + 0.12, 0.1, 0.12] : [0.12, 0.1, colW * wide + 0.12], [...out(0.2)].map((v, i) => (i === 1 ? v - rowH * 0.26 : v)) as [number, number, number]);
          }
        }
      }
    }
    // Roof: slabs with a slight overhang, and a parapet.
    const roof = mat(p.roof, 0.7);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) chunk(b, roof, [p.w / 2 + 0.3, 0.3, p.d / 2 + 0.3], [(sx * (p.w / 2 + 0.3)) / 2, p.h + 0.15, (sz * (p.d / 2 + 0.3)) / 2]);
    // A canvas awning over the shop front.
    if (p.awning) chunk(b, mat(p.awning, 0.9), [p.w * 0.8, 0.12, 1.6], [0, rowH * 0.95, front * (p.d / 2 + 0.75)]);
    // Draw the whole building as one mesh per material until it is first hit.
    const intact = new THREE.Group();
    for (const c of b.chunks) {
      const copy = new THREE.Mesh(c.mesh.geometry, c.mesh.material);
      copy.position.copy(c.mesh.position);
      copy.scale.copy(c.mesh.scale);
      copy.castShadow = true;
      intact.add(copy);
      c.mesh.visible = false;
    }
    bake(intact, [], owned);
    group.add(intact);
    b.intact = intact;
    return b;
  });

  // Street lamps along both pavements.
  const lampOn = keep(new THREE.MeshStandardMaterial({ color: '#fff1c8', emissive: '#ffd98a', emissiveIntensity: 2.2 }));
  const lampOff = mat('#3a3833', 0.5);
  const poleMat = mat('#2d2f31', 0.5, 0.6);
  const heads: THREE.Mesh[] = [];
  for (let k = -2; k <= 2; k++) for (const side of [-1, 1]) {
    const x = TOWN.x + k * 10 + (side > 0 ? 5 : 0);
    const z = TOWN.z + side * 4.1;
    const pole = new THREE.Mesh(box, poleMat);
    pole.scale.set(0.16, 5.5, 0.16);
    pole.position.set(x, groundY(x, z) + 2.75, z);
    pole.castShadow = true;
    scene.add(pole);
    const arm = new THREE.Mesh(box, poleMat);
    arm.scale.set(0.1, 0.1, 1.2);
    arm.position.set(x, groundY(x, z) + 5.45, z - side * 0.55);
    scene.add(arm);
    const head = new THREE.Mesh(box, lampOn);
    head.scale.set(0.45, 0.18, 0.7);
    head.position.set(x, groundY(x, z) + 5.35, z - side * 1.05);
    scene.add(head);
    heads.push(pole, arm, head);
  }
  // Poles and arms as one mesh, lamp heads as another (its material switches with the power).
  const lampGroup = new THREE.Group();
  for (const m of heads) {
    scene.remove(m);
    lampGroup.add(m);
  }
  scene.add(lampGroup);
  bake(lampGroup, [], owned);
  const headMesh = lampGroup.children.find((m) => (m as THREE.Mesh).material === lampOn) as THREE.Mesh;

  const tmp = new THREE.Vector3();

  function loosen(c: Chunk, b: Building, from: THREE.Vector3, power: number) {
    if (c.loose) return;
    c.loose = true;
    // Move it out of the building group into world space so it can fly free.
    c.mesh.getWorldPosition(tmp);
    b.group.remove(c.mesh);
    c.mesh.position.copy(tmp);
    scene.add(c.mesh);
    const away = tmp.clone().sub(from).setY(0).normalize();
    c.vel.copy(away).multiplyScalar(power * (0.4 + Math.random() * 0.8)).setY(2 + Math.random() * power * 0.5);
    c.spin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  }

  function puff(at: THREE.Vector3, n: number, size: number) {
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(dustGeo, dustMat);
      mesh.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * size, Math.random() * size * 0.4, (Math.random() - 0.5) * size));
      mesh.scale.setScalar(0.5 + Math.random() * Math.min(size, 6) * 0.15);
      scene.add(mesh);
      dust.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3), life: 1.2 + Math.random() * 0.9 });
    }
  }

  return {
    buildings,
    collide(p, r, vel) {
      let hit: Building | null = null;
      for (const b of buildings) {
        if (b.state !== 'standing') continue;
        if (p.y > b.group.position.y + b.height + 0.5) continue; // on (or over) the roof
        const cx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
        const cz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-4) {
          p.x = cx + (dx / d) * r;
          p.z = cz + (dz / d) * r;
          if (vel) {
            const into = -(vel.x * dx + vel.z * dz) / d;
            if (into > 0) vel.addScaledVector(tmp.set(dx / d, 0, dz / d), into);
          }
        } else {
          // Centre inside: push out the nearest way.
          const ex = Math.min(p.x - b.minX, b.maxX - p.x);
          const ez = Math.min(p.z - b.minZ, b.maxZ - p.z);
          if (ex < ez) p.x = p.x - b.minX < b.maxX - p.x ? b.minX - r : b.maxX + r;
          else p.z = p.z - b.minZ < b.maxZ - p.z ? b.minZ - r : b.maxZ + r;
        }
        hit = b;
      }
      return hit;
    },
    hit(b, from) {
      if (b.state !== 'standing' || b.cool > 0) return false;
      // First hit: swap the merged building for its separate panels.
      if (b.intact) {
        b.group.remove(b.intact);
        b.intact = null;
        for (const c of b.chunks) c.mesh.visible = true;
      }
      b.cool = 0.7;
      b.hp--;
      b.shake = 1;
      // Knock loose the panels nearest the impact.
      const local = from.clone().sub(b.group.position);
      const near = b.chunks
        .filter((c) => !c.loose)
        .sort((a, c) => a.mesh.position.distanceToSquared(local) - c.mesh.position.distanceToSquared(local))
        .slice(0, 3 + Math.floor(Math.random() * 3));
      for (const c of near) loosen(c, b, from, 7);
      puff(tmp.set(THREE.MathUtils.clamp(from.x, b.minX, b.maxX), b.group.position.y + 0.8, THREE.MathUtils.clamp(from.z, b.minZ, b.maxZ)), 3, 2);
      if (b.hp > 0) return false;
      // Collapse: everything comes down, roof first, walls spilling outwards.
      b.state = 'rubble';
      for (const c of [...b.chunks]) loosen(c, b, from, 3.5);
      puff(tmp.set((b.minX + b.maxX) / 2, b.group.position.y + 1, (b.minZ + b.maxZ) / 2), 10, Math.max(b.maxX - b.minX, b.maxZ - b.minZ));
      return true;
    },
    setLights(on) {
      headMesh.material = on ? lampOn : lampOff;
    },
    pavement(rand) {
      const row = rand() < 0.5 ? -1 : 1;
      const x = TOWN.x + (rand() - 0.5) * (TOWN.w - 4);
      const z = TOWN.z + row * (4.6 + rand() * 1.2);
      return new THREE.Vector3(x, groundY(x, z), z);
    },
    update(dt) {
      for (const b of buildings) {
        b.cool = Math.max(0, b.cool - dt);
        if (b.shake > 0) {
          b.shake = Math.max(0, b.shake - dt * 3);
          b.group.rotation.z = Math.sin(b.shake * 40) * 0.012 * b.shake;
        }
        for (const c of b.chunks) {
          if (!c.loose || c.resting) continue;
          const m = c.mesh;
          c.vel.y -= GRAVITY * dt;
          m.position.addScaledVector(c.vel, dt);
          m.rotation.x += c.spin.x * dt;
          m.rotation.y += c.spin.y * dt;
          m.rotation.z += c.spin.z * dt;
          const floor = groundY(m.position.x, m.position.z) + c.half;
          if (m.position.y <= floor) {
            m.position.y = floor;
            if (Math.abs(c.vel.y) < 3) {
              // Settle flat-ish, as rubble.
              c.resting = true;
              m.rotation.x = Math.round(m.rotation.x / (Math.PI / 2)) * (Math.PI / 2) + (Math.random() - 0.5) * 0.3;
              m.rotation.z = Math.round(m.rotation.z / (Math.PI / 2)) * (Math.PI / 2) + (Math.random() - 0.5) * 0.3;
            } else {
              c.vel.y *= -0.25;
              c.vel.x *= 0.5;
              c.vel.z *= 0.5;
              c.spin.multiplyScalar(0.5);
            }
          }
        }
      }
      for (let i = dust.length - 1; i >= 0; i--) {
        const d = dust[i];
        d.life -= dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        d.vel.multiplyScalar(1 - dt * 0.8);
        // Billow out, then thin away at the end.
        d.mesh.scale.multiplyScalar(d.life > 0.5 ? 1 + dt * 0.35 : 1 - dt * 3);
        if (d.life <= 0) {
          scene.remove(d.mesh);
          dust.splice(i, 1);
        }
      }
    },
    dispose() {
      for (const b of buildings) {
        scene.remove(b.group);
        for (const c of b.chunks) scene.remove(c.mesh);
      }
      dust.forEach((d) => scene.remove(d.mesh));
      scene.remove(lampGroup);
      owned.forEach((o) => o.dispose());
    },
  };
}
