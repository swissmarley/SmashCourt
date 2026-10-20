/**
 * Toon shading helpers: shared gradient map, material factory and inverted-hull outlines.
 */
import * as THREE from 'three';

let gradientMap: THREE.DataTexture | null = null;

/** 4-step gradient used by every MeshToonMaterial for a consistent cel look. */
export function getGradientMap(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const steps = [90, 150, 215, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  gradientMap = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

export function toonMaterial(color: number, opts: { emissive?: number; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: getGradientMap(),
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
  return m;
}

const outlineMaterials = new Map<string, THREE.ShaderMaterial>();

/** Outline material: pushes vertices along their normals in world units and paints a flat colour. */
export function outlineMaterial(width = 0.02, color = 0x14121c): THREE.ShaderMaterial {
  const key = `${width}-${color}`;
  let m = outlineMaterials.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    uniforms: { width: { value: width }, color: { value: new THREE.Color(color) } },
    vertexShader: `
      uniform float width;
      void main() {
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Scale the offset so outlines keep a consistent screen thickness-ish.
        mv.xyz += n * width;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      void main() { gl_FragColor = vec4(color, 1.0); }
    `,
    side: THREE.BackSide,
  });
  outlineMaterials.set(key, m);
  return m;
}

/** Add an inverted-hull outline child to a mesh. */
export function addOutline(mesh: THREE.Mesh, width = 0.02, color = 0x14121c): THREE.Mesh {
  const o = new THREE.Mesh(mesh.geometry, outlineMaterial(width, color));
  o.castShadow = false;
  o.receiveShadow = false;
  o.name = 'outline';
  mesh.add(o);
  return o;
}

/** Make a toon mesh with an outline in one call. */
export function toonMesh(geometry: THREE.BufferGeometry, color: number, outline = 0.02, castShadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, toonMaterial(color));
  mesh.castShadow = castShadow;
  mesh.receiveShadow = false;
  if (outline > 0) addOutline(mesh, outline);
  return mesh;
}

/** Convert a hex colour to a CSS string. */
export function hexToCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
