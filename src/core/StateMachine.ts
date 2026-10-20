/** Generic finite state machine with enter/exit/update hooks. */
export interface StateHandlers<Ctx> {
  enter?: (ctx: Ctx, from: string | null) => void;
  exit?: (ctx: Ctx, to: string) => void;
  update?: (ctx: Ctx, dt: number) => void;
}

export class StateMachine<S extends string, Ctx> {
  private states = new Map<S, StateHandlers<Ctx>>();
  private _current: S | null = null;
  /** Time spent in the current state (seconds, game time). */
  time = 0;

  constructor(private ctx: Ctx) {}

  add(name: S, handlers: StateHandlers<Ctx>): this {
    this.states.set(name, handlers);
    return this;
  }

  get current(): S | null {
    return this._current;
  }

  is(...names: S[]): boolean {
    return this._current !== null && names.includes(this._current);
  }

  set(name: S): void {
    if (this._current === name) return;
    const from = this._current;
    if (from) this.states.get(from)?.exit?.(this.ctx, name);
    this._current = name;
    this.time = 0;
    this.states.get(name)?.enter?.(this.ctx, from);
  }

  update(dt: number): void {
    if (!this._current) return;
    this.time += dt;
    this.states.get(this._current)?.update?.(this.ctx, dt);
  }
}
