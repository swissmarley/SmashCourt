import { TIMING } from '../config/constants';

export interface LoopCallbacks {
  /** Fixed-step simulation. `dt` is already scaled by timeScale. */
  fixedUpdate: (dt: number) => void;
  /** Per-frame work (rendering, camera, UI). `dt` is real seconds, `gameDt` is scaled. */
  frame: (dt: number, gameDt: number) => void;
}

/**
 * Fixed timestep game loop with an accumulator. Physics always runs at TIMING.physicsDt so
 * trajectories are deterministic regardless of the display refresh rate. `timeScale` is used
 * for slow motion (Power Shots) and hit-stop.
 */
export class GameLoop {
  timeScale = 1;
  running = false;
  /** Frames per second estimate for the HUD. */
  fps = 60;
  private accumulator = 0;
  private last = 0;
  private rafId = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  /** Real-time pause of the simulation (seconds) for hit-stop. */
  private freeze = 0;

  constructor(private cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.1) dt = 0.1; // tab switch / hitch guard
      this.fpsAccum += dt;
      this.fpsFrames++;
      if (this.fpsAccum >= 0.5) {
        this.fps = this.fpsFrames / this.fpsAccum;
        this.fpsAccum = 0;
        this.fpsFrames = 0;
      }
      let gameDt = dt * this.timeScale;
      if (this.freeze > 0) {
        this.freeze -= dt;
        gameDt = 0;
      }
      this.accumulator += gameDt;
      const step = TIMING.physicsDt;
      let steps = 0;
      while (this.accumulator >= step && steps < TIMING.maxStepsPerFrame) {
        this.cb.fixedUpdate(step);
        this.accumulator -= step;
        steps++;
      }
      if (steps === TIMING.maxStepsPerFrame) this.accumulator = 0;
      this.cb.frame(dt, gameDt);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Freeze the simulation for a few milliseconds of real time (hit-stop). */
  hitStop(seconds: number): void {
    this.freeze = Math.max(this.freeze, seconds);
  }
}
