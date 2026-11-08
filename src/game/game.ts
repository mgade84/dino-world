import * as THREE from 'three';
import type { GameContext } from '../types';
import { ambience, noiseLoop, sfx, toneLoop } from '../engine/audio';
import { L, UI, type Txt } from '../i18n';
import { buildSettings } from '../settings';
import { animate, buildDino, disposeDinoAssets, DINOS, type DinoSpec, type Rig } from './dinos';
import { buildWorld, floorY, groundY, HALF, MAP, rng, CAGE_SPOTS, POWER, SHORE, useMap } from './world';
import { getMap, trialMap, type MapDef } from './maps';
import { CAGE, CAGE_HITS, CAR_COLORS, createCage, createCar, createPerson, disposePark, knockDown, posePerson, scare, updateCar, wreckCar, type Cage, type Car, type Person } from './park';
import { createTown, type Building } from './buildings';
import { createFences } from './fences';
import { createSecurity } from './security';
import { createStation, type Generator } from './station';
import { createDocks } from './docks';
import { createSeeThrough } from './seethrough';
import { disposeMerged } from './merge';
import { getQuality, getShowFps } from '../engine/storage';
import { HERO, LEVELS, type Goal, type LevelDef } from './levels';
import { rampageBest, recordRampage, unlockDino, unlockedDinos } from './progress';
import { clock, M as STRINGS, S } from './strings';
import { createWeather, STORM } from './weather';
import './dino.css';

/** Jeeps (each with a person beside it) in Rampage on a map without any, respawned once all are wrecked and scared. */
const RAMPAGE_TARGETS = 10;
/** Rampage: rangers on the island. */
const RAMPAGE_RANGERS = 4;
/** Rampage scoring: points per kind of mayhem, the combo window and cap, and how often reinforcements come. */
const POINTS: Record<string, number> = { smash: 100, scare: 25, knock: 50, free: 200, destroy: 500, generators: 400, sink: 300, fence: 50 };
const COMBO = { window: 4, max: 5 };
const HEAT = { every: 2500, max: 6 };
/** Energy lost to a dart, and to a live fence. Energy comes back after a few seconds without a hit. */
const DART_HIT = 14;
const ZAP_HIT = 20;
const REGEN = { after: 5, rate: 6 };
/** A new roar can start once the last one's `roaring` has fallen to this: its head-rear is over. */
const ROAR_AGAIN = 0.375;
/** Charging faster than this damages buildings and tears down dead fences. */
const CHARGE = 5;
/** Sedation: seconds until the screen is black, and until the dinosaur wakes at the checkpoint. */
const SEDATE = { dark: 1.6, wake: 3.8 };
/** Length of a level's opening camera shot, in seconds. */
const INTRO = 5.5;
/** Auto quality: resolution steps between these, by this much, when frames run slower or faster than these (ms). */
const ADAPT = { min: 0.7, step: 0.15, slow: 24, fast: 14, window: 1000 };
/** Fog and clear colour: the storm's horizon. */
const SKY = STORM.horizon;
/** Base light levels; lightning adds to them. */
const LIGHT = { hemi: 1.5, sun: 1.6, flashHemi: 3.5 };
/** Mouse look: radians per pixel, and how far the camera tilts up or down. */
const LOOK = 0.0028;
const PITCH = { min: -0.45, max: 0.7 };
/** Third-person camera: behind and above the dinosaur, looking a little ahead of it. */
const CHASE = { back: 13, up: 7.5, look: 3.2, ahead: 9 };
/** Joystick reach in CSS pixels: the further up from where the finger landed, the faster. */
const STICK = 100;
const GRAVITY = 34;
/** Jump speed: peaks a little over 4 units, enough to get onto the plateaus. */
const JUMP = 17;
/** Seconds spent crouching to load the legs before springing off them. */
const WINDUP = 0.17;
/** Steepest ground a dinosaur can walk up (rise over run); cliffs need a jump. */
const CLIMB = 0.9;

interface Npc { rig: Rig; target: THREE.Vector3; wait: number; speed: number; flee: number; heading: number; vel: THREE.Vector3; stuck: number; }
/** A dinosaur locked in one of the other cages, waiting to be broken out. */
interface Captive { cage: Cage; spec: DinoSpec; rig: Rig; state: 'caged' | 'leaving' | 'free'; target: THREE.Vector3; heading: number; vel: THREE.Vector3; wait: number; roarIn: number; }

export interface RunOpts {
  /** The story level, or null for Rampage. */
  level: LevelDef | null;
  /** Rampage: the island to play on (default: the map being tried from the editor, or the default map). */
  map?: MapDef;
  /** Story only: the level was won or lost. */
  onEnd(result: { won: boolean; time: number }): void;
  onRestart(): void;
  onQuit(): void;
}

const turnToward = (from: number, to: number, max: number) => {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + THREE.MathUtils.clamp(d, -max, max);
};

