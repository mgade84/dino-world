import * as THREE from 'three';
import { sfx } from '../engine/audio';
import { createPerson, knockDown, posePerson, type Person } from './park';
import { groundY } from './world';

/**
 * Park rangers with tranquilliser rifles. They walk a patrol until they see the dinosaur, then stand and
 * shoot darts at it. A dart is a real projectile, so a dinosaur on the move can dodge. Up close, or when
 * it roars, they break and run; rammed, they're knocked flat. After a while they come back to the fight.
 */

/** How far a ranger can see the dinosaur from, and the range they shoot at. */
const SIGHT = 44;
/** Closer than this and nerve fails: they run. */
const NERVE = 11;
const DART_SPEED = 55;
/** Seconds between shots (plus up to SHOT_JITTER). */
const SHOT_EVERY = 2.3;
const SHOT_JITTER = 1.5;

interface Ranger {
  p: Person;
  home: THREE.Vector3;
  target: THREE.Vector3;
  mode: 'patrol' | 'aim' | 'flee' | 'down';
  t: number;
  cool: number;
}

interface Dart { mesh: THREE.Group; vel: THREE.Vector3; life: number }

export interface PlayerView {
  pos: THREE.Vector3;
  radius: number;
  speed: number;
  /** Out of its paddock (rangers ignore a dinosaur still behind bars). */
  free: boolean;
  /** Sedated or otherwise not a target. */
  ignore: boolean;
}

export interface Security {
  update(dt: number, t: number, player: PlayerView): void;
  /** A roar at `at`: rangers within `range` run. */
  roar(at: THREE.Vector3, range: number): void;
  /** After the dinosaur wakes at a checkpoint: rangers near it fall back to their posts. */
  regroup(at: THREE.Vector3): void;
  /** More rangers arrive at posts around the island. */
  reinforce(n: number): void;
  readonly count: number;
  dispose(): void;
}

