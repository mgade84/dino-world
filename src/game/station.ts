import * as THREE from 'three';
import { groundY, POWER } from './world';
import { bake } from './merge';

/**
 * The power station: three backup generators in a fenced yard, with transformers and floodlights.
 * Each generator takes BITES bites; every one tears a gash in its housing where the jaws went in and rips a
 * panel off, and it leans, sparks and smokes more as it goes, then dies with a burst of sparks.
 * When the last one goes the island blacks out (the caller turns the fences and lights off).
 */

export interface Generator {
  group: THREE.Group;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  hp: number;
  dead: boolean;
  cool: number;
  shake: number;
  lamp: THREE.Mesh;
  /** The torn gashes in its housing, one per bite (in its own group, so they slump with it). */
  gashes: THREE.InstancedMesh;
}

export interface Station {
  generators: Generator[];
  readonly running: number;
  /** Keeps a circle out of the generators (dead ones too: they're still big machines). */
  collide(p: THREE.Vector3, r: number, vel: THREE.Vector3): Generator | null;
  /** The running generator within `reach` of `at` and roughly ahead along `facing`, if any. */
  biteable(at: THREE.Vector3, facing: THREE.Vector3, reach: number): Generator | null;
  /** Jaws into a running generator at `jaw`: 'hit', 'dead' if that bite killed it, or null if it didn't land. */
  bite(g: Generator, jaw: THREE.Vector3): 'hit' | 'dead' | null;
  /** Everything off: floodlights dark, generators silent. `wrecked` also shows them already destroyed. */
  blackout(wrecked?: boolean): void;
  update(dt: number, t: number): void;
  dispose(): void;
}

/** Bites to kill a generator. */
export const BITES = 5;
const HP = BITES;
/** The housing, in a generator's own frame: centre and half sizes. */
const HOUSING = { y: 1.8, hx: 3.5, hy: 1.6, hz: 2 };
/** Panels torn off, at most, across the yard. */
const DEBRIS = HP * 3;

