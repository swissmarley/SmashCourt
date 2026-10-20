import * as THREE from 'three';
import type { PowerElement } from '../config/characters';
import type { ParticleSystem } from './Particles';

/** Elemental palettes for the Power Shot visuals. */
export const ELEMENT_COLORS: Record<PowerElement, number[]> = {
  fire: [0xff3b1f, 0xff8a00, 0xffd23f, 0xfff0a0],
  ice: [0x9be7ff, 0x58c6ff, 0xffffff, 0xc7f3ff],
  lightning: [0xfff27a, 0xffffff, 0x8ad7ff, 0xffe12e],
  wind: [0xd8ffe8, 0x9dffd0, 0xffffff, 0x6ee7b7],
  rainbow: [0xff5e5e, 0xffb75e, 0xfff65e, 0x6eff8a, 0x6ec8ff, 0xb46eff],
  shadow: [0x6b2cff, 0x3cff9e, 0x1a0b2a, 0xb59cff],
  bloom: [0xffb3d9, 0xff6fb0, 0xa6ff8a, 0xffffff],
  quake: [0xb3341e, 0xff9d2e, 0x6b4a2b, 0xffd8a0],
};

/**
 * Chance zone: a glowing star on the ground coloured by the shot button that gives the bonus.
 */
export class ChanceStar {
  readonly group = new THREE.Group();
  private mat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private t = 0;

  constructor() {
    const shape = new THREE.Shape();
    const pts = 5;
    for (let i = 0; i < pts * 2; i++) {
      const r = i % 2 === 0 ? 0.55 : 0.24;
      const a = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    const star = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.mat);
    star.rotation.x = -Math.PI / 2;
    star.position.y = 0.015;
    this.group.add(star);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.9, 40), this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.013;
    this.group.add(ring);
    this.group.visible = false;
    this.group.renderOrder = 4;
  }

  show(x: number, z: number, color: number): void {
    this.group.visible = true;
    this.group.position.set(x, 0, z);
    this.mat.color.set(color);
    this.ringMat.color.set(color);
    this.t = 0;
  }

  hide(): void {
    this.group.visible = false;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    this.group.rotation.y = this.t * 1.5;
    const s = 1 + Math.sin(this.t * 6) * 0.1;
    this.group.scale.set(s, 1, s);
    this.mat.opacity = 0.7 + Math.sin(this.t * 8) * 0.2;
  }
}

/**
 * Elemental Power Shot visuals: an aura that follows the ball plus particle bursts emitted from the
 * ball every frame while the shot is in flight. Each element has a distinct look.
 */
export class PowerAura {
  readonly group = new THREE.Group();
  private element: PowerElement = 'fire';
  private active = false;
  private core: THREE.Mesh;
  private ring: THREE.Mesh;
  private coreMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private t = 0;
  private emitAccum = 0;

  constructor(private particles: ParticleSystem) {
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), this.coreMat);
    this.group.add(this.core);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.025, 6, 24), this.ringMat);
    this.group.add(this.ring);
    this.group.visible = false;
  }

  start(element: PowerElement): void {
    this.element = element;
    this.active = true;
    this.group.visible = true;
    this.t = 0;
    const cols = ELEMENT_COLORS[element];
    this.coreMat.color.set(cols[0]);
    this.ringMat.color.set(cols[1]);
  }

  stop(): void {
    this.active = false;
    this.group.visible = false;
  }

  update(dt: number, ballPos: THREE.Vector3, ballVel: THREE.Vector3): void {
    if (!this.active) return;
    this.t += dt;
    this.group.position.copy(ballPos);
    const cols = ELEMENT_COLORS[this.element];
    const dir = ballVel.clone().normalize();
    this.ring.lookAt(ballPos.clone().add(dir));
    const pulse = 1 + Math.sin(this.t * 30) * 0.15;
    this.core.scale.setScalar(pulse);
    this.ring.scale.setScalar(pulse * (this.element === 'wind' ? 1.6 : 1));
    this.emitAccum += dt;
    const back = dir.clone().multiplyScalar(-1);
    while (this.emitAccum > 0.016) {
      this.emitAccum -= 0.016;
      switch (this.element) {
        case 'fire':
          this.particles.emit({ pos: ballPos, count: 3, color: cols, speed: 2.5, dir: back, spread: 0.6, life: 0.4, size: 0.12, gravity: -4, drag: 2 });
          break;
        case 'ice':
          this.particles.emit({ pos: ballPos, count: 2, color: cols, speed: 1.2, dir: back, spread: 1.2, life: 0.8, size: 0.07, gravity: 3, drag: 1 });
          break;
        case 'lightning':
          this.particles.emit({ pos: ballPos, count: 2, color: cols, speed: 6, dir: new THREE.Vector3(0, 0, 0), spread: 1, life: 0.12, size: 0.09, gravity: 0, drag: 0 });
          break;
        case 'wind':
          this.particles.emit({ pos: ballPos, count: 2, color: cols, speed: 2, dir: back, spread: 2, life: 0.5, size: 0.05, gravity: 0, drag: 0.5 });
          break;
        case 'rainbow':
          this.particles.emit({ pos: ballPos, count: 3, color: cols, speed: 1.5, dir: back, spread: 0.8, life: 0.7, size: 0.08, gravity: 2, drag: 1 });
          break;
        case 'shadow':
          this.particles.emit({ pos: ballPos, count: 3, color: cols, speed: 1.0, dir: back, spread: 1, life: 0.6, size: 0.14, gravity: -1, drag: 2 });
          break;
        case 'bloom':
          this.particles.emit({ pos: ballPos, count: 2, color: cols, speed: 1.4, dir: back, spread: 1.5, life: 1.0, size: 0.08, gravity: 1.5, drag: 1.5 });
          break;
        case 'quake':
          this.particles.emit({ pos: ballPos, count: 2, color: cols, speed: 2.5, dir: back, spread: 0.5, life: 0.5, size: 0.13, gravity: 8, drag: 1 });
          break;
      }
    }
  }
}

/** One-shot bursts shared by the match. */
export function burstImpact(ps: ParticleSystem, pos: THREE.Vector3, color: number, count = 14, speed = 4): void {
  ps.emit({ pos, count, color: [color, 0xffffff], speed, spread: 1, life: 0.35, size: 0.07, gravity: 6, drag: 2 });
}

export function burstDust(ps: ParticleSystem, pos: THREE.Vector3, color: number, strength = 1): void {
  ps.emit({
    pos,
    count: Math.round(8 * strength),
    color: [color, 0xffffff],
    speed: 1.6 * strength,
    dir: new THREE.Vector3(0, 1, 0),
    spread: 1.2,
    life: 0.5,
    size: 0.09,
    gravity: 2,
    drag: 2.5,
  });
}

export function burstConfetti(ps: ParticleSystem, pos: THREE.Vector3, count = 80): void {
  ps.emit({
    pos,
    count,
    color: [0xff5e5e, 0xffb75e, 0xfff65e, 0x6eff8a, 0x6ec8ff, 0xb46eff, 0xffffff],
    speed: 7,
    dir: new THREE.Vector3(0, 1, 0),
    spread: 0.9,
    life: 2.6,
    size: 0.12,
    gravity: 2.5,
    drag: 1.2,
    sizeJitter: 0.4,
  });
}

export function burstPowerStart(ps: ParticleSystem, pos: THREE.Vector3, element: PowerElement): void {
  const cols = ELEMENT_COLORS[element];
  ps.emit({ pos, count: 60, color: cols, speed: 6, spread: 1, life: 0.7, size: 0.12, gravity: 1, drag: 1.5 });
}
