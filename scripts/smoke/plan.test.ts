import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planUp } from './plan.ts';

test('starts a fresh stack when nothing is there', () => {
  assert.equal(planUp({ envFile: false, leftovers: false }), 'fresh');
});

test('reuses a running stack that still has its .env.smoke', () => {
  assert.equal(planUp({ envFile: true, leftovers: true }), 'reuse');
});

test('writes a new file when only a stale .env.smoke is left', () => {
  assert.equal(planUp({ envFile: true, leftovers: false }), 'fresh');
});

test('tears down a stack whose .env.smoke is gone, since its volumes need the lost passwords', () => {
  // A cancelled CI job on a self-hosted runner: the next checkout cleaned .env.smoke away.
  assert.equal(planUp({ envFile: false, leftovers: true }), 'reset');
});