export function createSecurity(
  scene: THREE.Scene,
  count: number,
  spot: () => THREE.Vector3,
  block: (p: THREE.Vector3, r: number) => void,
  rand: () => number,
  hooks: { onHit(): void; onSpot(): void; onKnock(): void },
): Security {
  const owned: { dispose(): void }[] = [];
  const dartGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.6, 5).rotateX(Math.PI / 2);
  const tuftGeo = new THREE.ConeGeometry(0.09, 0.2, 6).rotateX(-Math.PI / 2);
  owned.push(dartGeo, tuftGeo);
  const dartMat = new THREE.MeshStandardMaterial({ color: '#c9c4b8', metalness: 0.6, roughness: 0.3 });
  const tuftMat = new THREE.MeshStandardMaterial({ color: '#ff3a1a', emissive: '#a01800', emissiveIntensity: 0.6 });
  owned.push(dartMat, tuftMat);

  const recruit = (): Ranger => {
    const p = createPerson(rand, 'ranger');
    const home = spot();
    p.group.position.copy(home);
    scene.add(p.group);
    return { p, home, target: home.clone(), mode: 'patrol', t: rand() * 3, cool: 0 };
  };
  const rangers: Ranger[] = Array.from({ length: count }, recruit);
  const darts: Dart[] = [];
  let spotted = false;
  const to = new THREE.Vector3();
  const chest = new THREE.Vector3();

  function fire(r: Ranger, player: PlayerView) {
    const from = r.p.group.position.clone().add(new THREE.Vector3(Math.sin(r.p.heading) * 0.8, 2.2, Math.cos(r.p.heading) * 0.8));
    chest.copy(player.pos).setY(player.pos.y + player.radius * 1.1);
    // Aim at where the dinosaur is now, a little off: the further away, the wider the miss.
    const spread = 0.4 + from.distanceTo(chest) * 0.03;
    chest.x += (rand() - 0.5) * spread;
    chest.y += (rand() - 0.5) * spread * 0.6;
    chest.z += (rand() - 0.5) * spread;
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(dartGeo, dartMat));
    const tuft = new THREE.Mesh(tuftGeo, tuftMat);
    tuft.position.z = -0.35;
    mesh.add(tuft);
    mesh.position.copy(from);
    mesh.lookAt(chest);
    scene.add(mesh);
    darts.push({ mesh, vel: new THREE.Vector3().subVectors(chest, from).normalize().multiplyScalar(DART_SPEED), life: 1.4 });
    sfx.dartShot();
  }

  return {
    update(dt, t, player) {
      for (const r of rangers) {
        const p = r.p;
        const q = p.group.position;
        r.t += dt;
        r.cool -= dt;
        to.subVectors(player.pos, q).setY(0);
        const d = to.length();
        // Rammed at a run: knocked flat.
        if (player.free && p.state !== 'down' && d < player.radius + 0.9 && player.speed > 3 && player.pos.y - q.y < 3) {
          knockDown(p, player.pos);
          r.mode = 'down';
          hooks.onKnock();
        }
        let speed = 0;
        if (r.mode === 'down') {
          // Slide a little with the blow, then lie there; posePerson gets them up and running.
          p.vel.multiplyScalar(Math.exp(-dt * 4));
          q.addScaledVector(p.vel, dt);
          if (p.state === 'panic') {
            r.mode = 'flee';
            r.t = 0;
            p.state = 'idle'; // rangers run with the rifle, not in a blind panic
          }
        } else if (r.mode === 'patrol') {
          to.subVectors(r.target, q).setY(0);
          if (to.length() < 1.5 || r.t > 12) {
            r.target.set(r.home.x + (rand() - 0.5) * 30, 0, r.home.z + (rand() - 0.5) * 30);
            r.t = 0;
          }
          speed = 2.2;
          p.vel.copy(to.normalize()).multiplyScalar(speed);
          p.aim = Math.max(0, p.aim - dt * 3);
          if (player.free && !player.ignore && d < SIGHT) {
            r.mode = 'aim';
            r.cool = 0.9 + rand() * 0.8;
            if (!spotted) {
              spotted = true;
              hooks.onSpot();
            }
          }
        } else if (r.mode === 'aim') {
          // Stand, face the dinosaur, raise the rifle, shoot.
          p.vel.set(0, 0, 0);
          p.heading = Math.atan2(player.pos.x - q.x, player.pos.z - q.z);
          p.aim = Math.min(1, p.aim + dt * 3);
          if (d < NERVE) {
            r.mode = 'flee';
            r.t = 0;
          } else if (d > SIGHT * 1.3 || player.ignore || !player.free) r.mode = 'patrol';
          else if (r.cool <= 0 && p.aim >= 1) {
            fire(r, player);
            r.cool = SHOT_EVERY + rand() * SHOT_JITTER;
          }
        } else if (r.mode === 'flee') {
          // Run off, then regain nerve at a safe distance and turn back to the fight.
          p.aim = 0;
          to.subVectors(q, player.pos).setY(0).normalize();
          speed = 7;
          p.vel.copy(to).multiplyScalar(speed);
          if (r.t > 4 && d > 26) {
            r.mode = 'patrol';
            r.target.copy(q);
          }
        }
        if (r.mode !== 'down' && r.mode !== 'aim') {
          q.addScaledVector(p.vel, dt);
          if (speed > 0.3) p.heading += Math.atan2(Math.sin(Math.atan2(p.vel.x, p.vel.z) - p.heading), Math.cos(Math.atan2(p.vel.x, p.vel.z) - p.heading)) * Math.min(1, dt * 8);
        }
        block(q, 0.6);
        q.y = groundY(q.x, q.z);
        posePerson(p, dt, t, speed);
        // A fleeing ranger keeps their rifle: 'idle' pose with legs running.
        if (r.mode === 'flee') p.legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 13 + i * Math.PI) * 0.9));
      }
      for (let i = darts.length - 1; i >= 0; i--) {
        const dart = darts[i];
        dart.life -= dt;
        dart.mesh.position.addScaledVector(dart.vel, dt);
        chest.copy(player.pos).setY(player.pos.y + player.radius * 1.1);
        const hit = !player.ignore && dart.mesh.position.distanceTo(chest) < player.radius * 1.05;
        const ground = dart.mesh.position.y < groundY(dart.mesh.position.x, dart.mesh.position.z);
        if (hit || ground || dart.life <= 0) {
          if (hit) hooks.onHit();
          scene.remove(dart.mesh);
          darts.splice(i, 1);
        }
      }
    },
    roar(at, range) {
      for (const r of rangers) {
        if (r.mode === 'down') continue;
        if (r.p.group.position.distanceTo(at) < range) {
          r.mode = 'flee';
          r.t = 0;
        }
      }
    },
    get count() {
      return rangers.length;
    },
    reinforce(n) {
      for (let k = 0; k < n; k++) rangers.push(recruit());
    },
    regroup(at) {
      for (const r of rangers) {
        if (r.p.group.position.distanceTo(at) > SIGHT + 10) continue;
        // Back to a post well away from the checkpoint.
        const home = spot();
        r.home.copy(home);
        r.target.copy(home);
        r.p.group.position.copy(home);
        r.p.state = 'idle';
        r.p.group.visible = true;
        r.p.alert.visible = false;
        r.mode = 'patrol';
        r.t = 0;
      }
      darts.forEach((d) => scene.remove(d.mesh));
      darts.length = 0;
    },
    dispose() {
      rangers.forEach((r) => scene.remove(r.p.group));
      darts.forEach((d) => scene.remove(d.mesh));
      owned.forEach((o) => o.dispose());
    },
  };
}
