import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arityOf, synthInputs } from '../src/probe/synthTests.js';
import { probeSymbol } from '../src/probe/runProbe.js';
import { checkoutTree, checkoutMerged } from '../src/git/worktrees.js';

test('arityOf reads parameter counts', () => {
  assert.equal(arityOf('export function f(a, b) { return a; }'), 2);
  assert.equal(arityOf('const g = (x) => x*2'), 1);
  assert.equal(arityOf('function h() {}'), 0);
});

test('synthInputs respects arity and cap', () => {
  assert.deepEqual(synthInputs(0), [[]]);
  const two = synthInputs(2, 10);
  assert.ok(two.length <= 10);
  assert.ok(two.every((t) => t.length === 2));
});

test('probeSymbol observes a real behavioral DIFFERENCE between two versions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sentinel-probe-'));
  try {
    // version A: clamps negative to 0 (old behavior)
    writeFileSync(join(dir, 'a.mjs'), `export function norm(n){ return n < 0 ? 0 : n; }`);
    // version B: passes negatives through (changed behavior)
    writeFileSync(join(dir, 'b.mjs'), `export function norm(n){ return n; }`);

    const inputs = [[-1], [0], [5]];
    const ra = await probeSymbol(dir, 'a.mjs', 'norm', inputs);
    const rb = await probeSymbol(dir, 'b.mjs', 'norm', inputs);
    assert.ok(ra.ok && rb.ok, 'both probes should run');
    // The two versions diverge on negative input; the signatures must differ.
    assert.notDeepEqual(ra.results, rb.results, 'behavior signatures should differ');
    assert.equal(ra.results[0], 'number:0', 'A clamps -1 to 0');
    assert.equal(rb.results[0], 'number:-1', 'B passes -1 through');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkoutMerged produces a runnable merged worktree for clean merges', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sentinel-merge-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir });
  g('init', '-q'); g('config', 'user.email', 't@t.t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  // base with two independent functions in two files (clean merge guaranteed)
  writeFileSync(join(dir, 'x.mjs'), `export function x(){ return 1; }`);
  writeFileSync(join(dir, 'y.mjs'), `export function y(){ return 1; }`);
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

  g('checkout', '-q', '-b', 'a'); writeFileSync(join(dir, 'x.mjs'), `export function x(){ return 2; }`); g('add', '-A'); g('commit', '-q', '-m', 'a');
  g('checkout', '-q', base); g('checkout', '-q', '-b', 'b'); writeFileSync(join(dir, 'y.mjs'), `export function y(){ return 3; }`); g('add', '-A'); g('commit', '-q', '-m', 'b');
  g('checkout', '-q', base);

  const merged = await checkoutMerged(base, 'a', 'b', dir);
  try {
    assert.ok(!merged.conflict, 'should merge cleanly');
    const rx = await probeSymbol(merged.path, 'x.mjs', 'x', [[]]);
    const ry = await probeSymbol(merged.path, 'y.mjs', 'y', [[]]);
    assert.deepEqual(rx.results, ['number:2'], 'merged x() == 2 (from branch a)');
    assert.deepEqual(ry.results, ['number:3'], 'merged y() == 3 (from branch b)');
  } finally {
    merged.cleanup?.();
    rmSync(dir, { recursive: true, force: true });
  }
});
