import * as THREE from 'three';

/**
 * Camera-facing ribbon trail. Points are pushed every frame; the ribbon fades and tapers toward
 * the tail. Colour is set per shot type.
 */
export class Trail {
  readonly mesh: THREE.Mesh;
  private points: THREE.Vector3[] = [];
  private maxPoints: number;
  private positions: Float32Array;
  private colors: Float32Array;
  private geometry: THREE.BufferGeometry;
  private color = new THREE.Color(0xffffff);
  width = 0.11;
  /** 0..1 overall intensity (hidden when 0). */
  intensity = 0;
  private tmpSide = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private tmpView = new THREE.Vector3();

  constructor(maxPoints: number) {
    this.maxPoints = maxPoints;
    this.positions = new Float32Array(maxPoints * 2 * 3);
    this.colors = new Float32Array(maxPoints * 2 * 4);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    const idx: number[] = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    for (let i = 0; i < maxPoints; i++) this.points.push(new THREE.Vector3());
    this.clear();
  }

  setColor(hex: number): void {
    this.color.set(hex);
  }

  clear(): void {
    this.intensity = 0;
    this.geometry.setDrawRange(0, 0);
  }

  /** Reset every point to a position (so a fresh hit does not draw a streak from the old spot). */
  reset(p: THREE.Vector3): void {
    for (const pt of this.points) pt.copy(p);
  }

  push(p: THREE.Vector3): void {
    const last = this.points.pop()!;
    last.copy(p);
    this.points.unshift(last);
  }

  update(camera: THREE.Camera): void {
    if (this.intensity <= 0.01) {
      this.geometry.setDrawRange(0, 0);
      return;
    }
    const n = this.maxPoints;
    const camPos = camera.position;
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const next = this.points[Math.min(i + 1, n - 1)];
      const prev = this.points[Math.max(i - 1, 0)];
      this.tmpDir.subVectors(next, prev);
      if (this.tmpDir.lengthSq() < 1e-8) this.tmpDir.set(0, 0, 1);
      this.tmpView.subVectors(camPos, p);
      this.tmpSide.crossVectors(this.tmpDir, this.tmpView).normalize();
      const f = 1 - i / (n - 1);
      const w = this.width * f * this.intensity;
      const o = i * 6;
      this.positions[o] = p.x + this.tmpSide.x * w;
      this.positions[o + 1] = p.y + this.tmpSide.y * w;
      this.positions[o + 2] = p.z + this.tmpSide.z * w;
      this.positions[o + 3] = p.x - this.tmpSide.x * w;
      this.positions[o + 4] = p.y - this.tmpSide.y * w;
      this.positions[o + 5] = p.z - this.tmpSide.z * w;
      const c = i * 8;
      const a = f * f * this.intensity;
      for (let k = 0; k < 2; k++) {
        this.colors[c + k * 4] = this.color.r;
        this.colors[c + k * 4 + 1] = this.color.g;
        this.colors[c + k * 4 + 2] = this.color.b;
        this.colors[c + k * 4 + 3] = a;
      }
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, (n - 1) * 6);
  }
}
