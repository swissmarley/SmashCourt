import type { PlayerInput } from './Input';
import type { ShotType } from '../config/shots';
import type { Intent } from '../entities/Player';

/**
 * Turns raw button state into a player Intent, resolving button combinations:
 *   J            topspin          K            slice
 *   J+K together flat             J then K     lob          K then J  drop shot
 *
 * A single press is buffered for a few milliseconds so a "together" press can be recognised.
 * Two presses within TOGETHER_MS are a flat; a second press inside the buffer window after that
 * is a lob/drop by order; and while a shot button is held (charging), pressing the other button
 * upgrades the charged shot to a lob or a drop.
 */
export class HumanController {
  /** Presses closer than this count as "together" (flat). */
  private static TOGETHER_MS = 30;
  /** Buffer window: a single press is committed once this much time has passed. */
  private static WINDOW_MS = 40;
  private pending: { shot: 'topspin' | 'slice'; since: number } | null = null;
  /** The shot currently held down (drives charging). */
  private held: ShotType | null = null;

  reset(): void {
    this.pending = null;
    this.held = null;
  }

  /**
   * @param camSide +1 if the camera sits behind the +Z baseline, -1 otherwise (screen -> court).
   * @param playerSide which half this player defends (+1 => +Z).
   */
  intent(input: PlayerInput, now: number, camSide: number, playerSide: number, out: Intent): Intent {
    // Movement: screen space -> court space.
    out.moveX = input.moveX * camSide;
    out.moveZ = -input.moveY * camSide;
    // Aim: lateral in the hitter's own left/right; depth positive = toward the opponent.
    out.aimX = input.moveX * camSide * playerSide;
    out.aimDepth = input.moveY * camSide * playerSide;
    out.dive = input.dive.justPressed;
    out.power = input.power.justPressed;
    out.aimTarget = null;
    out.shotPressed = false;
    out.shotReleased = false;

    const jp = input.topspin.justPressed;
    const kp = input.slice.justPressed;
    const jh = input.topspin.held;
    const kh = input.slice.held;
    let committed: ShotType | null = null;

    // 1. Flush a buffered single press whose window has elapsed (before looking at new presses).
    if (this.pending && now - this.pending.since > HumanController.WINDOW_MS) {
      committed = this.pending.shot;
      this.held = committed;
      this.pending = null;
    }

    // 2. New presses.
    if (jp && kp) {
      committed = 'flat';
      this.pending = null;
      this.held = 'flat';
    } else if (jp || kp) {
      const pressed: 'topspin' | 'slice' = jp ? 'topspin' : 'slice';
      const otherHeld = pressed === 'topspin' ? kh : jh;
      if (this.pending && this.pending.shot !== pressed) {
        const gap = now - this.pending.since;
        committed = gap <= HumanController.TOGETHER_MS ? 'flat' : this.pending.shot === 'topspin' ? 'lob' : 'drop';
        this.pending = null;
        this.held = committed;
      } else if (this.held && otherHeld) {
        // Second button while the first is held: J then K = lob, K then J = drop.
        const base = this.held;
        committed = base === 'topspin' || base === 'lob' ? 'lob' : base === 'slice' || base === 'drop' ? 'drop' : 'flat';
        this.held = committed;
      } else {
        this.pending = { shot: pressed, since: now };
      }
    }

    if (committed) out.shotPressed = true;

    // 3. Release handling.
    if (!jh && !kh) {
      if (this.held) out.shotReleased = true;
      out.shot = committed;
      this.held = null;
      // A tap shorter than the buffer window still needs to commit: flush it next frame.
    } else {
      out.shot = committed ?? this.held;
    }
    return out;
  }
}
