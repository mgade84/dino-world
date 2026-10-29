import * as THREE from 'three';
import type { GameContext } from '../../types';
import { say, sfx } from '../../engine/audio';
import { L } from '../../i18n';
import { animate, buildDino, disposeDinoAssets, SEA_DINOS, type DinoSpec, type Rig } from './dinos';
import { createBoat, createFish, disposePark, FISH_COLORS, posePerson, scare, type Boat, type Fish } from './park';
import { buildOcean, floorY, SEA_HALF } from './seaworld';
import { rng } from './world';
import { S } from './strings';
import './dino.css';

/** Fish to eat and boats of tourists to scare away. */
const FISH = 10;
const BOATS = 5;
const SKY = '#a6dcf5';
const DEEP = '#136a93';
/** Third-person camera, a bit lower than on land so the surface stays in view. */
const CHASE = { back: 13, up: 7, look: 1, ahead: 7 };
/** Joystick reach in CSS pixels: the further up from where the finger landed, the faster. */
const STICK = 100;
/** Diving and floating back up, in units per second. */
const DIVE = 9;
const RISE = 6;

const turnToward = (from: number, to: number, max: number) => {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + THREE.MathUtils.clamp(d, -max, max);
};

/** Dino World's ocean: swim, dive to the bottom, eat fish and send tourist boats racing off. */
export function runSea(ctx: GameContext, opts: { onMap(): void }): () => void {
  const root = ctx.area;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'dn-canvas';
  root.appendChild(canvas);

  const scene = new THREE.Scene();
  const sky = new THREE.Color(SKY);
  const deep = new THREE.Color(DEEP);
  scene.background = sky.clone();
  const fog = new THREE.Fog(SKY, 45, 150);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 260);
  scene.add(new THREE.HemisphereLight('#e3f5ff', '#2b6a8a', 1.4));
  const sun = new THREE.DirectionalLight('#fff1d0', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const ocean = buildOcean();
  scene.add(ocean.group);
  const rand = rng(Date.now() & 0xffff);
  const extra: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (extra.push(x), x);

  // ---- HUD ----
  const hud = document.createElement('div');
  hud.className = 'dn-hud';
  hud.style.setProperty('--top', `${ctx.topInset}px`);
  hud.innerHTML = `
    <div class="dn-goals" hidden>
      <span aria-label="${S().fishLabel}">🐟 <b class="dn-fish">0</b> / ${FISH}</span>
      <span aria-label="${S().boatsLabel}">🚤 <b class="dn-boats">0</b> / ${BOATS}</span>
    </div>
    <button class="dn-map" aria-label="${S().map}">🗺️</button>
    <button class="dn-change" aria-label="${S().change}">🔄</button>
    <button class="dn-jump" aria-label="${S().dive}"><span>🤿</span></button>
    <button class="dn-roar" aria-label="${S().roar}"><span>🦖</span></button>
    <div class="dn-hint" aria-hidden="true">👆</div>
    <div class="dn-stick" hidden><i></i></div>
    <div class="dn-pick" hidden>
      <h2>${S().pick}</h2>
      <div class="dn-cards"></div>
    </div>`;
  root.appendChild(hud);
  const goals = hud.querySelector<HTMLElement>('.dn-goals')!;
  const fishCount = hud.querySelector('.dn-fish')!;
  const boatCount = hud.querySelector('.dn-boats')!;
  const hint = hud.querySelector<HTMLElement>('.dn-hint')!;
  const picker = hud.querySelector<HTMLElement>('.dn-pick')!;
  const stick = hud.querySelector<HTMLElement>('.dn-stick')!;
  const knob = stick.querySelector('i')!;
  const roarBtn = hud.querySelector<HTMLElement>('.dn-roar')!;
  const roarIcon = roarBtn.querySelector('span')!;
  const diveBtn = hud.querySelector<HTMLElement>('.dn-jump')!;

  // ---- Player ----
  let spec: DinoSpec = SEA_DINOS[0];
  let player: Rig | null = null;
  const vel = new THREE.Vector3();
  let heading = 0;
  let vy = 0;
  let diving = false;
  let wasDeep = false;
  const restY = () => -(player ? player.radius : 2) * 0.3;

  function setPlayer(s: DinoSpec) {
    const at = player ? player.root.position.clone() : new THREE.Vector3(0, -0.6, 0);
    if (player) scene.remove(player.root);
    spec = s;
    player = buildDino(s);
    player.root.position.copy(at);
    player.root.rotation.y = heading;
    scene.add(player.root);
  }

  // ---- Fish and boats ----
  let fish: Fish[] = [];
  let boats: Boat[] = [];
  let eaten = 0;
  let scared = 0;
  let finishing = false;

  function spawnRound() {
    fish.forEach((f) => scene.remove(f.group));
    boats.forEach((b) => scene.remove(b.group));
    fish = [];
    boats = [];
    const spots: THREE.Vector3[] = [];
    const take = (depth: number, spacing: number) => {
      for (let tries = 0; tries < 400; tries++) {
        const p = ocean.openWater(rand, depth, 0, 0, 22);
        if (spots.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < spacing - tries / 40)) continue;
        spots.push(p);
        return p;
      }
      return ocean.openWater(rand, depth, 0, 0, 22);
    };
    for (let i = 0; i < FISH; i++) {
      const [body, stripe] = FISH_COLORS[i % FISH_COLORS.length];
      const f = createFish(body, stripe);
      const p = take(8, 20);
      // Some near the surface, some down by the seabed: diving pays off.
      const bottom = floorY(p.x, p.z) + 2;
      f.home.set(p.x, THREE.MathUtils.lerp(-2.5, bottom, i % 2 ? 0.25 + rand() * 0.2 : 0.75 + rand() * 0.2), p.z);
      f.radius = 4 + rand() * 5;
      f.angle = rand() * Math.PI * 2;
      f.speed = (0.35 + rand() * 0.3) * (rand() < 0.5 ? 1 : -1);
      scene.add(f.group);
      fish.push(f);
    }
    for (let i = 0; i < BOATS; i++) {
      const b = createBoat(rand, i);
      b.home.copy(take(6, 30));
      // Shrink the cruising circle until it stays over open water all the way round.
      b.radius = 12 + rand() * 10;
      const clear = (r: number) => Array.from({ length: 16 }, (_, k) => (k / 16) * Math.PI * 2).every((a) => floorY(b.home.x + Math.cos(a) * r, b.home.z + Math.sin(a) * r) < -4);
      while (b.radius > 4 && !clear(b.radius)) b.radius -= 2;
      b.angle = rand() * Math.PI * 2;
      scene.add(b.group);
      boats.push(b);
    }
    eaten = scared = 0;
    fishCount.textContent = boatCount.textContent = '0';
  }

  function checkDone() {
    if (finishing || eaten < FISH || scared < BOATS) return;
    finishing = true;
    timers.push(
      window.setTimeout(async () => {
        await ctx.celebrate(S().done, `${FISH} 🐟 · ${BOATS} 🚤`, 5);
        finishing = false;
        if (!alive) return;
        started = false;
        goals.hidden = true;
        showPicker();
      }, 1500),
    );
  }

  function eat(f: Fish) {
    if (f.eaten) return;
    f.eaten = 0.0001;
    eaten++;
    fishCount.textContent = String(eaten);
    if (player && player.biting <= 0) player.biting = 1;
    sfx.chomp();
    sfx.good();
    ctx.addStars(1);
    checkDone();
  }

  function scareBoat(b: Boat) {
    if (b.state !== 'cruise' || !player) return;
    b.state = 'flee';
    b.t = 0;
    b.vel.subVectors(b.group.position, player.root.position).setY(0).normalize().multiplyScalar(18);
    b.people.forEach((pp) => scare(pp));
    sfx.scream();
    scared++;
    boatCount.textContent = String(scared);
    ctx.addStars(1);
    checkDone();
  }

  // Arrow floating beside the dinosaur, pointing at the nearest fish or calm boat.
  const arrowGeo = keep(new THREE.ConeGeometry(0.6, 1.8, 10));
  arrowGeo.rotateX(Math.PI / 2);
  const arrowMat = keep(new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, depthWrite: false }));
  const arrow = new THREE.Mesh(arrowGeo, arrowMat);
  scene.add(arrow);

  // Ripples where the dinosaur and the boats break the surface.
  const rippleGeo = keep(new THREE.RingGeometry(0.85, 1, 24));
  rippleGeo.rotateX(-Math.PI / 2);
  const ripples = Array.from({ length: 14 }, () => {
    const m = new THREE.Mesh(rippleGeo, keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false })));
    m.userData.life = 0;
    scene.add(m);
    return m;
  });
  function ripple(x: number, z: number, size: number) {
    const m = ripples.find((r) => r.userData.life <= 0) ?? ripples[0];
    m.position.set(x, 0.12, z);
    m.userData.life = 1;
    m.userData.size = size;
  }

  // ---- Picker, with pictures rendered from the real models ----
  function renderThumbs() {
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight('#ffffff', '#6fa8c8', 2.2));
    const l = new THREE.DirectionalLight('#ffffff', 1.6);
    l.position.set(4, 8, 6);
    s.add(l);
    const cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 100);
    renderer.setPixelRatio(1);
    renderer.setSize(360, 270, false);
    renderer.setClearColor('#000000', 0);
    const urls = SEA_DINOS.map((d) => {
      const r = buildDino(d);
      r.root.rotation.y = -0.7;
      animate(r, 0, 0, 0);
      s.add(r.root);
      const box = new THREE.Box3().setFromObject(r.root);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length() * 0.8;
      cam.position.set(c.x + size * 0.9, c.y + size * 0.45, c.z + size * 1.3);
      cam.lookAt(c);
      renderer.render(s, cam);
      const url = canvas.toDataURL('image/png');
      s.remove(r.root);
      return url;
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    return urls;
  }
  const thumbs = renderThumbs();
  picker.querySelector('.dn-cards')!.innerHTML = SEA_DINOS.map(
    (d, i) => `<button class="dn-card" data-i="${i}" style="--c:${d.colors.body}"><img src="${thumbs[i]}" alt=""><span>${L(d.name)}</span></button>`,
  ).join('');

  let started = false;
  let picking = false;
  const timers: number[] = [];
  function showPicker() {
    picking = true;
    picker.hidden = false;
    say(S().pick);
  }
  picker.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.dn-card');
    if (!b) return;
    const d = SEA_DINOS[Number(b.dataset.i)];
    sfx.tap();
    picker.hidden = true;
    picking = false;
    setPlayer(d);
    say(L(d.name));
    if (!started) {
      started = true;
      spawnRound();
      goals.hidden = false;
      timers.push(window.setTimeout(() => say(S().seaHint), 1600));
    }
  });

  // ---- Input: joystick wherever the finger lands (up = forward); hold 🤿 to dive ----
  let pointer: number | null = null;
  let ox = 0;
  let oy = 0;
  let sx = 0;
  let sy = 0;
  const keys = new Set<string>();
  const dir = new THREE.Vector3();
  canvas.addEventListener('pointerdown', (e) => {
    if (picking || pointer !== null) return;
    pointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    const r = hud.getBoundingClientRect();
    ox = e.clientX;
    oy = e.clientY;
    sx = sy = 0;
    stick.style.left = `${ox - r.left}px`;
    stick.style.top = `${oy - r.top}px`;
    knob.style.transform = '';
    stick.hidden = false;
    hint.hidden = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer) return;
    const dx = e.clientX - ox;
    const dy = e.clientY - oy;
    const k = Math.min(1, STICK / (Math.hypot(dx, dy) || 1));
    sx = (dx * k) / STICK;
    sy = (dy * k) / STICK;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  });
  const release = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    sx = sy = 0;
    stick.hidden = true;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  const KEYS: Record<string, [number, number]> = {
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      if (!e.repeat) diving = e.type === 'keydown' && !picking;
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyR') {
      if (e.type === 'keydown') act();
      e.preventDefault();
      return;
    }
    if (!KEYS[e.code]) return;
    e.preventDefault();
    if (e.type === 'keydown') keys.add(e.code);
    else keys.delete(e.code);
    hint.hidden = true;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  diveBtn.addEventListener('pointerdown', (e) => {
    if (picking) return;
    diveBtn.setPointerCapture(e.pointerId);
    diving = true;
    hint.hidden = true;
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) diveBtn.addEventListener(ev, () => (diving = false));

  // The roar button bites a fish that is close in front, otherwise roars (scaring nearby boats).
  const mouth = new THREE.Vector3();
  function mouthPos() {
    const r = player!;
    return mouth.set(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(r.radius + 1.2).add(r.root.position);
  }
  function fishNear(range: number) {
    if (!player) return null;
    const m = mouthPos();
    let best: Fish | null = null;
    let bestD = range;
    for (const f of fish) {
      if (f.eaten) continue;
      const d = f.group.position.distanceTo(m);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }
  let shake = 0;
  function act() {
    if (!player || picking || player.roaring > 0 || player.biting > 0) return;
    const f = fishNear(5);
    if (f) {
      player.biting = 1;
      timers.push(window.setTimeout(() => alive && eat(f), 200));
      return;
    }
    player.roaring = 1;
    sfx.roar(spec.roar);
    shake = 0.5;
    const p = player.root.position;
    for (const b of boats) if (Math.hypot(b.group.position.x - p.x, b.group.position.z - p.z) < 30) scareBoat(b);
  }
  roarBtn.addEventListener('click', act);
  hud.querySelector('.dn-change')!.addEventListener('click', () => {
    sfx.tap();
    showPicker();
  });
  hud.querySelector('.dn-map')!.addEventListener('click', () => {
    sfx.tap();
    opts.onMap();
  });

  // ---- Simulation ----
  const camAt = new THREE.Vector3(0, 0, 6);
  const camPos = new THREE.Vector3(0, CHASE.up, -CHASE.back);
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let camYaw = 0;
  let t = 0;
  let rippleIn = 0;
  let biteShown = false;

  function update(dt: number) {
    t += dt;
    ocean.update(t);
    if (player) {
      const p = player.root.position;
      let side = sx;
      let ahead = -sy;
      for (const k of keys) {
        side += KEYS[k][0];
        ahead -= KEYS[k][1];
      }
      if (picking) side = ahead = 0;
      const amount = Math.min(1, Math.hypot(side, ahead));
      fwd.set(Math.sin(camYaw), 0, Math.cos(camYaw));
      right.set(-Math.cos(camYaw), 0, Math.sin(camYaw));
      dir.set(0, 0, 0);
      if (amount > 0.15) dir.addScaledVector(fwd, ahead).addScaledVector(right, side).normalize();
      const pace = amount <= 0.15 ? 0 : ahead > 0.15 ? Math.min(1, ahead) : amount * 0.45;
      const steer = pace > 0 ? Math.atan2(dir.x, dir.z) : null;
      vel.lerp(dir.multiplyScalar(spec.speed * pace), 1 - Math.exp(-dt * 3));

      // Swim, but never into water too shallow for the whole body: no crawling up onto
      // islands or through reefs. The check looks a body length ahead, so the head stays off the beach too.
      const ox0 = p.x;
      const oz0 = p.z;
      const floorWas = floorY(p.x, p.z);
      p.x = THREE.MathUtils.clamp(p.x + vel.x * dt, -SEA_HALF, SEA_HALF);
      p.z = THREE.MathUtils.clamp(p.z + vel.z * dt, -SEA_HALF, SEA_HALF);
      const moving = Math.hypot(vel.x, vel.z);
      const lookX = moving > 0.1 ? (vel.x / moving) * player.radius : 0;
      const lookZ = moving > 0.1 ? (vel.z / moving) * player.radius : 0;
      const floorAhead = Math.max(floorY(p.x, p.z), floorY(p.x + lookX, p.z + lookZ));
      // Too shallow to swim in at the surface (island beaches), or a steep reef wall in front.
      // Gentle seabed dunes are fine: the dinosaur glides up over them.
      const shallow = floorAhead > restY() - player.radius * 0.8;
      const wall = floorAhead > Math.min(p.y, restY()) - player.radius * 0.8 && floorAhead - floorWas > player.radius * 0.5;
      if (shallow || wall) {
        p.x = ox0;
        p.z = oz0;
        vel.multiplyScalar(0.3);
      }

      // Dive while the button is held; float back up to the surface when it is let go.
      const rest = restY();
      // The seabed only ever stops a dive; it never lifts the dinosaur out of the water.
      const bottom = Math.min(floorY(p.x, p.z) + player.radius * 0.6, rest);
      const goalVy = diving ? -DIVE : p.y < rest - 0.05 ? RISE : (rest - p.y) * 4;
      vy += (goalVy - vy) * (1 - Math.exp(-dt * 4));
      p.y = THREE.MathUtils.clamp(p.y + vy * dt, bottom, rest);
      if (p.y <= bottom + 0.01 && vy < 0) vy = 0;
      const deep = p.y < rest - 2;
      if (wasDeep && !deep) {
        sfx.splat();
        for (let k = 0; k < 3; k++) ripple(p.x, p.z, player.radius * (1 + k * 0.5));
      } else if (!wasDeep && deep) sfx.splat();
      wasDeep = deep;

      const speed = Math.hypot(vel.x, vel.z);
      if (player.biting > 0) {
        const f = fishNear(8);
        if (f) heading = turnToward(heading, Math.atan2(f.group.position.x - p.x, f.group.position.z - p.z), dt * 12);
      } else if (steer !== null) heading = turnToward(heading, steer, dt * 4);
      player.root.rotation.y = heading;
      player.root.rotation.x = THREE.MathUtils.clamp(-vy * 0.05, -0.5, 0.5);
      animate(player, dt, Math.max(0.25, THREE.MathUtils.clamp(speed / spec.speed, 0, 1)), t);
      rippleIn -= dt;
      if (!deep && speed > 2 && rippleIn <= 0) {
        ripple(p.x - Math.sin(heading) * player.radius, p.z - Math.cos(heading) * player.radius, player.radius * 0.8);
        rippleIn = 0.35;
      }

      // Fish circle about their spot, drifting away from the dinosaur when it comes near.
      const m = mouthPos();
      const best = { d: Infinity, at: null as THREE.Vector3 | null };
      const consider = (q: THREE.Vector3) => {
        const d = q.distanceTo(p);
        if (d < best.d) {
          best.d = d;
          best.at = q;
        }
      };
      for (const f of fish) {
        if (f.eaten) {
          f.eaten += dt * 4;
          f.group.scale.setScalar(Math.max(0.001, 1 - f.eaten));
          f.group.position.lerp(m, Math.min(1, dt * 10));
          if (f.eaten >= 1) f.group.visible = false;
          continue;
        }
        tmp.subVectors(f.home, p);
        const near = tmp.length();
        if (near < 10) {
          f.home.addScaledVector(tmp.divideScalar(near || 1), dt * 3);
          f.home.x = THREE.MathUtils.clamp(f.home.x, -SEA_HALF + 5, SEA_HALF - 5);
          f.home.z = THREE.MathUtils.clamp(f.home.z, -SEA_HALF + 5, SEA_HALF - 5);
          f.home.y = THREE.MathUtils.clamp(f.home.y, floorY(f.home.x, f.home.z) + 1.5, -1.5);
        }
        f.angle += dt * f.speed * (near < 10 ? 2 : 1);
        const prev = tmp.copy(f.group.position);
        f.group.position.set(
          f.home.x + Math.cos(f.angle) * f.radius,
          f.home.y + Math.sin(t * 0.9 + f.radius) * 1.2,
          f.home.z + Math.sin(f.angle) * f.radius,
        );
        // Swim over reefs, not through them.
        f.group.position.y = THREE.MathUtils.clamp(f.group.position.y, floorY(f.group.position.x, f.group.position.z) + 1.5, -1.2);
        f.group.rotation.y = Math.atan2(f.group.position.x - prev.x, f.group.position.z - prev.z);
        f.tail.rotation.y = Math.sin(t * 9 + f.radius) * 0.5;
        if (f.group.position.distanceTo(m) < 2.4) eat(f);
        consider(f.group.position);
      }

      // Boats cruise in circles until the dinosaur comes close, then race away.
      boats.forEach((b, i) => {
        const g = b.group;
        if (b.state === 'cruise') {
          b.angle += dt * 4 / b.radius;
          const prev = tmp.copy(g.position);
          g.position.set(b.home.x + Math.cos(b.angle) * b.radius, 0, b.home.z + Math.sin(b.angle) * b.radius);
          b.heading = Math.atan2(g.position.x - prev.x, g.position.z - prev.z);
          const d = Math.hypot(g.position.x - p.x, g.position.z - p.z);
          if (d < player!.radius + 8 && p.y > -6 && speed > 2) scareBoat(b);
          consider(g.position);
        } else if (b.state === 'flee') {
          b.t += dt;
          g.position.addScaledVector(b.vel, dt);
          b.heading = turnToward(b.heading, Math.atan2(b.vel.x, b.vel.z), dt * 6);
          if (b.t > 4.5) g.scale.setScalar(Math.max(0.001, 1 - (b.t - 4.5) * 2));
          if (b.t > 5) {
            b.state = 'gone';
            g.visible = false;
          }
          if (Math.floor(b.t * 4) !== Math.floor((b.t - dt) * 4)) ripple(g.position.x, g.position.z, 1.5);
        }
        g.position.y = Math.sin(t * 1.6 + i) * 0.15;
        g.rotation.set(Math.sin(t * 1.3 + i) * 0.04, b.heading, Math.sin(t * 1.1 + i * 2) * 0.05);
        for (const pp of b.people) if (pp.state !== 'gone') posePerson(pp, dt, t, b.state === 'flee' ? 4 : 0);
      });

      // Roar button turns into 🦷 when a fish is close in front.
      const canBite = !!fishNear(5);
      if (canBite !== biteShown) {
        biteShown = canBite;
        roarBtn.classList.toggle('bite', canBite);
        roarIcon.textContent = canBite ? '🦷' : '🦖';
        roarBtn.setAttribute('aria-label', canBite ? S().bite : S().roar);
      }
      arrow.visible = !!best.at && best.d > 14 && !picking;
      if (best.at && arrow.visible) {
        tmp.subVectors(best.at, p).normalize();
        arrow.position.copy(p).addScaledVector(tmp, player.radius + 3).setY(Math.max(arrow.position.y, floorY(arrow.position.x, arrow.position.z) + 1));
        arrow.lookAt(best.at);
        arrowMat.opacity = 0.65 + Math.sin(t * 5) * 0.3;
      }

      // Chase camera; it follows the dinosaur down under the water.
      if (speed > 1 && ahead > -0.2) {
        const d = Math.atan2(Math.sin(heading - camYaw), Math.cos(heading - camYaw));
        camYaw += d * (1 - Math.exp(-dt * 2.2));
      }
      fwd.set(Math.sin(camYaw), 0, Math.cos(camYaw));
      const c = spec.cam;
      camAt.copy(p).addScaledVector(fwd, CHASE.ahead * c).setY(p.y + CHASE.look * c);
      tmp.copy(p).addScaledVector(fwd, -CHASE.back * c);
      tmp.y = Math.max(p.y + CHASE.up * c, floorY(tmp.x, tmp.z) + 2);
      camPos.lerp(tmp, 1 - Math.exp(-dt * 5));
    }
    shake = Math.max(0, shake - dt);
    camera.position.copy(camPos);
    if (shake > 0) camera.position.add(tmp.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
    camera.lookAt(camAt);

    // Under the surface everything turns deep blue and close.
    const under = camera.position.y < ocean.surface.position.y;
    const bg = scene.background as THREE.Color;
    bg.lerp(under ? deep : sky, 0.25);
    fog.color.copy(bg);
    fog.near += ((under ? 2 : 45) - fog.near) * 0.25;
    fog.far += ((under ? 60 : 150) - fog.far) * 0.25;
    const ground = player ? player.root.position : camAt;
    sun.position.copy(ground).add(tmp.set(28, 60, 18));
    sun.target.position.copy(ground);

    for (const r of ripples) {
      if (r.userData.life <= 0) continue;
      r.userData.life -= dt * 1.4;
      r.scale.setScalar(r.userData.size * (1.6 - r.userData.life));
      (r.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.userData.life) * 0.7;
    }
  }

  // ---- Loop ----
  let raf = 0;
  let last = performance.now();
  let alive = true;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    renderer.render(scene, camera);
  }
  function resize() {
    const w = root.clientWidth || 1;
    const h = root.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  const onVis = () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', onVis);

  renderer.setClearColor(SKY, 1);
  resize();
  setPlayer(SEA_DINOS[0]);
  showPicker();
  raf = requestAnimationFrame(frame);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    ro.disconnect();
    ocean.dispose();
    extra.forEach((x) => x.dispose());
    disposeDinoAssets();
    disposePark();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    hud.remove();
  };
}
