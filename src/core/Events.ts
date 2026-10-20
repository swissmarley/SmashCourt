/** Minimal typed event emitter. */
type Handler = (...args: unknown[]) => void;

export class Emitter<T extends Record<string, unknown[]>> {
  private listeners = new Map<keyof T, Set<Handler>>();

  on<K extends keyof T>(event: K, fn: (...args: T[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as unknown as Handler);
    return () => this.off(event, fn);
  }

  off<K extends keyof T>(event: K, fn: (...args: T[K]) => void): void {
    this.listeners.get(event)?.delete(fn as unknown as Handler);
  }

  emit<K extends keyof T>(event: K, ...args: T[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) fn(...(args as unknown[]));
  }

  clear(): void {
    this.listeners.clear();
  }
}
