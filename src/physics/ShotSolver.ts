/**
 * Shot solver: given a start point, a target landing point and a shot definition, compute the
 * initial velocity (and spin) so the ball lands on the target while clearing the net.
 *
 * Because drag and Magnus make the trajectory non-analytic, the solver uses the real integrator as
 * a black box and searches numerically:
 *   1. Pick a launch speed (from the shot type) or a launch angle (lobs/drops).
 *   2. Bisect the free parameter until the simulated landing distance equals the target distance.
 *   3. If the ball would clip the net, raise the launch angle and re-solve the speed until the
 *      clearance requirement is met (steeper arc, slower ball).
 *   4. Sidespin bends the flight, so correct the azimuth and repeat a couple of times.
 *
 * The caller adds aim error by perturbing the target before calling; the solver itself is exact.
 */
import { Vector3 } from 'three';
import { createBallState, makeSpin, netHeightAt, simulateTrajectory, type BallState, type PhysicsEnv, type TrajectoryResult } from './BallPhysics';
import { TIMING } from '../config/constants';

export interface SolveRequest {
  start: Vector3;
  target: Vector3;
  /** Launch speed in m/s (ignored when `angle` is given). */
  speed: number;
  /** Launch elevation in degrees; when given the solver finds the speed. */
  angle?: number;
  /** Topspin scalar in rad/s (negative = backspin). */
  topspin: number;
  /** Sidespin scalar in rad/s. */
  sidespin: number;
  /** Required clearance above the net cord in metres. */
  netClearance: number;
}

export interface SolveResult {
  velocity: Vector3;
  spin: Vector3;
  /** Predicted landing point. */
  landing: Vector3;
  flightTime: number;
  /** Clearance achieved over the net (may be negative if impossible). */
  clearance: number;
  speed: number;
  angleDeg: number;
}

const DEG = Math.PI / 180;
const SOLVER_DT = TIMING.physicsDt;
const probe: BallState = createBallState();
const traj: TrajectoryResult = { samples: [], landing: null, netCrossHeight: null, netCrossX: 0, hitNet: false, apex: 0 };
const tmpDir = new Vector3();

/** Shoot once and report the horizontal distance travelled along `dirH` and the lateral miss. */
function shoot(
  start: Vector3,
  dirH: Vector3,
  speed: number,
  angleDeg: number,
  topspin: number,
  sidespin: number,
  env: PhysicsEnv,
): { range: number; lateral: number; clearance: number; time: number; landing: { x: number; z: number } | null } {
  const a = angleDeg * DEG;
  const vh = Math.cos(a) * speed;
  probe.pos.copy(start);
  probe.vel.set(dirH.x * vh, Math.sin(a) * speed, dirH.z * vh);
  makeSpin(dirH, topspin, sidespin, probe.spin);
  probe.rolling = false;
  simulateTrajectory(probe, env, SOLVER_DT, 6, true, traj);
  if (!traj.landing) {
    return { range: 0, lateral: 0, clearance: -10, time: 0, landing: null };
  }
  const dx = traj.landing.x - start.x;
  const dz = traj.landing.z - start.z;
  const range = dx * dirH.x + dz * dirH.z;
  // lateral axis = up x dirH = (-dirH.z, 0, dirH.x)... use right-handed: lateral = (dirH.z, 0, -dirH.x)
  const lateral = dx * dirH.z - dz * dirH.x;
  let clearance = -10;
  if (traj.netCrossHeight !== null) {
    clearance = traj.netCrossHeight - netHeightAt(traj.netCrossX);
  } else if (Math.sign(start.z) === Math.sign(traj.landing.z)) {
    // Landed on the hitter's own side: never crossed the net.
    clearance = -10;
  } else {
    clearance = 10;
  }
  return { range, lateral, clearance, time: traj.landing.t, landing: traj.landing };
}

