import * as THREE from 'three';
import { DIFFICULTIES, type Difficulty, type DifficultyDef } from '../config/difficulty';
import { COURT, PLAYER } from '../config/constants';
import type { ShotType } from '../config/shots';
import type { Ball } from '../entities/Ball';
import type { Intent, Player } from '../entities/Player';
import type { TrajectorySample } from '../physics/BallPhysics';

/** What the AI needs to know about the world. Implemented by the match controller. */
export interface AIWorld {
  ball: Ball;
  players: Player[];
  halfWidth: number;
  /** Samples of the current ball flight since the last hit (game time from the hit). */
  trajectory: TrajectorySample[];
  /** Seconds elapsed since the last hit. */
  flightTime: number;
  /** Increments on every racket contact / serve. */
  hitId: number;
  /** Surface speed hint (friction), used to prefer slices on fast courts. */
  surfaceFriction: number;
  mode: 'singles' | 'doubles' | 'practice';
}

function gauss(): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * CPU opponent controller.
 *
 * Every time the ball is struck toward its side the AI:
 *   1. waits `reactionDelay` seconds (difficulty),
 *   2. predicts the ball path with the *same* physics the ball uses, adds a per-shot prediction
 *      error (difficulty), and picks an intercept point after the bounce at a comfortable height,
 *   3. runs there (never faster than its character's speed * difficulty speedUse),
 *   4. chooses a shot from the tactical situation and strikes with near-perfect timing (noisier on
 *      Easy). Hard also charges when it has time, uses chance zones and its Power Shot.
 */
export class OpponentAI {
  readonly diff: DifficultyDef;
  private seenHit = -1;
  private reaction = 0;
  private predErr = new THREE.Vector2();
  private intercept: { x: number; z: number; t: number; volley: boolean } | null = null;
  private decision: { shot: ShotType; target: THREE.Vector3; wantCharge: boolean; usePower: boolean; timingOffset: number; block: boolean } | null = null;
  private wantsBall = true;
  private holding = false;
  private tmpTarget = new THREE.Vector3();

  constructor(
    readonly player: Player,
    difficulty: Difficulty,
    private world: AIWorld,
  ) {
    this.diff = DIFFICULTIES[difficulty];
    player.speedScale = this.diff.speedUse;
    player.reachScale = this.diff.reachScale;
  }

  /** Home (recovery) position for this player. */
  private homePosition(out: THREE.Vector3): THREE.Vector3 {
    const p = this.player;
    const side = p.side;
    const ball = this.world.ball;
    // Shade toward the side the ball is on, but stay near the middle.
    let x = THREE.MathUtils.clamp(ball.pos.x * 0.25, -1.5, 1.5);
    let z = side * (COURT.halfLength - 0.4);
    if (this.world.mode === 'doubles') {
      const partner = this.world.players.find((q) => q.team === p.team && q !== p);
      const half = partner ? (p.pos.x >= partner.pos.x ? 1 : -1) : 1;
      x = half * 2.2;
      if (p.doublesRole === 'net') z = side * 3.6;
    }
    return out.set(x, 0, z);
  }

  /** Should this player take the incoming ball (doubles responsibility)? */
  private shouldTake(icp: { x: number; z: number }): boolean {
    if (this.world.mode !== 'doubles') return true;
    const p = this.player;
    const partner = this.world.players.find((q) => q.team === p.team && q !== p);
    if (!partner) return true;
    const myD = Math.hypot(icp.x - p.pos.x, icp.z - p.pos.z);
    const pd = Math.hypot(icp.x - partner.pos.x, icp.z - partner.pos.z);
    if (partner.isHuman) {
      // Never poach a human partner's half.
      const mySide = Math.sign(p.pos.x - partner.pos.x) || 1;
      return Math.sign(icp.x - (p.pos.x + partner.pos.x) / 2) === mySide || myD < pd * 0.6;
    }
    const bias = p.doublesRole === 'net' ? 0.85 : 1;
    return myD * bias <= pd;
  }

  /** Pick where to meet the ball using the shared trajectory prediction. */
  private computeIntercept(): void {
    const p = this.player;
    const side = p.side;
    const traj = this.world.trajectory;
    const now = this.world.flightTime;
    this.intercept = null;
    if (traj.length === 0) return;
    const maxZ = COURT.halfLength + COURT.runbackDepth - 0.3;
    const minZ = 0.9;
    const nearNet = Math.abs(p.pos.z) < 5.5 || p.doublesRole === 'net';
    let best: TrajectorySample | null = null;
    let fallback: TrajectorySample | null = null;
    for (const s of traj) {
      if (s.t < now) continue;
      const zs = s.z * side; // depth on our side (positive when on our half)
      if (zs < minZ) continue;
      if (zs > maxZ) break;
      // Volley: ball passes close to a net player at a hittable height before bouncing.
      if (nearNet && s.bounces === 0 && Math.abs(zs - Math.abs(p.pos.z)) < 0.6 && s.y > 0.5 && s.y < 2.2) {
        best = s;
        break;
      }
      if (s.bounces >= 1 && s.vy < 0 && s.y < 1.25 && s.y > 0.45) {
        best = s;
        break;
      }
      if (s.bounces >= 1 && s.y < 2.6) fallback = s;
      if (s.bounces >= 2) break;
    }
    const pick = best ?? fallback ?? traj[traj.length - 1];
    if (!pick) return;
    const dt = Math.max(0, pick.t - now);
    this.intercept = { x: pick.x + this.predErr.x, z: pick.z + this.predErr.y * 0.6, t: dt, volley: !!best && pick.bounces === 0 };
  }

  /** Tactical shot choice once the ball is close. */
  private decide(): void {
    const p = this.player;
    const w = this.world;
    const ball = w.ball;
    const opps = w.players.filter((q) => q.team !== p.team);
    const tactical = Math.random() < this.diff.tacticalChance;
    const oppSide = -p.side;
    const margin = this.diff.aimMargin;
    const maxX = w.halfWidth - margin;
    const deepZ = COURT.halfLength - margin;
    const nearest = opps.reduce((a, b) => (Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) ? a : b));
    const oppAtNet = opps.some((o) => Math.abs(o.pos.z) < 4.8 && !o.isBusy);
    const oppDeep = opps.every((o) => Math.abs(o.pos.z) > COURT.halfLength - 0.6);
    const incomingSpeed = Math.hypot(ball.vel.x, ball.vel.z);
    const comfortable = incomingSpeed < 16 && Math.abs(p.pos.z) < COURT.halfLength + 0.5;
    const weakBall = (incomingSpeed < 12 && ball.pos.y > 1.0) || p.chanceZone !== null;

    // Open court: aim away from the opponent's x. Mean x of opponents for doubles.
    const oppX = opps.reduce((s, o) => s + o.pos.x, 0) / opps.length;
    const openX = oppX > 0.3 ? -maxX : oppX < -0.3 ? maxX : Math.random() < 0.5 ? -maxX : maxX;

    let shot: ShotType = 'topspin';
    const target = this.tmpTarget.set(openX * (0.6 + Math.random() * 0.4), 0, oppSide * deepZ * (0.85 + Math.random() * 0.15));

    if (p.chanceZone && this.diff.usesChance) {
      shot = p.chanceZone.shot;
      target.set(openX, 0, oppSide * deepZ * 0.9);
    } else if (tactical && oppAtNet && comfortable && ball.pos.y < 1.6) {
      shot = 'lob';
      target.set(openX * 0.5, 0, oppSide * deepZ * 0.95);
    } else if (tactical && oppDeep && comfortable && Math.abs(p.pos.z) < COURT.halfLength - 2 && Math.random() < 0.55) {
      shot = 'drop';
      target.set(openX * 0.5, 0, oppSide * (1.6 + Math.random() * 1.2));
    } else if (tactical && weakBall) {
      shot = ball.pos.y > 1.6 ? 'flat' : 'topspin';
      target.set(openX, 0, oppSide * deepZ * (0.75 + Math.random() * 0.2));
    } else {
      const sliceBias = 0.3 + (0.3 - w.surfaceFriction);
      shot = Math.random() < sliceBias ? 'slice' : 'topspin';
      if (!tactical) {
        // Safe default: toward the middle-deep.
        target.set((Math.random() - 0.5) * 2 * maxX * 0.5, 0, oppSide * deepZ * 0.85);
      }
    }
    // Hard: pass it by the net player rather than at them.
    if (oppAtNet && shot !== 'lob') {
      const netGuy = opps.find((o) => Math.abs(o.pos.z) < 4.8) ?? nearest;
      if (Math.abs(target.x - netGuy.pos.x) < 1.5) target.x = netGuy.pos.x > 0 ? -maxX : maxX;
    }
    target.x = THREE.MathUtils.clamp(target.x, -maxX, maxX);

    const usePower = this.diff.usesPower && p.powerMeter >= 0.999 && comfortable && !ball.isPower;
    const wantCharge = this.diff.usesCharge && Math.random() < 0.7;
    // Timing offset: Easy swings early/late by up to ~0.5 of the window.
    const timingSigma = this.diff.id === 'easy' ? 0.45 : this.diff.id === 'medium' ? 0.22 : 0.08;
    const timingOffset = THREE.MathUtils.clamp(gauss() * timingSigma, -0.8, 0.8);
    const block = Math.random() < this.diff.blockChance;
    this.decision = { shot, target: target.clone(), wantCharge, usePower, timingOffset, block };
  }

  update(dt: number, intent: Intent, serving: boolean): void {
    const p = this.player;
    const w = this.world;
    const ball = w.ball;
    intent.moveX = 0;
    intent.moveZ = 0;
    intent.shot = null;
    intent.shotPressed = false;
    intent.shotReleased = false;
    intent.dive = false;
    intent.power = false;
    intent.aimX = 0;
    intent.aimDepth = 0;
    intent.aimTarget = null;
    if (p.isBusy) return;

    const incoming = ball.inPlay && ball.lastHitTeam !== p.team && ball.lastHitTeam !== -1;

    if (serving || !incoming) {
      // Recover to the home position between shots.
      this.seenHit = -1;
      this.decision = null;
      this.intercept = null;
      if (this.holding) {
        intent.shotReleased = true;
        this.holding = false;
      }
      if (!serving) this.moveToward(this.homePosition(this.tmpTarget), intent, 0.25);
      return;
    }

    // New ball flight: react after a delay and roll a fresh prediction error.
    if (w.hitId !== this.seenHit) {
      this.seenHit = w.hitId;
      this.reaction = this.diff.reactionDelay;
      this.predErr.set(gauss() * this.diff.predictionError, gauss() * this.diff.predictionError);
      this.decision = null;
      this.intercept = null;
      if (this.holding) {
        intent.shotReleased = true;
        this.holding = false;
      }
      this.wantsBall = true;
    }
    if (this.reaction > 0) {
      this.reaction -= dt;
      // Before reacting, keep the previous motion (none).
      return;
    }

    // Recompute the intercept every step: cheap and robust to net cords and bounces.
    this.computeIntercept();
    if (!this.intercept) return;
    const icp = this.intercept;
    if (w.hitId === this.seenHit && this.decision === null) {
      this.wantsBall = this.shouldTake(icp);
    }
    if (!this.wantsBall) {
      this.moveToward(this.homePosition(this.tmpTarget), intent, 0.25);
      return;
    }

    // Chance zone: stand on the star instead.
    const zone = this.diff.usesChance ? p.chanceZone : null;
    const rightSign = p.side > 0 ? 1 : -1;
    const standX = zone ? zone.x : icp.x - rightSign * 0.5;
    const standZ = zone ? zone.z : THREE.MathUtils.clamp(icp.z * p.side, 0.9, COURT.halfLength + COURT.runbackDepth - 0.3) * p.side;
    const dist = Math.hypot(standX - p.pos.x, standZ - p.pos.z);
    const effectiveSpeed = p.runSpeed * p.speedScale;
    const timeToArrive = dist / Math.max(0.1, effectiveSpeed);

    if (!this.decision) this.decide();
    const d = this.decision!;

    // Power Shot incoming: time a block.
    if (ball.isPower) {
      this.moveToward(this.tmpTarget.set(standX, 0, standZ), intent, 0.05);
      if (d.block && p.ballInReach(ball, 0.6) && !this.holding) {
        intent.shotPressed = true;
        intent.shot = 'slice';
      }
      return;
    }

    const inReach = p.ballInReach(ball);
    const timing = p.timingFor(ball);

    // Dive when the ball will not be reachable on foot.
    if (this.diff.dives && !inReach && timeToArrive > icp.t + 0.05 && icp.t < 0.45 && dist < PLAYER.diveDistance + p.reach + 0.4 && dist > p.reach) {
      intent.dive = true;
      intent.moveX = (standX - p.pos.x) / dist;
      intent.moveZ = (standZ - p.pos.z) / dist;
      return;
    }

    if (p.state === 'charging') {
      // Hold the button until the swing fires automatically.
      intent.shot = d.shot;
      this.holding = true;
      intent.aimTarget = d.target;
      return;
    }

    // Move into position.
    this.moveToward(this.tmpTarget.set(standX, 0, standZ), intent, 0.12);

    // Charge when there is time to spare and we're already in position.
    if (d.wantCharge && !inReach && dist < 0.35 && icp.t > 0.75 && icp.t < 2.5 && !this.holding) {
      intent.shot = d.shot;
      intent.shotPressed = true;
      intent.aimTarget = d.target;
      this.holding = true;
      return;
    }

    // Strike when the ball reaches the ideal contact point (with the per-shot timing offset).
    if (inReach && (timing <= d.timingOffset || timing < -0.7)) {
      if (d.usePower) {
        intent.power = true;
      } else {
        intent.shot = d.shot;
        intent.shotPressed = true;
      }
      intent.aimTarget = d.target;
      intent.moveX = 0;
      intent.moveZ = 0;
    }
  }

  private moveToward(target: THREE.Vector3, intent: Intent, deadZone: number): void {
    const p = this.player;
    const dx = target.x - p.pos.x;
    const dz = target.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < deadZone) return;
    const k = Math.min(1, dist / 0.5);
    intent.moveX = (dx / dist) * k;
    intent.moveZ = (dz / dist) * k;
  }
}
