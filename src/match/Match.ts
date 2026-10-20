import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import { OpponentAI, type AIWorld } from '../ai/OpponentAI';
import { BallMachine, type PracticeOptions } from '../ai/BallMachine';
import type { CharacterDef } from '../config/characters';
import { BALL, CHANCE, COURT, PLAYER, POWER_METER, TIMING } from '../config/constants';
import type { CourtDef } from '../config/courts';
import type { Difficulty } from '../config/difficulty';
import { DIFFICULTIES } from '../config/difficulty';
import { SHOTS, type ShotType } from '../config/shots';
import { HumanController } from '../core/HumanController';
import type { GameLoop } from '../core/GameLoop';
import type { InputManager } from '../core/Input';
import { StateMachine } from '../core/StateMachine';
import { Ball } from '../entities/Ball';
import { Court } from '../entities/Court';
import { Net } from '../entities/Net';
import { emptyIntent, Player, type HitParams, type Intent, type PlayerHost } from '../entities/Player';
import { simulateTrajectory, stepBall, type BallEvent, type PhysicsEnv, type TrajectoryResult, type TrajectorySample } from '../physics/BallPhysics';
import { solveShot } from '../physics/ShotSolver';
import type { CameraRig } from '../render/CameraRig';
import { ChargeBar } from '../render/ChargeBar';
import { Crowd } from '../render/Crowd';
import { burstConfetti, burstDust, burstImpact, burstPowerStart, ChanceStar, PowerAura } from '../render/Effects';
import { ParticleSystem } from '../render/Particles';
import type { SceneManager } from '../render/SceneManager';
import { Scoring, type MatchLength, type ScoreState } from '../rules/Scoring';
import type { HUD } from '../ui/HUD';
import { Replay } from './Replay';

export type MatchMode = 'singles' | 'doubles' | 'practice';
export type ControlKind = 'human1' | 'human2' | 'cpu';

export interface PlayerSetup {
  character: CharacterDef;
  control: ControlKind;
  difficulty: Difficulty;
}

export interface MatchConfig {
  mode: MatchMode;
  length: MatchLength;
  court: CourtDef;
  /** 2 players (singles), 4 (doubles: 0 & 2 = team 0, 1 & 3 = team 1) or 1 (practice). */
  players: PlayerSetup[];
  practice?: PracticeOptions;
  /** Optional label shown at the start ("ROUND 1"). */
  title?: string;
}

export interface MatchResult {
  winnerTeam: number;
  score: ScoreState;
  names: [string, string];
  /** Stats per team. */
  stats: { aces: number; winners: number; longestRally: number; powerShots: number }[];
  aborted: boolean;
}

export interface MatchDeps {
  scene: SceneManager;
  rig: CameraRig;
  hud: HUD;
  input: InputManager;
  loop: GameLoop;
  onFinished: (result: MatchResult) => void;
}

type MatchState = 'intro' | 'preServe' | 'serve' | 'rally' | 'pointOver' | 'sideSwitch' | 'replay' | 'matchOver' | 'practice';

interface Controller {
  human: HumanController | null;
  humanSlot: number;
  ai: OpponentAI | null;
  /** Debug: an AI that drives a human slot (CPU vs CPU test matches). */
  autopilot: OpponentAI | null;
  intent: Intent;
}

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * The match controller: owns the court scene, the players, the ball, the rules and the flow of a
 * match (serve -> rally -> point -> game -> set), and bridges to the camera, HUD, audio and effects.
 */
export class Match implements PlayerHost, AIWorld {
  readonly config: MatchConfig;
  readonly ball = new Ball();
  readonly players: Player[] = [];
  readonly court: Court;
  readonly net = new Net();
  readonly crowd: Crowd;
  readonly particles = new ParticleSystem(700);
  readonly scoring: Scoring;
  readonly env: PhysicsEnv;
  readonly halfWidth: number;
  readonly mode: MatchMode;
  trajectory: TrajectorySample[] = [];
  flightTime = 0;
  hitId = 0;
  surfaceFriction: number;
  private trajResult: TrajectoryResult = { samples: [], landing: null, netCrossHeight: null, netCrossX: 0, hitNet: false, apex: 0 };
  private controllers: Controller[] = [];
  private sm: StateMachine<MatchState, Match>;
  private deps: MatchDeps;
  private group = new THREE.Group();
  private chargeBars: ChargeBar[] = [];
  private chanceStar = new ChanceStar();
  private aura: PowerAura;
  private events: BallEvent[] = [];
  private replay = new Replay();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private time = 0;
  private finished = false;

  // Serve state
  private serverIndex = 0;
  private receiverIndex = 1;
  private faults = 0;
  private tossed = false;
  private serveNetCord = false;
  private aiServeTimer = 0;
  private serveTeamMember: [number, number] = [0, 0];
  private tossApex = 0;

  // Rally state
  private rallyHits = 0;
  private receiverSwung = false;
  private pointWinner = -1;
  private pendingSwitch = false;
  private lastPowerKnock = false;
  private slowMo = 0;
  private powerCamTimer = 0;
  private confettiTimer = 0;
  private chargeTickLevel: number[] = [];
  private stats = [
    { aces: 0, winners: 0, longestRally: 0, powerShots: 0 },
    { aces: 0, winners: 0, longestRally: 0, powerShots: 0 },
  ];

  // Practice
  private machine: BallMachine | null = null;
  private practiceStats = { shots: 0, hits: 0, streak: 0, best: 0, inPlay: 0 };
  private practiceTimer = 0;
  private practiceBallLive = false;
  private targetRings: THREE.Mesh[] = [];
  private targetCenters: THREE.Vector3[] = [];

  constructor(config: MatchConfig, deps: MatchDeps) {
    this.config = config;
    this.deps = deps;
    this.mode = config.mode;
    this.halfWidth = config.mode === 'doubles' ? COURT.doublesHalfWidth : COURT.singlesHalfWidth;
    this.court = new Court(config.court);
    this.surfaceFriction = config.court.surface.friction;
    this.env = {
      gravity: BALL.gravity,
      surface: { restitution: config.court.surface.restitution, friction: config.court.surface.friction, patches: config.court.bouncyPatches },
      netCollision: true,
    };
    this.scoring = new Scoring(config.length, Math.random() < 0.5 ? 0 : 1);
    this.crowd = new Crowd(config.court.colors.crowdAccent, config.court.colors.stands, config.court.theme === 'garden' ? 1 : 2, config.court.theme === 'garden' ? 1.6 : config.court.theme === 'clay' ? 1.8 : config.court.theme === 'candy' ? 2.0 : 2.2);
    this.aura = new PowerAura(this.particles);

    // Build players
    config.players.forEach((setup, i) => {
      const team = i % 2;
      const side = team === 0 ? 1 : -1;
      const p = new Player(i, team, side, setup.character);
      p.isHuman = setup.control !== 'cpu';
      this.players.push(p);
      const ctrl: Controller = { human: null, humanSlot: 0, ai: null, autopilot: null, intent: emptyIntent() };
      if (setup.control === 'cpu') ctrl.ai = new OpponentAI(p, setup.difficulty, this);
      else {
        ctrl.human = new HumanController();
        ctrl.humanSlot = setup.control === 'human1' ? 0 : 1;
      }
      this.controllers.push(ctrl);
      this.group.add(p.model.root);
      const bar = new ChargeBar();
      this.chargeBars.push(bar);
      this.group.add(bar.group);
      this.chargeTickLevel.push(0);
    });

    this.group.add(this.court.group, this.net.group, this.ball.group, this.crowd.mesh, this.particles.mesh, this.chanceStar.group, this.aura.group);
    deps.scene.scene.add(this.group);
    deps.scene.applyCourtLighting(config.court);
    deps.rig.side = this.cameraSide();

    if (config.mode === 'practice') {
      this.machine = new BallMachine(config.practice ?? { shot: 'random', interval: 2.6, target: 'random' });
      this.group.add(this.machine.group);
      this.buildTargets();
    }

    this.sm = new StateMachine<MatchState, Match>(this)
      .add('intro', { enter: () => this.enterIntro(), update: (_, dt) => this.updateIntro(dt) })
      .add('preServe', { enter: () => this.enterPreServe(), update: () => this.updatePreServe() })
      .add('serve', { enter: () => this.enterServe(), update: (_, dt) => this.updateServe(dt) })
      .add('rally', { update: (_, dt) => this.updateRally(dt) })
      .add('pointOver', { update: () => this.updatePointOver() })
      .add('sideSwitch', { enter: () => this.enterSideSwitch(), update: () => this.updateSideSwitch() })
      .add('replay', { enter: () => this.enterReplay(), update: (_, dt) => this.updateReplay(dt) })
      .add('matchOver', { enter: () => this.enterMatchOver(), update: (_, dt) => this.updateMatchOver(dt) })
      .add('practice', { enter: () => this.enterPractice(), update: (_, dt) => this.updatePractice(dt) });

    this.deps.hud.setVisible(true);
    this.deps.hud.clear();
    if (config.mode === 'practice') this.sm.set('practice');
    else this.sm.set('intro');
  }

