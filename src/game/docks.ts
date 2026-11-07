import * as THREE from 'three';
import { createPerson, posePerson, type Person } from './park';
import { DOCKS, groundY, HALF, SHORE } from './world';

/**
 * The north-coast docks: a pier with evacuation launches moored either side, a boat shed and crates on
 * the landing. Boats can be sent off on a schedule; each one backs out and sails along the coast,
 * and gets away once it reaches the edge of the island. A dinosaur that rams a boat (moored or
 * sailing) capsizes it; the people aboard go over the side and swim for it.
 */

export interface Boat {
  group: THREE.Group;
  people: Person[];
  /** Moored, sailing away, capsized, or escaped. */
  state: 'moored' | 'sailing' | 'sunk' | 'gone';
  /** Which way it sails along the coast: -1 west, +1 east. */
  dir: number;
  heading: number;
  t: number;
}

export interface Docks {
  boats: Boat[];
  /** Boats still able to get away (moored or sailing). */
  readonly afloat: number;
  /**
   * Keeps the dinosaur out of boat hulls. A boat hit at `speed` above walking pace capsizes; returns it.
   */
  ram(p: THREE.Vector3, r: number, vel: THREE.Vector3, speed: number): Boat | null;
  /** Departure times (seconds from now) for the moored boats, in order. */
  schedule(times: number[]): void;
  /** Spots on the landing for the waiting crowd. */
  landing(rand: () => number): THREE.Vector3;
  update(dt: number, t: number, events: { depart(b: Boat): void; escape(b: Boat): void }): void;
  dispose(): void;
}

const PIER = { x: DOCKS.x, z0: SHORE - 6, z1: 124, w: 3.6, deck: 0.7 };
const SPEED = 3.4;
const HULL = { len: 11, beam: 4 };

