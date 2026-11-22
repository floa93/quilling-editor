// Snapshot-based undo/redo. Documents are immutable, so a snapshot is just a reference.

export const DEFAULT_LIMIT = 100;

export class History {
  constructor(limit = DEFAULT_LIMIT) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  /** Records `previous` as an undo step before a change. Clears the redo stack. */
  record(previous) {
    this.past.push(previous);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  canUndo() {
    return this.past.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }

  /** Returns the state to restore, or null. `current` is moved to the redo stack. */
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    return this.past.pop();
  }

  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    return this.future.pop();
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}
