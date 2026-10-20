import * as THREE from 'three';
import { COURT } from '../config/constants';

const VARIANTS = 8; // atlas columns: 0-3 seated poses, 4-7 standing/cheering poses

/**
 * Animated crowd: one InstancedMesh of billboard spectators drawn from a procedural sprite atlas.
 * Each spectator has a seated sprite and a cheering sprite; a per-instance attribute selects the
 * atlas column, and excitement flips people from seated to standing in waves.
 */
export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  private count: number;
  private base: THREE.Vector3[] = [];
  private phase: Float32Array;
  private threshold: Float32Array;
  private seatedVariant: Float32Array;
  private cheerVariant: Float32Array;
  private variantAttr: THREE.InstancedBufferAttribute;
  private standing: Uint8Array;
  private dummy = new THREE.Object3D();
  private time = 0;
  /** 0..1 excitement level, decays over time. */
  excitement = 0.1;
  private cheerPulse = 0;

  constructor(accent: number, standsColor: number, tiers: number, tierHeight = 2.2) {
    const positions: THREE.Vector3[] = [];
    const inset = 1.5;
    const w = COURT.doublesWidth + 2 * COURT.runoutWidth + inset * 2;
    const l = COURT.length + 2 * COURT.runbackDepth + inset * 2;
    const depth = 3.2;
    for (let t = 0; t < Math.max(1, tiers); t++) {
      const y = tierHeight * (t + 1) + 0.02;
      const off = depth * t;
      const spacing = 0.95;
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 + depth / 2 + off);
        for (let z = -l / 2 - off + 1; z < l / 2 + off - 1; z += spacing) {
          if (Math.random() < 0.12) continue;
          positions.push(new THREE.Vector3(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.25));
        }
      }
      for (const sz of [-1, 1]) {
        const z = sz * (l / 2 + depth / 2 + off);
        for (let x = -w / 2 - off + 1; x < w / 2 + off - 1; x += spacing) {
          if (Math.random() < 0.12) continue;
          positions.push(new THREE.Vector3(x + (Math.random() - 0.5) * 0.25, y, z + (Math.random() - 0.5) * 0.5));
        }
      }
    }
    this.count = positions.length;
    this.base = positions;
    this.phase = new Float32Array(this.count);
    this.threshold = new Float32Array(this.count);
    this.seatedVariant = new Float32Array(this.count);
    this.cheerVariant = new Float32Array(this.count);
    this.standing = new Uint8Array(this.count);
    const tex = Crowd.makeAtlas(accent);
    const geo = new THREE.PlaneGeometry(0.9, 1.8);
    geo.translate(0, 0.9, 0);
    const variants = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.phase[i] = Math.random() * Math.PI * 2;
      this.threshold[i] = 0.35 + Math.random() * 0.5;
      this.seatedVariant[i] = Math.floor(Math.random() * 4);
      this.cheerVariant[i] = 4 + Math.floor(Math.random() * 4);
      variants[i] = this.seatedVariant[i];
    }
    this.variantAttr = new THREE.InstancedBufferAttribute(variants, 1);
    this.variantAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('variant', this.variantAttr);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.45, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float variant;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vec2((uv.x + variant) / ${VARIANTS.toFixed(1)}, uv.y);`);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.Color();
    // Tints applied on top of the (mostly white-shirt) sprites for variety.
    const palette = [0xffffff, 0xff6b6b, 0x5bb5ff, 0xffd95b, 0x8dff9a, 0xff9ddb, 0xffa65b, 0xc9b0ff, 0xffffff, 0xd0f0ff, (standsColor ^ 0x6060a0) & 0xffffff];
    for (let i = 0; i < this.count; i++) this.mesh.setColorAt(i, color.set(palette[(i * 7) % palette.length]));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.frustumCulled = false;
    this.update(0, new THREE.Vector3(0, 10, 30));
  }

  /**
   * Draw the sprite atlas: 8 columns of simple but human-looking spectators (head with hair, neck,
   * shirt, arms, legs). Columns 0-3 are seated, 4-7 are standing with arms raised.
   */
  private static makeAtlas(accent: number): THREE.CanvasTexture {
    const W = 128;
    const H = 256;
    const c = document.createElement('canvas');
    c.width = W * VARIANTS;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, H);
    const skins = ['#f6d3b3', '#d9a27a', '#8d5a3b', '#f1c6a0', '#5c3a21', '#e8b48f'];
    const hairs = ['#2b1b12', '#6b3b1f', '#e0b36a', '#1a1a1a', '#b5462c', '#9a9a9a'];
    const pants = ['#2b3a67', '#3d3d3d', '#6b4a2b', '#1f4d3a'];
    const accentCss = '#' + accent.toString(16).padStart(6, '0');
    const rr = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
    };
    for (let v = 0; v < VARIANTS; v++) {
      const ox = v * W;
      const standing = v >= 4;
      const skin = skins[v % skins.length];
      const hair = hairs[(v * 3) % hairs.length];
      const pant = pants[v % pants.length];
      const cx = ox + W / 2;
      ctx.lineCap = 'round';
      if (standing) {
        // Legs
        ctx.fillStyle = pant;
        rr(cx - 22, 150, 18, 90, 8);
        rr(cx + 4, 150, 18, 90, 8);
        // Shoes
        ctx.fillStyle = '#222';
        rr(cx - 26, 232, 24, 14, 6);
        rr(cx + 2, 232, 24, 14, 6);
        // Shirt (white, tinted per instance)
        ctx.fillStyle = '#ffffff';
        rr(cx - 30, 86, 60, 72, 14);
        // Arms up
        ctx.strokeStyle = skin;
        ctx.lineWidth = 13;
        ctx.beginPath();
        ctx.moveTo(cx - 26, 100);
        ctx.lineTo(cx - 44, 60);
        ctx.lineTo(cx - 36, 22);
        ctx.moveTo(cx + 26, 100);
        ctx.lineTo(cx + 44, 60);
        ctx.lineTo(cx + 36, 22);
        ctx.stroke();
        // Sleeves
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx - 28, 98, 11, 0, Math.PI * 2);
        ctx.arc(cx + 28, 98, 11, 0, Math.PI * 2);
        ctx.fill();
        // Neck + head
        ctx.fillStyle = skin;
        rr(cx - 7, 74, 14, 16, 4);
        ctx.beginPath();
        ctx.arc(cx, 54, 22, 0, Math.PI * 2);
        ctx.fill();
        // Hair
        ctx.fillStyle = hair;
        ctx.beginPath();
        ctx.arc(cx, 48, 23, Math.PI, Math.PI * 2);
        ctx.fill();
        if (v % 2 === 0) rr(cx - 23, 44, 46, 10, 4);
        // Face
        ctx.fillStyle = '#1b1a24';
        ctx.beginPath();
        ctx.arc(cx - 7, 56, 2.5, 0, Math.PI * 2);
        ctx.arc(cx + 7, 56, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7a3a3a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, 62, 7, 0.2, Math.PI - 0.2);
        ctx.stroke();
        // Accent scarf / flag for some
        if (v === 5 || v === 7) {
          ctx.fillStyle = accentCss;
          rr(cx - 30, 84, 60, 10, 4);
        }
      } else {
        // Seated: knees forward, body lower in the frame.
        ctx.fillStyle = pant;
        rr(cx - 30, 176, 60, 26, 10); // thighs
        rr(cx - 28, 196, 16, 44, 6); // shins
        rr(cx + 12, 196, 16, 44, 6);
        ctx.fillStyle = '#222';
        rr(cx - 32, 234, 24, 12, 5);
        rr(cx + 8, 234, 24, 12, 5);
        ctx.fillStyle = '#ffffff';
        rr(cx - 30, 112, 60, 70, 14); // torso
        // Arms: resting on lap or clapping
        ctx.strokeStyle = skin;
        ctx.lineWidth = 13;
        ctx.beginPath();
        if (v % 2 === 0) {
          ctx.moveTo(cx - 26, 126);
          ctx.lineTo(cx - 36, 160);
          ctx.lineTo(cx - 16, 182);
          ctx.moveTo(cx + 26, 126);
          ctx.lineTo(cx + 36, 160);
          ctx.lineTo(cx + 16, 182);
        } else {
          ctx.moveTo(cx - 26, 126);
          ctx.lineTo(cx - 36, 158);
          ctx.lineTo(cx - 10, 150);
          ctx.moveTo(cx + 26, 126);
          ctx.lineTo(cx + 36, 158);
          ctx.lineTo(cx + 10, 150);
        }
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx - 28, 124, 11, 0, Math.PI * 2);
        ctx.arc(cx + 28, 124, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = skin;
        rr(cx - 7, 100, 14, 16, 4);
        ctx.beginPath();
        ctx.arc(cx, 80, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hair;
        ctx.beginPath();
        ctx.arc(cx, 74, 23, Math.PI, Math.PI * 2);
        ctx.fill();
        if (v === 1 || v === 3) {
          // long hair
          rr(cx - 24, 72, 10, 36, 4);
          rr(cx + 14, 72, 10, 36, 4);
        }
        ctx.fillStyle = '#1b1a24';
        ctx.beginPath();
        ctx.arc(cx - 7, 82, 2.5, 0, Math.PI * 2);
        ctx.arc(cx + 7, 82, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7a3a3a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, 88, 6, 0.2, Math.PI - 0.2);
        ctx.stroke();
        if (v === 2) {
          // cap
          ctx.fillStyle = accentCss;
          ctx.beginPath();
          ctx.arc(cx, 72, 24, Math.PI, Math.PI * 2);
          ctx.fill();
          rr(cx - 26, 70, 52, 8, 3);
        }
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Burst of excitement (0..1). */
  cheer(amount: number): void {
    this.excitement = Math.min(1, this.excitement + amount);
    this.cheerPulse = 1;
  }

  update(dt: number, cameraPos: THREE.Vector3): void {
    this.time += dt;
    this.excitement = Math.max(0.1, this.excitement - dt * 0.22);
    this.cheerPulse = Math.max(0, this.cheerPulse - dt * 1.2);
    const ex = this.excitement;
    let variantsChanged = false;
    for (let i = 0; i < this.count; i++) {
      const b = this.base[i];
      const ph = this.phase[i];
      const shouldStand = ex > this.threshold[i];
      if (shouldStand !== (this.standing[i] === 1)) {
        this.standing[i] = shouldStand ? 1 : 0;
        this.variantAttr.setX(i, shouldStand ? this.cheerVariant[i] : this.seatedVariant[i]);
        variantsChanged = true;
      }
      const standing = this.standing[i] === 1;
      const bob = standing ? Math.max(0, Math.sin(this.time * (4 + ex * 5) + ph)) * (0.08 + ex * 0.3) : Math.sin(this.time * 1.5 + ph) * 0.012;
      const wave = this.cheerPulse > 0 ? Math.max(0, Math.sin(this.time * 6 + b.x * 0.3 + b.z * 0.3)) * this.cheerPulse * 0.35 : 0;
      this.dummy.position.set(b.x, b.y + bob + wave, b.z);
      this.dummy.rotation.set(0, Math.atan2(cameraPos.x - b.x, cameraPos.z - b.z), 0);
      const s = 0.92 + (ph % 0.25);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (variantsChanged) this.variantAttr.needsUpdate = true;
  }
}
