import * as THREE from 'three';
import { STAT_FORMULAS, type CharacterDef } from '../config/characters';
import { CHANCE, COURT, PLAYER, POWER_METER } from '../config/constants';
import type { ShotType } from '../config/shots';
import type { Ball } from './Ball';
import { CharacterModel, type SwingKind } from './CharacterModel';

/** What a controller (human or AI) wants the player to do this step. */
export interface Intent {
  /** Court-space movement direction (length <= 1). */
  moveX: number;
  moveZ: number;
  /** Shot the controller is asking for (held or just pressed), or null. */
  shot: ShotType | null;
  /** A shot button went down this step. */
  shotPressed: boolean;
  /** All shot buttons are up and one was released this step. */
  shotReleased: boolean;
  dive: boolean;
  power: boolean;
  /** Aim: lateral -1..1 (hitter's left..right), depth -1..1 (short..deep). */
  aimX: number;
  aimDepth: number;
  /** Explicit world-space target (AI). Overrides aimX/aimDepth when set. */
  aimTarget: THREE.Vector3 | null;
}

export function emptyIntent(): Intent {
  return { moveX: 0, moveZ: 0, shot: null, shotPressed: false, shotReleased: false, dive: false, power: false, aimX: 0, aimDepth: 0, aimTarget: null };
}

export interface HitParams {
  shot: ShotType;
  /** 0..1 */
  charge: number;
  /** -1 (late) .. 1 (early) */
  timing: number;
  perfect: boolean;
  aimX: number;
  aimDepth: number;
  aimTarget: THREE.Vector3 | null;
  isPower: boolean;
  isBlock: boolean;
  fromDive: boolean;
  /** 'none' = no chance zone, 'any' = in a zone, 'match' = in a zone with the matching button. */
  chance: 'none' | 'any' | 'match';
  kind: SwingKind;
}

export interface ChanceZone {
  x: number;
  z: number;
  shot: ShotType;
  color: number;
}

/** Services the match provides to a player. */
export interface PlayerHost {
  ball: Ball;
  /** Rules check: may this player strike the ball right now? */
  canHit(p: Player): boolean;
  /** Where the incoming ball will be when it reaches this player's depth (for the magnet). */
  getIntercept(p: Player): { x: number; z: number; t: number } | null;
  onHit(p: Player, params: HitParams): void;
  onBlockFail(p: Player): void;
  onDive(p: Player): void;
  onChargeStart(p: Player, shot: ShotType): void;
  isPowerBallIncoming(p: Player): boolean;
}

export type PlayerState = 'idle' | 'charging' | 'swinging' | 'diving' | 'recovering' | 'stunned' | 'frozen' | 'celebrating' | 'defeated';

/**
 * A tennis player. Controller-agnostic: humans and the AI both feed it an `Intent` every physics
 * step. Handles movement, reach checks, charging, swinging, diving, Power Shots and blocks, and
 * drives the character model's poses.
 */
export class Player {
  readonly index: number;
  team: number;
  /** +1 when this player's half is +Z, -1 when it is -Z. */
  side: number;
  readonly def: CharacterDef;
  readonly model: CharacterModel;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  isHuman = false;
  /** Doubles: is this player the designated net player of the pair? */
  doublesRole: 'single' | 'baseline' | 'net' = 'single';

  // Derived stats
  readonly runSpeed: number;
  readonly reach: number;
  readonly errorScale: number;
  readonly powerScale: number;
  readonly spinScale: number;

  state: PlayerState = 'idle';
  charge = 0;
  chargeShot: ShotType = 'topspin';
  /** 0..1 Power meter. */
  powerMeter = 0;
  /** Chance zone assigned to this player (set by the match). */
  chanceZone: ChanceZone | null = null;
  /** Recorded for the HUD. */
  lastHitWasPerfect = false;
  /** Timestamp (game seconds) of the last shot-button press, for Power Shot blocks. */
  lastShotPressTime = -1e9;
  /** Game clock maintained by the host. */
  time = 0;
  private stateTimer = 0;
  private diveDir = new THREE.Vector3();
  private diveFrom = new THREE.Vector3();
  private swingTimer = 0;
  private blockFailed = false;
  private powerArmed = false;
  private tmp = new THREE.Vector3();
  /** Speed multiplier the controller may apply (AI difficulty). */
  speedScale = 1;

