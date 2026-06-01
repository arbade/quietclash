import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInput, diffSymbol } from '../src/analyze/behavioralDiff.js';
import { applyFilters } from '../src/analyze/filterFP.js';

test('classifyInput: nobody changed -> none', () => {
  assert.equal(classifyInput('x', 'x', 'x', 'x').kind, 'none');
});

test('classifyInput: only A changed and survived -> none', () => {
  assert.equal(classifyInput('base', 'A', 'base', 'A').kind, 'none');
});

test('classifyInput: only A changed but merge lost it -> lost-A', () => {
  assert.equal(classifyInput('base', 'A', 'base', 'base').kind, 'lost-A');
});

test('classifyInput: both changed differently, merge took A -> clash-B-lost', () => {
  assert.equal(classifyInput('base', 'A', 'B', 'A').kind, 'clash-B-lost');
});

test('classifyInput: both changed differently, merge is neither -> clash-both-broken', () => {
  assert.equal(classifyInput('base', 'A', 'B', 'C').kind, 'clash-both-broken');
});

test('classifyInput: both converged on same change, merge kept it -> none', () => {
  assert.equal(classifyInput('base', 'X', 'X', 'X').kind, 'none');
});

test('diffSymbol flags a clash with evidence', () => {
  const inputs = [['p'], ['q'], ['r']];
  const v = diffSymbol({
    inputs,
    base: { ok: true, results: ['0', '0', '0'] },
    a: { ok: true, results: ['A', '0', '0'] },   // A changed input 0
    b: { ok: true, results: ['B', '0', '0'] },   // B changed input 0 differently
    m: { ok: true, results: ['A', '0', '0'] },   // merge took A -> B lost
  });
  assert.equal(v.conflict, true);
  assert.equal(v.dominantKind, 'clash-B-lost');
  assert.equal(v.conflictingInputs, 1);
  assert.ok(v.evidence.length === 1);
});

test('diffSymbol returns unobservable when a world failed', () => {
  const v = diffSymbol({
    inputs: [['p']],
    base: { ok: true, results: ['0'] },
    a: { ok: false, reason: 'load-error' },
    b: { ok: true, results: ['0'] },
    m: { ok: true, results: ['0'] },
  });
  assert.equal(v.conflict, false);
  assert.equal(v.reason, 'unobservable');
});

test('applyFilters drops non-deterministic symbols', () => {
  const verdict = { conflict: true, kindCounts: { 'clash-B-lost': 2 }, conflictingInputs: 2 };
  const res = applyFilters(verdict, { stable: false, reason: 'non-deterministic' });
  assert.equal(res.keep, false);
  assert.match(res.droppedReason, /unstable/);
});

test('applyFilters keeps a stable hard clash', () => {
  const verdict = { conflict: true, kindCounts: { 'clash-B-lost': 1 }, conflictingInputs: 1 };
  const res = applyFilters(verdict, { stable: true });
  assert.equal(res.keep, true);
});

test('applyFilters drops a single soft-input loss as likely noise', () => {
  const verdict = { conflict: true, kindCounts: { 'lost-A': 1 }, conflictingInputs: 1 };
  const res = applyFilters(verdict, { stable: true });
  assert.equal(res.keep, false);
  assert.equal(res.droppedReason, 'single-soft-input');
});
