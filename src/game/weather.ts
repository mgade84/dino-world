import * as THREE from 'three';
import { noiseLoop, sfx } from '../engine/audio';

/** Storm colours: the sky overhead, at the horizon (and the fog that matches it). */
export const STORM = { zenith: '#1c2529', horizon: '#56636a' };

export interface Weather {
  /** Moves the rain with the camera, fades lightning, and now and then strikes. */
  update(dt: number, camera: THREE.Camera): void;
  /** 0..1 while a lightning flash is lit, for the scene lights to add. */
  readonly flash: number;
  dispose(): void;
}

const RAIN = { drops: 2600, box: 46, height: 34, speed: 30, len: 0.9, wind: 0.22 };

/**
 * A storm: a gradient sky dome that follows the camera, streaks of rain falling through a box around the
 * camera (moved entirely on the GPU), lightning flashes with thunder after them, and the hiss of rain.
 */
export function createWeather(scene: THREE.Scene, density = 1): Weather {
  const DROPS = Math.round(RAIN.drops * density);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // ---- Sky ----
  const skyUniforms = {
    zenith: { value: new THREE.Color(STORM.zenith) },
    horizon: { value: new THREE.Color(STORM.horizon) },
    flash: { value: 0 },
  };
  const sky = new THREE.Mesh(
    keep(new THREE.SphereGeometry(125, 24, 12)), // inside the camera's far plane (game.ts)
    keep(new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 zenith; uniform vec3 horizon; uniform float flash; varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          // Lumpy cloud banks: cheap bands of light and dark across the sky.
          float clouds = sin(vDir.x * 9.0 + sin(vDir.z * 7.0) * 2.0) * sin(vDir.z * 8.0 + vDir.x * 3.0) * 0.5 + 0.5;
          vec3 c = mix(horizon, zenith, pow(h, 0.55));
          c *= 0.85 + clouds * 0.25 * smoothstep(0.05, 0.4, h);
          c += vec3(0.75, 0.82, 0.95) * flash * (0.5 + 0.5 * h);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    })),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  // ---- Rain: each drop is a short line; the shader wraps it round a box that follows the camera ----
  const pos = new Float32Array(DROPS * 2 * 3);
  const end = new Float32Array(DROPS * 2);
  for (let i = 0; i < DROPS; i++) {
    const x = (Math.random() - 0.5) * RAIN.box;
    const y = Math.random() * RAIN.height;
    const z = (Math.random() - 0.5) * RAIN.box;
    for (let k = 0; k < 2; k++) {
      pos.set([x, y, z], (i * 2 + k) * 3);
      end[i * 2 + k] = k;
    }
  }
  const rainGeo = keep(new THREE.BufferGeometry());
  rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const rainUniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uFlash: { value: 0 } };
  const rain = new THREE.LineSegments(
    rainGeo,
    keep(new THREE.ShaderMaterial({
      uniforms: rainUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aEnd; uniform float uTime; uniform vec3 uCam; varying float vA;
        const float BOX = ${RAIN.box.toFixed(1)}; const float H = ${RAIN.height.toFixed(1)};
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * ${RAIN.speed.toFixed(1)}, H) - H * 0.35 + uCam.y;
          p.x += ${RAIN.wind.toFixed(2)} * (p.y - uCam.y);
          p.xz = mod(p.xz - uCam.xz + BOX * 0.5, BOX) - BOX * 0.5 + uCam.xz;
          p += vec3(${(RAIN.wind * RAIN.len).toFixed(3)}, ${RAIN.len.toFixed(2)}, 0.0) * aEnd;
          vA = mix(0.0, 1.0, aEnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float uFlash; varying float vA;
        void main() { gl_FragColor = vec4(vec3(0.72, 0.78, 0.84) + uFlash * 0.3, 0.28 * vA + 0.05); }`,
    })),
  );
  rain.frustumCulled = false;
  scene.add(rain);

  // ---- Lightning and thunder ----
  let flash = 0;
  let flashT = -1;
  let nextStrike = 4 + Math.random() * 6;
  const thunder: number[] = [];
  const rainSound = noiseLoop('lowpass', 1400, 0.6);
  rainSound.set(0.07);

  let time = 0;
  return {
    get flash() {
      return flash;
    },
    update(dt, camera) {
      time += dt;
      sky.position.copy(camera.position);
      rainUniforms.uTime.value = time;
      rainUniforms.uCam.value.copy(camera.position);
      nextStrike -= dt;
      if (nextStrike <= 0) {
        nextStrike = 9 + Math.random() * 14;
        flashT = 0;
        // Thunder follows the flash; a near strike is quicker and louder.
        thunder.push(window.setTimeout(() => sfx.thunder(), 400 + Math.random() * 1800));
      }
      if (flashT >= 0) {
        flashT += dt;
        // Two quick flickers, then darkness.
        flash = flashT < 0.08 ? 1 : flashT < 0.16 ? 0.15 : flashT < 0.26 ? 0.75 : Math.max(0, 0.75 - (flashT - 0.26) * 3);
        if (flash <= 0 && flashT > 0.5) flashT = -1;
      }
      skyUniforms.flash.value = flash;
      rainUniforms.uFlash.value = flash;
    },
    dispose() {
      thunder.forEach(clearTimeout);
      rainSound.stop();
      scene.remove(sky, rain);
      disposables.forEach((d) => d.dispose());
    },
  };
}
