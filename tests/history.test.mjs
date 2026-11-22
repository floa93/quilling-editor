import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/history.js';

test('undo and redo walk through snapshots', () => {
  const h = new History();
  let state = 0;
  for (let i = 1; i <= 3; i++) {
    h.record(state);
    state = i;
  }
  state = h.undo(state);
  assert.equal(state, 2);
  state = h.undo(state);
  assert.equal(state, 1);
  state = h.redo(state);
  assert.equal(state, 2);
  assert.ok(h.canRedo());
  h.record(state);
  state = 99;
  assert.ok(!h.canRedo(), 'a new change clears redo');
  assert.equal(h.undo(state), 2);
});

test('supports at least 50 undo steps and enforces the limit', () => {
  const h = new History(100);
  let state = 0;
  for (let i = 1; i <= 150; i++) {
    h.record(state);
    state = i;
  }
  let steps = 0;
  while (h.canUndo()) {
    state = h.undo(state);
    steps++;
  }
  assert.equal(steps, 100);
  assert.equal(state, 50);
});

test('undo/redo on empty history returns null', () => {
  const h = new History();
  assert.equal(h.undo(1), null);
  assert.equal(h.redo(1), null);
});
