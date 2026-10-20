/**
 * Input manager: keyboard + gamepad, mapped to per-player action snapshots.
 *
 * Movement is reported in *screen space* (x right, y up/forward); the match code converts it to
 * court space depending on which end the camera is on.
 *
 * "justPressed" flags are latched on the key event and cleared when `consumeEdges()` is called
 * after the first physics step of a frame, so taps are never lost even at very high frame rates.
 */

export interface ButtonState {
  held: boolean;
  justPressed: boolean;
  justReleased: boolean;
  /** Timestamp (ms) of the last press, for combo detection. */
  pressedAt: number;
}

export interface PlayerInput {
  moveX: number;
  moveY: number;
  topspin: ButtonState;
  slice: ButtonState;
  dive: ButtonState;
  power: ButtonState;
  /** Any shot button pressed this frame (block input). */
  anyShot: boolean;
}

export interface MenuInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  pause: boolean;
}

interface Binding {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  topspin: string[];
  slice: string[];
  dive: string[];
  power: string[];
}

export const BINDINGS: Binding[] = [
  {
    up: ['KeyW'],
    down: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    topspin: ['KeyJ'],
    slice: ['KeyK'],
    dive: ['KeyL'],
    power: ['KeyU'],
  },
  {
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    topspin: ['Numpad1', 'Comma'],
    slice: ['Numpad2', 'Period'],
    dive: ['Numpad3', 'Slash'],
    power: ['Numpad0', 'ShiftRight'],
  },
];

function newButton(): ButtonState {
  return { held: false, justPressed: false, justReleased: false, pressedAt: -1e9 };
}

function newPlayerInput(): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    topspin: newButton(),
    slice: newButton(),
    dive: newButton(),
    power: newButton(),
    anyShot: false,
  };
}

