import type { Ball } from '../entities/Ball';
import type { Pose, SwingKind } from '../entities/CharacterModel';
import type { Player } from '../entities/Player';

interface Frame {
  t: number;
  ball: [number, number, number];
  players: { x: number; z: number; pose: Pose; kind: SwingKind }[];
}

/**
 * Records the last point and plays it back in slow motion for the match-point replay.
 * Only positions and pose names are stored; the character rigs re-animate from those.
 */
export class Replay {
  private frames: Frame[] = [];
  private recording = false;
  private t = 0;
  private playhead = 0;
  private speed = 0.5;
  private hold = 0;
  private maxDuration = 6;

  get hasData(): boolean {
    return this.frames.length > 30;
  }

  beginRecording(): void {
    this.frames = [];
    this.recording = true;
    this.t = 0;
  }

  stopRecording(): void {
    this.recording = false;
  }

  record(ball: Ball, players: Player[], dt = 1 / 120): void {
    if (!this.recording) return;
    this.t += dt;
    this.frames.push({
      t: this.t,
      ball: [ball.pos.x, ball.pos.y, ball.pos.z],
      players: players.map((p) => ({ x: p.pos.x, z: p.pos.z, pose: p.model.pose, kind: p.model.swingKind })),
    });
    while (this.frames.length > 1 && this.t - this.frames[0].t > this.maxDuration) this.frames.shift();
  }

  beginPlayback(speed: number): void {
    this.speed = speed;
    this.playhead = this.frames.length ? this.frames[0].t : 0;
    this.hold = 0.6;
  }

  /** Advance the playback. Returns true when finished. */
  playback(dt: number, ball: Ball, players: Player[]): boolean {
    if (this.frames.length === 0) return true;
    this.playhead += dt * this.speed;
    const last = this.frames[this.frames.length - 1];
    let frame = last;
    for (const f of this.frames) {
      if (f.t >= this.playhead) {
        frame = f;
        break;
      }
    }
    ball.state.pos.set(frame.ball[0], frame.ball[1], frame.ball[2]);
    ball.state.vel.set(0, 0, 0);
    ball.trail.intensity = 1;
    frame.players.forEach((fp, i) => {
      const p = players[i];
      if (!p) return;
      p.pos.set(fp.x, 0, fp.z);
      p.model.setPose(fp.pose, fp.kind);
      p.syncModel();
      p.model.update(dt * this.speed);
    });
    if (this.playhead >= last.t) {
      this.hold -= dt;
      return this.hold <= 0;
    }
    return false;
  }
}
