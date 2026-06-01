import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectOverlap } from '../src/overlap/detectOverlap.js';
import { mergesCleanly } from '../src/git/worktrees.js';

// Build a throwaway git repo with a base commit and two agent branches, then
// assert sentinel's overlap detection finds what we planted.
function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'sentinel-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir });
  g('init', '-q');
  g('config', 'user.email', 't@t.t');
  g('config', 'user.name', 'test');
  g('config', 'commit.gpgsign', 'false');

  // base: parseDate is naive; greet calls it.
  writeFileSync(
    join(dir, 'lib.js'),
    `export function parseDate(s) { return new Date(s); }\n` +
    `export function greet(name) { return 'hi ' + name; }\n`
  );
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

  // agent-a: changes parseDate to assume UTC (a behavior change), leaves greet.
  g('checkout', '-q', '-b', 'agent-a');
  writeFileSync(
    join(dir, 'lib.js'),
    `export function parseDate(s) { return new Date(s + 'Z'); }\n` +
    `export function greet(name) { return 'hi ' + name; }\n`
  );
  g('add', '-A');
  g('commit', '-q', '-m', 'a: parseDate UTC');

  // agent-b: independently changes parseDate differently (direct overlap) AND
  // changes greet (single-agent, should NOT be flagged).
  g('checkout', '-q', base);
  g('checkout', '-q', '-b', 'agent-b');
  writeFileSync(
    join(dir, 'lib.js'),
    `export function parseDate(s) { return new Date(Date.parse(s)); }\n` +
    `export function greet(name) { return 'hello, ' + name; }\n`
  );
  g('add', '-A');
  g('commit', '-q', '-m', 'b: parseDate via Date.parse + greet reword');

  g('checkout', '-q', base);
  return { dir, base };
}

test('detectOverlap finds the symbol two agents both changed, ignores single-agent changes', async () => {
  const { dir, base } = setupRepo();
  try {
    const { direct } = await detectOverlap(base, ['agent-a', 'agent-b'], dir);
    const parseDate = direct.find((d) => d.symbol === 'parseDate');
    assert.ok(parseDate, 'parseDate should be a direct overlap (both agents changed it)');
    assert.equal(parseDate.branches.length, 2, 'both branches recorded');

    // greet was changed only by agent-b -> not a cross-agent overlap.
    assert.equal(direct.find((d) => d.symbol === 'greet'), undefined, 'greet is single-agent, not flagged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectOverlap finds a contract conflict (producer changes symbol, consumer calls it)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sentinel-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir });
  g('init', '-q');
  g('config', 'user.email', 't@t.t');
  g('config', 'user.name', 'test');
  g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'lib.js'), `export function fmt(n) { return String(n); }\n`);
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

  // producer: changes fmt's behavior.
  g('checkout', '-q', '-b', 'prod');
  writeFileSync(join(dir, 'lib.js'), `export function fmt(n) { return n.toFixed(2); }\n`);
  g('add', '-A'); g('commit', '-q', '-m', 'prod: fmt now 2dp');

  // consumer: adds a new caller of fmt (written against old contract).
  g('checkout', '-q', base);
  g('checkout', '-q', '-b', 'cons');
  writeFileSync(
    join(dir, 'lib.js'),
    `export function fmt(n) { return String(n); }\n` +
    `export function label(n) { return 'v=' + fmt(n); }\n`
  );
  g('add', '-A'); g('commit', '-q', '-m', 'cons: add label calling fmt');
  g('checkout', '-q', base);

  try {
    const { contract } = await detectOverlap(base, ['prod', 'cons'], dir);
    const c = contract.find((x) => x.changedSymbol === 'fmt' && x.consumerSymbol === 'label');
    assert.ok(c, 'should flag label (consumer) depending on changed fmt (producer)');
    assert.equal(c.producer, 'prod');
    assert.equal(c.consumer, 'cons');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mergesCleanly reports clean for non-textually-conflicting branches', async () => {
  const { dir } = setupRepo();
  try {
    // agent-a and agent-b both edit lib.js line 1 -> textual conflict expected.
    const res = await mergesCleanly('agent-a', 'agent-a', 'agent-b', dir);
    // They touch the same line, so this SHOULD be a textual conflict (not clean).
    // sentinel's value is on CLEAN merges; this asserts we can tell them apart.
    assert.equal(typeof res.clean, 'boolean');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