export function createDocks(scene: THREE.Scene, rand: () => number): Docks {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  const cyl = keep(new THREE.CylinderGeometry(1, 1, 1, 10));
  const std = (color: string, roughness = 0.7, metalness = 0.1) => keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const wood = std('#4f4032', 0.85);
  const darkWood = std('#33291f', 0.9);
  const root = new THREE.Group();
  scene.add(root);
  const put = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, s: [number, number, number], p: [number, number, number], r: [number, number, number] = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.scale.set(...s);
    mesh.position.set(...p);
    mesh.rotation.set(...r);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Pier: a plank deck on posts, low over the water.
  const len = PIER.z1 - PIER.z0;
  put(root, box, wood, [PIER.w, 0.25, len], [PIER.x, PIER.deck, (PIER.z0 + PIER.z1) / 2]);
  for (let z = PIER.z0 + 1; z <= PIER.z1; z += 3) for (const s of [-1, 1]) {
    const y = groundY(PIER.x, z);
    put(root, cyl, darkWood, [0.18, PIER.deck - y + 0.9, 0.18], [PIER.x + s * (PIER.w / 2 - 0.15), (PIER.deck + y + 0.9) / 2, z]);
  }
  // Boat shed and stacked crates on the landing.
  const shedX = DOCKS.x - 10;
  const shedZ = DOCKS.z - 1;
  const sy = groundY(shedX, shedZ);
  put(root, box, std('#6a675e', 0.85), [8, 4, 6], [shedX, sy + 2, shedZ]);
  put(root, box, std('#2e2c2a', 0.7), [8.6, 0.3, 6.6], [shedX, sy + 4.1, shedZ], [0, 0, 0.05]);
  put(root, box, std('#3a3530', 0.8), [3, 3, 0.1], [shedX, sy + 1.5, shedZ + 3.02]);
  for (let k = 0; k < 7; k++) {
    const x = DOCKS.x + 6 + (k % 3) * 1.4;
    const z = DOCKS.z - 3 + Math.floor(k / 3) * 1.4;
    put(root, box, std(k % 2 ? '#5a4a34' : '#4a5a3a', 0.8), [1.3, 1.2, 1.3], [x, groundY(x, z) + 0.6 + (k > 4 ? 1.2 : 0), z]);
  }

  // Evacuation launches: a white hull with a dark waterline stripe, a wheelhouse and a guard rail.
  const hullMat = std('#c9c6bd', 0.5, 0.1);
  const stripe = std('#2a3a44', 0.5, 0.1);
  const cabinMat = std('#a6a39a', 0.6, 0.1);
  const glass = std('#22303a', 0.1, 0.4);
  const rail = std('#8a8f92', 0.4, 0.7);
  const moorings: [number, number, number][] = [
    [PIER.x - PIER.w / 2 - HULL.beam / 2 - 0.4, 109, -1],
    [PIER.x + PIER.w / 2 + HULL.beam / 2 + 0.4, 112, 1],
    [PIER.x - PIER.w / 2 - HULL.beam / 2 - 0.4, 121, -1],
    [PIER.x + PIER.w / 2 + HULL.beam / 2 + 0.4, 124, 1],
  ];
  const boats: Boat[] = moorings.map(([x, z, dir]) => {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.position.set(x, 0, z);
    put(g, box, hullMat, [HULL.beam, 1.6, HULL.len], [0, 0.5, 0]);
    put(g, box, hullMat, [HULL.beam * 0.7, 1.6, 2], [0, 0.5, HULL.len / 2 + 0.6], [0, Math.PI / 4, 0]).scale.set(HULL.beam * 0.5, 1.6, HULL.beam * 0.5);
    put(g, box, stripe, [HULL.beam + 0.04, 0.35, HULL.len + 0.04], [0, 0.05, 0]);
    put(g, box, cabinMat, [HULL.beam * 0.75, 1.8, 3.4], [0, 2.2, -1]);
    put(g, box, glass, [HULL.beam * 0.76, 0.6, 3.2], [0, 2.6, -1]);
    put(g, box, std('#2b2928', 0.6), [HULL.beam * 0.85, 0.15, 3.8], [0, 3.15, -1]);
    for (const s of [-1, 1]) put(g, box, rail, [0.06, 0.6, HULL.len - 1], [s * (HULL.beam / 2 - 0.1), 1.6, 0.2]);
    root.add(g);
    // Passengers crowded on the aft deck.
    const people = Array.from({ length: 3 }, (_, k) => {
      const pp = createPerson(rand);
      pp.group.scale.setScalar(0.8);
      pp.group.position.set((k - 1) * 1.1, 1.3, -3.6 - (k % 2) * 0.6);
      pp.heading = Math.PI + (rand() - 0.5);
      g.add(pp.group);
      return pp;
    });
    return { group: g, people, state: 'moored', dir, heading: 0, t: 0 };
  });

  // Swimmers from capsized boats, making for the shore (then gone).
  const swimmers: { p: Person; vel: THREE.Vector3; t: number }[] = [];
  let departures: { at: number; boat: Boat }[] = [];
  let clock = 0;
  const to = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  function capsize(boat: Boat) {
    boat.state = 'sunk';
    boat.t = 0;
    // Everyone goes over the side and swims for it.
    for (const pp of boat.people) {
      pp.group.getWorldPosition(a);
      boat.group.remove(pp.group);
      pp.group.position.copy(a).setY(-0.6);
      pp.group.scale.setScalar(1);
      pp.state = 'panic';
      pp.t = 0;
      scene.add(pp.group);
      swimmers.push({ p: pp, vel: new THREE.Vector3((rand() - 0.5) * 2, 0, -3 - rand()), t: 0 });
    }
    boat.people = [];
  }

  return {
    boats,
    get afloat() {
      return boats.filter((x) => x.state === 'moored' || x.state === 'sailing').length;
    },
    ram(p, r, vel, speed) {
      let rammed: Boat | null = null;
      for (const boat of boats) {
        if (boat.state === 'sunk' || boat.state === 'gone') continue;
        // The hull as a capsule along its heading.
        const g = boat.group;
        const fx = Math.sin(g.rotation.y);
        const fz = Math.cos(g.rotation.y);
        a.set(g.position.x - fx * (HULL.len / 2 - 1), 0, g.position.z - fz * (HULL.len / 2 - 1));
        b.set(g.position.x + fx * (HULL.len / 2 - 1), 0, g.position.z + fz * (HULL.len / 2 - 1));
        to.set(p.x - a.x, 0, p.z - a.z);
        const ab = b.clone().sub(a);
        const t = THREE.MathUtils.clamp(to.dot(ab) / ab.lengthSq(), 0, 1);
        const cx = a.x + ab.x * t;
        const cz = a.z + ab.z * t;
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d = Math.hypot(dx, dz) || 1e-4;
        const min = r + HULL.beam / 2;
        if (d >= min) continue;
        if (speed > 3) {
          capsize(boat);
          rammed = boat;
          continue;
        }
        p.x = cx + (dx / d) * min;
        p.z = cz + (dz / d) * min;
        const into = -(vel.x * dx + vel.z * dz) / d;
        if (into > 0) {
          vel.x += (dx / d) * into;
          vel.z += (dz / d) * into;
        }
      }
      return rammed;
    },
    schedule(times) {
      clock = 0;
      const moored = boats.filter((x) => x.state === 'moored');
      departures = times.slice(0, moored.length).map((at, i) => ({ at, boat: moored[i] }));
    },
    landing(r) {
      const x = DOCKS.x + (r() - 0.5) * (DOCKS.w - 8);
      const z = DOCKS.z + 2 + r() * 4;
      return new THREE.Vector3(x, groundY(x, z), z);
    },
    update(dt, t, events) {
      clock += dt;
      for (const dep of departures) {
        if (dep.at >= 0 && clock >= dep.at && dep.boat.state === 'moored') {
          dep.at = -1;
          dep.boat.state = 'sailing';
          dep.boat.t = 0;
          events.depart(dep.boat);
        }
      }
      for (const boat of boats) {
        const g = boat.group;
        boat.t += dt;
        if (boat.state === 'moored') {
          g.position.y = Math.sin(t * 1.3 + g.position.z) * 0.08;
          g.rotation.z = Math.sin(t * 0.9 + g.position.x) * 0.03;
        } else if (boat.state === 'sailing') {
          // Back away from the pier, swing round, then motor along the coast.
          const turn = THREE.MathUtils.smoothstep(boat.t, 1, 5);
          g.rotation.y = boat.dir * (Math.PI / 2) * turn;
          g.position.x += Math.sin(g.rotation.y) * SPEED * dt * Math.max(0.3, turn) + boat.dir * (1 - turn) * dt * 1.5;
          g.position.z += Math.cos(g.rotation.y) * SPEED * dt * Math.max(0.3, turn) * 0.3;
          g.position.y = Math.sin(t * 2.1) * 0.15;
          g.rotation.x = Math.sin(t * 1.7) * 0.04;
          if (Math.abs(g.position.x) > HALF - 4) {
            boat.state = 'gone';
            g.visible = false;
            events.escape(boat);
          }
        } else if (boat.state === 'sunk') {
          // List over and settle low in the water.
          const k = Math.min(1, boat.t / 1.6);
          g.rotation.z = boat.dir * 1.35 * (1 - (1 - k) ** 3);
          g.position.y = -1.6 * k;
        }
        for (const pp of boat.people) posePerson(pp, dt, t, 0);
      }
      for (let i = swimmers.length - 1; i >= 0; i--) {
        const s = swimmers[i];
        s.t += dt;
        s.p.group.position.addScaledVector(s.vel, dt);
        s.p.group.position.y = -0.9 + Math.sin(t * 4 + i) * 0.1;
        s.p.group.rotation.y = Math.atan2(s.vel.x, s.vel.z);
        s.p.arms.forEach((arm, k) => (arm.rotation.x = Math.PI + Math.sin(t * 6 + k * Math.PI) * 1.2));
        if (s.t > 9 || s.p.group.position.z < SHORE - 2) {
          scene.remove(s.p.group);
          swimmers.splice(i, 1);
        }
      }
    },
    dispose() {
      scene.remove(root);
      swimmers.forEach((s) => scene.remove(s.p.group));
      owned.forEach((o) => o.dispose());
    },
  };
}
