/**
 * Global tuning constants. 1 unit = 1 meter. Y is up. The net lies on the plane z = 0.
 * Player 1 starts on the +Z half, the opponent on the -Z half.
 *
 * Everything that changes "how the game feels" should live in this folder so it can be
 * tuned without hunting through gameplay code.
 */

export const COURT = {
  /** Full court length (baseline to baseline). */
  length: 23.77,
  halfLength: 23.77 / 2,
  /** Singles width. */
  singlesWidth: 8.23,
  singlesHalfWidth: 8.23 / 2,
  /** Doubles width. */
  doublesWidth: 10.97,
  doublesHalfWidth: 10.97 / 2,
  /** Distance from the net to each service line. */
  serviceLineZ: 6.4,
  /** Net height at the centre strap and at the posts. */
  netHeightCenter: 0.914,
  netHeightPost: 1.07,
  /** Posts stand 0.914 m outside the doubles sideline. */
  netPostX: 10.97 / 2 + 0.914,
  /** Painted line width. */
  lineWidth: 0.05,
  /** How far behind the baseline a player may run. */
  runbackDepth: 4.0,
  /** How far outside the sideline a player may run. */
  runoutWidth: 4.5,
} as const;

export const BALL = {
  /** Real radius used by the physics. */
  radius: 0.035,
  /** Render radius (bigger than real for readability at broadcast distance). */
  renderRadius: 0.095,
  /** Arcade gravity. Real gravity is 9.81, the arcade value makes shots snappier. */
  gravity: 12.0,
  /** Quadratic air drag coefficient (per metre). v' = v - drag * |v| * v * dt. Kept low for an arcade feel. */
  drag: 0.005,
  /**
   * Magnus coefficient: a = magnus * (spin x velocity). Spin is in rad/s. At 170 rad/s and 20 m/s
   * this gives ~3.7 m/s^2 of dip (about 0.3 g), enough to read clearly without turning rally balls
   * into moonballs.
   */
  magnus: 0.0011,
  /** Spin decays towards zero in flight (per second). */
  spinDecay: 0.25,
  /** How much spin survives a bounce. */
  spinBounceRetention: 0.55,
  /** Minimum vertical speed for a bounce to register; below this the ball starts rolling. */
  minBounceSpeed: 0.9,
  /** Ball is considered dead when rolling slower than this. */
  deadSpeed: 0.4,
  /** Fraction of horizontal speed kept when the ball hits the net cord (trickle-over). */
  netCordDamping: 0.35,
  /** Fraction of speed kept when the ball hits the net mesh and falls back. */
  netMeshDamping: 0.12,
  /** Length of the trail in points. */
  trailLength: 26,
} as const;

/** Spin -> bounce coupling. Spin scalar is normalised to [-1, 1] (topspin positive). */
export const BOUNCE = {
  /** Topspin kick: horizontal speed gain after the bounce at full topspin. */
  topspinKick: 0.28,
  /** Topspin makes the ball bounce higher. */
  topspinLift: 0.18,
  /** Backspin keeps horizontal speed (skids). */
  backspinSkid: 0.12,
  /** Backspin lowers the bounce. */
  backspinFlatten: 0.35,
  /** Sidespin bends the bounce direction by this many radians at full sidespin. */
  sidespinDeflect: 0.22,
  /** Spin scalar that counts as "full" (rad/s). */
  fullSpin: 180,
} as const;

