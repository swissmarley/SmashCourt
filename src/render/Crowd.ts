import * as THREE from 'three';
import { COURT } from '../config/constants';

/**
 * Animated crowd: instanced billboard "people" on the stands. Excitement scales the bobbing and
 * triggers waves of arms-up jumps.
 */
export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  private count: number;
  private base: THREE.Vector3[] = [];
  private phase: Float32Array;
  private dummy = new THREE.Object3D();
  private time = 0;
  /** 0..1 excitement level, decays over time. */
  excitement = 0.1;
  private cheerPulse = 0;

  constructor(accent: number, standsColor: number, tiers: number) {
    const positions: THREE.Vector3[] = [];
    const inset = 1.5;
    const w = COURT.doublesWidth + 2 * COURT.runoutWidth + inset * 2;
    const l = COURT.length + 2 * COURT.runbackDepth + inset * 2;
    const depth = 3.2;
    const tierHeight = 2.2;
    for (let t = 0; t < Math.max(1, tiers); t++) {
      const y = tierHeight * (t + 1) + 0.45;
      const off = depth * t;
      const spacing = 1.15;
      // long sides
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 + depth / 2 + off);
        for (let z = -l / 2 - off + 1; z < l / 2 + off - 1; z += spacing) {
          if (Math.random() < 0.15) continue;
          positions.push(new THREE.Vector3(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.3));
        }
      }
      for (const sz of [-1, 1]) {
        const z = sz * (l / 2 + depth / 2 + off);
        for (let x = -w / 2 - off + 1; x < w / 2 + off - 1; x += spacing) {
          if (Math.random() < 0.15) continue;
          positions.push(new THREE.Vector3(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.6));
        }
      }
    }
    this.count = positions.length;
    this.base = positions;
    this.phase = new Float32Array(this.count);
    const tex = Crowd.makeTexture(accent);
    const geo = new THREE.PlaneGeometry(0.8, 1.3);
    geo.translate(0, 0.65, 0);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.Color();
    const palette = [0xff5b5b, 0x5bb5ff, 0xffd95b, 0x7dff8a, 0xff9ddb, 0xffffff, 0xffa65b, standsColor ^ 0x4040a0];
    for (let i = 0; i < this.count; i++) {
      this.phase[i] = Math.random() * Math.PI * 2;
      this.mesh.setColorAt(i, color.set(palette[i % palette.length]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.frustumCulled = false;
    this.update(0, new THREE.Vector3(0, 10, 30));
  }

  private static makeTexture(accent: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 104;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 104);
    // body (white; tinted per instance)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(14, 40, 36, 52, 10);
    ctx.fill();
    // head
    ctx.fillStyle = '#f6d3b3';
    ctx.beginPath();
    ctx.arc(32, 24, 16, 0, Math.PI * 2);
    ctx.fill();
    // arms up (accent)
    ctx.strokeStyle = '#' + accent.toString(16).padStart(6, '0');
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(16, 48);
    ctx.lineTo(4, 14);
    ctx.moveTo(48, 48);
    ctx.lineTo(60, 14);
    ctx.stroke();
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.LinearFilter;
    return t;
  }

  /** Burst of excitement (0..1). */
  cheer(amount: number): void {
    this.excitement = Math.min(1, this.excitement + amount);
    this.cheerPulse = 1;
  }

  update(dt: number, cameraPos: THREE.Vector3): void {
    this.time += dt;
    this.excitement = Math.max(0.1, this.excitement - dt * 0.25);
    this.cheerPulse = Math.max(0, this.cheerPulse - dt * 1.2);
    const ex = this.excitement;
    for (let i = 0; i < this.count; i++) {
      const b = this.base[i];
      const ph = this.phase[i];
      const bob = Math.max(0, Math.sin(this.time * (3 + ex * 5) + ph)) * (0.05 + ex * 0.35);
      const wave = this.cheerPulse > 0 ? Math.max(0, Math.sin(this.time * 6 + b.x * 0.3 + b.z * 0.3)) * this.cheerPulse * 0.5 : 0;
      this.dummy.position.set(b.x, b.y + bob + wave, b.z);
      // Face the camera around Y.
      this.dummy.rotation.set(0, Math.atan2(cameraPos.x - b.x, cameraPos.z - b.z), 0);
      const s = 0.9 + (ph % 0.3);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