  constructor(index: number, team: number, side: number, def: CharacterDef) {
    this.index = index;
    this.team = team;
    this.side = side;
    this.def = def;
    this.model = new CharacterModel(def);
    this.runSpeed = STAT_FORMULAS.runSpeed(def.stats, PLAYER.baseSpeed, PLAYER.speedPerStat);
    this.reach = STAT_FORMULAS.reach(def, PLAYER.baseReach, PLAYER.reachPerStat);
    this.errorScale = STAT_FORMULAS.errorScale(def.stats);
    this.powerScale = STAT_FORMULAS.powerScale(def.stats);
    this.spinScale = STAT_FORMULAS.spinScale(def.stats);
  }

  /** Direction toward the net. */
  get forward(): number {
    return -this.side;
  }

  /** Teleport and reset for a new point. */
  placeAt(x: number, z: number): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.state = 'idle';
    this.charge = 0;
    this.stateTimer = 0;
    this.blockFailed = false;
    this.powerArmed = false;
    this.chanceZone = null;
    this.model.setPose('idle');
    this.syncModel();
  }

  setCelebrate(win: boolean): void {
    this.state = win ? 'celebrating' : 'defeated';
    this.vel.set(0, 0, 0);
    this.model.setPose(win ? 'victory' : 'defeat');
  }

  freeze(): void {
    this.state = 'frozen';
    this.vel.set(0, 0, 0);
    this.model.setPose('idle');
  }

  unfreeze(): void {
    if (this.state === 'frozen') this.state = 'idle';
  }

  get isBusy(): boolean {
    return this.state === 'diving' || this.state === 'recovering' || this.state === 'stunned' || this.state === 'frozen' || this.state === 'celebrating' || this.state === 'defeated';
  }

  /** Point on the court where the racket meets the ball (slightly in front of the body). */
  racketPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, 0, this.pos.z + this.forward * 0.3);
  }

  /** Is the ball inside this player's hit volume? */
  ballInReach(ball: Ball, bonus = 0): boolean {
    const b = ball.pos;
    const rp = this.racketPoint(this.tmp);
    const dx = b.x - rp.x;
    const dz = b.z - rp.z;
    const r = this.reach + bonus;
    if (dx * dx + dz * dz > r * r) return false;
    if (b.y > PLAYER.maxHitHeight + this.model.height * 0.2) return false;
    if (b.y < PLAYER.minHitHeight) return false;
    // Cannot reach over the net.
    if (b.z * this.side < -0.25) return false;
    return true;
  }

  /** Swing side relative to the body. */
  swingKindFor(ball: Ball): SwingKind {
    if (ball.pos.y > this.model.height * 1.05) return 'overhead';
    // Right hand is on the player's right: for a player facing -Z (side +1) right is +X.
    const rightX = this.side > 0 ? 1 : -1;
    const rel = (ball.pos.x - this.pos.x) * rightX;
    return rel >= -0.15 ? 'forehand' : 'backhand';
  }

  /**
   * Timing: how early/late the strike is. Positive = early (ball still in front), negative = late
   * (ball has passed the ideal contact point beside the body).
   */
  timingFor(ball: Ball): number {
    const ahead = (ball.pos.z - this.pos.z) * this.forward; // metres in front of the player
    const ideal = 0.45;
    return THREE.MathUtils.clamp((ahead - ideal) / PLAYER.timingWindow, -1, 1);
  }

  private chanceFor(shot: ShotType): 'none' | 'any' | 'match' {
    const z = this.chanceZone;
    if (!z) return 'none';
    const d = Math.hypot(this.pos.x - z.x, this.pos.z - z.z);
    if (d > CHANCE.radius) return 'none';
    return z.shot === shot ? 'match' : 'any';
  }

  /** Main simulation step. */
  update(dt: number, intent: Intent, host: PlayerHost): void {
    this.time += dt;
    const ball = host.ball;
    this.stateTimer += dt;
    if (intent.shotPressed) this.lastShotPressTime = this.time;

    // --- Timed states --------------------------------------------------------------
    switch (this.state) {
      case 'swinging':
        this.swingTimer -= dt;
        if (this.swingTimer <= 0) this.state = 'idle';
        break;
      case 'diving': {
        const k = Math.min(1, this.stateTimer / PLAYER.diveDuration);
        const ease = 1 - (1 - k) * (1 - k);
        this.pos.copy(this.diveFrom).addScaledVector(this.diveDir, PLAYER.diveDistance * ease);
        this.clampToCourt();
        // Auto-hit during the dive with extended reach.
        if (ball.inPlay && host.canHit(this) && this.ballInReach(ball, PLAYER.diveReachBonus)) {
          this.performHit(host, 'slice', 0, 0, intent, true);
        }
        if (k >= 1) {
          this.state = 'recovering';
          this.stateTimer = 0;
          this.model.setPose('down');
        }
        break;
      }
      case 'recovering': {
        const dur = PLAYER.diveRecovery * STAT_FORMULAS.diveRecoveryScale(this.def);
        if (this.stateTimer >= dur) this.state = 'idle';
        break;
      }
      case 'stunned': {
        if (this.stateTimer >= PLAYER.powerShotStun) this.state = 'idle';
        break;
      }
      case 'frozen':
      case 'celebrating':
      case 'defeated':
        this.syncModel();
        this.updatePose(dt, ball);
        return;
      default:
        break;
    }

    const canAct = this.state === 'idle' || this.state === 'charging' || this.state === 'swinging';
    const incoming = ball.inPlay && host.canHit(this);
    const inReach = incoming && this.ballInReach(ball);

    // --- Power Shot block / knockback -------------------------------------------------
    if (incoming && host.isPowerBallIncoming(this) && !this.blockFailed) {
      if (this.ballInReach(ball, 0.25)) {
        const pressedRecently = this.time - this.lastShotPressTime <= POWER_METER.blockWindow;
        if (pressedRecently && canAct) {
          this.performHit(host, 'block', 0, 0, intent, false, true);
          return;
        }
        if (this.state !== 'diving') {
          // Too slow: the ball blows past and knocks the racket back.
          this.blockFailed = true;
          this.state = 'stunned';
          this.stateTimer = 0;
          this.charge = 0;
          this.model.setPose('stun');
          host.onBlockFail(this);
        }
      }
    }

    // --- Shots -----------------------------------------------------------------------
    if (canAct && this.state !== 'swinging') {
      // Power Shot trigger
      if (intent.power && this.powerMeter >= 0.999 && incoming) {
        if (inReach) {
          this.performHit(host, 'power', 0, this.timingFor(ball), intent, false);
          return;
        }
        this.powerArmed = true;
        this.beginCharge('power', host);
      }

      if (intent.shotPressed && intent.shot && incoming && !this.powerArmed) {
        if (inReach) {
          this.performHit(host, intent.shot, this.charge, this.timingFor(ball), intent, false);
          return;
        }
        // Not yet in reach: plant the feet and charge.
        this.beginCharge(intent.shot, host);
      }

      if (this.state === 'charging') {
        // Shot type can change while charging (J then K = lob, K then J = drop).
        if (intent.shot && !this.powerArmed) this.chargeShot = intent.shot;
        this.charge = Math.min(1, this.charge + dt / PLAYER.chargeTime);
        if (inReach) {
          const shot = this.powerArmed ? 'power' : this.chargeShot;
          this.performHit(host, shot, this.charge, 0, intent, false);
          return;
        }
        if (intent.shotReleased && !this.powerArmed) {
          // Releasing early cancels the charge, unless the ball is about to arrive: then the
          // swing stays queued so quick taps still connect (forgiveness).
          const icp = host.getIntercept(this);
          if (!icp || icp.t > 0.45) {
            this.state = 'idle';
            this.charge = 0;
          }
        }
        // Ball passed us: charge is wasted.
        if (!incoming || (ball.pos.z - this.pos.z) * this.forward < -1.2) {
          this.state = 'idle';
          this.charge = 0;
          this.powerArmed = false;
        }
      }
    }

    // --- Dive -------------------------------------------------------------------------
    if (intent.dive && (this.state === 'idle' || this.state === 'charging' || this.state === 'swinging')) {
      this.startDive(intent, host);
    }

    // --- Movement ---------------------------------------------------------------------
    if (this.state === 'idle' || this.state === 'swinging' || this.state === 'charging') {
      const maxSpeed = this.runSpeed * this.speedScale * (this.state === 'swinging' ? 0.55 : 1);
      let mx = intent.moveX;
      let mz = intent.moveZ;
      if (this.state === 'charging') {
        mx = 0;
        mz = 0;
      }
      // Magnet: nudge toward the intercept when the ball is coming and the player is close.
      const icp = incoming ? host.getIntercept(this) : null;
      if (icp) {
        const dx = icp.x - this.pos.x;
        const dist = Math.abs(dx);
        if (dist < PLAYER.magnetRange && dist > 0.05) {
          const strength = this.state === 'charging' ? PLAYER.magnetStrength * 0.6 : PLAYER.magnetStrength;
          const inputMag = Math.hypot(mx, mz);
          const assist = Math.sign(dx) * Math.min(1, dist / 0.6) * strength * (1 - inputMag * 0.6);
          mx += assist;
        }
      }
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      const targetVx = mx * maxSpeed;
      const targetVz = mz * maxSpeed;
      const accel = len > 0.05 ? PLAYER.acceleration : PLAYER.deceleration;
      this.vel.x = THREE.MathUtils.damp(this.vel.x, targetVx, accel / 8, dt);
      this.vel.z = THREE.MathUtils.damp(this.vel.z, targetVz, accel / 8, dt);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.clampToCourt();
    } else if (this.state !== 'diving') {
      this.vel.set(0, 0, 0);
    }

    this.syncModel();
    this.updatePose(dt, ball);
  }

  private beginCharge(shot: ShotType, host: PlayerHost): void {
    if (this.state === 'charging') return;
    this.state = 'charging';
    this.stateTimer = 0;
    this.charge = 0;
    this.chargeShot = shot;
    host.onChargeStart(this, shot);
  }

  private startDive(intent: Intent, host: PlayerHost): void {
    const ball = host.ball;
    let dx = intent.moveX;
    let dz = intent.moveZ;
    if (Math.hypot(dx, dz) < 0.2) {
      // No direction held: dive toward the ball (or its intercept).
      const icp = host.getIntercept(this);
      const tx = icp ? icp.x : ball.pos.x;
      const tz = icp ? icp.z : ball.pos.z;
      dx = tx - this.pos.x;
      dz = tz - this.pos.z;
      if (Math.hypot(dx, dz) < 0.2) {
        dx = this.side > 0 ? 1 : -1;
        dz = 0;
      }
    }
    const len = Math.hypot(dx, dz) || 1;
    this.diveDir.set(dx / len, 0, dz / len);
    this.diveFrom.copy(this.pos);
    this.state = 'diving';
    this.stateTimer = 0;
    this.charge = 0;
    this.powerArmed = false;
    this.model.diveDir.copy(this.diveDir);
    this.model.setPose('dive');
    host.onDive(this);
  }

  private performHit(host: PlayerHost, shot: ShotType, charge: number, timing: number, intent: Intent, fromDive: boolean, isBlock = false): void {
    const ball = host.ball;
    const kind = this.swingKindFor(ball);
    const perfect = !fromDive && !isBlock && Math.abs(timing) < PLAYER.perfectWindow && charge < 0.05;
    const isPower = shot === 'power';
    const chance = this.chanceFor(shot);
    const params: HitParams = {
      shot,
      charge,
      timing,
      perfect,
      aimX: intent.aimX,
      aimDepth: intent.aimDepth,
      aimTarget: intent.aimTarget ? intent.aimTarget.clone() : null,
      isPower,
      isBlock,
      fromDive,
      chance,
      kind,
    };
    this.lastHitWasPerfect = perfect;
    if (isPower) this.powerMeter = 0;
    this.powerArmed = false;
    this.charge = 0;
    if (!fromDive) {
      this.state = 'swinging';
      this.swingTimer = PLAYER.swingRecovery;
      this.stateTimer = 0;
      this.model.setPose('swing', kind);
      // Face the strike without stopping.
    }
    host.onHit(this, params);
  }

  private clampToCourt(): void {
    const maxX = COURT.doublesHalfWidth + COURT.runoutWidth;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -maxX, maxX);
    const minZ = 0.6;
    const maxZ = COURT.halfLength + COURT.runbackDepth;
    const zs = this.pos.z * this.side;
    this.pos.z = THREE.MathUtils.clamp(zs, minZ, maxZ) * this.side;
  }

  /** Copy position/orientation into the model root. */
  syncModel(): void {
    this.model.root.position.copy(this.pos);
    // Face the net: local +Z is forward.
    this.model.root.rotation.y = this.side > 0 ? Math.PI : 0;
  }

  private updatePose(dt: number, ball: Ball): void {
    const m = this.model;
    m.moveSpeed = Math.hypot(this.vel.x, this.vel.z);
    m.charge = this.charge;
    switch (this.state) {
      case 'idle':
        m.setPose(m.moveSpeed > 0.6 ? 'run' : 'idle');
        break;
      case 'charging':
        m.setPose('ready', this.swingKindFor(ball));
        break;
      case 'swinging':
        break; // pose set in performHit
      default:
        break;
    }
    m.update(dt);
    m.setGlow(this.powerMeter >= 0.999, dt);
  }

  /** Fill the meter (clamped). */
  addPower(amount: number): void {
    this.powerMeter = THREE.MathUtils.clamp(this.powerMeter + amount, 0, 1);
  }
}
