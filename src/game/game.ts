import * as THREE from 'three';
import type { GameContext } from '../../types';
import { say, sfx } from '../../engine/audio';
import { L } from '../../i18n';
import { animate, buildDino, disposeDinoAssets, DINOS, type DinoSpec, type Rig } from './dinos';
import { buildWorld, CAGE_SPOTS, groundY, HALF, rng } from './world';
import { CAGE, CAR_COLORS, createCage, createCar, createPerson, disposePark, posePerson, scare, updateCar, wreckCar, type Cage, type Car, type Person } from './park';
import { S } from './strings';
import './dino.css';

/** Cars to smash and people to scare once out of the cage. */
const TARGETS = 10;
/** Bonus stars for breaking another dinosaur out of its cage. */
const FREE_BONUS = 3;
const NPCS = 6;
const SKY = '#a6dcf5';
/** Third-person camera: behind and above the dinosaur, looking a little ahead of it. */
const CHASE = { back: 12, up: 12, look: 2, ahead: 9 };
/** Joystick reach in CSS pixels: the further up from where the finger landed, the faster. */
const STICK = 100;
const GRAVITY = 34;
/** Jump speed: peaks a little over 4 units, enough to get onto the plateaus. */
const JUMP = 17;
/** Steepest ground a dinosaur can walk up (rise over run); cliffs need a jump. */
const CLIMB = 0.9;

interface Npc { rig: Rig; target: THREE.Vector3; wait: number; speed: number; flee: number; heading: number; vel: THREE.Vector3; stuck: number; }
/** A dinosaur locked in one of the other cages, waiting to be broken out. */
interface Captive { cage: Cage; spec: DinoSpec; rig: Rig; state: 'caged' | 'leaving' | 'free'; target: THREE.Vector3; heading: number; vel: THREE.Vector3; wait: number; roarIn: number; }

const turnToward = (from: number, to: number, max: number) => {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + THREE.MathUtils.clamp(d, -max, max);
};

