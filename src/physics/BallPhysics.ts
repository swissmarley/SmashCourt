/**
 * Pure ball physics. No rendering, no game rules.
 *
 * The same `stepBall` function drives the live ball, the shot solver and the AI prediction, so
 * everything agrees on where the ball will go.
 *
 * Model (per step):
 *   a = gravity + drag + Magnus
 *   drag   = -k_d * |v| * v               (quadratic air resistance)
 *   Magnus = k_m * (spin x v)             (topspin dips, backspin floats, sidespin curves)
 *   semi-implicit Euler: v += a dt ; p += v dt
 *
 * Spin is a vector in rad/s. For a ball travelling along horizontal direction d:
 *   topspin  = spin dotted with (up x d)   > 0 means the top of the ball rotates forward
 *   sidespin = spin.y                      rotation about the vertical axis
 */
import { Vector3 } from 'three';
import { BALL, BOUNCE, COURT } from '../config/constants';
import type { BouncyPatch } from '../config/courts';

export interface BallState {
  pos: Vector3;
  vel: Vector3;
  spin: Vector3;
  /** True once the ball is rolling on the ground (no more bounces). */
  rolling: boolean;
}

export interface SurfaceParams {
  restitution: number;
  friction: number;
  patches?: BouncyPatch[];
}

export interface PhysicsEnv {
  gravity: number;
  surface: SurfaceParams;
  /** When false the ball passes through the net plane (used by the solver to measure clearance). */
  netCollision: boolean;
}

export type BallEvent =
  | { type: 'bounce'; pos: Vector3; speed: number; patch: boolean; spinTop: number }
  | { type: 'netcord'; pos: Vector3; over: boolean }
  | { type: 'netmesh'; pos: Vector3 };

const UP = new Vector3(0, 1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpDir = new Vector3();
const tmpAxis = new Vector3();

export function createBallState(): BallState {
  return { pos: new Vector3(), vel: new Vector3(), spin: new Vector3(), rolling: false };
}

export function copyBallState(dst: BallState, src: BallState): BallState {
  dst.pos.copy(src.pos);
  dst.vel.copy(src.vel);
  dst.spin.copy(src.spin);
  dst.rolling = src.rolling;
  return dst;
}

/** Height of the net cord at a given x (parabolic sag between the posts). */
export function netHeightAt(x: number): number {
  const t = Math.min(1, Math.abs(x) / COURT.netPostX);
  return COURT.netHeightCenter + (COURT.netHeightPost - COURT.netHeightCenter) * t * t;
}

/** Topspin scalar (rad/s) for a given velocity: positive = topspin. */
export function topspinOf(spin: Vector3, vel: Vector3): number {
  tmpDir.set(vel.x, 0, vel.z);
  if (tmpDir.lengthSq() < 1e-6) return 0;
  tmpDir.normalize();
  tmpAxis.crossVectors(UP, tmpDir);
  return spin.dot(tmpAxis);
}

/** Build a spin vector from a topspin scalar and a sidespin scalar for a horizontal direction. */
export function makeSpin(dirH: Vector3, topspin: number, sidespin: number, out: Vector3): Vector3 {
  tmpDir.set(dirH.x, 0, dirH.z).normalize();
  tmpAxis.crossVectors(UP, tmpDir).multiplyScalar(topspin);
  out.copy(tmpAxis);
  out.y += sidespin;
  return out;
}

function findPatch(x: number, z: number, patches?: BouncyPatch[]): BouncyPatch | null {
  if (!patches) return null;
  for (const p of patches) {
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz <= p.radius * p.radius) return p;
  }
  return null;
}

/**
 * Advance the ball by dt seconds. Returns events that happened during the step so the caller can
 * play sounds, spawn particles and apply rules.
 */
