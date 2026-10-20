import * as THREE from 'three';
import { BALL, COLORS } from '../config/constants';
import type { ShotType } from '../config/shots';
import { SHOTS } from '../config/shots';
import { createBallState, type BallState } from '../physics/BallPhysics';
import { addOutline, toonMaterial } from '../render/Toon';
import { Trail } from '../render/Trail';

/**
 * The tennis ball: physics state + readable visuals (ground shadow blob, landing marker, trail,
 * squash-and-stretch).
 */
export class Ball {
  readonly state: BallState = createBallState();
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly marker: THREE.Group;
  readonly trail: Trail;
  /** Index of the player who hit the ball last (-1 = nobody / serve toss). */
  lastHitter = -1;
  /** Team (0 or 1) of the last hitter. */
  lastHitTeam = -1;
  /** Shot type currently in flight. */
  shotType: ShotType = 'flat';
  /** Bounces since the last hit. */
  bounces = 0;
  /** True while a point is live. */
  inPlay = false;
  /** True when this flight is a serve. */
  isServe = false;
  /** True while this is a Power Shot flight. */
  isPower = false;
  /** Predicted landing point (updated by the match controller). */
  readonly predictedLanding = new THREE.Vector3();
  predictedLandingValid = false;
  predictedIn = true;
  predictedTime = 0;
  /** Squash/stretch animation. */
  private stretch = 0;
  private squash = 0;
  private stretchDir = new THREE.Vector3(0, 0, 1);
  private markerPulse = 0;
  private markerMat: THREE.MeshBasicMaterial;
  private markerDot: THREE.Mesh;
  private sideFlagMat: THREE.MeshBasicMaterial;
  private sideFlag: THREE.Mesh;
  private spinMesh: THREE.Mesh;

