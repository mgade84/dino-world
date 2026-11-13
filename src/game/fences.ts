import * as THREE from 'three';
import { FENCE_LINES, groundY } from './world';
import { bake } from './merge';

/**
 * Perimeter fences: tall concrete posts strung with cables, a warning lamp on every post. While the
 * power is on they are live: touching one zaps the dinosaur and throws it back. With the power off they
 * are just cables, and a charging dinosaur tears a section down.
 */

const POST_GAP = 5;
const HEIGHT = 6;
const CABLES = 6;

interface Section {
  a: THREE.Vector2;
  b: THREE.Vector2;
  group: THREE.Group;
  down: boolean;
  /** 0..1 while falling over. */
  fall: number;
  fallDir: number;
}

export interface Fences {
  live: boolean;
  setLive(on: boolean): void;
  /**
   * Keeps a circle out of standing sections. Returns 'zap' if it touched a live one (the caller deals the
   * damage; the push-back is applied to `vel`), 'break' if it tore a dead one down, or null.
   */
  collide(p: THREE.Vector3, r: number, vel: THREE.Vector3, speed: number): 'zap' | 'break' | null;
  /** Keeps someone on foot (a ranger, a visitor) out of standing sections, live or dead: no zap, nothing torn down. */
  block(p: THREE.Vector3, r: number): void;
  update(dt: number, t: number): void;
  dispose(): void;
}

export function createFences(scene: THREE.Scene, live: boolean): Fences {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  const cyl = keep(new THREE.CylinderGeometry(1, 1, 1, 6));
  const concrete = keep(new THREE.MeshStandardMaterial({ color: '#77746d', roughness: 0.9 }));
  const steel = keep(new THREE.MeshStandardMaterial({ color: '#2d3033', roughness: 0.4, metalness: 0.6 }));
  const lampOn = keep(new THREE.MeshStandardMaterial({ color: '#ff4a1c', emissive: '#ff3010', emissiveIntensity: 2 }));
  const lampOff = keep(new THREE.MeshStandardMaterial({ color: '#3a2420', roughness: 0.5 }));
  const signMat = keep(new THREE.MeshStandardMaterial({ color: '#d9b21a', roughness: 0.6 }));
  const lamps: THREE.Mesh[] = [];
  const sections: Section[] = [];

  for (const [x1, z1, x2, z2] of FENCE_LINES) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.round(len / POST_GAP));
    for (let k = 0; k < n; k++) {
      const ax = x1 + ((x2 - x1) * k) / n;
      const az = z1 + ((z2 - z1) * k) / n;
      const bx = x1 + ((x2 - x1) * (k + 1)) / n;
      const bz = z1 + ((z2 - z1) * (k + 1)) / n;
      const g = new THREE.Group();
      g.position.set(ax, groundY(ax, az), az);
      g.rotation.y = Math.atan2(bx - ax, bz - az);
      const seg = Math.hypot(bx - ax, bz - az);
      // Post at the section's start; cables run along local +z to the next post.
      const post = new THREE.Mesh(box, concrete);
      post.scale.set(0.45, HEIGHT, 0.45);
      post.position.y = HEIGHT / 2;
      post.castShadow = true;
      g.add(post);
      const lamp = new THREE.Mesh(box, live ? lampOn : lampOff);
      lamp.scale.set(0.3, 0.25, 0.3);
      lamp.position.y = HEIGHT + 0.15;
      lamp.userData.keep = true; // its material switches with the power
      g.add(lamp);
      lamps.push(lamp);
      for (let c = 0; c < CABLES; c++) {
        const cable = new THREE.Mesh(cyl, steel);
        cable.scale.set(0.035, seg, 0.035);
        cable.rotation.x = Math.PI / 2;
        cable.position.set(0, 0.8 + (c * (HEIGHT - 1.2)) / (CABLES - 1), seg / 2);
        g.add(cable);
      }
      if (k % 3 === 1) {
        const sign = new THREE.Mesh(box, signMat);
        sign.scale.set(0.05, 0.7, 1.0);
        sign.position.set(0.12, 2.2, seg / 2);
        g.add(sign);
      }
      bake(g, [], owned);
      scene.add(g);
      sections.push({ a: new THREE.Vector2(ax, az), b: new THREE.Vector2(bx, bz), group: g, down: false, fall: 0, fallDir: 1 });
    }
  }

  const ab = new THREE.Vector2();
  const ap = new THREE.Vector2();
  let flick = 0;
  const fences: Fences = {
    live,
    setLive(on) {
      fences.live = on;
      lamps.forEach((l) => (l.material = on ? lampOn : lampOff));
    },
    collide(p, r, vel, speed) {
      let result: 'zap' | 'break' | null = null;
      for (const s of sections) {
        if (s.down || p.y > s.group.position.y + HEIGHT + 0.5) continue;
        ab.subVectors(s.b, s.a);
        ap.set(p.x - s.a.x, p.z - s.a.y);
        const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
        const cx = s.a.x + ab.x * t;
        const cz = s.a.y + ab.y * t;
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d = Math.hypot(dx, dz) || 1e-4;
        if (d >= r + 0.2) continue;
        if (!fences.live && speed > 6) {
          // Dead fence, hit at a run: the section goes over.
          s.down = true;
          s.fallDir = (ab.x * dz - ab.y * dx) > 0 ? -1 : 1;
          result = 'break';
          continue;
        }
        p.x = cx + (dx / d) * (r + 0.2);
        p.z = cz + (dz / d) * (r + 0.2);
        const into = -(vel.x * dx + vel.z * dz) / d;
        if (fences.live) {
          // Thrown back off the wires.
          vel.set((dx / d) * 16, vel.y, (dz / d) * 16);
          result = 'zap';
        } else if (into > 0) {
          vel.x += (dx / d) * into;
          vel.z += (dz / d) * into;
        }
      }
      return result;
    },
    block(p, r) {
      for (const s of sections) {
        if (s.down || p.y > s.group.position.y + HEIGHT + 0.5) continue;
        ab.subVectors(s.b, s.a);
        ap.set(p.x - s.a.x, p.z - s.a.y);
        const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
        const cx = s.a.x + ab.x * t;
        const cz = s.a.y + ab.y * t;
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= r + 0.2 || d < 1e-4) continue;
        p.x = cx + (dx / d) * (r + 0.2);
        p.z = cz + (dz / d) * (r + 0.2);
      }
    },
    update(dt, t) {
      // Live lamps pulse; a fault flicker now and then.
      flick -= dt;
      if (fences.live) {
        if (flick <= 0) flick = 3 + Math.random() * 5;
        lampOn.emissiveIntensity = flick < 0.15 ? 0.2 : 1.6 + Math.sin(t * 4) * 0.6;
      }
      for (const s of sections) {
        if (!s.down || s.fall >= 1) continue;
        s.fall = Math.min(1, s.fall + dt * 2.2);
        const e = s.fall * s.fall;
        s.group.rotation.z = s.fallDir * e * (Math.PI / 2 - 0.15);
      }
    },
    dispose() {
      sections.forEach((s) => scene.remove(s.group));
      owned.forEach((o) => o.dispose());
    },
  };
  return fences;
}