/** Bisect the speed for a fixed angle so the range matches. */
function solveSpeedForAngle(
  start: Vector3,
  dirH: Vector3,
  angleDeg: number,
  dist: number,
  topspin: number,
  sidespin: number,
  env: PhysicsEnv,
): number {
  let lo = 2;
  let hi = 70;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const r = shoot(start, dirH, mid, angleDeg, topspin, sidespin, env).range;
    if (r < dist) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Bisect the angle on the low branch (angle below the max-range angle) for a fixed speed.
 * Returns null when the target is out of range at this speed.
 */
function solveAngleForSpeed(
  start: Vector3,
  dirH: Vector3,
  speed: number,
  dist: number,
  topspin: number,
  sidespin: number,
  env: PhysicsEnv,
): number | null {
  // Coarse scan to find the angle of maximum range.
  let bestAngle = 0;
  let bestRange = -1;
  for (let a = -20; a <= 70; a += 6) {
    const r = shoot(start, dirH, speed, a, topspin, sidespin, env).range;
    if (r > bestRange) {
      bestRange = r;
      bestAngle = a;
    }
  }
  if (bestRange < dist) return null;
  let lo = -25;
  let hi = bestAngle;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const r = shoot(start, dirH, speed, mid, topspin, sidespin, env).range;
    if (r < dist) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function solveShot(req: SolveRequest, env: PhysicsEnv): SolveResult {
  const start = req.start;
  const target = req.target;
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  const dist = Math.max(0.5, Math.hypot(dx, dz));
  // Azimuth may be corrected for sidespin; we work with a yaw angle.
  let yaw = Math.atan2(dx, dz);
  const solverEnv: PhysicsEnv = { gravity: env.gravity, surface: env.surface, netCollision: false };

  let speed = req.speed;
  let angle = 0;
  let last = { range: 0, lateral: 0, clearance: -10, time: 0, landing: null as { x: number; z: number } | null };

  for (let iter = 0; iter < 3; iter++) {
    tmpDir.set(Math.sin(yaw), 0, Math.cos(yaw));

    if (req.angle !== undefined) {
      angle = req.angle;
      speed = solveSpeedForAngle(start, tmpDir, angle, dist, req.topspin, req.sidespin, solverEnv);
    } else {
      speed = req.speed;
      let solved: number | null = null;
      // If the shot cannot reach, speed it up in steps.
      for (let k = 0; k < 8 && solved === null; k++) {
        solved = solveAngleForSpeed(start, tmpDir, speed, dist, req.topspin, req.sidespin, solverEnv);
        if (solved === null) speed *= 1.1;
      }
      angle = solved ?? 30;
    }

    last = shoot(start, tmpDir, speed, angle, req.topspin, req.sidespin, solverEnv);

    // Net clearance: steepen the arc (and re-solve the speed) until the ball clears.
    if (last.clearance < req.netClearance) {
      let lo = angle;
      let hi = 78;
      let bestAngle = hi;
      let bestSpeed = solveSpeedForAngle(start, tmpDir, hi, dist, req.topspin, req.sidespin, solverEnv);
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const sp = solveSpeedForAngle(start, tmpDir, mid, dist, req.topspin, req.sidespin, solverEnv);
        const r = shoot(start, tmpDir, sp, mid, req.topspin, req.sidespin, solverEnv);
        if (r.clearance >= req.netClearance) {
          hi = mid;
          bestAngle = mid;
          bestSpeed = sp;
        } else {
          lo = mid;
        }
      }
      angle = bestAngle;
      speed = bestSpeed;
      last = shoot(start, tmpDir, speed, angle, req.topspin, req.sidespin, solverEnv);
    }

    // Sidespin azimuth correction.
    if (Math.abs(req.sidespin) < 1 || Math.abs(last.lateral) < 0.05) break;
    yaw -= Math.atan2(last.lateral, dist);
  }

  tmpDir.set(Math.sin(yaw), 0, Math.cos(yaw));
  const a = angle * DEG;
  const velocity = new Vector3(tmpDir.x * Math.cos(a) * speed, Math.sin(a) * speed, tmpDir.z * Math.cos(a) * speed);
  const spin = makeSpin(tmpDir, req.topspin, req.sidespin, new Vector3());
  const landing = last.landing ? new Vector3(last.landing.x, 0, last.landing.z) : target.clone();
  return { velocity, spin, landing, flightTime: last.time, clearance: last.clearance, speed, angleDeg: angle };
}
