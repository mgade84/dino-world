import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Cuts draw calls by baking static parts together. Every mesh under `root` that doesn't move on its
 * own is merged into its nearest "anchor": the root, a node in `moving` (joints the animation turns),
 * or any Bone. Parts with a plain coloured material (no texture, not transparent, not glowing) have
 * their colour baked into the vertices, so all of an anchor's plain parts become one mesh with one
 * shared material. Textured or special parts are merged per material.
 *
 * Left alone: skinned meshes, meshes marked `userData.keep` (e.g. lamps whose material is swapped
 * later), and anything that isn't a Mesh. Materials marked `userData.dynamic` (their colour changes
 * later) are merged per material instead of being baked into vertex colours.
 */

type Plain = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

/** Shared vertex-coloured materials, one per kind of surface; freed by disposeMerged(). */
const painted = new Map<string, THREE.Material>();

function plainKey(m: THREE.Material): string | null {
  const p = m as Plain;
  if (!(p.isMeshStandardMaterial || p.isMeshLambertMaterial) || p.userData.dynamic) return null;
  if (p.map || p.bumpMap || p.transparent || p.side !== THREE.FrontSide || p.vertexColors) return null;
  if (p.emissive && p.emissive.getHex() !== 0 && p.emissiveIntensity > 0) return null;
  if ((p as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    const s = p as THREE.MeshStandardMaterial;
    return `std/${Math.round(s.roughness * 5)}/${Math.round(s.metalness * 2)}/${s.flatShading}`;
  }
  return `lam/${p.flatShading}`;
}

function paintedMaterial(key: string, like: Plain) {
  let m = painted.get(key);
  if (!m) {
    if ((like as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      const s = like as THREE.MeshStandardMaterial;
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: Math.round(s.roughness * 5) / 5, metalness: Math.round(s.metalness * 2) / 2, flatShading: s.flatShading });
    } else m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: like.flatShading });
    painted.set(key, m);
  }
  return m;
}

export function bake(root: THREE.Object3D, moving: Iterable<THREE.Object3D> = [], owned?: { dispose(): void }[]) {
  const anchors = new Set<THREE.Object3D>([root, ...moving]);
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) anchors.add(o);
  });
  root.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  for (const anchor of anchors) {
    // Batches by material (or by kind of plain surface, for vertex-coloured merging).
    const batches = new Map<THREE.Material | string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; shadow: boolean; painted: boolean }>();
    const inv = anchor.matrixWorld.clone().invert();
    const visit = (node: THREE.Object3D) => {
      for (const child of node.children) {
        if (anchors.has(child)) continue;
        const mesh = child as THREE.Mesh;
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) continue;
        if (mesh.isMesh && !mesh.userData.keep && !Array.isArray(mesh.material) && mesh.visible) {
          const geo = mesh.geometry.clone();
          geo.applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
          // Mirrored parts (negative scale) would come out inside-out.
          if (m.determinant() < 0) flipWinding(geo);
          const pk = plainKey(mesh.material);
          if (pk) {
            col.copy((mesh.material as Plain).color);
            const n = geo.attributes.position.count;
            const c = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
            geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
          }
          const key = pk ?? mesh.material;
          const batch = batches.get(key) ?? { mat: pk ? paintedMaterial(pk, mesh.material as Plain) : mesh.material, geos: [], meshes: [], shadow: false, painted: !!pk };
          batch.geos.push(geo);
          batch.meshes.push(mesh);
          batch.shadow ||= mesh.castShadow;
          batches.set(key, batch);
        }
        visit(child);
      }
    };
    visit(anchor);
    for (const batch of batches.values()) {
      // A lone unpainted mesh gains nothing from merging: leave it where it is.
      if (batch.geos.length < 2 && !batch.painted) {
        batch.geos.forEach((g) => g.dispose());
        continue;
      }
      const merged = mergeGeometries(batch.geos.map((g) => normalise(g, batch.painted)), false);
      batch.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      owned?.push(merged);
      const mesh = new THREE.Mesh(merged, batch.mat);
      mesh.castShadow = batch.shadow;
      mesh.receiveShadow = true;
      anchor.add(mesh);
      for (const original of batch.meshes) original.parent?.remove(original);
    }
  }
}

/** Frees the shared vertex-coloured materials (at the end of a level). */
export function disposeMerged() {
  painted.forEach((m) => m.dispose());
  painted.clear();
}

/** mergeGeometries needs matching attributes: position/normal/uv (+ colour when painted), all indexed. */
function normalise(g: THREE.BufferGeometry, painted: boolean) {
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(painted && name === 'color')) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
  g.clearGroups();
  return g;
}

function flipWinding(g: THREE.BufferGeometry) {
  const idx = g.index;
  if (!idx) return;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
}
