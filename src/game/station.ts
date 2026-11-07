import * as THREE from 'three';
import { groundY, POWER } from './world';

/**
 * The power station: three backup generators in a fenced yard, with transformers and floodlights.
 * Each generator takes a few charges; it sparks and smokes as it breaks, and dies with a burst of sparks.
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
}

export interface Station {
  generators: Generator[];
  readonly running: number;
  /** Keeps a circle out of the generators (dead ones too: they're still big machines). */
  collide(p: THREE.Vector3, r: number, vel: THREE.Vector3): Generator | null;
  /** A charge into a running generator; true if it just died. */
  hit(g: Generator, from: THREE.Vector3): boolean;
  /** Everything off: floodlights dark, generators silent. `wrecked` also shows them already destroyed. */
  blackout(wrecked?: boolean): void;
  update(dt: number, t: number): void;
  dispose(): void;
}

const HP = 4;

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
    return { group: g, minX: x - 3.8, maxX: x + 3.8, minZ: z - 2.3, maxZ: z + 2.3, hp: HP, dead: false, cool: 0, shake: 0, lamp };
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
    floods.push(put(pole, box, flood, [1.1, 0.5, 0.6], [0, 9.1, 0], [0.3, Math.atan2(-dx, -dz), 0]));
    root.add(pole);
  }

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
    hit(g, from) {
      if (g.dead || g.cool > 0) return false;
      g.cool = 0.7;
      g.hp--;
      g.shake = 1;
      tmp.set(THREE.MathUtils.clamp(from.x, g.minX, g.maxX), g.group.position.y + 2, THREE.MathUtils.clamp(from.z, g.minZ, g.maxZ));
      burst(tmp, 10);
      g.lamp.material = lampWarn;
      if (g.hp > 0) return false;
      g.dead = true;
      g.lamp.material = lampOff;
      burst(tmp.set(g.group.position.x, g.group.position.y + 3, g.group.position.z), 40);
      // A dead generator slumps on its mounts.
      g.group.rotation.z = 0.06;
      g.group.rotation.x = -0.04;
      return true;
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
        if (!g.dead && g.hp < HP && Math.random() < dt * 1.5) burst(tmp.set(g.group.position.x + 3, g.group.position.y + 2.5, g.group.position.z), 4);
      }
      // Smoke from the stacks of running generators, and from wrecked ones.
      smokeIn -= dt;
      if (smokeIn <= 0) {
        smokeIn = 0.6;
        for (const g of generators) if (powered || g.dead) puff(tmp.set(g.group.position.x + 2.4, g.group.position.y + (g.dead ? 3.5 : 6.3), g.group.position.z));
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
      sparks.forEach((s) => scene.remove(s.mesh));
      smoke.forEach((s) => scene.remove(s.mesh));
      owned.forEach((o) => o.dispose());
    },
  };
  return station;
}