export function stepBall(s: BallState, dt: number, env: PhysicsEnv, events?: BallEvent[]): void {
  const r = BALL.radius;
  const v = s.vel;
  const prevZ = s.pos.z;

  if (!s.rolling) {
    // --- Forces -----------------------------------------------------------------
    const speed = v.length();
    // gravity
    tmpA.set(0, -env.gravity, 0);
    // quadratic drag
    tmpA.addScaledVector(v, -BALL.drag * speed);
    // Magnus: k * (spin x v)
    tmpB.crossVectors(s.spin, v).multiplyScalar(BALL.magnus);
    tmpA.add(tmpB);
    v.addScaledVector(tmpA, dt);
    s.pos.addScaledVector(v, dt);
    // spin decays slowly in the air
    s.spin.multiplyScalar(Math.max(0, 1 - BALL.spinDecay * dt));
  } else {
    // Rolling on the ground: friction only.
    v.y = 0;
    const k = Math.max(0, 1 - 2.2 * dt);
    v.x *= k;
    v.z *= k;
    s.pos.addScaledVector(v, dt);
    s.pos.y = r;
  }

  // --- Net ----------------------------------------------------------------------
  if (env.netCollision && prevZ !== s.pos.z && Math.sign(prevZ) !== Math.sign(s.pos.z) && prevZ !== 0) {
    const t = prevZ / (prevZ - s.pos.z);
    const xc = s.pos.x - v.x * dt * (1 - t);
    const yc = s.pos.y - v.y * dt * (1 - t);
    if (Math.abs(xc) <= COURT.netPostX) {
      const h = netHeightAt(xc);
      if (yc - r < h) {
        const side = Math.sign(prevZ) || 1;
        if (yc > h - r * 0.6) {
          // Net cord. Decide whether it trickles over or drops back.
          const pOver = (yc - (h - r * 0.6)) / (r * 1.6);
          const over = Math.random() < pOver;
          const horizontalSpeed = Math.hypot(v.x, v.z);
          const dir = over ? -side : side;
          const newSpeed = horizontalSpeed * BALL.netCordDamping;
          v.z = dir * newSpeed * 0.9;
          v.x = v.x * 0.3 + (Math.random() - 0.5) * 0.6;
          v.y = Math.abs(v.y) * 0.25 + 1.6;
          s.pos.z = dir * (r + 0.01);
          s.pos.y = Math.max(yc, h + r * 0.4);
          s.spin.multiplyScalar(0.3);
          events?.push({ type: 'netcord', pos: s.pos.clone(), over });
        } else {
          // Hit the mesh: drop back onto the hitter's side.
          v.z = side * Math.abs(v.z) * BALL.netMeshDamping;
          v.x *= 0.4;
          v.y = Math.min(v.y * 0.2, 0.5);
          s.pos.z = side * (r + 0.02);
          s.pos.y = Math.min(yc, h - r);
          s.spin.multiplyScalar(0.2);
          events?.push({ type: 'netmesh', pos: s.pos.clone() });
        }
      }
    }
  }

  // --- Ground -------------------------------------------------------------------
  if (!s.rolling && s.pos.y - r <= 0 && v.y < 0) {
    s.pos.y = r;
    const patch = findPatch(s.pos.x, s.pos.z, env.surface.patches);
    const restitution = patch ? patch.restitution : env.surface.restitution;
    const friction = env.surface.friction;

    // Decompose spin relative to the travel direction.
    const spinTop = topspinOf(s.spin, v);
    const tn = Math.max(-1, Math.min(1, spinTop / BOUNCE.fullSpin));
    const sn = Math.max(-1, Math.min(1, s.spin.y / BOUNCE.fullSpin));

    // Vertical: topspin bounces higher, backspin stays low.
    const liftFactor = tn > 0 ? 1 + BOUNCE.topspinLift * tn : 1 + BOUNCE.backspinFlatten * tn;
    let vy = -v.y * restitution * liftFactor;

    // Horizontal: topspin kicks forward, backspin skids (keeps speed).
    const keep = (1 - friction) * (tn > 0 ? 1 + BOUNCE.topspinKick * tn : 1 + BOUNCE.backspinSkid * -tn);
    v.x *= keep;
    v.z *= keep;

    // Sidespin bends the bounce in the direction of the curve.
    if (Math.abs(sn) > 0.02) {
      tmpDir.set(v.x, 0, v.z);
      const hs = tmpDir.length();
      if (hs > 1e-4) {
        tmpAxis.crossVectors(UP, tmpDir).normalize();
        v.x += tmpAxis.x * hs * sn * BOUNCE.sidespinDeflect;
        v.z += tmpAxis.z * hs * sn * BOUNCE.sidespinDeflect;
      }
    }

    const impactSpeed = Math.hypot(v.x, v.z, v.y);
    if (vy < BALL.minBounceSpeed) {
      vy = 0;
      s.rolling = true;
    }
    v.y = vy;
    s.spin.multiplyScalar(BALL.spinBounceRetention);
    events?.push({ type: 'bounce', pos: s.pos.clone(), speed: impactSpeed, patch: !!patch, spinTop });
  }
}

