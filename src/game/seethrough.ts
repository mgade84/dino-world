import * as THREE from 'three';

/**
 * See-through occluders: whatever stands between the camera and the dinosaur (a building, a tree,
 * cage bars, a rock) is thinned out to about a third, so the dinosaur never disappears behind it.
 *
 * It is done in the shaders, not by swapping materials: every mesh material in the scene gets a few
 * lines that discard a dither pattern of its pixels when they are inside a circle around the dinosaur
 * on screen, nearer the camera than it is, and above its feet. Opaque materials stay opaque (no
 * sorting, no extra draw calls, shared and instanced materials just work), and the dither reads as
 * transparency. Anything very close to the camera thins out too, so the camera can sit in a tree.
 *
 * Objects marked `userData.noFade` (and everything under them) are left alone: the dinosaurs, the
 * ground, water and roads, and their materials wherever else they're used, except bake()'s shared
 * vertex-colour materials (`userData.shared`, used by nearly every model): those objects get private
 * copies of them instead, so the shared originals still fade everywhere else.
 */

/** How much of an occluder's pixels disappear at full strength (0.7 leaves it about 30% there). */
const THIN = 0.7;

const uniforms = {
  /** The dinosaur's chest on screen, in drawing-buffer pixels. */
  uSeeCenter: { value: new THREE.Vector2() },
  /** Radius of the cleared circle, in drawing-buffer pixels. */
  uSeeRadius: { value: 1 },
  /** View-space distance to the dinosaur's chest, less a margin for its own body. */
  uSeeDepth: { value: 0 },
  /** World height of the dinosaur's feet: floors and roads at or below them are never thinned. */
  uSeeFloor: { value: 0 },
  /** 0 (off) to 1 (on); eased so it fades in after the opening shot. */
  uSeeAmount: { value: 0 },
};

const VERTEX_HEAD = 'varying float vSeeDepth;\nvarying float vSeeY;\n';
const VERTEX_BODY = `
  vSeeDepth = -mvPosition.z;
  {
    vec4 seeW = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      seeW = instanceMatrix * seeW;
    #endif
    vSeeY = (modelMatrix * seeW).y;
  }
`;
const FRAGMENT_HEAD = `
varying float vSeeDepth;
varying float vSeeY;
uniform vec2 uSeeCenter;
uniform float uSeeRadius;
uniform float uSeeDepth;
uniform float uSeeFloor;
uniform float uSeeAmount;
`;
const FRAGMENT_BODY = `
  if (uSeeAmount > 0.0) {
    float seeD = length(gl_FragCoord.xy - uSeeCenter) / uSeeRadius;
    float seeIn = (1.0 - smoothstep(0.55, 1.0, seeD))
      * (1.0 - smoothstep(uSeeDepth - 2.0, uSeeDepth, vSeeDepth))
      * smoothstep(uSeeFloor + 0.3, uSeeFloor + 0.9, vSeeY);
    seeIn = max(seeIn, 1.0 - smoothstep(1.5, 4.0, vSeeDepth));
    // Interleaved gradient noise: a fine, even dither that doesn't crawl.
    float seeN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (seeN < seeIn * uSeeAmount * ${THIN.toFixed(2)}) discard;
  }
`;

function patch(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>' + VERTEX_BODY);
  shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + FRAGMENT_BODY);
}