export function createStation(scene: THREE.Scene): Station {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  const cyl = keep(new THREE.CylinderGeometry(1, 1, 1, 12));
  const std = (color: string, roughness = 0.7, metalness = 0.2) => keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const paint = std('#3d4a3a', 0.55, 0.35);
  const steel = std('#4a4e52', 0.4, 0.7);
  const concrete = std('#6e6b64', 0.9, 0);
  const stripeY = std('#c9a21c', 0.6, 0);
  const stripeK = std('#1d1d1d', 0.6, 0);
  const lampOn = keep(new THREE.MeshStandardMaterial({ color: '#3fdc5a', emissive: '#22c040', emissiveIntensity: 2 }));
  const lampWarn = keep(new THREE.MeshStandardMaterial({ color: '#ff8a1c', emissive: '#ff6a00', emissiveIntensity: 2.2 }));
  const lampOff = std('#2a2a2a', 0.5, 0);
  // Torn metal: the dark inside of the housing, with a hot glow of wiring in it.
  const gashMat = keep(new THREE.MeshStandardMaterial({ color: '#141210', emissive: '#4a1a04', emissiveIntensity: 0.6, roughness: 0.9 }));
  const flood = keep(new THREE.MeshStandardMaterial({ color: '#fff4d0', emissive: '#ffe9b0', emissiveIntensity: 2.5 }));
  const sparkMat = keep(new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
  const smokeMat = keep(new THREE.MeshLambertMaterial({ color: '#3a3a3a', transparent: true, opacity: 0.28, depthWrite: false }));
  const sparkGeo = keep(new THREE.BoxGeometry(0.08, 0.08, 0.4));
  const smokeGeo = keep(new THREE.IcosahedronGeometry(1, 1));
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

  // The yard's concrete pad.
  const y0 = POWER.y;
  const pad = put(root, box, concrete, [POWER.w - 2, 0.2, POWER.d - 2], [POWER.x, y0 + 0.05, POWER.z]);
  pad.castShadow = false;

  // Three generators in a row: housings with radiator grilles, exhaust stacks and a status lamp.
  const generators: Generator[] = [-7, 0, 7].map((dz) => {
    const x = POWER.x - 3;
    const z = POWER.z + dz;
    const g = new THREE.Group();
    g.position.set(x, groundY(x, z), z);
    g.userData.x = x;
    root.add(g);
    put(g, box, paint, [7, 3.2, 4], [0, 1.8, 0]);
    put(g, box, concrete, [7.6, 0.4, 4.6], [0, 0.2, 0]);
    for (let k = 0; k < 6; k++) put(g, box, steel, [0.08, 2.2, 3.4], [-2.9 + k * 0.2, 1.9, 0]);
    put(g, cyl, steel, [0.35, 3.2, 0.35], [2.4, 4.6, 0.9]);
    put(g, cyl, steel, [0.35, 3.2, 0.35], [2.4, 4.6, -0.9]);
    for (let k = 0; k < 5; k++) put(g, box, k % 2 ? stripeK : stripeY, [0.6, 0.35, 4.05], [3.2, 0.7 + k * 0.35, 0]);
    const lamp = put(g, box, lampOn, [0.15, 0.3, 0.3], [3.55, 2.9, 1.2]);
    lamp.userData.keep = true;
    const gashes = new THREE.InstancedMesh(box, gashMat, HP);
    gashes.count = 0;
    gashes.userData.keep = true;
    return { group: g, minX: x - 3.8, maxX: x + 3.8, minZ: z - 2.3, maxZ: z + 2.3, hp: HP, dead: false, cool: 0, shake: 0, lamp, gashes };
  });

  // Transformers and floodlights along the back of the yard.
  for (const dz of [-6, 0, 6]) {
    const t = new THREE.Group();
    const x = POWER.x - 10.5;
    const z = POWER.z + dz;
    t.position.set(x, groundY(x, z), z);
    put(t, box, steel, [2.2, 2.6, 2.6], [0, 1.3, 0]);
    for (const dx of [-0.6, 0, 0.6]) put(t, cyl, std('#7a5a3a', 0.4, 0), [0.12, 1.0, 0.12], [dx, 3.1, 0]);
    root.add(t);
  }
  const floods: THREE.Mesh[] = [];
  for (const [dx, dz] of [[9, -9], [9, 9], [-11, -9], [-11, 9]] as const) {
    const x = POWER.x + dx;
    const z = POWER.z + dz;
    const pole = new THREE.Group();
    pole.position.set(x, groundY(x, z), z);
    put(pole, cyl, steel, [0.15, 9, 0.15], [0, 4.5, 0]);
    const f = put(pole, box, flood, [1.1, 0.5, 0.6], [0, 9.1, 0], [0.3, Math.atan2(-dx, -dz), 0]);
    f.userData.keep = true;
    floods.push(f);
    root.add(pole);
  }

  // One mesh per material for the static yard; generators keep their own group (they shake and slump).
  bake(root, generators.map((g) => g.group), owned);
  for (const g of generators) {
    bake(g.group, [], owned);
    // Added after baking, so the gashes stay one instanced mesh.
    g.group.add(g.gashes);
  }

  // Panels torn off by the bites: one instanced mesh for the yard, each flung off and left lying.
  const debris = new THREE.InstancedMesh(box, std('#3d4a3a', 0.55, 0.35), DEBRIS);
  debris.count = 0;
  debris.castShadow = true;
  scene.add(debris);
  owned.push({ dispose: () => debris.dispose() });
  const flying: { i: number; pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; size: THREE.Vector3; rest: boolean }[] = [];
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const setDebris = (d: (typeof flying)[number]) => {
    m4.compose(d.pos, quat.setFromEuler(d.rot), d.size);
    debris.setMatrixAt(d.i, m4);
    debris.instanceMatrix.needsUpdate = true;
  };
  const local = new THREE.Vector3();
  const normal = new THREE.Vector3();

  // Sparks and smoke.
  const sparks: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];
  const smoke: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];
  function burst(at: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.position.copy(at);
      const v = new THREE.Vector3((Math.random() - 0.5) * 10, 3 + Math.random() * 7, (Math.random() - 0.5) * 10);
      mesh.lookAt(at.clone().add(v));
      scene.add(mesh);
      sparks.push({ mesh, vel: v, life: 0.5 + Math.random() * 0.5 });
    }
  }
  function puff(at: THREE.Vector3) {
    const mesh = new THREE.Mesh(smokeGeo, smokeMat);
    mesh.position.copy(at);
    mesh.scale.setScalar(0.4);
    scene.add(mesh);
    smoke.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 2 + Math.random(), (Math.random() - 0.5) * 0.6), life: 3 });
  }

  let powered = true;
  let smokeIn = 0;
  const tmp = new THREE.Vector3();
  const station: Station = {
    generators,
    get running() {
      return generators.filter((g) => !g.dead).length;
    },
    collide(p, r, vel) {
      let hit: Generator | null = null;
      for (const g of generators) {
        const cx = THREE.MathUtils.clamp(p.x, g.minX, g.maxX);
        const cz = THREE.MathUtils.clamp(p.z, g.minZ, g.maxZ);
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= r || p.y > g.group.position.y + 3.6) continue;
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        p.x = cx + nx * r;
        p.z = cz + nz * r;
        const into = -(vel.x * nx + vel.z * nz);
        if (into > 0) {
          vel.x += nx * into;
          vel.z += nz * into;
        }
        hit = g;
      }
      return hit;
    },
    biteable(at, facing, reach) {
      for (const g of generators) {
        if (g.dead) continue;
        const dx = THREE.MathUtils.clamp(at.x, g.minX, g.maxX) - at.x;
        const dz = THREE.MathUtils.clamp(at.z, g.minZ, g.maxZ) - at.z;
        const d = Math.hypot(dx, dz);
        if (d > reach || at.y > g.group.position.y + 4) continue;
        if (d > 1e-3 && (dx * facing.x + dz * facing.z) / d < 0.4) continue;
        return g;
      }
      return null;
    },
    bite(g, jaw) {
      if (g.dead || g.cool > 0) return null;
      g.cool = 0.4;
      g.hp--;
      g.shake = 1;
      const taken = HP - g.hp;
      // Where the jaws went in, on the housing's nearest face, in the generator's own frame.
      local.copy(jaw);
      g.group.worldToLocal(local);
      const ax = Math.abs(local.x) / HOUSING.hx;
      const az = Math.abs(local.z) / HOUSING.hz;
      local.x = THREE.MathUtils.clamp(local.x, -HOUSING.hx, HOUSING.hx);
      local.y = THREE.MathUtils.clamp(local.y, HOUSING.y - HOUSING.hy + 0.6, HOUSING.y + HOUSING.hy - 0.4);
      local.z = THREE.MathUtils.clamp(local.z, -HOUSING.hz, HOUSING.hz);
      // Spread the bites out a little along the face, so each leaves its own gash.
      if (ax >= az) {
        normal.set(Math.sign(local.x) || 1, 0, 0);
        local.x = normal.x * (HOUSING.hx + 0.02);
        local.z = THREE.MathUtils.clamp(local.z + (Math.random() - 0.5) * 1.6, -HOUSING.hz + 0.6, HOUSING.hz - 0.6);
      } else {
        normal.set(0, 0, Math.sign(local.z) || 1);
        local.z = normal.z * (HOUSING.hz + 0.02);
        local.x = THREE.MathUtils.clamp(local.x + (Math.random() - 0.5) * 2, -HOUSING.hx + 0.7, HOUSING.hx - 0.7);
      }
      local.y += (Math.random() - 0.5) * 0.8;
      // The gash: a torn dark hole in the panel, a little ragged (tilted, of varying size).
      const w = 0.9 + Math.random() * 0.7;
      const h = 0.6 + Math.random() * 0.5;
      m4.compose(
        local,
        quat.setFromEuler(new THREE.Euler(0, normal.x ? Math.PI / 2 : 0, (Math.random() - 0.5) * 0.8)),
        new THREE.Vector3(w, h, 0.08),
      );
      g.gashes.setMatrixAt(g.gashes.count, m4);
      g.gashes.count++;
      g.gashes.instanceMatrix.needsUpdate = true;
      // A panel comes away with it and goes flying, out from the face and up.
      if (debris.count < DEBRIS) {
        const at = local.clone().addScaledVector(normal, 0.3);
        g.group.localToWorld(at);
        const out = normal.clone().transformDirection(g.group.matrixWorld);
        const d = {
          i: debris.count++,
          pos: at,
          vel: out.multiplyScalar(4 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, 5 + Math.random() * 3, (Math.random() - 0.5) * 3)),
          rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
          spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14),
          size: new THREE.Vector3(w * 1.1, h * 1.1, 0.07),
          rest: false,
        };
        flying.push(d);
        setDebris(d);
      }
      // It sags further on its mounts with each bite.
      g.group.rotation.z = 0.012 * taken;
      g.group.rotation.x = -0.008 * taken;
      g.group.position.y = groundY(g.group.position.x, g.group.position.z) - 0.03 * taken;
      tmp.copy(local);
      g.group.localToWorld(tmp);
      burst(tmp, 10 + taken * 3);
      g.lamp.material = lampWarn;
      if (g.hp > 0) return 'hit';
      g.dead = true;
      g.lamp.material = lampOff;
      burst(tmp.set(g.group.position.x, g.group.position.y + 3, g.group.position.z), 40);
      // A dead generator slumps on its mounts.
      g.group.rotation.z = 0.07;
      g.group.rotation.x = -0.045;
      return 'dead';
    },
    blackout(wrecked = false) {
      powered = false;
      floods.forEach((f) => (f.material = lampOff));
      for (const g of generators) {
        g.lamp.material = lampOff;
        if (wrecked) {
          g.dead = true;
          g.hp = 0;
          g.group.rotation.set(-0.04, 0, 0.06);
        }
      }
    },
    update(dt, t) {
      for (const g of generators) {
        g.cool = Math.max(0, g.cool - dt);
        if (g.shake > 0) {
          g.shake = Math.max(0, g.shake - dt * 3);
          g.group.position.x = g.group.userData.x + Math.sin(g.shake * 50) * 0.06 * g.shake;
        }
        // Running generators hum along with a gentle vibration; damaged ones spark now and then.
        if (!g.dead && powered) g.group.children[0].position.y = 1.8 + Math.sin(t * 60) * 0.004;
        if (!g.dead && g.hp < HP && Math.random() < dt * 1.2 * (HP - g.hp)) burst(tmp.set(g.group.position.x + 3, g.group.position.y + 2.5, g.group.position.z), 4);
      }
      // Smoke from the stacks of running generators, and from wrecked ones.
      smokeIn -= dt;
      if (smokeIn <= 0) {
        smokeIn = 0.6;
        for (const g of generators) if (!g.dead && g.hp < HP - 1) puff(tmp.set(g.group.position.x + (Math.random() - 0.5) * 4, g.group.position.y + 3.4, g.group.position.z + (Math.random() - 0.5) * 2));
        for (const g of generators) if (powered || g.dead) puff(tmp.set(g.group.position.x + 2.4, g.group.position.y + (g.dead ? 3.5 : 6.3), g.group.position.z));
      }
      // Torn panels tumble through the air and land flat, where they stay.
      for (const d of flying) {
        if (d.rest) continue;
        d.vel.y -= 25 * dt;
        d.pos.addScaledVector(d.vel, dt);
        d.rot.x += d.spin.x * dt;
        d.rot.y += d.spin.y * dt;
        d.rot.z += d.spin.z * dt;
        const floor = groundY(d.pos.x, d.pos.z) + 0.05;
        if (d.pos.y <= floor && d.vel.y < 0) {
          d.pos.y = floor;
          d.rot.set(Math.PI / 2 + (Math.random() - 0.5) * 0.1, d.rot.y, 0);
          d.rest = true;
        }
        setDebris(d);
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt;
        s.vel.y -= 25 * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        if (s.life <= 0) {
          scene.remove(s.mesh);
          sparks.splice(i, 1);
        }
      }
      for (let i = smoke.length - 1; i >= 0; i--) {
        const s = smoke[i];
        s.life -= dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        s.mesh.scale.multiplyScalar(s.life > 0.6 ? 1 + dt * 0.3 : 1 - dt * 3);
        if (s.life <= 0) {
          scene.remove(s.mesh);
          smoke.splice(i, 1);
        }
      }
    },
    dispose() {
      scene.remove(root);
      scene.remove(debris);
      sparks.forEach((s) => scene.remove(s.mesh));
      smoke.forEach((s) => scene.remove(s.mesh));
      owned.forEach((o) => o.dispose());
    },
  };
  return station;
}