export class InputManager {
  readonly players: PlayerInput[] = [newPlayerInput(), newPlayerInput()];
  readonly menu: MenuInput = { up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false };
  /** True when any input happened (used to unlock audio). */
  anyInput = false;
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private releasedKeys = new Set<string>();
  private padButtons: boolean[][] = [[], []];
  private padPrev: boolean[][] = [[], []];
  private menuRepeat = 0;
  private menuHeld = false;
  /** Called on any key press (for the title screen "press any key"). */
  onAnyKey: (() => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Prevent page scrolling with the game keys.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      this.anyInput = true;
      this.onAnyKey?.();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedKeys.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
    });
  }

  private pad(index: number): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let n = 0;
    for (const p of pads) {
      if (!p) continue;
      if (n === index) return p;
      n++;
    }
    return null;
  }

  /** Sample all devices. Call once per frame before the simulation steps. */
  update(now: number): void {
    const menuAny = { up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false };
    for (let i = 0; i < 2; i++) {
      const b = BINDINGS[i];
      const p = this.players[i];
      const pad = this.pad(i);
      let mx = 0;
      let my = 0;
      if (b.left.some((k) => this.keys.has(k))) mx -= 1;
      if (b.right.some((k) => this.keys.has(k))) mx += 1;
      if (b.up.some((k) => this.keys.has(k))) my += 1;
      if (b.down.some((k) => this.keys.has(k))) my -= 1;

      const padNow: boolean[] = this.padButtons[i];
      const padPrev: boolean[] = this.padPrev[i];
      padNow.length = 0;
      if (pad) {
        const ax = pad.axes[0] ?? 0;
        const ay = pad.axes[1] ?? 0;
        const dead = 0.22;
        if (Math.abs(ax) > dead) mx += Math.sign(ax) * ((Math.abs(ax) - dead) / (1 - dead));
        if (Math.abs(ay) > dead) my -= Math.sign(ay) * ((Math.abs(ay) - dead) / (1 - dead));
        for (let k = 0; k < pad.buttons.length; k++) padNow[k] = pad.buttons[k].pressed;
        if (padNow[14]) mx -= 1;
        if (padNow[15]) mx += 1;
        if (padNow[12]) my += 1;
        if (padNow[13]) my -= 1;
        if (padNow.some((v, idx) => v && !padPrev[idx])) {
          this.anyInput = true;
          this.onAnyKey?.();
        }
      }
      const len = Math.hypot(mx, my);
      if (len > 1) {
        mx /= len;
        my /= len;
      }
      p.moveX = mx;
      p.moveY = my;

      // Gamepad mapping: A(0)=topspin, B(1)=slice, X(2)=dive, Y(3)=power, RB(5)=power alt.
      this.updateButton(p.topspin, b.topspin, padNow, padPrev, [0], now);
      this.updateButton(p.slice, b.slice, padNow, padPrev, [1], now);
      this.updateButton(p.dive, b.dive, padNow, padPrev, [2, 4], now);
      this.updateButton(p.power, b.power, padNow, padPrev, [3, 5], now);
      p.anyShot = p.topspin.justPressed || p.slice.justPressed || p.power.justPressed;

      // Menu navigation (any player can drive menus).
      const padJust = (idx: number) => !!padNow[idx] && !padPrev[idx];
      menuAny.confirm ||= padJust(0) || padJust(9);
      menuAny.back ||= padJust(1);
      menuAny.pause ||= padJust(9);
      menuAny.up ||= padJust(12);
      menuAny.down ||= padJust(13);
      menuAny.left ||= padJust(14);
      menuAny.right ||= padJust(15);
      this.padPrev[i] = padNow.slice();
    }

    // Keyboard menu navigation.
    const kp = (codes: string[]) => codes.some((c) => this.pressedKeys.has(c));
    menuAny.confirm ||= kp(['Enter', 'Space', 'KeyJ', 'NumpadEnter']);
    menuAny.back ||= kp(['Escape', 'Backspace', 'KeyK']);
    menuAny.pause ||= kp(['Escape', 'KeyP']);
    menuAny.up ||= kp(['ArrowUp', 'KeyW']);
    menuAny.down ||= kp(['ArrowDown', 'KeyS']);
    menuAny.left ||= kp(['ArrowLeft', 'KeyA']);
    menuAny.right ||= kp(['ArrowRight', 'KeyD']);

    // Held-direction auto repeat for menus and analog sticks.
    const held = {
      up: ['ArrowUp', 'KeyW'].some((k) => this.keys.has(k)) || this.players.some((p) => p.moveY > 0.6),
      down: ['ArrowDown', 'KeyS'].some((k) => this.keys.has(k)) || this.players.some((p) => p.moveY < -0.6),
      left: ['ArrowLeft', 'KeyA'].some((k) => this.keys.has(k)) || this.players.some((p) => p.moveX < -0.6),
      right: ['ArrowRight', 'KeyD'].some((k) => this.keys.has(k)) || this.players.some((p) => p.moveX > 0.6),
    };
    const anyHeld = held.up || held.down || held.left || held.right;
    if (anyHeld) {
      if (!this.menuHeld) {
        this.menuHeld = true;
        this.menuRepeat = now + 420;
        // analog stick first-press
        if (!menuAny.up && !menuAny.down && !menuAny.left && !menuAny.right) {
          menuAny.up ||= held.up;
          menuAny.down ||= held.down;
          menuAny.left ||= held.left;
          menuAny.right ||= held.right;
        }
      } else if (now > this.menuRepeat) {
        this.menuRepeat = now + 110;
        menuAny.up ||= held.up;
        menuAny.down ||= held.down;
        menuAny.left ||= held.left;
        menuAny.right ||= held.right;
      }
    } else {
      this.menuHeld = false;
    }
    Object.assign(this.menu, menuAny);
    this.pressedKeys.clear();
    this.releasedKeys.clear();
  }

  private updateButton(
    btn: ButtonState,
    codes: string[],
    padNow: boolean[],
    padPrev: boolean[],
    padIdx: number[],
    now: number,
  ): void {
    const keyHeld = codes.some((c) => this.keys.has(c));
    const padHeld = padIdx.some((i) => !!padNow[i]);
    const keyJust = codes.some((c) => this.pressedKeys.has(c));
    const padJust = padIdx.some((i) => !!padNow[i] && !padPrev[i]);
    const keyRel = codes.some((c) => this.releasedKeys.has(c));
    const padRel = padIdx.some((i) => !padNow[i] && !!padPrev[i]);
    const held = keyHeld || padHeld;
    if (keyJust || padJust) {
      btn.justPressed = true;
      btn.pressedAt = now;
    }
    if ((keyRel || padRel) && !held) btn.justReleased = true;
    btn.held = held;
  }

  /** Clear edge flags after they have been seen by one simulation step. */
  consumeEdges(): void {
    for (const p of this.players) {
      for (const b of [p.topspin, p.slice, p.dive, p.power]) {
        b.justPressed = false;
        b.justReleased = false;
      }
      p.anyShot = false;
    }
  }

  isKeyHeld(code: string): boolean {
    return this.keys.has(code);
  }
}