  constructor() {
    const geo = new THREE.SphereGeometry(BALL.renderRadius, 20, 16);
    this.mesh = new THREE.Mesh(geo, toonMaterial(COLORS.ballYellow, { emissive: 0x404010, emissiveIntensity: 0.5 }));
    this.mesh.castShadow = true;
    addOutline(this.mesh, 0.014);
    // Seam ring to make spin readable.
    this.spinMesh = new THREE.Mesh(
      new THREE.TorusGeometry(BALL.renderRadius * 0.98, BALL.renderRadius * 0.11, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.spinMesh.rotation.x = 0.6;
    this.mesh.add(this.spinMesh);
    this.group.add(this.mesh);

    // Soft ground shadow blob
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL.renderRadius * 1.4, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
    this.group.add(this.shadow);

    // Landing marker: ring + dot
    this.marker = new THREE.Group();
    this.markerMat = new THREE.MeshBasicMaterial({ color: COLORS.inMarker, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 32), this.markerMat);
    ring.rotation.x = -Math.PI / 2;
    this.marker.add(ring);
    this.markerDot = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), this.markerMat);
    this.markerDot.rotation.x = -Math.PI / 2;
    this.marker.add(this.markerDot);
    this.marker.position.y = 0.012;
    this.marker.renderOrder = 3;
    this.marker.visible = false;
    this.group.add(this.marker);

    // Side flag drawn under the ball when it is high (helps judge lobs)
    this.sideFlagMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    this.sideFlag = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 1), this.sideFlagMat);
    this.sideFlag.visible = false;
    this.group.add(this.sideFlag);

    this.trail = new Trail(BALL.trailLength);
    this.group.add(this.trail.mesh);
  }

  get pos(): THREE.Vector3 {
    return this.state.pos;
  }
  get vel(): THREE.Vector3 {
    return this.state.vel;
  }

  /** Place the ball at rest. */
  reset(x: number, y: number, z: number): void {
    this.state.pos.set(x, y, z);
    this.state.vel.set(0, 0, 0);
    this.state.spin.set(0, 0, 0);
    this.state.rolling = false;
    this.bounces = 0;
    this.lastHitter = -1;
    this.lastHitTeam = -1;
    this.inPlay = false;
    this.isServe = false;
    this.isPower = false;
    this.predictedLandingValid = false;
    this.trail.clear();
    this.trail.reset(this.state.pos);
    this.marker.visible = false;
    this.stretch = 0;
    this.squash = 0;
    this.mesh.scale.set(1, 1, 1);
  }

  /** Called when a racket hits the ball. */
  onHit(shot: ShotType, power: boolean): void {
    this.shotType = shot;
    this.isPower = power;
    this.bounces = 0;
    this.trail.setColor(power ? COLORS.power : SHOTS[shot].color);
    this.trail.width = power ? 0.28 : shot === 'flat' ? 0.13 : 0.16;
    this.trail.intensity = 1;
    this.trail.reset(this.state.pos);
    this.stretch = 1;
    this.stretchDir.copy(this.state.vel).normalize();
  }

  onBounce(): void {
    this.bounces++;
    this.squash = 1;
  }

  setPrediction(x: number, z: number, t: number, isIn: boolean): void {
    this.predictedLanding.set(x, 0, z);
    this.predictedLandingValid = true;
    this.predictedIn = isIn;
    this.predictedTime = t;
  }

  clearPrediction(): void {
    this.predictedLandingValid = false;
  }

  /** Per-frame visual update. */
  updateVisuals(dt: number, camera: THREE.Camera): void {
    const p = this.state.pos;
    this.mesh.position.copy(p);

    // Shadow blob: smaller and fainter as the ball rises.
    const h = Math.max(0, p.y - BALL.radius);
    const sh = 1 / (1 + h * 0.25);
    this.shadow.position.set(p.x, 0.011, p.z);
    this.shadow.scale.set(sh, sh, 1);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 * Math.min(1, sh + 0.2);

    // Vertical guide line when the ball is high
    if (h > 1.4) {
      this.sideFlag.visible = true;
      this.sideFlag.position.set(p.x, h / 2 + BALL.radius, p.z);
      this.sideFlag.scale.y = h;
      this.sideFlag.lookAt(camera.position.x, this.sideFlag.position.y, camera.position.z);
      this.sideFlagMat.opacity = Math.min(0.35, (h - 1.4) * 0.3);
    } else {
      this.sideFlag.visible = false;
    }

    // Landing marker
    if (this.predictedLandingValid && this.inPlay && this.bounces === 0) {
      this.marker.visible = true;
      this.marker.position.x = this.predictedLanding.x;
      this.marker.position.z = this.predictedLanding.z;
      this.markerPulse += dt * 6;
      const s = 1 + Math.sin(this.markerPulse) * 0.12;
      this.marker.scale.set(s, s, 1);
      this.markerMat.color.set(this.predictedIn ? COLORS.inMarker : COLORS.outMarker);
    } else {
      this.marker.visible = false;
    }

    // Squash & stretch
    this.stretch = Math.max(0, this.stretch - dt * 7);
    this.squash = Math.max(0, this.squash - dt * 9);
    const st = this.stretch * 0.45;
    const sq = this.squash * 0.4;
    this.mesh.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
    if (st > 0.01) {
      // Orient the stretch along the velocity.
      const v = this.state.vel;
      if (v.lengthSq() > 0.01) this.stretchDir.copy(v).normalize();
      this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.stretchDir);
      this.mesh.scale.z *= 1 + st;
      this.mesh.scale.x *= 1 - st * 0.3;
      this.mesh.scale.y *= 1 - st * 0.3;
    } else {
      // Roll the seam with the spin so topspin/slice read visually.
      const sp = this.state.spin;
      this.mesh.rotation.x += sp.x * dt * 0.08;
      this.mesh.rotation.y += sp.y * dt * 0.08;
      this.mesh.rotation.z += sp.z * dt * 0.08;
    }

    // Trail
    if (this.trail.intensity > 0) {
      this.trail.push(p);
      if (!this.inPlay || this.state.rolling) this.trail.intensity = Math.max(0, this.trail.intensity - dt * 2.5);
      this.trail.update(camera);
    }
  }
}