  // ---------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------

  dispose(): void {
    this.deps.scene.scene.remove(this.group);
    this.deps.hud.setVisible(false);
    this.deps.hud.hideScoreboard();
    this.deps.loop.timeScale = 1;
    this.aura.stop();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }

  /** User quit from the pause menu. */
  abort(): void {
    if (this.finished) return;
    this.finished = true;
    this.deps.onFinished({ winnerTeam: -1, score: this.scoring.state, names: this.teamNames(), stats: this.stats, aborted: true });
  }

  /** Restart from the pause menu: rebuild the same match. */
  get state(): MatchState | null {
    return this.sm.current;
  }

  get isServing(): boolean {
    return this.sm.current === 'serve' || this.sm.current === 'preServe';
  }

  private teamNames(): [string, string] {
    const n = (team: number) =>
      this.players
        .filter((p) => p.team === team)
        .map((p) => p.def.name.split(' ')[0])
        .join(' & ');
    return [n(0), n(1) || 'MACHINE'];
  }

  private cameraSide(): number {
    // Follow the first human's team; fall back to team 0.
    const human = this.players.find((p) => p.isHuman);
    return human ? human.side : 1;
  }

  private humanOnTeam(team: number): Player | undefined {
    return this.players.find((p) => p.team === team && p.isHuman);
  }

  // ---------------------------------------------------------------------------------------------
  // PlayerHost
  // ---------------------------------------------------------------------------------------------

  canHit(p: Player): boolean {
    const b = this.ball;
    if (!b.inPlay) return false;
    if (b.lastHitTeam === p.team) return false;
    if (b.isServe && b.bounces === 0) return false;
    if (this.sm.current !== 'rally' && this.sm.current !== 'practice') return false;
    if (this.sm.current === 'practice' && !this.practiceBallLive) return false;
    return true;
  }

  isPowerBallIncoming(p: Player): boolean {
    const b = this.ball;
    return b.inPlay && b.isPower && b.lastHitTeam !== p.team && b.bounces <= 1 && b.vel.z * p.side > 0;
  }

  getIntercept(p: Player): { x: number; z: number; t: number } | null {
    const traj = this.trajectory;
    if (traj.length === 0) return null;
    const racketZ = p.pos.z + p.forward * 0.3;
    let lastOnSide: TrajectorySample | null = null;
    for (const s of traj) {
      if (s.t < this.flightTime) continue;
      if (s.z * p.side < -0.2) continue; // not yet on our side
      lastOnSide = s;
      if ((s.z - racketZ) * p.side <= 0.05) {
        return { x: s.x, z: s.z, t: s.t - this.flightTime };
      }
      if (s.bounces >= 2) break;
    }
    if (lastOnSide) return { x: lastOnSide.x, z: lastOnSide.z, t: lastOnSide.t - this.flightTime };
    return null;
  }

  onChargeStart(p: Player, _shot: ShotType): void {
    this.chargeTickLevel[p.index] = 0;
    if (p.isHuman) audio.chargeTick(0);
  }

  onDive(p: Player): void {
    audio.dive();
    audio.grunt(p.def.voice, 0.9);
    burstDust(this.particles, p.pos.clone().setY(0.05), this.config.court.colors.court, 1.2);
  }

  onBlockFail(p: Player): void {
    audio.stun();
    this.deps.hud.callout('KNOCKED BACK!', 'bad', 0.9);
    this.deps.rig.addShake(0.6);
    this.lastPowerKnock = true;
    burstImpact(this.particles, this.ball.pos.clone(), 0xffffff, 20, 6);
  }

  /** Resolve a racket contact. Humans and the AI both end up here. */
  onHit(p: Player, h: HitParams): void {
    const ball = this.ball;
    const def = SHOTS[h.shot];
    const pc = this.controllers[p.index];
    const aiDiff = (pc.autopilot ?? pc.ai)?.diff;
    const oppSide = -p.side;
    const rightSign = p.side > 0 ? 1 : -1;

    // --- Speed --------------------------------------------------------------------------
    let speed = def.speed * p.powerScale;
    speed *= 1 + h.charge * PLAYER.chargeMaxBonus;
    if (h.perfect) speed *= 1 + PLAYER.perfectPowerBonus;
    if (h.chance !== 'none') speed *= 1 + CHANCE.powerBonus + (h.chance === 'match' ? CHANCE.matchBonus : 0);
    if (h.isPower) speed *= POWER_METER.powerShotSpeedMul;
    if (h.fromDive) speed *= 0.75;

    // --- Spin ---------------------------------------------------------------------------
    let topspin = def.topspin * p.spinScale * (1 + h.charge * 0.3);
    // Sidespin bends the flight toward the aim direction; Tricky types curve a lot.
    const trickMul = p.def.type === 'Tricky' ? 2.2 : 1;
    let sidespin = -h.aimX * 45 * p.spinScale * trickMul * rightSign;
    if (h.shot === 'flat' || h.isPower) sidespin *= 0.3;
    if (h.isBlock) {
      topspin = -40;
      sidespin = 0;
    }

    // --- Target -------------------------------------------------------------------------
    const target = this.tmp2;
    if (h.aimTarget) {
      target.copy(h.aimTarget);
    } else {
      const depth = THREE.MathUtils.clamp(def.depth + h.aimDepth * 0.22, 0.14, 0.97);
      target.z = oppSide * depth * COURT.halfLength;
      let x = h.aimX * def.width * this.halfWidth * rightSign;
      // Timing: early -> cross-court (away from the hitter's x), late -> down the line.
      const hitterSide = Math.sign(p.pos.x) || rightSign;
      x += -hitterSide * h.timing * PLAYER.timingAimShift * (1 - Math.abs(h.aimX) * 0.4);
      target.x = THREE.MathUtils.clamp(x, -this.halfWidth * 0.95, this.halfWidth * 0.95);
    }
    if (h.isBlock) {
      target.x *= 0.5;
      target.z = oppSide * COURT.halfLength * 0.6;
    }

    // --- Error --------------------------------------------------------------------------
    let sigma = def.error * p.errorScale;
    if (h.perfect) sigma *= 0.45;
    if (h.charge > 0.5) sigma *= 0.8;
    if (h.fromDive) sigma *= 2.2;
    if (h.isBlock) sigma *= 1.6;
    if (h.chance !== 'none') sigma *= 0.7;
    if (aiDiff) {
      sigma *= aiDiff.errorScale;
      // CPU "fatigue": long rallies get progressively sloppier so points do end.
      sigma *= 1 + Math.min(1, this.rallyHits / 24) * 0.6;
    }
    // Hitting on the run or very late/early is harder.
    const runFactor = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / Math.max(1, p.runSpeed));
    sigma *= 1 + runFactor * 0.6;
    if (Math.abs(h.timing) > 0.6) sigma *= 1.4;
    target.x += gauss() * sigma;
    target.z += gauss() * sigma * 0.8;
    // Never aim into the net or behind the hitter.
    if (target.z * oppSide < 1.2) target.z = oppSide * 1.2;

