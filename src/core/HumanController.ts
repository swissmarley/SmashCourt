import type { PlayerInput } from './Input';
import type { ShotType } from '../config/shots';
import type { Intent } from '../entities/Player';

/**
 * Turns raw button state into a player Intent, resolving button combinations:
 *   J            topspin          K            slice
 *   J+K together flat             J then K     lob          K then J  drop shot
 *
 * A single press is buffered for a few milliseconds so a "together" press can be recognised.
 * While a shot button is held (charging), pressing the other button upgrades the shot type.
 */
export class HumanController {
  /** Buffer window (ms) in which a second button turns a single press into a "together" press. */
  private static COMBO_MS = 55;
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

    if (jp && kp) {
      committed = 'flat';
      this.pending = null;
    } else if (jp || kp) {
      const pressed: 'topspin' | 'slice' = jp ? 'topspin' : 'slice';
      const otherHeld = pressed === 'topspin' ? kh : jh;
      if (this.held && otherHeld && !this.pending) {
        // Second button while the first one is held: J then K = lob, K then J = drop.
        committed = this.held === 'topspin' || this.held === 'lob' ? 'lob' : this.held === 'slice' || this.held === 'drop' ? 'drop' : 'flat';
      } else if (this.pending && this.pending.shot !== pressed && now - this.pending.since <= HumanController.COMBO_MS) {
        committed = 'flat';
        this.pending = null;
      } else {
        this.pending = { shot: pressed, since: now };
      }
    }

    // Flush a buffered single press once the combo window has elapsed.
    if (this.pending && now - this.pending.since > HumanController.COMBO_MS) {
      const otherHeld = this.pending.shot === 'topspin' ? kh : jh;
      committed = otherHeld && !this.held ? 'flat' : this.pending.shot;
      this.pending = null;
    }

    if (committed) {
      out.shotPressed = true;
      this.held = committed;
    }

    if (!jh && !kh) {
      if (this.held && !committed) out.shotReleased = true;
      else if (this.held && committed) out.shotReleased = true; // tap: press and release in one frame
      out.shot = committed ?? null;
      this.held = null;
    } else {
      out.shot = this.held;
    }
    return out;
  }
}