export function runDino(ctx: GameContext, opts: { onMap(): void }): () => void {
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
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 45, 140);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 220);
  scene.add(new THREE.HemisphereLight('#e3f5ff', '#4b7d36', 1.3));
  const sun = new THREE.DirectionalLight('#fff1d0', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 150 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const world = buildWorld();
  scene.add(world.group);
  const placeRand = rng(Date.now() & 0xffff);
  const extra: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (extra.push(x), x);

  // ---- HUD ----
  const hud = document.createElement('div');
  hud.className = 'dn-hud';
  hud.style.setProperty('--top', `${ctx.topInset}px`);
  hud.innerHTML = `
    <div class="dn-goals" hidden>
      <span aria-label="${S().cars}">🚙 <b class="dn-cars">0</b> / ${TARGETS}</span>
      <span aria-label="${S().people}">🏃 <b class="dn-people">0</b> / ${TARGETS}</span>
      <span aria-label="${S().freedLabel}">🦕 <b class="dn-freed">0</b> / ${CAGE_SPOTS.length}</span>
    </div>
    <button class="dn-map" aria-label="${S().map}">🗺️</button>
    <button class="dn-change" aria-label="${S().change}">🔄</button>
    <button class="dn-jump" aria-label="${S().jump}"><span>⬆️</span></button>
    <button class="dn-roar" aria-label="${S().roar}"><span>🦖</span></button>
    <div class="dn-hint" aria-hidden="true">👆</div>
    <div class="dn-stick" hidden><i></i></div>
    <div class="dn-pick" hidden>
      <h2>${S().pick}</h2>
      <div class="dn-cards"></div>
    </div>`;
  root.appendChild(hud);
  const goals = hud.querySelector<HTMLElement>('.dn-goals')!;
  const carCount = hud.querySelector('.dn-cars')!;
  const peopleCount = hud.querySelector('.dn-people')!;
  const freedCount = hud.querySelector('.dn-freed')!;
  const hint = hud.querySelector<HTMLElement>('.dn-hint')!;
  const picker = hud.querySelector<HTMLElement>('.dn-pick')!;
  const stick = hud.querySelector<HTMLElement>('.dn-stick')!;
  const knob = stick.querySelector('i')!;

  // ---- Player ----
  let spec: DinoSpec = DINOS[0];
  let player: Rig | null = null;
  const vel = new THREE.Vector3();
  let heading = 0;
  let wasWet = false;
  let vy = 0;
  let grounded = true;
  /** Flyers: the jump button is being held. */
  let flying = false;
  let flapIn = 0;

  /** Swaps in a dinosaur. Until it has broken out, it always starts in the middle of its cage. */
  function setPlayer(s: DinoSpec) {
    const inCage = !free;
    const at = player && !inCage ? player.root.position.clone() : new THREE.Vector3(CAGE.x, groundY(CAGE.x, CAGE.z), CAGE.z);
    if (player) scene.remove(player.root);
    spec = s;
    player = buildDino(s);
    if (inCage) {
      vel.set(0, 0, 0);
      vy = 0;
      grounded = true;
      heading = 0;
      camYaw = 0;
      camPos.set(CAGE.x, at.y + CHASE.up * s.cam, CAGE.z - CHASE.back * s.cam);
    }
    player.root.position.copy(at);
    player.root.rotation.y = heading;
    scene.add(player.root);
    flying = false;
    jumpIcon.textContent = s.fly ? '🦅' : '⬆️';
    jumpBtn.setAttribute('aria-label', s.fly ? S().fly : S().jump);
  }

  /** An open spot at least `far` from the cage. */
  function spotAway(clear: number, far: number) {
    for (let i = 0; i < 200; i++) {
      const p = world.openSpot(placeRand, clear);
      if (Math.hypot(p.x - CAGE.x, p.z - CAGE.z) > far) return p;
    }
    return world.openSpot(placeRand, clear);
  }
  /** Keeps others out of the cages. */
  const still = new THREE.Vector3();
  function keepOut(p: THREE.Vector3, r: number) {
    for (const c of captives) c.cage.block(p, still, r, Infinity);
    const dx = p.x - CAGE.x;
    const dz = p.z - CAGE.z;
    const lim = CAGE.half + r + 0.3;
    if (Math.abs(dx) >= lim || Math.abs(dz) >= lim) return;
    if (lim - Math.abs(dx) < lim - Math.abs(dz)) p.x = CAGE.x + Math.sign(dx || 1) * lim;
    else p.z = CAGE.z + Math.sign(dz || 1) * lim;
  }

  // ---- The cage the dinosaur starts in ----
  let cage = createCage();
  scene.add(cage.group);
  let free = false;

  // ---- Other dinosaurs in cages of their own ----
  let captives: Captive[] = [];
  function spawnCaptives() {
    captives = CAGE_SPOTS.map((spot, i) => {
      const cage = createCage(spot.x, spot.z);
      scene.add(cage.group);
      const spec = DINOS[(i + 1) % DINOS.length];
      const rig = buildDino(spec);
      rig.root.scale.setScalar(0.85);
      rig.radius *= 0.85;
      rig.root.position.copy(cage.center);
      scene.add(rig.root);
      return { cage, spec, rig, state: 'caged', target: cage.center.clone(), heading: placeRand() * 6, vel: new THREE.Vector3(), wait: placeRand() * 3, roarIn: 3 + placeRand() * 8 };
    });
  }
  spawnCaptives();
  let freed = 0;

  /** After a finished game: every cage rebuilt and filled again, counters back to 0, and pick a dinosaur. */
  function newGame() {
    scene.remove(cage.group);
    cage = createCage();
    scene.add(cage.group);
    for (const c of captives) {
      scene.remove(c.cage.group, c.rig.root);
      const k = npcs.findIndex((n) => n.rig === c.rig);
      if (k >= 0) npcs.splice(k, 1);
    }
    spawnCaptives();
    freed = 0;
    freedCount.textContent = '0';
    free = false;
    goals.hidden = true;
    arrow.visible = false;
    started = false; // picking spawns fresh jeeps and visitors and gives the cage hint again
    showPicker();
  }

  function freeCaptive(c: Captive) {
    c.state = 'leaving';
    c.rig.roaring = 1;
    sfx.roar(c.spec.roar);
    freed++;
    freedCount.textContent = String(freed);
    ctx.addStars(FREE_BONUS);
    timers.push(window.setTimeout(() => say(S().freed(L(c.spec.name))), 600));
  }

  // ---- Baby dinosaurs wandering about ----
  const npcs: Npc[] = Array.from({ length: NPCS }, (_, i) => {
    const r = buildDino(DINOS[i % DINOS.length]);
    const s = 0.5 + placeRand() * 0.3;
    r.root.scale.setScalar(s);
    r.radius *= s;
    r.root.position.copy(spotAway(4, 20));
    scene.add(r.root);
    return { rig: r, target: r.root.position.clone(), wait: placeRand() * 3, speed: 3 + placeRand() * 2, flee: 0, heading: placeRand() * 6, vel: new THREE.Vector3(), stuck: 0 };
  });

  // ---- Jeeps to smash and visitors to scare, one visitor beside each jeep ----
  let cars: Car[] = [];
  let people: Person[] = [];
  let smashed = 0;
  let scared = 0;
  let finishing = false;

  function spawnTargets() {
    cars.forEach((c) => {
      scene.remove(c.group);
      c.smoke.forEach((m) => scene.remove(m));
    });
    people.forEach((pp) => scene.remove(pp.group));
    cars = [];
    people = [];
    const sites: THREE.Vector3[] = [];
    for (let tries = 0; sites.length < TARGETS && tries < 3000; tries++) {
      const p = world.openSpot(placeRand, 5);
      if (Math.hypot(p.x - CAGE.x, p.z - CAGE.z) < 30) continue;
      if (sites.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 24 - tries / 150)) continue;
      sites.push(p);
    }
    sites.forEach((p, i) => {
      const car = createCar(CAR_COLORS[i % CAR_COLORS.length], i % 2 ? '#ffffff' : '#2f2f2f');
      car.heading = placeRand() * Math.PI * 2;
      car.group.position.copy(p);
      car.group.rotation.y = car.heading;
      scene.add(car.group);
      cars.push(car);
      const person = createPerson(placeRand);
      const a = placeRand() * Math.PI * 2;
      const at = person.group.position.set(p.x + Math.cos(a) * 4, 0, p.z + Math.sin(a) * 4);
      world.collide(at, 0.6);
      at.y = groundY(at.x, at.z);
      person.heading = Math.atan2(p.x - at.x, p.z - at.z) + Math.PI;
      scene.add(person.group);
      people.push(person);
    });
    smashed = scared = 0;
    carCount.textContent = peopleCount.textContent = '0';
  }

  function checkDone() {
    if (finishing || smashed < TARGETS || scared < TARGETS) return;
    finishing = true;
    timers.push(
      window.setTimeout(async () => {
        await ctx.celebrate(S().done, S().doneSub(TARGETS), 5);
        finishing = false;
        if (alive) newGame();
      }, 1500),
    );
  }

  function frighten(pp: Person) {
    if (!scare(pp)) return;
    scared++;
    peopleCount.textContent = String(scared);
    sfx.scream();
    ctx.addStars(1);
    checkDone();
  }

  // Arrow on the ground pointing to the nearest jeep or calm visitor.
  const arrowShape = new THREE.Shape([new THREE.Vector2(0, 1.4), new THREE.Vector2(0.9, -0.4), new THREE.Vector2(0, 0), new THREE.Vector2(-0.9, -0.4)]);
  const arrowGeo = keep(new THREE.ShapeGeometry(arrowShape));
  arrowGeo.rotateX(-Math.PI / 2);
  arrowGeo.rotateY(Math.PI);
  const arrowMat = keep(new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, depthWrite: false }));
  const arrow = new THREE.Mesh(arrowGeo, arrowMat);
  arrow.scale.setScalar(1.4);
  scene.add(arrow);

  // Ripples when wading through the lake.
  const rippleGeo = keep(new THREE.RingGeometry(0.85, 1, 24));
  rippleGeo.rotateX(-Math.PI / 2);
  const ripples = Array.from({ length: 8 }, () => {
    const m = new THREE.Mesh(rippleGeo, keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false })));
    m.userData.life = 0;
    scene.add(m);
    return m;
  });
  let rippleIn = 0;
  function ripple(p: THREE.Vector3, size: number) {
    const m = ripples.find((r) => r.userData.life <= 0) ?? ripples[0];
    m.position.set(p.x, 0.08, p.z);
    m.userData.life = 1;
    m.userData.size = size;
  }

  // ---- Picker, with pictures rendered from the real models ----
  function renderThumbs() {
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight('#ffffff', '#88aa66', 2.2));
    const l = new THREE.DirectionalLight('#ffffff', 1.6);
    l.position.set(4, 8, 6);
    s.add(l);
    const cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 100);
    renderer.setPixelRatio(1);
    renderer.setSize(360, 270, false);
    renderer.setClearColor('#000000', 0);
    const urls = DINOS.map((d) => {
      const r = buildDino(d);
      r.root.rotation.y = -0.7;
      if (r.wings.length) {
        r.wingMode = 0.5;
        r.spread = 1;
      }
      animate(r, 0, 0, 0);
      s.add(r.root);
      const box = new THREE.Box3().setFromObject(r.root);
      const c = box.getCenter(new THREE.Vector3());
      // Spread wings make the box much wider than the animal; frame flyers closer.
      const size = box.getSize(new THREE.Vector3()).length() * (r.wings.length ? 0.62 : 1);
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
  picker.querySelector('.dn-cards')!.innerHTML = DINOS.map(
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
    const d = DINOS[Number(b.dataset.i)];
    sfx.tap();
    picker.hidden = true;
    picking = false;
    setPlayer(d);
    say(L(d.name));
    if (d.fly) timers.push(window.setTimeout(() => say(S().flyHint), 1300));
    if (!started) {
      started = true;
      spawnTargets();
      timers.push(window.setTimeout(() => say(S().escapeHint), 1600));
    }
  });

  // ---- Input: a joystick wherever the finger lands (up = forward); arrow keys / WASD too ----
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
      if (e.type === 'keydown' && !e.repeat) jumpDown();
      else if (e.type === 'keyup') jumpUp();
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

  /** Moves along the ground, sliding round trees and stopping at cliffs that are too steep. */
  const from = new THREE.Vector3();
  function moveOnGround(p: THREE.Vector3, v: THREE.Vector3, dt: number, radius: number, airborne: boolean) {
    from.copy(p);
    p.addScaledVector(v, dt);
    world.collide(p, radius);
    const run = Math.hypot(p.x - from.x, p.z - from.z);
    const rise = groundY(p.x, p.z) - from.y;
    const tooSteep = airborne ? rise > 0.25 : run > 1e-4 && rise / run > CLIMB && rise > 0.05;
    if (tooSteep) {
      p.x = from.x;
      p.z = from.z;
      v.multiplyScalar(0.3);
    }
  }

  /** The jump button: flyers fly while it is held, everyone else jumps. */
  function jumpDown() {
    if (!player || picking) return;
    if (!spec.fly) return jump();
    flying = true;
    if (grounded) {
      vy = 6;
      grounded = false;
      sfx.whoosh();
    }
    hint.hidden = true;
  }
  function jumpUp() {
    flying = false;
  }

  function jump() {
    if (!player || picking || !grounded) return;
    vy = JUMP;
    grounded = false;
    player.root.position.y += 0.01;
    sfx.boing();
    hint.hidden = true;
  }

  let shake = 0;
  const roarBtn = hud.querySelector<HTMLElement>('.dn-roar')!;
  const jumpBtn = hud.querySelector<HTMLElement>('.dn-jump')!;
  const jumpIcon = jumpBtn.querySelector('span')!;
  const roarIcon = roarBtn.querySelector('span')!;
  let biteShown = false;

  /** The nearest bars within biting reach, whichever way the dinosaur faces: its own cage from inside, others' from outside. */
  const facing = new THREE.Vector3();
  let biteHeading = 0;
  function biteTarget(): { cage: Cage; side: number; captive: Captive | null } | null {
    if (!player) return null;
    const p = player.root.position;
    facing.set(Math.sin(heading), 0, Math.cos(heading));
    const reach = player.radius + 2.8;
    if (!free) {
      const side = cage.nearSide(p, facing, reach, true, -2);
      return side >= 0 ? { cage, side, captive: null } : null;
    }
    for (const c of captives) {
      if (c.state !== 'caged') continue;
      const side = c.cage.nearSide(p, facing, reach, false, -2);
      if (side >= 0) return { cage: c.cage, side, captive: c };
    }
    return null;
  }

  /** The roar button: bites the bars when close to them, otherwise roars. */
  function act() {
    if (!player || picking || player.roaring > 0 || player.biting > 0) return;
    const target = biteTarget();
    if (!target || !grounded) return roar();
    player.biting = 1;
    // Turn to face the bars while lunging, so a bite always lands.
    const n = target.cage.normal(target.side);
    const toward = target.captive ? -1 : 1;
    biteHeading = Math.atan2(n.x * toward, n.z * toward);
    sfx.chomp();
    // The bars give at the moment the jaws close.
    timers.push(
      window.setTimeout(() => {
        if (!alive) return;
        sfx.clang();
        shake = 0.35;
        if (!target.cage.bump(target.side, target.captive ? -1 : 1)) return;
        sfx.crash();
        shake = 0.7;
        if (target.captive) freeCaptive(target.captive);
      }, 220),
    );
  }

  function roar() {
    if (!player || picking || player.roaring > 0) return;
    player.roaring = 1;
    sfx.roar(spec.roar);
    shake = 0.5;
    const p = player.root.position;
    if (!free) cage.rattle();
    else for (const pp of people) if (Math.hypot(pp.group.position.x - p.x, pp.group.position.z - p.z) < 24) frighten(pp);
    for (const n of npcs) {
      const away = n.rig.root.position.clone().sub(p).setY(0);
      if (away.length() > 32) continue;
      n.target.copy(n.rig.root.position).addScaledVector(away.normalize(), 26);
      n.flee = 2.5;
      n.wait = 0;
    }
  }
  roarBtn.addEventListener('click', act);
  jumpBtn.addEventListener('pointerdown', (e) => {
    jumpBtn.setPointerCapture(e.pointerId);
    jumpDown();
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) jumpBtn.addEventListener(ev, jumpUp);
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
  const camPos = new THREE.Vector3(0, 8, -6);
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  let camYaw = 0;
  let t = 0;
  /** Touching bars last frame, and the direction into them. */
  let pressing = false;
  const pressDir = new THREE.Vector3();

  function update(dt: number) {
    t += dt;
    world.update(t, dt);
    if (player) {
      const p = player.root.position;
      // Stick and keys, relative to where the camera looks: up is forward, sideways steers.
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
      // Speed comes from how far up the stick is pushed; sideways or back only walks.
      const pace = amount <= 0.15 ? 0 : ahead > 0.15 ? Math.min(1, ahead) : amount * 0.45;
      const wet = world.inWater(p.x, p.z);
      if (wet && !wasWet) sfx.splat();
      wasWet = wet;
      // Pushing roughly towards bars it is already touching: push straight in and face them squarely,
      // instead of sliding along them (and away from them) on a slightly sideways push.
      if (pressing && pace > 0 && dir.dot(pressDir) > 0.35) dir.copy(pressDir);
      // Face where the player steers, not where a bump off the bars sends it.
      const steer = pace > 0 ? Math.atan2(dir.x, dir.z) : null;
      // Flyers in the air go at flying speed, high above trees and cages.
      const aloft = !!spec.fly && (flying || !grounded);
      const high = aloft && p.y - groundY(p.x, p.z) > 7;
      const want = dir.multiplyScalar((aloft ? spec.fly! : spec.speed) * pace * (wet && !aloft ? 0.55 : 1));
      vel.lerp(want, 1 - Math.exp(-dt * (aloft ? 2.5 : grounded ? 6 : 1.5)));
      if (high) {
        p.addScaledVector(vel, dt);
        p.x = THREE.MathUtils.clamp(p.x, -HALF, HALF);
        p.z = THREE.MathUtils.clamp(p.z, -HALF, HALF);
      } else moveOnGround(p, vel, dt, player.radius, !grounded);
      // Cage bars only block; biting them (the roar button, when close) bends them.
      // Pressing against bars: no bounce, and friction so it doesn't slide off along them.
      let atBars = false;
      if (!free) {
        const side = cage.contain(p, vel, player.radius, 0, 1);
        if (side >= 0) {
          atBars = true;
          pressDir.copy(cage.normal(side));
        }
        if (cage.open && !cage.inside(p)) {
          free = true;
          goals.hidden = false;
          sfx.win();
          say(S().escaped);
        }
      }
      for (const c of captives) {
        if (c.state !== 'caged' || p.y > c.cage.center.y + CAGE.height) continue;
        const side = c.cage.block(p, vel, player.radius, 0, 1);
        if (side < 0) continue;
        atBars = true;
        pressDir.copy(c.cage.normal(side)).negate();
      }
      if (atBars) vel.multiplyScalar(Math.exp(-dt * 10));
      pressing = atBars;
      // Close to bars and facing them: the roar button becomes a bite button.
      const target = biteTarget();
      if (!!target !== biteShown) {
        biteShown = !!target;
        roarBtn.classList.toggle('bite', biteShown);
        roarIcon.textContent = biteShown ? '🦷' : '🦖';
        roarBtn.setAttribute('aria-label', biteShown ? S().bite : S().roar);
      }
      // Gravity, jumping, and walking down hills without bouncing.
      const g = groundY(p.x, p.z);
      if (spec.fly && flying) {
        // Climb to cruising height (lower inside the cage, so it still has to bite its way out).
        const alt = g + (free ? 13 : 4.5);
        vy = THREE.MathUtils.clamp((alt - p.y) * 3, -12, 14);
        p.y = Math.max(g, p.y + vy * dt);
        flapIn -= dt;
        if (flapIn <= 0) {
          sfx.flap();
          flapIn = 0.55;
        }
      } else if (grounded && p.y - g < 0.8) p.y = g;
      else {
        // Flyers glide gently down when the button is let go.
        vy -= (spec.fly ? GRAVITY * 0.35 : GRAVITY) * dt;
        if (spec.fly) vy = Math.max(vy, -9);
        p.y += vy * dt;
        if (p.y <= g) {
          if (vy < -14) sfx.thud();
          p.y = g;
          vy = 0;
        }
      }
      grounded = !(spec.fly && flying) && p.y <= g + 0.001;
      player.wingMode = spec.fly && flying ? 1 : grounded ? 0 : 0.5;
      const speed = Math.hypot(vel.x, vel.z);
      if (player.biting > 0) heading = turnToward(heading, biteHeading, dt * 16);
      else if (steer !== null) heading = turnToward(heading, steer, dt * 9);
      else if (speed > 0.6) heading = turnToward(heading, Math.atan2(vel.x, vel.z), dt * 9);
      player.root.rotation.y = heading;
      const move = THREE.MathUtils.clamp(speed / spec.speed, 0, 1);
      if (animate(player, dt, grounded ? move : 0, t) && grounded && (spec.id === 'trex' || spec.id === 'brachio')) sfx.step(spec.id === 'brachio' ? 1.2 : 0.8);
      player.root.rotation.x = grounded ? 0 : spec.fly ? THREE.MathUtils.clamp(Math.hypot(vel.x, vel.z) / spec.fly! * 0.25 - vy * 0.01, -0.3, 0.35) : THREE.MathUtils.clamp(-vy * 0.012, -0.2, 0.2);
      rippleIn -= dt;
      if (wet && speed > 1 && rippleIn <= 0) {
        ripple(p, player.radius);
        rippleIn = 0.3;
      }

      // Jeeps: a run or a jump into one wrecks it. Visitors run when the dinosaur comes close.
      const best = { d: Infinity, at: null as THREE.Vector3 | null };
      const consider = (q: THREE.Vector3) => {
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < best.d) {
          best.d = d;
          best.at = q;
        }
      };
      for (const car of cars) {
        updateCar(car, dt, t);
        if (car.wrecked) continue;
        const q = car.group.position;
        away.set(p.x - q.x, 0, p.z - q.z);
        const d = away.length();
        const reach = player.radius + 2.1;
        if (free && d < reach && p.y < q.y + 3.5 && (speed > 3 || vy < -4)) {
          wreckCar(car, p, scene);
          smashed++;
          carCount.textContent = String(smashed);
          sfx.crash();
          shake = 0.6;
          ctx.addStars(1);
          for (const pp of people) if (Math.hypot(pp.group.position.x - q.x, pp.group.position.z - q.z) < 14) frighten(pp);
          checkDone();
        } else if (d < reach && p.y < q.y + 2.6) {
          p.addScaledVector(away.divideScalar(d || 1), reach - d);
        }
        if (free) consider(q);
      }
      for (const pp of people) {
        if (pp.state === 'gone') continue;
        const q = pp.group.position;
        let run = 0;
        if (pp.state === 'idle') {
          if (free && Math.hypot(q.x - p.x, q.z - p.z) < player.radius + 7 && p.y - q.y < 10 && speed > 1.5) frighten(pp);
          if (free) consider(q);
        }
        if (pp.state === 'panic') {
          away.set(q.x - p.x, 0, q.z - p.z).normalize();
          pp.vel.lerp(away.multiplyScalar(9), 1 - Math.exp(-dt * 5));
          moveOnGround(q, pp.vel, dt, 0.6, false);
          keepOut(q, 0.6);
          q.y = groundY(q.x, q.z);
          run = pp.vel.length();
          if (run > 0.5) pp.heading = turnToward(pp.heading, Math.atan2(pp.vel.x, pp.vel.z), dt * 8);
          pp.group.rotation.y = pp.heading;
        }
        posePerson(pp, dt, t, run);
      }
      for (const c of captives) if (free && c.state === 'caged') consider(c.cage.center);
      arrow.visible = free && !!best.at && best.d > 14 && !picking;
      if (best.at && arrow.visible) {
        const target = best.at;
        const a = Math.atan2(target.x - p.x, target.z - p.z);
        const r = player.radius + 2.6;
        const ax = p.x + Math.sin(a) * r;
        const az = p.z + Math.cos(a) * r;
        arrow.position.set(ax, Math.max(groundY(ax, az), 0.05) + 0.15, az);
        arrow.rotation.y = a;
        arrowMat.opacity = 0.65 + Math.sin(t * 5) * 0.3;
      }

      // Camera swings round behind the dinosaur while it runs forward. Pulling the stick
      // back walks it towards the camera instead (following then would spin in circles).
      // At the bars the camera holds still: otherwise a slightly sideways push turns dinosaur and camera round together.
      if (speed > 1 && ahead > -0.2 && !atBars) {
        const d = Math.atan2(Math.sin(heading - camYaw), Math.cos(heading - camYaw));
        camYaw += d * (1 - Math.exp(-dt * 2.2));
      }
      fwd.set(Math.sin(camYaw), 0, Math.cos(camYaw));
      const c = spec.cam;
      camAt.copy(p).addScaledVector(fwd, CHASE.ahead * c).setY(p.y + CHASE.look * c);
      dir.copy(p).addScaledVector(fwd, -CHASE.back * c);
      dir.y = Math.max(p.y + CHASE.up * c, groundY(dir.x, dir.z) + 3);
      camPos.lerp(dir, 1 - Math.exp(-dt * 6));
    }
    shake = Math.max(0, shake - dt);
    camera.position.copy(camPos);
    if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
    camera.lookAt(camAt);
    const ground = player ? player.root.position : camAt;
    sun.position.copy(ground).add(new THREE.Vector3(28, 50, 18));
    sun.target.position.copy(ground);

    cage.update(dt, t);
    for (const c of captives) {
      c.cage.update(dt, t);
      updateCaptive(c, dt);
    }
    for (const n of npcs) updateNpc(n, dt);
    for (const m of ripples) {
      if (m.userData.life <= 0) continue;
      m.userData.life -= dt * 1.4;
      m.scale.setScalar(m.userData.size * (1.6 - m.userData.life));
      (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, m.userData.life) * 0.7;
    }
  }

  const away = new THREE.Vector3();
  /** Caged: pace about and roar now and then. Freed: charge out through the gap, then roam with the others. */
  function updateCaptive(c: Captive, dt: number) {
    if (c.state === 'free') return;
    const p = c.rig.root.position;
    const room = CAGE.half - c.rig.radius - 1;
    let speed = 3;
    if (c.state === 'caged') {
      c.wait -= dt;
      if (c.wait <= 0) {
        c.target.set(c.cage.center.x + (placeRand() * 2 - 1) * room, 0, c.cage.center.z + (placeRand() * 2 - 1) * room);
        c.wait = 3 + placeRand() * 4;
      }
      c.roarIn -= dt;
      if (c.roarIn <= 0) {
        c.roarIn = 6 + placeRand() * 6;
        c.rig.roaring = 1;
        if (player && player.root.position.distanceTo(p) < 30) sfx.roar(c.spec.roar);
      }
    } else {
      speed = 10;
      const out = c.cage.exit ?? (player ? away.subVectors(p, player.root.position).setY(0).normalize() : away.set(1, 0, 0));
      c.target.copy(c.cage.center).addScaledVector(out, CAGE.half + 16);
      if (!c.cage.inside(p)) {
        // Out: join the dinosaurs roaming the park.
        c.state = 'free';
        npcs.push({ rig: c.rig, target: c.target.clone(), wait: 0, speed: 4, flee: 2, heading: c.heading, vel: c.vel, stuck: 0 });
        return;
      }
    }
    dir.subVectors(c.target, p).setY(0);
    const d = dir.length();
    const move = d > 1 ? (c.state === 'leaving' ? 1 : 0.35) : 0;
    c.vel.lerp(dir.divideScalar(d || 1).multiplyScalar(move * speed), 1 - Math.exp(-dt * 4));
    moveOnGround(p, c.vel, dt, c.rig.radius, false);
    c.cage.contain(p, c.vel, c.rig.radius, Infinity);
    p.y = groundY(p.x, p.z);
    const sp = c.vel.length();
    if (sp > 0.3) c.heading = turnToward(c.heading, Math.atan2(c.vel.x, c.vel.z), dt * 5);
    c.rig.root.rotation.y = c.heading;
    animate(c.rig, dt, THREE.MathUtils.clamp(sp / 6, 0, 1), t + c.heading);
  }

  function updateNpc(n: Npc, dt: number) {
    const p = n.rig.root.position;
    let move = 0;
    n.flee = Math.max(0, n.flee - dt);
    if (n.wait > 0) n.wait -= dt;
    else {
      dir.subVectors(n.target, p).setY(0);
      const d = dir.length();
      if (d < 1.5) {
        n.wait = 2 + placeRand() * 5;
        n.target.set(
          THREE.MathUtils.clamp(p.x + (placeRand() - 0.5) * 50, -HALF + 5, HALF - 5),
          0,
          THREE.MathUtils.clamp(p.z + (placeRand() - 0.5) * 50, -HALF + 5, HALF - 5),
        );
      } else move = n.flee > 0 ? 1 : 0.45;
      dir.divideScalar(d || 1);
    }
    n.vel.lerp(dir.multiplyScalar(move * n.speed * (n.flee > 0 ? 2.4 : 1)), 1 - Math.exp(-dt * 4));
    moveOnGround(p, n.vel, dt, n.rig.radius, false);
    keepOut(p, n.rig.radius);
    if (player) {
      away.subVectors(p, player.root.position).setY(0);
      const d = away.length();
      const min = player.radius + n.rig.radius;
      if (d < min && d > 1e-3) p.addScaledVector(away.divideScalar(d), min - d);
    }
    p.y = groundY(p.x, p.z);
    const speed = n.vel.length();
    if (speed > 0.3) n.heading = turnToward(n.heading, Math.atan2(n.vel.x, n.vel.z), dt * 5);
    n.rig.root.rotation.y = n.heading;
    animate(n.rig, dt, THREE.MathUtils.clamp(speed / (n.speed * 1.6), 0, 1), t + n.speed);
    // Stuck against a tree: rest, then pick somewhere else.
    n.stuck = move > 0 && speed < 0.4 ? n.stuck + dt : 0;
    if (n.stuck > 1.2) {
      n.stuck = 0;
      n.target.copy(p);
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
  setPlayer(DINOS[0]);
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
    world.dispose();
    extra.forEach((x) => x.dispose());
    disposeDinoAssets();
    disposePark();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    hud.remove();
  };
}