export interface TrajectorySample {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Number of bounces so far. */
  bounces: number;
}

export interface TrajectoryResult {
  samples: TrajectorySample[];
  /** First ground contact or null if the ball never landed within maxTime. */
  landing: { x: number; z: number; t: number } | null;
  /** Height of the ball centre when it crossed the net plane (null if it never crossed). */
  netCrossHeight: number | null;
  netCrossX: number;
  hitNet: boolean;
  apex: number;
}

const simState = createBallState();
const simEvents: BallEvent[] = [];

/**
 * Simulate the ball forward without touching the live state. Shared by the solver and the AI.
 * Stops after the first bounce when `stopAtBounce` is set, otherwise records up to `maxTime`.
 */
export function simulateTrajectory(
  start: BallState,
  env: PhysicsEnv,
  dt: number,
  maxTime: number,
  stopAtBounce: boolean,
  out?: TrajectoryResult,
): TrajectoryResult {
  copyBallState(simState, start);
  const res: TrajectoryResult = out ?? {
    samples: [],
    landing: null,
    netCrossHeight: null,
    netCrossX: 0,
    hitNet: false,
    apex: 0,
  };
  res.samples.length = 0;
  res.landing = null;
  res.netCrossHeight = null;
  res.netCrossX = 0;
  res.hitNet = false;
  res.apex = start.pos.y;

  let t = 0;
  let bounces = 0;
  const steps = Math.ceil(maxTime / dt);
  for (let i = 0; i < steps; i++) {
    const prevZ = simState.pos.z;
    const prevY = simState.pos.y;
    const prevX = simState.pos.x;
    simEvents.length = 0;
    stepBall(simState, dt, env, simEvents);
    t += dt;
    if (simState.pos.y > res.apex) res.apex = simState.pos.y;
    // Net plane crossing (for clearance measurement).
    if (res.netCrossHeight === null && Math.sign(prevZ) !== Math.sign(simState.pos.z) && prevZ !== 0) {
      const f = prevZ / (prevZ - simState.pos.z);
      res.netCrossHeight = prevY + (simState.pos.y - prevY) * f;
      res.netCrossX = prevX + (simState.pos.x - prevX) * f;
    }
    for (const e of simEvents) {
      if (e.type === 'bounce') {
        bounces++;
        if (!res.landing) res.landing = { x: e.pos.x, z: e.pos.z, t };
      } else {
        res.hitNet = true;
      }
    }
    res.samples.push({
      t,
      x: simState.pos.x,
      y: simState.pos.y,
      z: simState.pos.z,
      vx: simState.vel.x,
      vy: simState.vel.y,
      vz: simState.vel.z,
      bounces,
    });
    if (stopAtBounce && bounces > 0) break;
    if (simState.rolling) break;
  }
  return res;
}