export const PLAYER = {
  /** Base run speed (m/s) at a speed stat of 1; scaled by stats. */
  baseSpeed: 5.2,
  /** Additional speed per speed-stat point. */
  speedPerStat: 0.42,
  /** Acceleration (m/s^2) — high for snappy starts. */
  acceleration: 48,
  /** Deceleration when no input. */
  deceleration: 42,
  /** Base reach radius (m) at a defensive stat of 1; the hit volume is a disc around the player. */
  baseReach: 1.45,
  reachPerStat: 0.05,
  /** Max ball height the player can reach (overheads). */
  maxHitHeight: 2.55,
  /** Minimum ball height the player can reach without a dive. */
  minHitHeight: 0.0,
  /** Lateral "magnet" speed assist toward the ball as a fraction of run speed. */
  magnetStrength: 0.7,
  /** Magnet only works within this distance of the ball's intercept point. */
  magnetRange: 3.2,
  /** While charging the player cannot steer, but shuffles toward the ball at this fraction of run speed. */
  chargeLockOnSpeed: 0.85,
  /** How long a full charge takes (seconds). */
  chargeTime: 1.0,
  /** Power multiplier at full charge. */
  chargeMaxBonus: 0.35,
  /** Dive parameters. */
  diveDistance: 2.4,
  diveDuration: 0.42,
  diveRecovery: 0.75,
  diveReachBonus: 0.85,
  /** Seconds the player is frozen after a shot (swing follow-through). */
  swingRecovery: 0.22,
  /** Timing window: ball distance (m) from the ideal contact point mapped to timing [-1, 1]. */
  timingWindow: 1.1,
  /** |timing| below this counts as perfect. */
  perfectWindow: 0.18,
  /** Speed bonus for a perfect hit. */
  perfectPowerBonus: 0.12,
  /** Lateral aim deflection (m at the far baseline) for a full early/late timing. */
  timingAimShift: 1.6,
  /** Knockback stun when a Power Shot is not blocked. */
  powerShotStun: 0.9,
  /** Hit-stop freeze on contact for readability (seconds, real time). */
  hitStop: 0.02,
} as const;

export const POWER_METER = {
  /** Meter range is 0..1. */
  perGoodShot: 0.1,
  perPerfectShot: 0.16,
  perRallyShot: 0.04,
  perPointWon: 0.12,
  perChanceZone: 0.2,
  /** Power Shot speed multiplier. */
  powerShotSpeedMul: 1.55,
  /** Time scale during the Power Shot slow-mo. */
  slowMoScale: 0.3,
  slowMoDuration: 0.55,
  /** Block window in seconds (press any shot button inside this window to block). */
  blockWindow: 0.26,
} as const;

export const CHANCE = {
  /** Incoming ball qualifies as weak if its peak height exceeds this... */
  minPeakHeight: 2.3,
  /** ...and its landing point is this far inside the opponent's court (from the net). */
  maxDepthFromNet: 5.5,
  /** ...or its speed is lower than this. */
  maxSpeed: 12,
  /** Zone radius the player must reach. */
  radius: 0.9,
  /** Power bonus for hitting from a chance zone. */
  powerBonus: 0.25,
  /** Extra bonus when the matching button is used. */
  matchBonus: 0.15,
} as const;

export const CAMERA = {
  /** Base rig distance behind the baseline and height (gives ~30 degrees of elevation). */
  distance: 10.5,
  height: 13.5,
  lookAhead: 0.0,
  lookHeight: 0.4,
  fov: 50,
  /** How much the rig follows the player's x position (kept small so aiming stays stable). */
  followX: 0.2,
  /** Damping for the follow. */
  damping: 4.5,
  /** Serve close-up duration. */
  serveCloseupTime: 1.3,
} as const;

export const TIMING = {
  /** Pause after a point before the next serve setup. */
  pointOverDelay: 1.9,
  /** Delay before the AI serves. */
  aiServeDelay: 1.2,
  /** Time until the toss is auto-hit if the player never presses. */
  tossTimeout: 2.4,
  /** Toss launch speed (m/s): apex ~2.75 m so the serve is struck well above the head. */
  tossSpeed: 6.7,
  /** Fixed physics step. */
  physicsDt: 1 / 120,
  maxStepsPerFrame: 8,
} as const;

/** Colours (hex) shared across the UI and render code. */
export const COLORS = {
  topspin: 0xff7a1a,
  slice: 0x3ec9ff,
  flat: 0xfff6a8,
  lob: 0x7dff6e,
  drop: 0xd77dff,
  power: 0xffffff,
  ballYellow: 0xdfff35,
  inMarker: 0x58ff7a,
  outMarker: 0xff4d4d,
} as const;
