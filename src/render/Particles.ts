import * as THREE from 'three';

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
  spin: number;
  shape: number;
}

/**
 * Pooled particle system using a single InstancedMesh. Good for sparks, dust, confetti and the
 * Power Shot elemental effects without per-particle draw calls.
 */
export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(count = 600) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 0.1,
        color: new THREE.Color(),
        gravity: 0,
        drag: 0,
        spin: 0,
        shape: 0,
      });
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.set(0.001, 0.001, 0.001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.set(0xffffff));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private spawnOne(): Particle | null {
    for (const p of this.particles) if (!p.alive) return p;
    return null;
  }

  emit(opts: {
    pos: THREE.Vector3;
    count: number;
    color: number | number[];
    speed: number;
    spread?: number;
    dir?: THREE.Vector3;
    life?: number;
    size?: number;
    gravity?: number;
    drag?: number;
    sizeJitter?: number;
    upBias?: number;
  }): void {
    const dir = opts.dir ?? new THREE.Vector3(0, 1, 0);
    const spread = opts.spread ?? 1;
    for (let i = 0; i < opts.count; i++) {
      const p = this.spawnOne();
      if (!p) return;
      p.alive = true;
      p.pos.copy(opts.pos);
      p.vel.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).normalize().multiplyScalar(spread);
      p.vel.add(dir);
      p.vel.normalize().multiplyScalar(opts.speed * (0.5 + Math.random() * 0.8));
      p.vel.y += opts.upBias ?? 0;
      p.maxLife = (opts.life ?? 0.6) * (0.6 + Math.random() * 0.8);
      p.life = p.maxLife;
      p.size = (opts.size ?? 0.08) * (1 - (opts.sizeJitter ?? 0.5) * Math.random());
      const c = Array.isArray(opts.color) ? opts.color[Math.floor(Math.random() * opts.color.length)] : opts.color;
      p.color.set(c);
      p.gravity = opts.gravity ?? 9;
      p.drag = opts.drag ?? 1.5;
      p.spin = (Math.random() - 0.5) * 12;
    }
  }

  update(dt: number): void {
    let i = 0;
    for (const p of this.particles) {
      if (p.alive) {
        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
        } else {
          p.vel.y -= p.gravity * dt;
          p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
          p.pos.addScaledVector(p.vel, dt);
          if (p.pos.y < 0.01 && p.gravity > 0) {
            p.pos.y = 0.01;
            p.vel.y *= -0.3;
            p.vel.x *= 0.7;
            p.vel.z *= 0.7;
          }
          const k = p.life / p.maxLife;
          const s = p.size * (0.3 + 0.7 * k);
          this.dummy.position.copy(p.pos);
          this.dummy.rotation.set(p.spin * p.life, p.spin * 0.7 * p.life, 0);
          this.dummy.scale.set(s, s, s);
          this.dummy.updateMatrix();
          this.mesh.setMatrixAt(i, this.dummy.matrix);
          this.mesh.setColorAt(i, p.color);
        }
      }
      if (!p.alive) {
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.set(0.001, 0.001, 0.001);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
      }
      i++;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.particles) p.alive = false;
  }
}