type Patchable = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshPhongMaterial | THREE.MeshBasicMaterial;
const isPatchable = (m: THREE.Material): m is Patchable =>
  (m as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
  (m as THREE.MeshLambertMaterial).isMeshLambertMaterial ||
  (m as THREE.MeshPhongMaterial).isMeshPhongMaterial ||
  (m as THREE.MeshBasicMaterial).isMeshBasicMaterial;

export interface SeeThrough {
  /** Aim the cleared circle at a dinosaur standing at `feet` with its head at `head`, `radius` wide. */
  update(dt: number, on: boolean, feet: THREE.Vector3, head: THREE.Vector3, radius: number): void;
  dispose(): void;
}

export function createSeeThrough(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): SeeThrough {
  const patched = new Map<Patchable, Patchable['onBeforeCompile']>();
  /** Private copies of materials for objects that never fade, by the original they replace. */
  const privates = new Map<THREE.Material, THREE.Material>();
  const copies = new Set<THREE.Material>();
  /** Materials of objects that never fade (not shared ones: those get copies). */
  const blocked = new Set<THREE.Material>();
  /** The material's own onBeforeCompile, before any patch of ours. */
  const unpatched = (m: THREE.Material) => (patched.get(m as Patchable) ?? m.onBeforeCompile) as THREE.Material['onBeforeCompile'];
  function privateCopy(m: THREE.Material) {
    if (copies.has(m)) return m;
    // Only bake()'s shared materials need copying; others (like the pulsing arrow) are just left alone.
    if (!m.userData.shared) {
      blocked.add(m);
      return m;
    }
    let c = privates.get(m);
    if (!c) {
      c = m.clone();
      c.onBeforeCompile = unpatched(m);
      privates.set(m, c);
      copies.add(c);
    }
    return c;
  }
  const each = (o: THREE.Object3D, fn: (m: THREE.Material) => void) => {
    const mat = (o as THREE.Mesh).material;
    if (!mat || !(o as THREE.Mesh).isMesh) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) fn(m);
  };

  /** Patches every material not yet seen. Run now and every so often, for things added later. */
  function scan() {
    const fade: THREE.Object3D[] = [];
    const walk = (o: THREE.Object3D, off: boolean) => {
      const skip = off || !!o.userData.noFade;
      if (skip) {
        // Never thinned: swap to private copies (they keep the textures; only the shader differs).
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(privateCopy) : privateCopy(mesh.material);
        }
      } else fade.push(o);
      for (const c of o.children) walk(c, skip);
    };
    walk(scene, false);
    for (const o of fade) {
      each(o, (m) => {
        if (copies.has(m) || blocked.has(m) || !isPatchable(m) || patched.has(m)) return;
        patched.set(m, m.onBeforeCompile);
        const before = m.onBeforeCompile;
        m.onBeforeCompile = (shader, r) => {
          before.call(m, shader, r);
          patch(shader);
        };
        m.needsUpdate = true;
      });
    }
  }
  scan();
  let rescan = 1;

  const chest = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const side = new THREE.Vector3();
  const c = new THREE.Vector3();
  const size = new THREE.Vector2();
  /** Where a world point lands, in drawing-buffer pixels (origin bottom left, as gl_FragCoord). */
  const toPixels = (v: THREE.Vector3, out: THREE.Vector3) => {
    out.copy(v).project(camera);
    out.set((out.x * 0.5 + 0.5) * size.x, (out.y * 0.5 + 0.5) * size.y, 0);
    return out;
  };

  return {
    update(dt, on, feet, head, radius) {
      rescan -= dt;
      if (rescan <= 0) {
        rescan = 1;
        scan();
      }
      const u = uniforms;
      u.uSeeAmount.value += ((on ? 1 : 0) - u.uSeeAmount.value) * (1 - Math.exp(-dt * 6));
      if (u.uSeeAmount.value < 0.01 && !on) u.uSeeAmount.value = 0;
      chest.addVectors(feet, head).multiplyScalar(0.5);
      camera.updateMatrixWorld();
      a.copy(chest).applyMatrix4(camera.matrixWorldInverse);
      // The dinosaur's own body reaches toward the camera by about its radius; don't thin that.
      u.uSeeDepth.value = -a.z - radius;
      u.uSeeFloor.value = feet.y;
      renderer.getDrawingBufferSize(size);
      toPixels(chest, c);
      u.uSeeCenter.value.set(c.x, c.y);
      side.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(radius * 1.4).add(chest);
      const r = Math.max(
        toPixels(head, a).distanceTo(c),
        toPixels(feet, b).distanceTo(c),
        toPixels(side, a).distanceTo(c),
      );
      u.uSeeRadius.value = Math.max(60, r * 1.7);
    },
    dispose() {
      uniforms.uSeeAmount.value = 0;
      // Put the materials back as they were (shared ones outlive this level).
      for (const [m, before] of patched) {
        m.onBeforeCompile = before;
        m.needsUpdate = true;
      }
      patched.clear();
      // The private copies go with the level's objects (their textures belong to the originals).
      for (const c of copies) c.dispose();
      privates.clear();
      copies.clear();
      blocked.clear();
    },
  };
}
