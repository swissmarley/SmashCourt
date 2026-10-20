import * as THREE from 'three';
import { CAMERA, COURT } from '../config/constants';

export type CameraMode = 'follow' | 'serve' | 'power' | 'replay' | 'orbit' | 'victory' | 'practice';

/**
 * Camera behaviours. The rig computes a desired position + look-at every frame and eases the real
 * camera toward it. All modes keep the full court readable except the deliberate close-ups.
 */
export class CameraRig {
  mode: CameraMode = 'orbit';
  /** +1 when the human's end is +Z (camera behind +Z baseline), -1 otherwise. */
  side = 1;
  /** Position of the followed player (for x-follow) and the ball. */
  readonly focusPlayer = new THREE.Vector3();
  readonly focusBall = new THREE.Vector3();
  /** Server position for the close-up. */
  readonly serverPos = new THREE.Vector3();
  /** Hitter position for the power close-up. */
  readonly powerPos = new THREE.Vector3();
  readonly victoryPos = new THREE.Vector3();
  private desiredPos = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private look = new THREE.Vector3(0, 0, 0);
  private orbitT = 0;
  private shake = 0;
  private snapNext = true;
  /** Extra damping multiplier for transitions. */
  private speed: number = CAMERA.damping;

  constructor(private camera: THREE.PerspectiveCamera) {}

  setMode(mode: CameraMode, snap = false): void {
    if (this.mode !== mode) this.speed = mode === 'follow' ? CAMERA.damping * 0.6 : CAMERA.damping;
    this.mode = mode;
    if (snap) this.snapNext = true;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  update(dt: number): void {
    const s = this.side;
    switch (this.mode) {
      case 'follow': {
        const px = THREE.MathUtils.clamp(this.focusPlayer.x, -4, 4) * CAMERA.followX;
        this.desiredPos.set(px, CAMERA.height, s * (COURT.halfLength + CAMERA.distance));
        this.desiredLook.set(px * 0.5 + this.focusBall.x * 0.08, CAMERA.lookHeight, s * CAMERA.lookAhead);
        break;
      }
      case 'practice': {
        const px = THREE.MathUtils.clamp(this.focusPlayer.x, -4, 4) * CAMERA.followX;
        this.desiredPos.set(px, CAMERA.height * 0.95, s * (COURT.halfLength + CAMERA.distance * 0.9));
        this.desiredLook.set(px * 0.5, CAMERA.lookHeight, s * (CAMERA.lookAhead - 1));
        break;
      }
      case 'serve': {
        // Over-the-shoulder close-up of the server.
        const sp = this.serverPos;
        const sideSign = Math.sign(sp.z) || 1;
        this.desiredPos.set(sp.x + (sp.x > 0 ? 1.4 : -1.4), 2.3, sp.z + sideSign * 4.2);
        this.desiredLook.set(sp.x * 0.3, 1.1, -sideSign * 6);
        break;
      }
      case 'power': {
        const hp = this.powerPos;
        const sideSign = Math.sign(hp.z) || 1;
        this.desiredPos.set(hp.x + 3.2 * (hp.x >= 0 ? 1 : -1), 2.6, hp.z + sideSign * 3.5);
        this.desiredLook.set(hp.x, 1.2, hp.z - sideSign * 2);
        break;
      }
      case 'replay': {
        // Side-on broadcast view that tracks the ball.
        const b = this.focusBall;
        this.desiredPos.set(16, 6.5, b.z * 0.5);
        this.desiredLook.set(b.x * 0.3, 1.0, b.z * 0.7);
        break;
      }
      case 'victory': {
        this.orbitT += dt * 0.5;
        const v = this.victoryPos;
        this.desiredPos.set(v.x + Math.sin(this.orbitT) * 4.5, 2.2 + Math.sin(this.orbitT * 0.7) * 0.4, v.z + Math.cos(this.orbitT) * 4.5);
        this.desiredLook.set(v.x, 1.0, v.z);
        break;
      }
      case 'orbit':
      default: {
        this.orbitT += dt * 0.12;
        const r = 26;
        this.desiredPos.set(Math.sin(this.orbitT) * r, 9 + Math.sin(this.orbitT * 0.5) * 1.5, Math.cos(this.orbitT) * r);
        this.desiredLook.set(0, 0.5, 0);
        break;
      }
    }

    if (this.snapNext) {
      this.camera.position.copy(this.desiredPos);
      this.look.copy(this.desiredLook);
      this.snapNext = false;
    } else {
      const k = 1 - Math.exp(-this.speed * dt);
      this.camera.position.lerp(this.desiredPos, k);
      this.look.lerp(this.desiredLook, k);
    }
    if (this.shake > 0) {
      const a = this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    this.camera.lookAt(this.look);
  }
}
