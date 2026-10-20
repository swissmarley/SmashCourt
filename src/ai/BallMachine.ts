import * as THREE from 'three';
import { COURT } from '../config/constants';
import { SHOTS, type ShotType } from '../config/shots';
import type { Ball } from '../entities/Ball';
import type { PhysicsEnv } from '../physics/BallPhysics';
import { solveShot } from '../physics/ShotSolver';
import { toonMesh } from '../render/Toon';

export interface PracticeOptions {
  /** Shot type the machine feeds. */
  shot: ShotType | 'random';
  /** Seconds between feeds (after the previous ball is dead). */
  interval: number;
  /** Target rings the player should aim for. */
  target: 'random' | 'left' | 'right' | 'deep' | 'short';
  /** Where the machine feeds the ball. */
  feed?: 'center' | 'wide' | 'random';
}

/** Practice-mode ball machine sitting at the far baseline. */
export class BallMachine {
  readonly group = new THREE.Group();
  options: PracticeOptions;
  private wheel: THREE.Mesh;
  private barrel: THREE.Mesh;
  private kick = 0;
  readonly position = new THREE.Vector3(0, 0.9, -(COURT.halfLength - 0.8));

  constructor(options: PracticeOptions) {
    this.options = options;
    const body = toonMesh(new THREE.BoxGeometry(0.9, 0.7, 0.7), 0x2b3a67, 0.02);
    body.position.set(0, 0.75, 0);
    this.group.add(body);
    for (const sx of [-1, 1]) {
      const leg = toonMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), 0x1b2233, 0.012);
      leg.position.set(sx * 0.35, 0.25, 0.2);
      this.group.add(leg);
      const leg2 = leg.clone();
      leg2.position.z = -0.2;
      this.group.add(leg2);
    }
    this.barrel = toonMesh(new THREE.CylinderGeometry(0.11, 0.14, 0.6, 12), 0x5bb5ff, 0.015);
    this.barrel.rotation.x = -Math.PI / 2 + 0.35;
    this.barrel.position.set(0, 0.95, 0.4);
    this.group.add(this.barrel);
    this.wheel = toonMesh(new THREE.TorusGeometry(0.22, 0.06, 8, 20), 0xffd23f, 0.012);
    this.wheel.position.set(0, 1.25, -0.1);
    this.group.add(this.wheel);
    const hopper = toonMesh(new THREE.CylinderGeometry(0.42, 0.25, 0.4, 12, 1, true), 0xffffff, 0.012, false);
    hopper.position.set(0, 1.35, -0.1);
    this.group.add(hopper);
    this.group.position.set(this.position.x, 0, this.position.z);
  }

  update(dt: number): void {
    this.wheel.rotation.y += dt * 6;
    this.kick = Math.max(0, this.kick - dt * 4);
    this.barrel.position.z = 0.4 - this.kick * 0.1;
  }

  /** Launch a ball toward the practising player's half. */
  fire(ball: Ball, env: PhysicsEnv, playerPos: THREE.Vector3): void {
    const types: ShotType[] = ['topspin', 'slice', 'flat', 'lob', 'drop'];
    const shot: ShotType = this.options.shot === 'random' ? types[Math.floor(Math.random() * types.length)] : this.options.shot;
    const def = SHOTS[shot];
    const feed = this.options.feed ?? 'random';
    let tx = 0;
    if (feed === 'center') tx = (Math.random() - 0.5) * 1.5;
    else if (feed === 'wide') tx = (Math.random() < 0.5 ? -1 : 1) * (2.4 + Math.random() * 0.9);
    else tx = (Math.random() - 0.5) * 2 * 3.0;
    // Mix it up relative to the player so they have to move a little.
    if (feed === 'random' && Math.random() < 0.4) tx = THREE.MathUtils.clamp(playerPos.x + (Math.random() < 0.5 ? -1 : 1) * (1.8 + Math.random()), -3.4, 3.4);
    const depth = shot === 'drop' ? 0.3 : 0.6 + Math.random() * 0.3;
    const target = new THREE.Vector3(tx, 0, depth * COURT.halfLength);
    const start = this.position.clone();
    start.y = 1.1;
    start.z += 0.5;
    const speed = def.speed * 0.8;
    const res = solveShot({ start, target, speed, angle: def.angle, topspin: def.topspin * 0.9, sidespin: 0, netClearance: def.netClearance }, env);
    ball.reset(start.x, start.y, start.z);
    ball.vel.copy(res.velocity);
    ball.state.spin.copy(res.spin);
    ball.inPlay = true;
    ball.lastHitTeam = 1;
    ball.lastHitter = -1;
    ball.onHit(shot, false);
    this.kick = 1;
  }
}