    // --- Solve --------------------------------------------------------------------------
    const start = this.tmp.copy(ball.pos);
    if (start.y < 0.25) start.y = 0.25;
    const result = solveShot(
      { start, target, speed, angle: def.angle, topspin, sidespin, netClearance: def.netClearance + (h.isPower ? 0.1 : 0) },
      this.env,
    );
    ball.state.pos.copy(start);
    ball.vel.copy(result.velocity);
    ball.state.spin.copy(result.spin);
    ball.state.rolling = false;
    ball.lastHitter = p.index;
    ball.lastHitTeam = p.team;
    ball.isServe = false;
    ball.onHit(h.shot, h.isPower);
    this.hitId++;
    this.rallyHits++;
    if (p.index === this.receiverIndex) this.receiverSwung = true;
    this.lastPowerKnock = false;
    this.recomputeTrajectory();

    // --- Feedback -----------------------------------------------------------------------
    audio.hit(h.shot, h.charge + (h.isPower ? 1 : 0.4), h.isPower);
    audio.grunt(p.def.voice, h.isPower ? 1 : 0.4 + h.charge * 0.5);
    burstImpact(this.particles, ball.pos.clone(), h.isPower ? 0xffffff : def.color, h.isPower ? 30 : 10, h.isPower ? 7 : 3.5);
    this.deps.loop.hitStop(h.isPower ? PLAYER.hitStop * 3 : PLAYER.hitStop);

    if (h.perfect) {
      audio.perfect();
      this.deps.hud.callout('PERFECT!', 'good', 0.7);
      this.particles.emit({ pos: ball.pos.clone(), count: 24, color: [0xffffff, 0xfff6a8], speed: 5, spread: 1, life: 0.35, size: 0.1, gravity: 0, drag: 3 });
    } else if (h.chance !== 'none') {
      this.deps.hud.callout(h.chance === 'match' ? 'SUPER CHANCE!' : 'CHANCE!', 'good', 0.8);
      audio.fanfare(false);
    } else if (h.charge >= 0.95 && !h.isPower) {
      this.deps.hud.callout('FULL CHARGE!', 'normal', 0.6);
    } else if (h.isBlock) {
      this.deps.hud.callout('BLOCKED!', 'good', 0.8);
      audio.perfect();
    } else if (h.fromDive) {
      this.deps.hud.callout('DIVE!', 'normal', 0.6);
    }

    if (h.isPower) {
      this.startPowerShot(p);
    } else if (ball.isPower) {
      // defensive: ensure the aura stops when a non-power hit happens
      this.aura.stop();
    }

    // --- Meter --------------------------------------------------------------------------
    if (!h.isPower) {
      p.addPower(h.perfect ? POWER_METER.perPerfectShot : POWER_METER.perGoodShot);
      if (this.rallyHits > 4) p.addPower(POWER_METER.perRallyShot);
      if (h.chance !== 'none') p.addPower(POWER_METER.perChanceZone);
      if (p.powerMeter >= 0.999 && p.isHuman) audio.meterFull();
    }

    // --- Chance zone for the other team -------------------------------------------------
    this.chanceStar.hide();
    for (const q of this.players) q.chanceZone = null;
    this.evaluateChance(p, h);

    // Rally callouts
    if (this.rallyHits === 8 || this.rallyHits === 14 || this.rallyHits === 20) {
      this.deps.hud.callout('NICE RALLY!', 'normal', 0.8);
      this.crowd.cheer(0.4);
      audio.cheer(0.4);
    }
    audio.setCrowdLevel(Math.min(1, 0.15 + this.rallyHits * 0.06));

