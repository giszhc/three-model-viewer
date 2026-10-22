export type Listener<T = unknown> = (...args: T[]) => void;

export class EventEmitter {
  private events: Map<string, Listener[]>;

  constructor() {
    this.events = new Map();
  }

  public on(event: string, listener: Listener): this {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(listener);
    return this;
  }

  public off(event: string, listener: Listener): this {
    const listeners = this.events.get(event);
    if (!listeners) return this;

    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
    return this;
  }

  public emit(event: string, ...args: unknown[]): boolean {
    const listeners = this.events.get(event);
    if (!listeners || listeners.length === 0) return false;

    // Clone array in case listener removes itself
    [...listeners].forEach((listener) => {
      try {
        listener(...args);
      } catch (err) {
        console.error(`Error in event listener for "${event}":`, err);
      }
    });

    return true;
  }

  public removeAllListeners(event?: string): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }
}