export function runDino(ctx: GameContext, opts: RunOpts): () => void {
  const root = ctx.area;
  const level = opts.level;
  const story = !!level;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const quality = getQuality();
  const maxRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  let ratio = quality === 'low' ? Math.min(1, maxRatio) : maxRatio;
  renderer.setPixelRatio(ratio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'dn-canvas';
  root.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY, 22, 115);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 220);
  // Storm light: a flat grey sky overhead and a weak, cool key light through the clouds.
  const hemi = new THREE.HemisphereLight('#b4c2ca', '#4a5040', LIGHT.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#c9d2d8', LIGHT.sun);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(quality === 'low' ? 512 : 1024);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 150 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // Lay out the level's map before anything is built on it.
  // Rampage plays on a map being tried out from the editor, if there is one.
  useMap(level ? getMap(level.map) : opts.map ?? trialMap() ?? getMap());
  const world = buildWorld();
  scene.add(world.group);
  // Low draws the cheap tree models everywhere; Auto starts with the full ones and may step down.
  let fullTrees = quality !== 'low';
  /** Times Auto has dropped the full trees; after the second it keeps the cheap ones, so it doesn't see-saw. */
  let treeDrops = 0;
  world.setTreeDetail(fullTrees);
  const weather = createWeather(scene, quality === 'low' ? 0.5 : 1);
  const town = createTown(scene);
  // Story levels say whether there are fences; Rampage has them live.
  const fenceMode = level ? level.fences : 'live';
  const fences = fenceMode ? createFences(scene, fenceMode === 'live') : null;
  const station = createStation(scene);
  const docks = createDocks(scene, rng(11));
  const powered = level?.power !== 'off';
  // Soundscape: the music, the station's hum and the surf, mixed by where the dinosaur is.
  const music = ambience();
  const hum = toneLoop('sine', 50);
  const humNoise = noiseLoop('lowpass', 140, 2);
  const surf = noiseLoop('lowpass', 450, 0.7);
  /** 0..1, how hunted the dinosaur is right now; rises on sightings and hits, then fades. */
  let tension = 0;
  if (!powered) {
    // After the blackout: the generators are wrecks and the lights are out.
    station.blackout(true);
    town.setLights(false);
  }
  const placeRand = rng(Date.now() & 0xffff);
  const extra: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (extra.push(x), x);

  // ---- HUD ----
  const hud = document.createElement('div');
  hud.className = 'dn-hud';
  hud.style.setProperty('--top', `${ctx.topInset}px`);
  hud.innerHTML = `
    <div class="dn-goals">
      ${level ? `<div class="dn-goals-head">${L(level.name)}</div>` : `<div class="dn-goals-head">${S().rampage}</div>`}
      <ul></ul>
    </div>
    ${level?.timeLimit ? `<div class="dn-timer"><small>${S().timeLeft}</small><b>${clock(level.timeLimit)}</b></div>` : ''}
    <button class="dn-btn dn-pause" aria-label="${S().pause}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg></button>
    ${story ? '' : `<button class="dn-btn dn-change" aria-label="${S().change}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3V4h2v6h-6V8h2.8A6 6 0 1 0 18 12h2a8 8 0 0 1-16 0z"/></svg></button>`}
    <button class="dn-act dn-jump" aria-label="${S().jump}"><span>${S().jump}</span></button>
    <button class="dn-act dn-roar" aria-label="${S().roar}"><span>${S().roar}</span></button>
    <div class="dn-intro" hidden>
      <div class="dn-bar dn-bar-top"></div><div class="dn-bar dn-bar-bottom"></div>
      ${level ? `<div class="dn-title"><small>${S().level(LEVELS.indexOf(level) + 1)} · ${L(level.place)}</small><h2>${L(level.name)}</h2></div>` : ''}
      <p class="dn-skip">${S().skip}</p>
    </div>
    <div class="dn-fps" ${getShowFps() ? '' : 'hidden'}></div>
    ${story ? '' : `<div class="dn-score"><small>${S().score}</small><b>0</b><i></i></div>`}
    <div class="dn-energy" hidden><small>${S().energy}</small><i><b></b></i></div>
    <div class="dn-hurt"></div>
    <div class="dn-sedate"><h2>${S().sedated}</h2><p>${S().sedatedSub}</p></div>
    <div class="dn-radio" hidden><small>${S().radio}</small><p></p></div>
    <div class="dn-toast" hidden></div>
    <div class="dn-stick" hidden><i></i></div>
    <div class="dn-pick" hidden>
      <h2>${S().pick}</h2>
      <div class="dn-cards"></div>
    </div>
    <div class="dn-menu" hidden>
      <h2>${S().paused}</h2>
      <button class="dn-big" data-act="resume">${S().resume}</button>
      ${story ? `<button class="dn-big dn-ghost" data-act="restart">${S().restart}</button>` : ''}
      <button class="dn-big dn-ghost" data-act="settings">${L(UI).settings}</button>
      <button class="dn-big dn-ghost" data-act="quit">${S().quit}</button>
    </div>`;
  root.appendChild(hud);
  const goalList = hud.querySelector<HTMLElement>('.dn-goals ul')!;
  const timerEl = hud.querySelector<HTMLElement>('.dn-timer');
  const timerNum = timerEl?.querySelector('b') ?? null;
  const radioBox = hud.querySelector<HTMLElement>('.dn-radio')!;
  const toast = hud.querySelector<HTMLElement>('.dn-toast')!;
  const menu = hud.querySelector<HTMLElement>('.dn-menu')!;
  const energyEl = hud.querySelector<HTMLElement>('.dn-energy')!;
  const energyBar = energyEl.querySelector<HTMLElement>('b')!;
  const hurt = hud.querySelector<HTMLElement>('.dn-hurt')!;
  const sedateEl = hud.querySelector<HTMLElement>('.dn-sedate')!;
  const introEl = hud.querySelector<HTMLElement>('.dn-intro')!;
  const fpsEl = hud.querySelector<HTMLElement>('.dn-fps')!;
  const scoreEl = hud.querySelector<HTMLElement>('.dn-score');
  const picker = hud.querySelector<HTMLElement>('.dn-pick')!;
  const stick = hud.querySelector<HTMLElement>('.dn-stick')!;
  const knob = stick.querySelector('i')!;

  // ---- Player ----
  const heroSpec = DINOS.find((d) => d.id === HERO)!;
  let spec: DinoSpec = heroSpec;
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
    jumpIcon.textContent = s.fly ? S().fly : S().jump;
    jumpBtn.setAttribute('aria-label', s.fly ? S().fly : S().jump);
  }

  /** Levels that begin after the breakout: the paddock's front bars are already bent open, and the dinosaur stands just outside. */
  function startOutside(at?: [number, number, number]) {
    for (let k = 0; k < CAGE_HITS; k++) cage.bump(3);
    free = true;
    const out = cage.exit!;
    // Just outside the bent bars, far enough out that the chase camera starts clear of them; or a level's own start.
    const x = at ? at[0] : CAGE.x + out.x * (CAGE.half + 16);
    const z = at ? at[1] : CAGE.z + out.z * (CAGE.half + 16);
    heading = camYaw = at ? at[2] : Math.atan2(out.x, out.z);
    player!.root.position.set(x, groundY(x, z), z);
    player!.root.rotation.y = heading;
    camPos.set(x - Math.sin(heading) * CHASE.back, groundY(x, z) + CHASE.up, z - Math.cos(heading) * CHASE.back);
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
  const emptyCages: Cage[] = [];
  function spawnCaptives() {
    if (!powered) {
      // The blackout opened every paddock: the cages stand empty, bars bent.
      for (const spot of CAGE_SPOTS) {
        const empty = createCage(spot.x, spot.z);
        for (let k = 0; k < CAGE_HITS; k++) empty.bump(2);
        scene.add(empty.group);
        emptyCages.push(empty);
      }
      captives = [];
      return;
    }
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

  // ---- Objectives ----
  const count = { escape: 0, smash: 0, scare: 0, free: 0, destroy: 0, generators: 0, sink: 0 };
  const goals: Goal[] = level?.goals ?? [];
  const goalNeed = (g: Goal) => (g.kind === 'escape' ? 1 : g.n);
  const GOAL_LABEL: Record<Goal['kind'], () => string> = {
    escape: () => S().goalEscape, smash: () => S().goalSmash, scare: () => S().goalScare, free: () => S().goalFree, destroy: () => S().goalDestroy,
    generators: () => S().goalGenerators, sink: () => S().goalSink,
  };
  function renderGoals() {
    if (story) {
      goalList.innerHTML = goals
        .map((g) => {
          const need = goalNeed(g);
          const have = Math.min(need, count[g.kind]);
          return `<li class="${have >= need ? 'done' : ''}"><i></i>${GOAL_LABEL[g.kind]()}${g.kind === 'escape' ? '' : ` <b>${have}/${need}</b>`}</li>`;
        })
        .join('');
    } else {
      goalList.innerHTML = `<li>${S().wrecked} <b>${count.smash}</b></li><li>${S().scaredLabel} <b>${count.scare}</b></li><li>${S().freedLabel} <b>${count.free}</b></li><li>${S().destroyedLabel} <b>${count.destroy}</b></li><li>${S().sunkLabel} <b>${count.sink}</b></li>`;
    }
  }
  const goalsMet = () => story && goals.every((g) => count[g.kind] >= goalNeed(g));

  /** Story: end the level a moment after the last goal (or the clock) so the player sees it happen. */
  let finished = false;
  let elapsed = 0;
  function finish(won: boolean) {
    if (finished || !level) return;
    finished = true;
    const line = won ? level.radio.done : level.radio.fail;
    if (line) timers.push(window.setTimeout(() => radio(line), won ? 900 : 0));
    if (won) sfx.win();
    else sfx.oops();
    const time = elapsed;
    timers.push(window.setTimeout(() => alive && opts.onEnd({ won, time }), won ? 4200 : 3200));
  }
  // ---- Rampage score ----
  let score = 0;
  let combo = 0;
  let lastScore = -99;
  let reinforced = 0;
  const startBest = story ? 0 : rampageBest();
  let bestShown = false;
  function award(kind: string) {
    if (story || !POINTS[kind]) return;
    // Mayhem in quick succession builds a combo multiplier.
    combo = t - lastScore < COMBO.window ? Math.min(COMBO.max, combo + 1) : 1;
    lastScore = t;
    score += POINTS[kind] * combo;
    if (scoreEl) {
      scoreEl.querySelector('b')!.textContent = score.toLocaleString();
      scoreEl.querySelector('i')!.textContent = combo > 1 ? `×${combo}` : '';
      scoreEl.classList.remove('pop');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('pop');
    }
    if (recordRampage(score) && startBest > 0 && !bestShown) {
      bestShown = true;
      notice(S().newBest);
    }
    // The more damage, the more rangers.
    const wanted = Math.min(HEAT.max, Math.floor(score / HEAT.every));
    if (wanted > reinforced && security) {
      security.reinforce(wanted - reinforced);
      reinforced = wanted;
      radio({ en: STRINGS.en.radioReinforce, da: STRINGS.da.radioReinforce });
    }
  }

  function progress(kind: keyof typeof count, n = 1) {
    award(kind);
    count[kind] += n;
    // Each step towards the goals is a checkpoint to wake up at if sedated.
    if (player && free && grounded) checkpoint.copy(player.root.position);
    renderGoals();
    if (goalsMet()) finish(true);
    else if (!story && !respawning && cars.every((c) => c.wrecked) && people.every((pp) => pp.state !== 'idle')) {
      // Rampage never runs dry: a fresh convoy arrives once everything is wrecked and everyone has fled.
      respawning = true;
      timers.push(window.setTimeout(() => {
        respawning = false;
        if (alive) spawnTargets();
      }, 4000));
    }
  }
  let respawning = false;

  // ---- Park radio (subtitles with a crackle; nothing is spoken), and short notices ----
  let radioTimer = 0;
  function radio(line: Txt) {
    const text = L(line);
    if (!text) return;
    sfx.radio();
    radioBox.querySelector('p')!.textContent = text;
    radioBox.hidden = false;
    clearTimeout(radioTimer);
    radioTimer = window.setTimeout(() => (radioBox.hidden = true), Math.max(4000, text.length * 75));
  }
  let toastTimer = 0;
  function notice(text: string) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), 3500);
  }

  function freeCaptive(c: Captive, quiet = false) {
    c.state = 'leaving';
    c.rig.roaring = 1;
    sfx.roar(c.spec.roar);
    if (!quiet) timers.push(window.setTimeout(() => alive && radio({ en: M_freed('en', c.spec), da: M_freed('da', c.spec) }), 600));
    if (unlockDino(c.spec.id)) timers.push(window.setTimeout(() => alive && notice(S().unlocked(L(c.spec.name))), 2200));
    progress('free');
  }

  // ---- Dinosaurs roaming the park: only the ones broken out of their cages (see updateCaptive) ----
  const npcs: Npc[] = [];

  // ---- Jeeps to smash and visitors to scare, one visitor beside each jeep ----
  let cars: Car[] = [];
  let people: Person[] = [];
  /** Enough jeeps (and a person by each) to meet the level's goals with a couple to spare. */
  const targetCount = () => {
    if (!level) return MAP.cars?.length ? 0 : RAMPAGE_TARGETS;
    const need = Math.max(0, ...goals.map((g) => (g.kind === 'smash' || g.kind === 'scare' ? g.n : 0)));
    return need ? need + 2 : 4;
  };

  function spawnTargets() {
    cars.forEach((c) => {
      scene.remove(c.group);
      c.smoke.forEach((m) => scene.remove(m));
    });
    people.forEach((pp) => scene.remove(pp.group));
    cars = [];
    people = [];
    // The map's jeeps, all of them, then random ones if the level needs more (or the map has none).
    const sites: THREE.Vector3[] = [];
    const headings: number[] = [];
    for (const c of MAP.cars ?? []) {
      sites.push(new THREE.Vector3(c.x, floorY(c.x, c.z), c.z));
      headings.push((c.a * Math.PI) / 180);
    }
    const n = Math.max(sites.length, targetCount());
    for (let tries = 0; sites.length < n && tries < 3000; tries++) {
      const p = world.openSpot(placeRand, 5);
      if (Math.hypot(p.x - CAGE.x, p.z - CAGE.z) < 30) continue;
      if (sites.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 24 - tries / 150)) continue;
      sites.push(p);
    }
    sites.forEach((p, i) => {
      const car = createCar(CAR_COLORS[i % CAR_COLORS.length], i % 2 ? '#ffffff' : '#2f2f2f');
      car.heading = headings[i] ?? placeRand() * Math.PI * 2;
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
    // The docks have a crowd waiting for the boats in the last level.
    if (level?.boats) {
      for (let k = 0; k < 8; k++) {
        const person = createPerson(placeRand);
        person.group.position.copy(docks.landing(placeRand));
        person.heading = Math.PI * (0.8 + placeRand() * 0.4);
        scene.add(person.group);
        people.push(person);
      }
    }
    // The map's own visitors, standing about where it puts them.
    for (const at of MAP.people) {
      const person = createPerson(placeRand);
      person.group.position.set(at.x, floorY(at.x, at.z), at.z);
      person.heading = placeRand() * Math.PI * 2;
      scene.add(person.group);
      people.push(person);
    }
    // Main Street has its own crowd, on the pavements, wherever buildings are a goal (and in Rampage).
    if (!level || goals.some((g) => g.kind === 'destroy')) {
      for (let k = 0; k < 8; k++) {
        const person = createPerson(placeRand);
        person.group.position.copy(town.pavement(placeRand));
        person.heading = placeRand() * Math.PI * 2;
        scene.add(person.group);
        people.push(person);
      }
    }
  }

  function frighten(pp: Person) {
    if (!scare(pp)) return;
    sfx.scream();
    progress('scare');
  }

  // Arrow on the ground pointing to the nearest jeep or calm visitor.
  const arrowShape = new THREE.Shape([new THREE.Vector2(0, 1.4), new THREE.Vector2(0.9, -0.4), new THREE.Vector2(0, 0), new THREE.Vector2(-0.9, -0.4)]);
  const arrowGeo = keep(new THREE.ShapeGeometry(arrowShape));
  arrowGeo.rotateX(-Math.PI / 2);
  arrowGeo.rotateY(Math.PI);
  const arrowMat = keep(new THREE.MeshBasicMaterial({ color: '#ffb020', transparent: true, depthWrite: false }));
  const arrow = new THREE.Mesh(arrowGeo, arrowMat);
  arrow.scale.setScalar(1.4);
  arrow.userData.noFade = true;
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
  function renderThumbs(list: DinoSpec[]) {
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight('#ffffff', '#6a7060', 3.2));
    const l = new THREE.DirectionalLight('#ffffff', 2.6);
    l.position.set(4, 8, 6);
    s.add(l);
    const cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 100);
    renderer.setPixelRatio(1);
    renderer.setSize(360, 270, false);
    renderer.setClearColor('#000000', 0);
    const urls = list.map((d) => {
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
    renderer.setPixelRatio(ratio);
    return urls;
  }
  /** Rampage: the dinosaurs freed in the story so far. */
  const choices = story ? [] : DINOS.filter((d) => unlockedDinos().includes(d.id));
  if (choices.length > 1) {
    const thumbs = renderThumbs(choices);
    picker.querySelector('.dn-cards')!.innerHTML = choices
      .map((d, i) => `<button class="dn-card" data-i="${i}"><img src="${thumbs[i]}" alt=""><span>${L(d.name)}</span></button>`)
      .join('');
  }

  let picking = false;
  let paused = false;
  const timers: number[] = [];
  function showPicker() {
    picking = true;
    picker.hidden = false;
    unlockPointer();
  }
  picker.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.dn-card');
    if (!b) return;
    const d = choices[Number(b.dataset.i)];
    sfx.tap();
    picker.hidden = true;
    picking = false;
    setPlayer(d);
  });

  // ---- Input: a joystick wherever the finger lands (up = forward); arrow keys / WASD too ----
  let pointer: number | null = null;
  let ox = 0;
  let oy = 0;
  let sx = 0;
  let sy = 0;
  const keys = new Set<string>();
  const dir = new THREE.Vector3();

  // Mouse look: a click on the game captures the mouse (where the browser allows it); while captured,
  // moving the mouse turns the camera and clicking roars or bites. Touch keeps the drag-anywhere joystick.
  const canLock = 'requestPointerLock' in canvas;
  const mouseLook = () => document.pointerLockElement === canvas;
  let camPitch = 0.1;
  function unlockPointer() {
    if (mouseLook()) document.exitPointerLock();
  }
  const onMouseMove = (e: MouseEvent) => {
    if (!mouseLook() || paused || picking) return;
    camYaw -= e.movementX * LOOK;
    camPitch = THREE.MathUtils.clamp(camPitch + e.movementY * LOOK, PITCH.min, PITCH.max);
  };
  document.addEventListener('mousemove', onMouseMove);
  // Esc releases the mouse before the page sees the key, so losing the lock mid-game pauses it.
  let lockedOnce = false;
  const onLockChange = () => {
    if (mouseLook()) lockedOnce = true;
    else if (lockedOnce && !paused && !picking && !finished) setPaused(true);
  };
  document.addEventListener('pointerlockchange', onLockChange);

  hud.addEventListener('pointerdown', () => endIntro(), { capture: true });
  canvas.addEventListener('pointerdown', (e) => {
    if (intro >= 0) return endIntro();
    if (picking || paused) return;
    if (e.pointerType === 'mouse' && canLock) {
      if (mouseLook()) {
        if (e.button === 0) act();
      } else canvas.requestPointerLock();
      return;
    }
    if (pointer !== null) return;
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
    if (intro >= 0 && e.type === 'keydown') {
      endIntro();
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (e.type !== 'keydown' || picking || finished) return;
      // With settings open, Esc steps back to the pause menu instead of resuming.
      if (closeSettingsPanel) {
        closeSettings();
        menu.hidden = false;
      } else setPaused(!paused);
      return;
    }
    if (paused) return;
    if (e.code === 'Space') {
      if (e.type === 'keydown' && !e.repeat) jumpDown();
      else if (e.type === 'keyup') jumpUp();
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyR' || e.code === 'KeyE') {
      if (e.type === 'keydown') act();
      e.preventDefault();
      return;
    }
    if (!KEYS[e.code]) return;
    e.preventDefault();
    if (e.type === 'keydown') keys.add(e.code);
    else keys.delete(e.code);
  };
  // Keys held while the window lost focus would otherwise keep the dinosaur walking.
  const onBlur = () => keys.clear();
  window.addEventListener('blur', onBlur);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  /** Moves along the ground, sliding round trees and stopping at cliffs that are too steep. */
  const from = new THREE.Vector3();
  /** The generator the last moveOnGround() pushed against, if any. */
  let touchedGen: Generator | null = null;
  /** Returns the building it pushed against, if any. */
  function moveOnGround(p: THREE.Vector3, v: THREE.Vector3, dt: number, radius: number, airborne: boolean): Building | null {
    from.copy(p);
    p.addScaledVector(v, dt);
    world.collide(p, radius);
    const building = town.collide(p, radius, v);
    touchedGen = station.collide(p, radius, v);
    const run = Math.hypot(p.x - from.x, p.z - from.z);
    const rise = floorY(p.x, p.z) - from.y;
    const tooSteep = airborne ? rise > 0.25 : run > 1e-4 && rise / run > CLIMB && rise > 0.05;
    if (tooSteep) {
      p.x = from.x;
      p.z = from.z;
      v.multiplyScalar(0.3);
    }
    return building;
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
  }
  function jumpUp() {
    flying = false;
  }

  /** Jumps start with a crouch; update() launches when the legs are loaded. */
  let windup = -1;
  /** How hard the last landing was, 0..1; the legs absorb it and it fades. */
  let landing = 0;
  function jump() {
    if (!player || picking || paused || sedated > 0 || !grounded || windup >= 0) return;
    windup = 0;
  }

  let shake = 0;
  const roarBtn = hud.querySelector<HTMLElement>('.dn-roar')!;
  const jumpBtn = hud.querySelector<HTMLElement>('.dn-jump')!;
  const jumpIcon = jumpBtn.querySelector('span')!;
  const roarLabel = roarBtn.querySelector('span')!;
  let biteShown = false;

  /** The nearest bars within biting reach, whichever way the dinosaur faces: its own cage from inside, others' from outside. */
  const facing = new THREE.Vector3();
  let biteHeading = 0;
  type BiteTarget = { cage: Cage; side: number; captive: Captive | null; building?: undefined } | { building: Building; heading: number };
  function biteTarget(): BiteTarget | null {
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
    // A building close by and roughly ahead: bite into its nearest wall.
    for (const b of town.buildings) {
      const dx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX) - p.x;
      const dz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ) - p.z;
      const d = Math.hypot(dx, dz);
      if (d > reach || d < 1e-3 || (dx * facing.x + dz * facing.z) / d < 0.4) continue;
      return { building: b, heading: Math.atan2(dx, dz) };
    }
    return null;
  }
  const jaw = new THREE.Vector3();

  /** The roar button: bites the bars when close to them, otherwise roars. */
  function act() {
    if (!player || picking || paused || sedated > 0 || player.roaring > ROAR_AGAIN || player.biting > 0) return;
    const target = biteTarget();
    if (!target || !grounded) return roar();
    player.biting = 1;
    if (target.building) {
      // Into the wall: the jaws close on whatever is nearest them and tear it out.
      const b = target.building;
      biteHeading = target.heading;
      sfx.chomp();
      timers.push(
        window.setTimeout(() => {
          if (!alive || !player) return;
          player.head.getWorldPosition(jaw);
          const got = town.bite(b, jaw);
          if (got === 'solid') {
            sfx.thud();
            shake = Math.max(shake, 0.25);
            return;
          }
          sfx.crunch();
          sfx.crash();
          shake = Math.max(shake, got === 'wrecked' ? 0.9 : 0.5);
          const c = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
          for (const pp of people) if (Math.hypot(pp.group.position.x - c.x, pp.group.position.z - c.z) < (got === 'wrecked' ? 22 : 12)) frighten(pp);
          if (got === 'wrecked') {
            sfx.collapse();
            progress('destroy');
          }
        }, 220),
      );
      return;
    }
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
    if (!player || picking || paused || sedated > 0 || player.roaring > ROAR_AGAIN) return;
    // On the run: a short, sharp roar, and another as soon as the head comes back down.
    const running = Math.hypot(vel.x, vel.z) > spec.speed * 0.4;
    player.roaring = 1;
    player.roarFor = running ? 0.8 : 1.6;
    sfx.roar(spec.roar, running);
    shake = 0.5;
    const p = player.root.position;
    if (free) security?.roar(p, 26);
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
  // On press, not on click: iPad Safari drops clicks from a second finger while one is on the stick,
  // so a click-only button couldn't roar on the move. Keyboard activation (detail 0) still clicks.
  roarBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    act();
  });
  roarBtn.addEventListener('click', (e) => {
    if (e.detail === 0) act();
  });
  jumpBtn.addEventListener('pointerdown', (e) => {
    jumpBtn.setPointerCapture(e.pointerId);
    jumpDown();
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) jumpBtn.addEventListener(ev, jumpUp);
  hud.querySelector('.dn-change')?.addEventListener('click', () => {
    sfx.tap();
    showPicker();
  });

  // ---- Pause menu ----
  function setPaused(on: boolean) {
    if (!on) closeSettings();
    paused = on;
    menu.hidden = !on;
    keys.clear();
    if (on) unlockPointer();
    // Let go of the joystick finger's capture: iPad Safari can drop a second finger's click on the menu while it's held.
    if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    stick.hidden = true;
    pointer = null;
    sx = sy = 0;
  }
  // Settings over the paused level: the pause menu stays underneath and comes back when they close.
  let closeSettingsPanel: (() => void) | null = null;
  function openSettings() {
    if (closeSettingsPanel) return;
    menu.hidden = true;
    closeSettingsPanel = buildSettings(hud, {
      inGame: true,
      onClose: () => {
        closeSettings();
        if (paused) menu.hidden = false;
      },
      onChange: () => {
        fpsEl.hidden = !getShowFps();
      },
    });
  }
  function closeSettings() {
    closeSettingsPanel?.();
    closeSettingsPanel = null;
  }
  hud.querySelector('.dn-pause')!.addEventListener('click', () => {
    if (finished) return;
    sfx.tap();
    setPaused(true);
  });
  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    sfx.tap();
    const a = b.dataset.act;
    if (a === 'resume') setPaused(false);
    else if (a === 'settings') openSettings();
    else if (a === 'restart') opts.onRestart();
    else opts.onQuit();
  });

  // ---- Simulation ----
  const camAt = new THREE.Vector3(CAGE.x, 0, CAGE.z);
  const camPos = new THREE.Vector3(CAGE.x, 8, CAGE.z - 12);
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  let camYaw = 0;
  let t = 0;
  // ---- Rangers, energy and sedation ----
  const checkpoint = new THREE.Vector3();
  let energy = 100;
  let lastHit = -99;
  /** Seconds since sedated, or 0 while awake. */
  let sedated = 0;
  let zapCool = 0;
  // A ranger at each of the map's posts (in Rampage, and in levels that have rangers), and more at random spots if the level wants more.
  const levelRangers = level ? level.rangers ?? 0 : RAMPAGE_RANGERS;
  const rangerCount = levelRangers > 0 ? Math.max(levelRangers, MAP.guards.length) : 0;
  let post = 0;
  const rangerSpot = () => {
    const at = MAP.guards[post++];
    return at ? new THREE.Vector3(at.x, floorY(at.x, at.z), at.z) : spotAway(6, 40);
  };
  const hazards = rangerCount > 0 || fenceMode === 'live';
  energyEl.hidden = !hazards;
  const security = rangerCount > 0
    ? createSecurity(
        scene,
        rangerCount,
        rangerSpot,
        (q, r) => {
          world.collide(q, r);
          town.collide(q, r);
          keepOut(q, r);
        },
        placeRand,
        {
          onHit: () => {
            sfx.dartHit();
            damage(DART_HIT);
          },
          onSpot: () => {
            sfx.siren();
            tension = 1;
            if (level?.radio.spotted) radio(level.radio.spotted);
          },
          onKnock: () => {
            award('knock');
            sfx.thud();
            shake = Math.max(shake, 0.3);
          },
        },
      )
    : null;

  function damage(n: number) {
    if (sedated > 0 || finished) return;
    energy = Math.max(0, energy - n);
    lastHit = t;
    tension = Math.max(tension, 0.8);
    hurt.classList.remove('on');
    void hurt.offsetWidth; // restart the flash
    hurt.classList.add('on');
    if (energy <= 0) {
      // Out cold: slump, fade out, wake up at the last checkpoint.
      sedated = 0.001;
      radio({ en: STRINGS.en.radioSedated, da: STRINGS.da.radioSedated });
    }
  }

  function updateEnergy(dt: number) {
    if (sedated > 0) {
      sedated += dt;
      sedateEl.classList.toggle('on', sedated > SEDATE.dark * 0.4 && sedated < SEDATE.wake);
      if (sedated >= SEDATE.wake && player) {
        const p = player.root.position;
        p.copy(checkpoint);
        vel.set(0, 0, 0);
        vy = 0;
        grounded = true;
        camYaw = heading;
        camPos.set(p.x - Math.sin(heading) * CHASE.back, p.y + CHASE.up, p.z - Math.cos(heading) * CHASE.back);
        security?.regroup(p);
        energy = 100;
        sedated = 0;
        notice(S().checkpoint);
      }
    } else if (t - lastHit > REGEN.after) energy = Math.min(100, energy + REGEN.rate * dt);
    energyBar.style.transform = `scaleX(${energy / 100})`;
    energyEl.classList.toggle('low', energy < 30);
  }

  const canBlackOut = !story || goals.some((g) => g.kind === 'generators');

  /** The last generator is dead: fences die, lights go out, and every paddock on the island opens. */
  function blackout() {
    sfx.powerDown();
    station.blackout();
    fences?.setLive(false);
    town.setLights(false);
    for (const c of captives) {
      if (c.state !== 'caged') continue;
      for (let k = 0; k < CAGE_HITS; k++) c.cage.bump(2, -1);
      freeCaptive(c, true);
    }
  }

  const docksEvents = {
    depart: () => radio({ en: STRINGS.en.radioBoat, da: STRINGS.da.radioBoat }),
    escape: () => {
      // Too many away to meet the goal: the mission's lost.
      const need = goals.find((g) => g.kind === 'sink');
      if (need && need.kind === 'sink' && count.sink + docks.afloat < need.n) finish(false);
      else radio({ en: STRINGS.en.radioBoatGone, da: STRINGS.da.radioBoatGone });
    },
  };

  // ---- Opening shot ----
  /** Seconds into the opening shot, or -1 once it's over (or for Rampage, which has none). */
  let intro = level ? 0 : -1;
  const introFrom = new THREE.Vector3();
  const introTo = new THREE.Vector3();
  const introLook = new THREE.Vector3();
  if (level) {
    introFrom.set(...level.intro.from);
    introTo.set(...level.intro.to);
    introLook.set(...level.intro.look);
  }
  function endIntro() {
    if (intro < 0) return;
    intro = -1;
    introEl.hidden = true;
    hud.classList.remove('in-intro');
    if (level?.boats) docks.schedule(level.boats);
  }

  /** Touching bars last frame, and the direction into them. */
  let pressing = false;
  const pressDir = new THREE.Vector3();

  function update(dt: number) {
    if (paused) return;
    t += dt;
    if (intro >= 0) {
      intro += dt;
      if (intro >= INTRO) endIntro();
    }
    if (!finished && intro < 0) elapsed += dt;
    if (level?.timeLimit && !finished && timerNum) {
      const left = Math.max(0, level.timeLimit - elapsed);
      timerNum.textContent = clock(Math.ceil(left));
      timerEl!.classList.toggle('low', left < 20);
      if (left <= 0) finish(false);
    }
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
      if (picking || finished || sedated > 0 || intro >= 0) side = ahead = 0;
      const amount = Math.min(1, Math.hypot(side, ahead));
      fwd.set(Math.sin(camYaw), 0, Math.cos(camYaw));
      right.set(-Math.cos(camYaw), 0, Math.sin(camYaw));
      dir.set(0, 0, 0);
      if (amount > 0.15) dir.addScaledVector(fwd, ahead).addScaledVector(right, side).normalize();
      // Speed comes from how far the stick is pushed, the same in every direction.
      const pace = amount <= 0.15 ? 0 : amount;
      const wet = world.inWater(p.x, p.z) && floorY(p.x, p.z) < 0;
      if (wet && !wasWet) sfx.splat();
      wasWet = wet;
      // Pushing roughly towards bars it is already touching: push straight in and face them squarely,
      // instead of sliding along them (and away from them) on a slightly sideways push.
      if (pressing && pace > 0 && dir.dot(pressDir) > 0.35) dir.copy(pressDir);
      // Face where the player steers, not where a bump off the bars sends it.
      const steer = pace > 0 ? Math.atan2(dir.x, dir.z) : null;
      // Flyers in the air go at flying speed, high above trees and cages.
      const aloft = !!spec.fly && (flying || !grounded);
      const high = aloft && p.y - floorY(p.x, p.z) > 7;
      const want = dir.multiplyScalar((aloft ? spec.fly! : spec.speed) * pace * (wet && !aloft ? 0.55 : 1));
      vel.lerp(want, 1 - Math.exp(-dt * (aloft ? 2.5 : grounded ? 6 : 1.5)));
      if (high) {
        p.addScaledVector(vel, dt);
        p.x = THREE.MathUtils.clamp(p.x, -HALF, HALF);
        p.z = THREE.MathUtils.clamp(p.z, -HALF, HALF);
      }
      // How hard it is charging, before walls and fences take any of it away.
      const charge = Math.hypot(vel.x, vel.z);
      const hitBuilding = high ? null : moveOnGround(p, vel, dt, player.radius, !grounded);
      if (hitBuilding && free && charge > CHARGE) {
        vel.multiplyScalar(-0.25);
        // Charging only shakes a building: it takes biting to tear pieces out of it.
        if (town.bump(hitBuilding, p)) {
          sfx.thud();
          shake = Math.max(shake, 0.5);
        }
      }
      if (fences && !high) {
        const f = fences.collide(p, player.radius, vel, charge);
        if (f === 'zap' && zapCool <= 0) {
          zapCool = 0.8;
          sfx.zap();
          damage(ZAP_HIT);
          shake = Math.max(shake, 0.7);
        } else if (f === 'break') {
          award('fence');
          sfx.crash();
          shake = Math.max(shake, 0.4);
        }
      }
      zapCool = Math.max(0, zapCool - dt);
      // Generators: a charge damages one; the last one dying blacks out the island.
      // Only Blackout (and Rampage) lets the generators be wrecked: elsewhere the story needs the power on.
      if (touchedGen && !high && free && charge > CHARGE && canBlackOut) {
        vel.multiplyScalar(-0.25);
        sfx.clang();
        sfx.zap();
        shake = Math.max(shake, 0.5);
        if (station.hit(touchedGen, p)) {
          sfx.collapse();
          shake = 1;
          progress('generators');
          if (station.running === 0) blackout();
          else radio({ en: STRINGS.en.radioGenerator, da: STRINGS.da.radioGenerator });
        }
      }
      // Boats: ram one, moored or under way, and over it goes.
      if (!high && free) {
        const boat = docks.ram(p, player.radius, vel, charge);
        if (boat) {
          sfx.crash();
          sfx.splat();
          sfx.scream();
          shake = Math.max(shake, 0.8);
          progress('sink');
        }
      }
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
          sfx.roar(spec.roar * 1.1);
          shake = 0.8;
          if (level?.radio.escaped) radio(level.radio.escaped);
          sfx.siren();
          tension = 1;
          progress('escape');
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
        roarLabel.textContent = biteShown ? S().bite : S().roar;
        roarBtn.setAttribute('aria-label', biteShown ? S().bite : S().roar);
      }
      // Jump: crouch to load the legs, then spring off them.
      if (windup >= 0) {
        windup += dt;
        if (windup >= WINDUP) {
          windup = -1;
          vy = JUMP;
          grounded = false;
          p.y += 0.01;
          sfx.thud();
          shake = Math.max(shake, 0.25);
        }
      }
      // Gravity, jumping, and walking down hills without bouncing.
      const g = floorY(p.x, p.z);
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
          // The legs take the impact: a deeper crouch the harder it lands.
          landing = THREE.MathUtils.clamp(-vy / 24, 0.25, 1);
          if (vy < -10) shake = Math.max(shake, landing * 0.5);
          p.y = g;
          vy = 0;
        }
      }
      grounded = !(spec.fly && flying) && p.y <= g + 0.001;
      player.wingMode = spec.fly && flying ? 1 : grounded ? 0 : 0.5;
      // Leg pose: crouch while winding up or absorbing a landing; tuck the legs up after take-off,
      // and reach down for the ground again on the way down.
      player.crouch = sedated > 0
        ? Math.min(1, sedated * 0.9)
        : windup >= 0 ? THREE.MathUtils.smoothstep(windup / WINDUP, 0, 1) * 0.75 : landing * 0.85;
      landing = Math.max(0, landing - dt * 2.6);
      const tuck = grounded ? 0 : spec.fly && flying ? 1 : vy > -5 ? 0.9 : 0.3;
      player.air += (tuck - player.air) * (1 - Math.exp(-dt * (grounded ? 20 : 8)));
      const speed = Math.hypot(vel.x, vel.z);
      if (player.biting > 0) heading = turnToward(heading, biteHeading, dt * 16);
      else if (steer !== null) heading = turnToward(heading, steer, dt * 9);
      else if (speed > 0.6) heading = turnToward(heading, Math.atan2(vel.x, vel.z), dt * 9);
      player.root.rotation.y = heading;
      const move = THREE.MathUtils.clamp(speed / spec.speed, 0, 1);
      // Heavy footfalls: a thud, and the camera shakes with each one.
      if (animate(player, dt, grounded ? move : 0, t, grounded ? speed : 0) && grounded && (spec.id === 'trex' || spec.id === 'brachio')) {
        sfx.step(spec.id === 'brachio' ? 1.4 : 1.1);
        shake = Math.max(shake, 0.18 * move);
      }
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
          sfx.crash();
          shake = 0.6;
          for (const pp of people) if (Math.hypot(pp.group.position.x - q.x, pp.group.position.z - q.z) < 14) frighten(pp);
          progress('smash');
        } else if (d < reach && p.y < q.y + 2.6) {
          p.addScaledVector(away.divideScalar(d || 1), reach - d);
        }
        if (free) consider(q);
      }
      for (const pp of people) {
        if (pp.state === 'gone') continue;
        const q = pp.group.position;
        let run = 0;
        // Run into at speed: knocked flat (they get up and flee).
        if (free && pp.state !== 'down' && Math.hypot(q.x - p.x, q.z - p.z) < player.radius + 0.9 && speed > 3 && p.y - q.y < 3) {
          frighten(pp);
          if (knockDown(pp, p)) {
            sfx.thud();
            award('knock');
          }
        }
        if (pp.state === 'down') {
          pp.vel.multiplyScalar(Math.exp(-dt * 4));
          q.addScaledVector(pp.vel, dt);
          world.collide(q, 0.6);
          town.collide(q, 0.6);
          q.y = groundY(q.x, q.z);
        }
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
      arrow.visible = free && !!best.at && best.d > 14 && !picking && !finished && sedated <= 0;
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
      if (speed > 1 && ahead > -0.2 && !atBars && !mouseLook()) {
        const d = Math.atan2(Math.sin(heading - camYaw), Math.cos(heading - camYaw));
        camYaw += d * (1 - Math.exp(-dt * 2.2));
      }
      fwd.set(Math.sin(camYaw), 0, Math.cos(camYaw));
      const c = spec.cam;
      // Pitch tilts the camera over the top (positive) or down behind the dinosaur (negative).
      camAt.copy(p).addScaledVector(fwd, CHASE.ahead * c).setY(p.y + CHASE.look * c);
      dir.copy(p).addScaledVector(fwd, -CHASE.back * c * (1 - camPitch * 0.35));
      dir.y = Math.max(p.y + CHASE.up * c * (0.9 + camPitch), groundY(dir.x, dir.z) + 3);
      camPos.lerp(dir, 1 - Math.exp(-dt * 6));
    }
    shake = Math.max(0, shake - dt);
    if (intro >= 0) {
      // The opening shot: a slow glide over the level's location.
      const k = THREE.MathUtils.smoothstep(intro / INTRO, 0, 1);
      camera.position.lerpVectors(introFrom, introTo, k);
      camera.lookAt(introLook);
    } else {
      camera.position.copy(camPos);
      if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
      camera.lookAt(camAt);
    }
    weather.update(dt, camera);
    hemi.intensity = LIGHT.hemi + weather.flash * LIGHT.flashHemi;
    sun.intensity = LIGHT.sun * (1 - weather.flash * 0.5);
    const ground = player ? player.root.position : camAt;
    sun.position.copy(ground).add(new THREE.Vector3(28, 50, 18));
    sun.target.position.copy(ground);

    town.update(dt);
    fences?.update(dt, t);
    station.update(dt, t);
    docks.update(dt, t, docksEvents);
    if (player) {
      const p = player.root.position;
      security?.update(dt, t, { pos: p, radius: player.radius, speed: Math.hypot(vel.x, vel.z), free, ignore: sedated > 0 || finished || intro >= 0 });
      updateEnergy(dt);
      if (scoreEl && combo > 1 && t - lastScore > COMBO.window) {
        combo = 0;
        scoreEl.querySelector('i')!.textContent = '';
      }
      // Mix the soundscape.
      tension = Math.max(0, tension - dt / 12);
      music.set(sedated > 0 ? 0 : 0.25 + tension * 0.75);
      const toStation = Math.hypot(p.x - POWER.x, p.z - POWER.z);
      const near = station.running > 0 ? THREE.MathUtils.clamp(1 - toStation / 45, 0, 1) : 0;
      hum.set(near * 0.08);
      humNoise.set(near * 0.12);
      surf.set(THREE.MathUtils.clamp(1 - (SHORE - p.z) / 35, 0, 1) * (0.06 + Math.sin(t * 0.45) * 0.03));
    }
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
    p.y = floorY(p.x, p.z);
    const sp = c.vel.length();
    if (sp > 0.3) c.heading = turnToward(c.heading, Math.atan2(c.vel.x, c.vel.z), dt * 5);
    c.rig.root.rotation.y = c.heading;
    animate(c.rig, dt, THREE.MathUtils.clamp(sp / 6, 0, 1), t + c.heading, sp);
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
    p.y = floorY(p.x, p.z);
    const speed = n.vel.length();
    if (speed > 0.3) n.heading = turnToward(n.heading, Math.atan2(n.vel.x, n.vel.z), dt * 5);
    n.rig.root.rotation.y = n.heading;
    animate(n.rig, dt, THREE.MathUtils.clamp(speed / (n.speed * 1.6), 0, 1), t + n.speed, speed);
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
  // Frame timing, for the frame-rate readout and for adapting the resolution in Auto quality.
  let frames = 0;
  let frameMs = 0;
  let fastWindows = 0;
  function adapt(avg: number) {
    if (quality !== 'auto') return;
    if (avg > ADAPT.slow) {
      fastWindows = 0;
      // First the cheap trees (the jungle is the heaviest thing on screen and it barely shows), then resolution.
      if (fullTrees) {
        fullTrees = false;
        treeDrops++;
        world.setTreeDetail(false);
      } else if (ratio > ADAPT.min + 0.01) {
        ratio = Math.max(ADAPT.min, ratio - ADAPT.step);
        renderer.setPixelRatio(ratio);
        resize();
      } else if (sun.castShadow) sun.castShadow = false; // last resort: no shadows
    } else if (avg < ADAPT.fast && (ratio < maxRatio - 0.01 || (!fullTrees && treeDrops < 2))) {
      // Only step back up after a couple of fast windows in a row, so it doesn't flicker between sizes.
      // Resolution comes back first, the full trees last (and they need a longer run of fast frames).
      if (++fastWindows >= (ratio < maxRatio - 0.01 ? 2 : 4)) {
        fastWindows = 0;
        if (ratio < maxRatio - 0.01) {
          ratio = Math.min(maxRatio, ratio + ADAPT.step * 0.66);
          renderer.setPixelRatio(ratio);
          resize();
        } else {
          fullTrees = true;
          world.setTreeDetail(true);
        }
      }
    } else fastWindows = 0;
  }
  // Thin out whatever stands between the camera and the dinosaur.
  const seeThrough = createSeeThrough(scene, camera, renderer);
  const seeHead = new THREE.Vector3();
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const raw = now - last;
    // A frame's timestamp can be a little earlier than the start time; a negative step would run every countdown backwards.
    const dt = THREE.MathUtils.clamp(raw / 1000, 0, 0.05);
    last = now;
    update(dt);
    if (player) player.head.getWorldPosition(seeHead);
    seeThrough.update(dt, !!player && intro < 0 && !picking, player ? player.root.position : camAt, seeHead, player ? player.radius : 1);
    renderer.render(scene, camera);
    // Measured over about a second of real time (frames longer than a second are pauses, not slowness).
    if (raw > 0 && raw < 1000) {
      frames++;
      frameMs += raw;
      if (frameMs >= ADAPT.window) {
        const avg = frameMs / frames;
        if (!fpsEl.hidden) fpsEl.textContent = `${Math.round(1000 / avg)} fps · ${ratio.toFixed(2)}×${sun.castShadow ? '' : ' · no shadows'}${fullTrees ? '' : ' · simple trees'} · ${renderer.info.render.calls} calls`;
        if (intro < 0 && !paused) adapt(avg);
        frames = 0;
        frameMs = 0;
      }
    }
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
  setPlayer(heroSpec);
  if (!level || level.start === 'free') startOutside();
  else if (Array.isArray(level.start)) startOutside(level.start);
  introEl.hidden = intro < 0;
  hud.classList.toggle('in-intro', intro >= 0);
  checkpoint.copy(player!.root.position);
  spawnTargets();
  renderGoals();
  if (choices.length > 1) showPicker();
  if (level) timers.push(window.setTimeout(() => alive && radio(level.radio.start), 900));
  raf = requestAnimationFrame(frame);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('pointerlockchange', onLockChange);
    unlockPointer();
    closeSettings();
    clearTimeout(radioTimer);
    clearTimeout(toastTimer);
    ro.disconnect();
    weather.dispose();
    music.stop();
    hum.stop();
    humNoise.stop();
    surf.stop();
    town.dispose();
    station.dispose();
    docks.dispose();
    fences?.dispose();
    security?.dispose();
    world.dispose();
    extra.forEach((x) => x.dispose());
    disposeDinoAssets();
    disposePark();
    disposeMerged();
    seeThrough.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    hud.remove();
  };
}

/** The freed-dinosaur radio line in one language, using that language's species name. */
function M_freed(lang: 'en' | 'da', d: DinoSpec) {
  return STRINGS[lang].freed(d.name[lang]);
}