    if (this.mode === 'practice') this.practiceStats.shots++;
  }

  private startPowerShot(p: Player): void {
    const ball = this.ball;
    this.deps.hud.callout(`${p.def.powerShotName.toUpperCase()}!`, 'power', 1.4);
    this.aura.start(p.def.element);
    burstPowerStart(this.particles, ball.pos.clone(), p.def.element);
    this.slowMo = POWER_METER.slowMoDuration;
    this.deps.loop.timeScale = POWER_METER.slowMoScale;
    this.deps.rig.powerPos.copy(p.pos);
    this.deps.rig.setMode('power');
    this.powerCamTimer = 0.7;
    this.deps.rig.addShake(0.5);
    this.stats[p.team].powerShots++;
    audio.powerCharge();
    this.crowd.cheer(0.8);
  }

  /** Decide whether the shot just played is weak enough to create a chance zone for the receivers. */
  private evaluateChance(hitter: Player, h: HitParams): void {
    if (this.mode === 'practice') return;
    const r = this.trajResult;
    if (!r.landing) return;
    const speed = this.ball.vel.length();
    const depthFromNet = Math.abs(r.landing.z);
    const weak = (r.apex > CHANCE.minPeakHeight && depthFromNet < CHANCE.maxDepthFromNet) || speed < CHANCE.maxSpeed || h.fromDive || h.isBlock;
    if (!weak || h.isPower || h.shot === 'lob' && r.apex < 3.5 && depthFromNet > 7) return;
    // Find where the receiver should stand: after the first bounce, as the ball comes down to ~1.1 m.
    let spot: TrajectorySample | null = null;
    for (const s of r.samples) {
      if (s.bounces >= 1 && s.vy < 0 && s.y < 1.2) {
        spot = s;
        break;
      }
      if (s.bounces >= 2) break;
    }
    if (!spot) return;
    const receivers = this.players.filter((q) => q.team !== hitter.team);
    if (receivers.length === 0) return;
    const side = receivers[0].side;
    if (Math.abs(spot.z) > COURT.halfLength + 1) return;
    const shots: ShotType[] = spot.y > 1.0 || r.apex > 3 ? ['flat', 'topspin'] : ['topspin', 'slice'];
    const shot = shots[Math.floor(Math.random() * shots.length)];
    const zone = { x: spot.x, z: spot.z + side * 0.35, shot, color: SHOTS[shot].color };
    for (const q of receivers) q.chanceZone = zone;
    this.chanceStar.show(zone.x, zone.z, zone.color);
    audio.chanceAppear();
  }

  /** Simulate the current ball flight for the landing marker, magnet and AI. */
  private recomputeTrajectory(): void {
    simulateTrajectory(this.ball.state, this.env, TIMING.physicsDt, 5, false, this.trajResult);
    this.trajectory = this.trajResult.samples;
    this.flightTime = 0;
    const l = this.trajResult.landing;
    if (l) {
      const isIn = this.ball.isServe ? this.isInServiceBox(l.x, l.z) : this.isInCourt(l.x, l.z);
      this.ball.setPrediction(l.x, l.z, l.t, isIn);
    } else {
      this.ball.clearPrediction();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------------------------

  isInCourt(x: number, z: number): boolean {
    const r = BALL.radius;
    return Math.abs(x) <= this.halfWidth + r && Math.abs(z) <= COURT.halfLength + r;
  }

  /** Service box the current serve must land in. */
  private serviceBox(): { xMin: number; xMax: number; zMin: number; zMax: number } {
    const server = this.players[this.serverIndex];
    const s = server.side;
    const rightSign = s > 0 ? 1 : -1;
    const sideName = this.scoring.serviceSide();
    // Deuce: the server stands on their right and serves to the box on the opposite x sign.
    const boxSign = sideName === 'deuce' ? -rightSign : rightSign;
    const xMin = boxSign > 0 ? 0 : -COURT.singlesHalfWidth;
    const xMax = boxSign > 0 ? COURT.singlesHalfWidth : 0;
    const zA = -s * 0;
    const zB = -s * COURT.serviceLineZ;
    return { xMin, xMax, zMin: Math.min(zA, zB), zMax: Math.max(zA, zB) };
  }

  isInServiceBox(x: number, z: number): boolean {
    const b = this.serviceBox();
    const r = BALL.radius;
    return x >= b.xMin - r && x <= b.xMax + r && z >= b.zMin - r && z <= b.zMax + r;
  }

  private serverX(): number {
    const server = this.players[this.serverIndex];
    const rightSign = server.side > 0 ? 1 : -1;
    return this.scoring.serviceSide() === 'deuce' ? rightSign * 1.3 : -rightSign * 1.3;
  }

  // ---------------------------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------------------------

  private enterIntro(): void {
    this.deps.hud.callout(this.config.title ?? 'MATCH START', 'big', 1.6);
    this.deps.hud.setHint(this.controlsHint());
    this.placePlayersForServe(true);
    this.ball.reset(this.players[this.serverIndex].pos.x, 1.0, this.players[this.serverIndex].pos.z);
    this.deps.rig.setMode('follow', true);
    this.updateScoreboard();
    audio.startCrowd();
    audio.setCrowdLevel(0.2);
  }

  private controlsHint(): string {
    return `<b>WASD</b> move · <b>J</b> topspin · <b>K</b> slice · <b>J+K</b> flat · <b>J→K</b> lob · <b>K→J</b> drop · <b>L</b> dive · <b>U</b> power shot · <b>Esc</b> pause<br>Hold a shot button early to <b>charge</b>. Serve: press once to toss, again at the top to hit.`;
  }

  private updateIntro(_dt: number): void {
    if (this.sm.time > 1.6) this.sm.set('preServe');
  }

  /** Who serves: the team from the scoring state, the member rotates within the team. */
  private resolveServerAndReceiver(): void {
    const team = this.scoring.state.server;
    const teamPlayers = this.players.filter((p) => p.team === team);
    const member = this.serveTeamMember[team] % teamPlayers.length;
    this.serverIndex = teamPlayers[member].index;
    const opp = this.players.filter((p) => p.team !== team);
    if (opp.length === 1) {
      this.receiverIndex = opp[0].index;
    } else {
      // Doubles: the receiver is the partner covering the box being served to.
      const sideName = this.scoring.serviceSide();
      const server = this.players[this.serverIndex];
      const rightSign = server.side > 0 ? 1 : -1;
      const boxSign = sideName === 'deuce' ? -rightSign : rightSign;
      // Partner ordering swaps every game so both get to receive on each side.
      const g = this.scoring.state.gamesInSet + this.scoring.state.sets[0] + this.scoring.state.sets[1];
      const ordered = g % 2 === 0 ? opp : [opp[1], opp[0]];
      this.receiverIndex = (boxSign > 0 ? ordered[0] : ordered[1]).index;
    }
  }

  private placePlayersForServe(resetAll: boolean): void {
    this.resolveServerAndReceiver();
    const server = this.players[this.serverIndex];
    const receiver = this.players[this.receiverIndex];
    const sx = this.serverX();
    server.placeAt(sx, server.side * (COURT.halfLength + 0.5));
    receiver.placeAt(-Math.sign(sx) * 2.4, receiver.side * (COURT.halfLength - 0.2));
    server.doublesRole = this.mode === 'doubles' ? 'baseline' : 'single';
    receiver.doublesRole = this.mode === 'doubles' ? 'baseline' : 'single';
    for (const p of this.players) {
      if (p === server || p === receiver) continue;
      // Doubles partners: server's partner at the net, receiver's partner at the service line.
      if (p.team === server.team) {
        p.placeAt(-Math.sign(sx) * 2.6, p.side * 3.4);
        p.doublesRole = 'net';
      } else {
        p.placeAt(Math.sign(sx) * 2.6, p.side * 6.2);
        p.doublesRole = 'net';
      }
    }
    if (resetAll) for (const c of this.controllers) c.human?.reset();
  }

  private enterPreServe(): void {
    this.placePlayersForServe(true);
    const server = this.players[this.serverIndex];
    this.ball.reset(server.pos.x + (server.side > 0 ? -0.35 : 0.35), 1.05, server.pos.z);
    this.tossed = false;
    this.serveNetCord = false;
    this.rallyHits = 0;
    this.receiverSwung = false;
    this.lastPowerKnock = false;
    this.aura.stop();
    this.chanceStar.hide();
    for (const p of this.players) {
      p.chanceZone = null;
      p.freeze();
    }
    this.deps.rig.serverPos.copy(server.pos);
    this.deps.rig.setMode('serve');
    this.updateScoreboard();
    if (this.faults === 1) this.deps.hud.announce('SECOND SERVE', 1.6);
    else if (this.sm.time === 0 && this.scoring.state.pointsInGame === 0 && !this.scoring.state.inTiebreak) {
      // New game: say who serves.
      this.deps.hud.announce(`${server.def.name.toUpperCase()} TO SERVE`, 1.8);
    }
  }

  private updatePreServe(): void {
    if (this.sm.time > (this.faults === 1 ? 0.9 : 1.4)) this.sm.set('serve');
  }

  private enterServe(): void {
    for (const p of this.players) p.unfreeze();
    this.aiServeTimer = TIMING.aiServeDelay * (0.8 + Math.random() * 0.5);
    this.replay.beginRecording();
  }

  private updateServe(dt: number): void {
    const server = this.players[this.serverIndex];
    const ctrl = this.controllers[this.serverIndex];
    const ball = this.ball;
    const humanServer = !!ctrl.human && !ctrl.autopilot;
    const serverAi = ctrl.autopilot ?? ctrl.ai;
    // Non-servers may shuffle; the server stays planted.
    const intent = ctrl.intent;
    if (humanServer) {
      const inp = this.deps.input.players[ctrl.humanSlot];
      ctrl.human!.intent(inp, performance.now(), this.deps.rig.side, server.side, intent);
    }
    if (!this.tossed) {
      // Ball rests in the hand.
      ball.state.pos.set(server.pos.x + (server.side > 0 ? -0.35 : 0.35), 1.05, server.pos.z);
      let doToss = false;
      if (humanServer) doToss = intent.shotPressed || intent.power;
      else {
        this.aiServeTimer -= dt;
        doToss = this.aiServeTimer <= 0;
      }
      if (doToss) {
        this.tossed = true;
        ball.vel.set(0, TIMING.tossSpeed, server.side * -0.4);
        ball.state.spin.set(0, 0, 0);
        this.tossApex = ball.pos.y + (TIMING.tossSpeed * TIMING.tossSpeed) / (2 * BALL.gravity);
        server.model.setPose('toss');
        audio.swing();
        this.deps.rig.setMode('follow');
        this.aiServeTimer = 0.1 + Math.random() * 0.1;
      }
    } else {
      // Toss in flight: integrate without the net/ground logic (simple gravity).
      ball.vel.y -= BALL.gravity * dt;
      ball.pos.addScaledVector(ball.vel, dt);
      let hit = false;
      let shot: ShotType = 'flat';
      if (humanServer) {
        if (intent.power && server.powerMeter >= 0.999) {
          hit = true;
          shot = 'power';
        } else if (intent.shotPressed && intent.shot) {
          hit = true;
          shot = intent.shot === 'slice' || intent.shot === 'drop' ? 'slice' : intent.shot === 'topspin' || intent.shot === 'lob' ? 'topspin' : 'flat';
        }
      } else {
        // AI: hit near the apex, with noise scaled by serve quality.
        const q = serverAi!.diff.serveQuality;
        if (ball.vel.y < 1.2 - (1 - q) * 1.8 + (Math.random() - 0.5) * 0.4) {
          hit = true;
          const roll = Math.random();
          shot = this.faults === 1 ? (roll < 0.6 ? 'topspin' : 'slice') : roll < 0.45 ? 'flat' : roll < 0.75 ? 'topspin' : 'slice';
        }
      }
      if (hit && ball.pos.y > 1.3) {
        this.hitServe(server, shot, intent);
      } else if (ball.pos.y < 1.0 && ball.vel.y < 0) {
        // Missed the toss: catch it and start over.
        this.tossed = false;
        server.model.setPose('idle');
        this.deps.rig.setMode('serve');
      }
    }
    // Let the other players move.
    for (const p of this.players) {
      if (p === server) {
        p.syncModel();
        p.model.update(dt);
        continue;
      }
      this.driveController(p, dt);
    }
    this.replay.record(this.ball, this.players);
  }

  private hitServe(server: Player, shot: ShotType, intent: Intent): void {
    const ball = this.ball;
    const q = THREE.MathUtils.clamp(1 - Math.abs(ball.pos.y - this.tossApex) / 0.6, 0, 1);
    const box = this.serviceBox();
    const c = this.controllers[server.index];
    const aiDiff = (c.autopilot ?? c.ai)?.diff;
    const def = SHOTS.serve;
    let speed = def.speed * server.powerScale * (0.7 + 0.35 * q);
    let topspin = 40 * server.spinScale;
    let sidespin = 0;
    let clearance = 0.12;
    let sigma = 0.9 * server.errorScale * (1.1 - 0.5 * q);
    let trailShot: ShotType = 'flat';
    const rightSign = server.side > 0 ? 1 : -1;
    switch (shot) {
      case 'topspin':
        speed *= 0.86;
        topspin = 170 * server.spinScale;
        clearance = 0.45;
        sigma *= 0.75;
        trailShot = 'topspin';
        break;
      case 'slice':
        speed *= 0.9;
        topspin = -30;
        sidespin = 110 * server.spinScale * -rightSign * (box.xMin >= 0 ? -1 : 1);
        clearance = 0.3;
        sigma *= 0.85;
        trailShot = 'slice';
        break;
      case 'power':
        speed *= POWER_METER.powerShotSpeedMul * 0.95;
        clearance = 0.15;
        sigma *= 0.6;
        trailShot = 'power';
        server.powerMeter = 0;
        break;
      default:
        break;
    }
    if (aiDiff) {
      sigma *= aiDiff.errorScale;
      speed *= 0.85 + 0.15 * aiDiff.serveQuality;
      if (this.faults === 1) {
        speed *= 0.82;
        sigma *= 0.6;
        clearance += 0.25;
      }
    }
    // Aim inside the box.
    const cx = (box.xMin + box.xMax) / 2;
    const bw = (box.xMax - box.xMin) / 2;
    const target = this.tmp2;
    if (intent.aimTarget && aiDiff) {
      target.copy(intent.aimTarget);
    } else {
      const aim = aiDiff ? (Math.random() - 0.5) * 1.4 : intent.aimX * rightSign;
      target.x = cx + THREE.MathUtils.clamp(aim, -1, 1) * bw * 0.65;
      const depthAim = aiDiff ? (Math.random() - 0.5) * 0.6 : intent.aimDepth;
      const zNear = Math.min(Math.abs(box.zMin), Math.abs(box.zMax));
      const zFar = Math.max(Math.abs(box.zMin), Math.abs(box.zMax));
      const depth = THREE.MathUtils.clamp(0.8 + depthAim * 0.15, 0.35, 0.95);
      target.z = -server.side * (zNear + (zFar - zNear) * depth);
    }
    target.x += gauss() * sigma * 0.8;
    target.z += gauss() * sigma * 0.6;

    const result = solveShot({ start: ball.pos.clone(), target, speed, topspin, sidespin, netClearance: clearance }, this.env);
    ball.vel.copy(result.velocity);
    ball.state.spin.copy(result.spin);
    ball.state.rolling = false;
    ball.inPlay = true;
    ball.isServe = true;
    ball.lastHitter = server.index;
    ball.lastHitTeam = server.team;
    ball.onHit(trailShot, shot === 'power');
    this.hitId++;
    this.rallyHits = 1;
    this.receiverSwung = false;
    this.recomputeTrajectory();
    server.model.setPose('serveHit');
    audio.hit('serve', 0.4 + q * 0.6, shot === 'power');
    audio.grunt(server.def.voice, 0.5 + q * 0.5);
    burstImpact(this.particles, ball.pos.clone(), SHOTS[trailShot].color, 10, 3);
    if (q > 0.85) this.deps.hud.callout('FAST SERVE!', 'good', 0.7);
    if (shot === 'power') this.startPowerShot(server);
    this.sm.set('rally');
  }

  private driveController(p: Player, dt: number): void {
    const ctrl = this.controllers[p.index];
    const ai = ctrl.autopilot ?? ctrl.ai;
    if (ai) {
      ai.update(dt, ctrl.intent, this.sm.current === 'serve' || this.sm.current === 'preServe');
    } else if (ctrl.human) {
      const inp = this.deps.input.players[ctrl.humanSlot];
      ctrl.human.intent(inp, performance.now(), this.deps.rig.side, p.side, ctrl.intent);
    }
    p.update(dt, ctrl.intent, this);
  }

  /** Debug helper: let an AI drive every human slot. */
  setAutopilot(on: boolean, difficulty: Difficulty = 'hard'): void {
    for (const c of this.controllers) {
      if (!c.human) continue;
      const p = this.players[this.controllers.indexOf(c)];
      c.autopilot = on ? new OpponentAI(p, difficulty, this) : null;
      if (!on) p.speedScale = 1;
    }
  }

  private updateRally(dt: number): void {
    const ball = this.ball;
    // Players
    for (const p of this.players) this.driveController(p, dt);

    // Ball
    this.events.length = 0;
    this.stepBallWithEvents(dt);
    this.flightTime += dt;
    this.replay.record(ball, this.players);

    // Ball flew way out without bouncing.
    if (ball.inPlay && ball.bounces === 0) {
      const beyondBaseline = Math.abs(ball.pos.z) > COURT.halfLength + 1.6 && ball.pos.z * ball.vel.z > 0;
      const beyondSide = Math.abs(ball.pos.x) > this.halfWidth + 3.0;
      if (beyondBaseline || beyondSide) {
        this.endPoint(1 - ball.lastHitTeam, 'OUT!', 'bad');
        return;
      }
    }
    // A ball that bounced in and has left the area players can reach: the receiver failed.
    if (ball.inPlay && ball.bounces >= 1) {
      const gone =
        (Math.abs(ball.pos.z) > COURT.halfLength + COURT.runbackDepth + 0.6 && ball.pos.z * ball.vel.z > 0) ||
        (Math.abs(ball.pos.x) > COURT.doublesHalfWidth + COURT.runoutWidth + 0.6 && ball.pos.x * ball.vel.x > 0);
      if (gone) {
        this.resolveUnreturned();
        return;
      }
    }
    // Safety: a dead ball that never produced a decisive event.
    if (ball.inPlay && (ball.state.rolling || ball.vel.lengthSq() < 0.01) && this.sm.time > 2) {
      if (ball.bounces >= 1) this.resolveUnreturned();
      else {
        const sideTeam = this.teamOnSide(ball.pos.z);
        this.endPoint(1 - sideTeam, 'POINT', 'normal');
      }
    }
  }

  /** Which team defends the half containing z. */
  private teamOnSide(z: number): number {
    const s = Math.sign(z) || 1;
    const p = this.players.find((q) => q.side === s);
    return p ? p.team : 0;
  }

  private stepBallWithEvents(dt: number): void {
    const ball = this.ball;
    stepBall(ball.state, dt, this.env, this.events);
    for (const e of this.events) this.handleBallEvent(e);
  }

  private handleBallEvent(e: BallEvent): void {
    const ball = this.ball;
    const inPractice = this.sm.current === 'practice';
    switch (e.type) {
      case 'bounce': {
        ball.onBounce();
        const brightness = this.config.court.surface.soundBrightness;
        audio.bounce(brightness, e.speed, e.patch);
        burstDust(this.particles, e.pos.clone(), this.config.court.colors.court, Math.min(1.5, e.speed / 18));
        if (this.config.court.surface.marks) this.court.addMark(e.pos.x, e.pos.z);
        if (e.patch) {
          this.deps.hud.callout('BOING!', 'normal', 0.5);
          this.particles.emit({ pos: e.pos.clone(), count: 16, color: [0xff4fa3, 0xffffff], speed: 4, spread: 1, life: 0.5, size: 0.08, gravity: 4, drag: 1.5 });
        }
        if (!ball.inPlay) break;
        if (inPractice) {
          this.practiceBounce(e.pos);
          break;
        }
        this.resolveBounce(e.pos);
        break;
      }
      case 'netcord': {
        audio.net();
        this.net.hit(e.pos.x);
        burstImpact(this.particles, e.pos.clone(), 0xffffff, 6, 2);
        if (ball.isServe) this.serveNetCord = true;
        if (!inPractice) this.deps.hud.callout(e.over ? 'NET CORD!' : 'NET!', e.over ? 'normal' : 'bad', 0.7);
        this.recomputeTrajectory();
        break;
      }
      case 'netmesh': {
        audio.net();
        this.net.hit(e.pos.x);
        burstImpact(this.particles, e.pos.clone(), 0xffffff, 6, 2);
        if (!inPractice) this.deps.hud.callout('NET!', 'bad', 0.7);
        this.recomputeTrajectory();
        break;
      }
    }
  }

  private resolveBounce(pos: THREE.Vector3): void {
    const ball = this.ball;
    const hitTeam = ball.lastHitTeam;
    const bounceSideTeam = this.teamOnSide(pos.z);
    if (ball.bounces === 1) {
      if (ball.isServe) {
        const inBox = this.isInServiceBox(pos.x, pos.z);
        if (inBox && this.serveNetCord) {
          this.letServe();
          return;
        }
        if (!inBox) {
          this.serveFault(bounceSideTeam === hitTeam ? 'FAULT!' : 'FAULT!');
          return;
        }
        return; // good serve, live ball
      }
      if (bounceSideTeam === hitTeam) {
        // Landed on the hitter's own side (net dribble etc.).
        this.endPoint(1 - hitTeam, 'NET!', 'bad');
        return;
      }
      if (!this.isInCourt(pos.x, pos.z)) {
        this.endPoint(1 - hitTeam, 'OUT!', 'bad');
        return;
      }
      // In: ball is live, receiver must return it before the second bounce.
      this.ball.clearPrediction();
      return;
    }
    if (ball.bounces >= 2) this.resolveUnreturned();
  }

  /** The ball bounced in and was not returned: point to the last hitter. */
  private resolveUnreturned(): void {
    const ball = this.ball;
    const hitTeam = ball.lastHitTeam;
    if (ball.isServe) {
      if (!this.receiverSwung) this.stats[hitTeam].aces++;
      this.endPoint(hitTeam, this.receiverSwung ? 'SERVICE WINNER!' : 'ACE!', 'good');
    } else if (this.lastPowerKnock) {
      this.endPoint(hitTeam, 'SMASHED!', 'power');
    } else {
      this.stats[hitTeam].winners++;
      const human = this.humanOnTeam(hitTeam);
      this.endPoint(hitTeam, human ? 'NICE SHOT!' : 'WINNER!', 'good');
    }
  }

  private letServe(): void {
    this.deps.hud.callout('LET', 'normal', 0.9);
    audio.ui('back');
    this.ball.inPlay = false;
    this.sm.set('preServe');
  }

  private serveFault(text: string): void {
    this.faults++;
    this.ball.inPlay = false;
    audio.fault();
    if (this.faults >= 2) {
      this.faults = 0;
      this.deps.hud.callout('DOUBLE FAULT!', 'bad', 1.2);
      this.pointWinner = 1 - this.players[this.serverIndex].team;
      this.finishPoint();
      return;
    }
    this.deps.hud.callout(text, 'bad', 1.0);
    this.sm.set('preServe');
  }

  private endPoint(winnerTeam: number, callout: string, style: 'normal' | 'good' | 'bad' | 'power'): void {
    if (this.sm.current !== 'rally') return;
    this.pointWinner = winnerTeam;
    this.deps.hud.callout(callout, style, 1.2);
    this.faults = 0;
    this.finishPoint();
  }

  /** Common point wrap-up: score, feedback, next state. */
  private finishPoint(): void {
    const winner = this.pointWinner;
    this.ball.inPlay = false;
    this.ball.clearPrediction();
    this.aura.stop();
    this.chanceStar.hide();
    this.deps.loop.timeScale = 1;
    this.slowMo = 0;
    for (const p of this.players) {
      p.chanceZone = null;
      if (p.team === winner) p.addPower(POWER_METER.perPointWon);
    }
    this.stats[winner].longestRally = Math.max(this.stats[winner].longestRally, this.rallyHits);
    const res = this.scoring.addPoint(winner);
    this.pendingSwitch = res.switchSides;
    if (res.serverChanged || res.gameWon) this.serveTeamMember[this.scoring.state.server] += res.gameWon ? 1 : 0;
    // In a tiebreak each change of server advances the rotation of that team.
    if (this.scoring.state.inTiebreak && res.serverChanged && !res.gameWon) this.serveTeamMember[this.scoring.state.server]++;

    // Crowd & audio
    const drama = Math.min(1, 0.3 + this.rallyHits * 0.05 + (res.gameWon ? 0.3 : 0));
    const humanWon = !!this.humanOnTeam(winner);
    if (humanWon) {
      audio.cheer(drama);
      this.crowd.cheer(drama);
    } else {
      audio.groan();
      this.crowd.cheer(drama * 0.5);
    }
    audio.setCrowdLevel(0.2);

    // Announcements
    const names = this.teamNames();
    if (res.matchWon) {
      this.deps.hud.announce(`GAME, SET AND MATCH — ${names[winner].toUpperCase()}`, 3);
      audio.fanfare(true);
    } else if (res.setWon) {
      this.deps.hud.announce(`SET — ${names[winner].toUpperCase()}`, 2.4);
      audio.fanfare(true);
    } else if (res.gameWon) {
      this.deps.hud.announce(`GAME — ${names[winner].toUpperCase()}`, 2.2);
      audio.fanfare(false);
    } else {
      this.deps.hud.announce(this.scoring.announcement(), 1.8);
    }
    this.updateScoreboard();
    this.replay.stopRecording();
    this.sm.set('pointOver');
  }

  private updatePointOver(): void {
    const delay = this.scoring.state.winner !== null ? TIMING.pointOverDelay + 0.6 : TIMING.pointOverDelay;
    if (this.sm.time < delay) return;
    if (this.scoring.state.winner !== null) {
      this.sm.set(this.replay.hasData ? 'replay' : 'matchOver');
      return;
    }
    if (this.pendingSwitch) {
      this.pendingSwitch = false;
      this.sm.set('sideSwitch');
      return;
    }
    this.sm.set('preServe');
  }

  private enterSideSwitch(): void {
    this.deps.hud.callout('CHANGE ENDS', 'normal', 1.3);
    for (const p of this.players) {
      p.side = -p.side;
      p.freeze();
    }
    this.deps.rig.side = this.cameraSide();
    this.placePlayersForServe(true);
    for (const p of this.players) p.freeze();
    const server = this.players[this.serverIndex];
    this.ball.reset(server.pos.x, 1.05, server.pos.z);
    this.deps.rig.setMode('follow');
  }

  private updateSideSwitch(): void {
    if (this.sm.time > 1.5) this.sm.set('preServe');
  }

  private enterReplay(): void {
    this.deps.hud.callout('REPLAY', 'normal', 1.2);
    this.replay.beginPlayback(0.6);
    this.deps.rig.setMode('replay', true);
    for (const p of this.players) p.freeze();
  }

  private updateReplay(dt: number): void {
    const done = this.replay.playback(dt, this.ball, this.players);
    this.deps.rig.focusBall.copy(this.ball.pos);
    if (done) this.sm.set('matchOver');
  }

  private enterMatchOver(): void {
    const winner = this.scoring.state.winner ?? 0;
    for (const p of this.players) p.setCelebrate(p.team === winner);
    const w = this.players.find((p) => p.team === winner)!;
    this.deps.rig.victoryPos.copy(w.pos);
    this.deps.rig.setMode('victory');
    this.deps.hud.callout(`${this.teamNames()[winner].toUpperCase()} WINS!`, 'big', 3);
    this.confettiTimer = 3.5;
    audio.cheer(1);
    this.crowd.cheer(1);
  }

  private updateMatchOver(dt: number): void {
    this.confettiTimer -= dt;
    if (this.confettiTimer > 0 && Math.random() < dt * 6) {
      const w = this.players.find((p) => p.team === (this.scoring.state.winner ?? 0)) ?? this.players[0];
      burstConfetti(this.particles, new THREE.Vector3(w.pos.x + (Math.random() - 0.5) * 4, 4 + Math.random() * 2, w.pos.z + (Math.random() - 0.5) * 4), 30);
    }
    for (const p of this.players) {
      p.syncModel();
      p.model.update(dt);
    }
    if (this.sm.time > 4.5 && !this.finished) {
      this.finished = true;
      this.deps.onFinished({ winnerTeam: this.scoring.state.winner ?? 0, score: this.scoring.state, names: this.teamNames(), stats: this.stats, aborted: false });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Practice mode
  // ---------------------------------------------------------------------------------------------

  private buildTargets(): void {
    const opts = this.config.practice ?? { shot: 'random', interval: 2.6, target: 'random' };
    const zones: [number, number][] = [];
    const deep = -(COURT.halfLength - 1.6);
    const short = -3.2;
    switch (opts.target) {
      case 'left':
        zones.push([-2.6, deep]);
        break;
      case 'right':
        zones.push([2.6, deep]);
        break;
      case 'deep':
        zones.push([-2.6, deep], [2.6, deep]);
        break;
      case 'short':
        zones.push([-2.4, short], [2.4, short]);
        break;
      default:
        zones.push([-2.6, deep], [2.6, deep], [0, short]);
    }
    for (const [x, z] of zones) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.014, z);
      this.group.add(ring);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.35, 24), new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.8 }));
      inner.rotation.x = -Math.PI / 2;
      inner.position.set(x, 0.014, z);
      this.group.add(inner);
      this.targetRings.push(ring);
      this.targetCenters.push(new THREE.Vector3(x, 0, z));
    }
  }

  private enterPractice(): void {
    const p = this.players[0];
    p.side = 1;
    p.placeAt(0, COURT.halfLength - 0.5);
    this.deps.rig.side = 1;
    this.deps.rig.setMode('practice', true);
    this.deps.hud.callout('PRACTICE', 'big', 1.4);
    this.deps.hud.setHint(this.controlsHint());
    this.deps.hud.hideScoreboard();
    this.practiceTimer = 1.5;
    this.ball.reset(0, 1, -COURT.halfLength + 1);
    this.ball.inPlay = false;
    this.practiceBallLive = false;
    audio.startCrowd();
    audio.setCrowdLevel(0.08);
    this.updatePracticeHud();
  }

  private updatePracticeHud(): void {
    const s = this.practiceStats;
    const opts = this.config.practice ?? { shot: 'random', interval: 2.6, target: 'random' };
    this.deps.hud.setPractice(
      `<div class="pp-title">BALL MACHINE</div>
       <div class="pp-row"><span>Feed</span><b>${String(opts.shot).toUpperCase()}</b></div>
       <div class="pp-row"><span>Targets</span><b>${String(opts.target).toUpperCase()}</b></div>
       <div class="pp-row"><span>Returns in</span><b>${s.inPlay} / ${s.shots}</b></div>
       <div class="pp-row"><span>Targets hit</span><b>${s.hits}</b></div>
       <div class="pp-row"><span>Streak</span><b>${s.streak}</b> <span class="pp-best">best ${s.best}</span></div>
       <div class="pp-tip">Esc: change settings</div>`,
    );
  }

  private updatePractice(dt: number): void {
    const p = this.players[0];
    this.driveController(p, dt);
    const ball = this.ball;
    if (this.machine) this.machine.update(dt);

    if (!ball.inPlay) {
      this.practiceTimer -= dt;
      if (this.practiceTimer <= 0 && this.machine) {
        this.machine.fire(this.ball, this.env, this.players[0].pos);
        this.hitId++;
        this.practiceBallLive = true;
        this.recomputeTrajectory();
        audio.hit('flat', 0.4);
        burstImpact(this.particles, ball.pos.clone(), 0xffffff, 8, 3);
        this.replay.beginRecording();
      }
    } else {
      this.events.length = 0;
      this.stepBallWithEvents(dt);
      this.flightTime += dt;
      // Ball returned past the far baseline without bouncing = long.
      if (ball.lastHitTeam === 0 && ball.bounces === 0 && ball.pos.z < -(COURT.halfLength + 1.5)) {
        this.practiceResult(false, 'LONG!');
      }
      // Ball passed the player (machine feed not returned).
      if (ball.lastHitTeam !== 0 && (ball.bounces >= 2 || ball.pos.z > COURT.halfLength + COURT.runbackDepth + 1 || ball.state.rolling)) {
        this.practiceEndBall(0.9);
        this.practiceStats.streak = 0;
        this.updatePracticeHud();
      }
      if (ball.lastHitTeam === 0 && ball.state.rolling) this.practiceEndBall(0.8);
    }
  }

  private practiceBounce(pos: THREE.Vector3): void {
    const ball = this.ball;
    if (ball.lastHitTeam !== 0) {
      // Machine feed bouncing on our side: fine; if it bounces on the machine side it's a bad feed.
      if (pos.z < 0 && ball.bounces === 1) this.practiceEndBall(0.3);
      return;
    }
    if (ball.bounces !== 1) return;
    if (pos.z > 0) {
      this.practiceResult(false, 'NET!');
      return;
    }
    if (!this.isInCourt(pos.x, pos.z)) {
      this.practiceResult(false, 'OUT!');
      return;
    }
    let hitTarget = false;
    for (const c of this.targetCenters) {
      if (Math.hypot(c.x - pos.x, c.z - pos.z) <= 1.15) hitTarget = true;
    }
    this.practiceResult(true, hitTarget ? 'TARGET!' : 'IN');
    if (hitTarget) {
      this.practiceStats.hits++;
      this.particles.emit({ pos: pos.clone(), count: 30, color: [0xfff27a, 0xff4d4d, 0xffffff], speed: 5, spread: 1, life: 0.6, size: 0.1, gravity: 4, drag: 1.5 });
      audio.fanfare(false);
    }
  }

  private practiceResult(good: boolean, text: string): void {
    const s = this.practiceStats;
    if (good) {
      s.inPlay++;
      s.streak++;
      s.best = Math.max(s.best, s.streak);
      this.deps.hud.callout(text, text === 'TARGET!' ? 'good' : 'normal', 0.7);
    } else {
      s.streak = 0;
      this.deps.hud.callout(text, 'bad', 0.8);
      audio.fault();
    }
    this.updatePracticeHud();
    this.practiceEndBall(1.0);
  }

  private practiceEndBall(delay: number): void {
    this.ball.inPlay = false;
    this.practiceBallLive = false;
    this.ball.clearPrediction();
    this.practiceTimer = delay + (this.config.practice?.interval ?? 2.6) * 0.3;
    this.chanceStar.hide();
    this.players[0].chanceZone = null;
  }

  /** Update practice settings live (from the pause menu). */
  setPracticeOptions(opts: PracticeOptions): void {
    this.config.practice = opts;
    if (this.machine) this.machine.options = opts;
    for (const r of this.targetRings) this.group.remove(r);
    this.targetRings = [];
    this.targetCenters = [];
    this.group.children
      .filter((c) => (c as THREE.Mesh).geometry instanceof THREE.CircleGeometry && Math.abs(c.position.y - 0.014) < 1e-4)
      .forEach((c) => this.group.remove(c));
    this.buildTargets();
    this.updatePracticeHud();
  }

  // ---------------------------------------------------------------------------------------------
  // Frame / fixed update entry points
  // ---------------------------------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    this.time += dt;
    this.sm.update(dt);
    for (const p of this.players) p.time = this.time;
  }

  frame(dt: number, gameDt: number): void {
    const cam = this.deps.scene.camera;
    // Slow motion timer runs in real time.
    if (this.slowMo > 0) {
      this.slowMo -= dt;
      if (this.slowMo <= 0) this.deps.loop.timeScale = 1;
    }
    if (this.powerCamTimer > 0) {
      this.powerCamTimer -= dt;
      if (this.powerCamTimer <= 0 && this.deps.rig.mode === 'power') this.deps.rig.setMode('follow');
    }

    // Camera focus
    const human = this.players.find((p) => p.isHuman) ?? this.players[0];
    this.deps.rig.focusPlayer.copy(human.pos);
    this.deps.rig.focusBall.copy(this.ball.pos);
    if (this.sm.current !== 'replay' && this.sm.current !== 'matchOver' && this.sm.current !== 'practice') {
      if (this.deps.rig.mode !== 'serve' && this.deps.rig.mode !== 'power') this.deps.rig.setMode('follow');
    }

    // Visuals
    this.ball.updateVisuals(gameDt, cam);
    this.court.update(gameDt);
    this.net.update(gameDt);
    this.particles.update(gameDt);
    this.chanceStar.update(gameDt);
    this.aura.update(gameDt, this.ball.pos, this.ball.vel);
    this.crowd.update(dt, cam.position);
    if (this.sm.current === 'rally' || this.sm.current === 'practice' || this.sm.current === 'serve') {
      for (const p of this.players) {
        // Model animation is advanced in Player.update at the physics rate; nothing else needed.
        const bar = this.chargeBars[p.index];
        const top = this.tmp.set(p.pos.x, p.model.height + 0.45, p.pos.z);
        bar.update(p.charge, p.state === 'charging', top, cam, SHOTS[p.chargeShot].color);
        // Charge ticks
        if (p.state === 'charging' && p.isHuman) {
          const lvl = Math.floor(p.charge * 4);
          if (lvl > this.chargeTickLevel[p.index]) {
            this.chargeTickLevel[p.index] = lvl;
            audio.chargeTick(p.charge);
          }
        }
      }
    } else {
      for (const bar of this.chargeBars) bar.group.visible = false;
    }
    // Power meters
    const hud = this.deps.hud;
    if (this.mode === 'practice') {
      hud.setMeter(0, this.players[0].powerMeter, this.players[0].def.name, this.players[0].def.colors.primary);
      hud.setMeter(1, 0, '', 0, false);
    } else {
      for (let team = 0; team < 2; team++) {
        const lead = this.players.find((p) => p.team === team && p.isHuman) ?? this.players.find((p) => p.team === team)!;
        hud.setMeter(team, lead.powerMeter, lead.def.name.split(' ')[0], lead.def.colors.primary);
      }
    }
  }

  private updateScoreboard(): void {
    const s = this.scoring.state;
    const names = this.teamNames();
    const lead = (team: number) => this.players.find((p) => p.team === team)!;
    this.deps.hud.setScoreboard({
      names,
      colors: [lead(0).def.colors.primary, lead(1).def.colors.primary],
      sets: [s.sets[0], s.sets[1]],
      games: [s.games[0], s.games[1]],
      points: [this.scoring.pointLabel(0), this.scoring.pointLabel(1)],
      server: s.server,
      setHistory: s.history.map((h) => `${h.games[0]}-${h.games[1]}`).join('  '),
      inTiebreak: s.inTiebreak,
    });
  }

  /** The human team's side (for the pause menu etc). */
  get difficultyLabel(): string {
    const ai = this.controllers.find((c) => c.ai)?.ai;
    return ai ? DIFFICULTIES[ai.diff.id].label : '';
  }
}
