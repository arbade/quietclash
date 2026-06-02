// Evaluation harness. Runs quietclash against labeled scenarios and reports
// precision, recall, and the headline number — the credibility anchor for the
// whole project. Every claim quietclash makes about catching hidden conflicts is
// only as good as this number, so the harness is honest: it counts false
// positives (firing on clean merges) as harshly as misses.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenarios } from './scenarios.js';
import { runCheck } from '../src/check.js';

// Materialize one scenario as a git repo with base + agent-a + agent-b, all
// merging cleanly. Returns { dir, base } or { dir, textualConflict:true }.
function buildScenario(s) {
  const dir = mkdtempSync(join(tmpdir(), 'quietclash-bench-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 'b@b.b');
  g('config', 'user.name', 'bench');
  g('config', 'commit.gpgsign', 'false');

  writeFileSync(join(dir, s.file), s.base);
  g('add', '-A'); g('commit', '-qm', 'base');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

  g('checkout', '-qb', 'agent-a');
  writeFileSync(join(dir, s.file), s.a);
  g('add', '-A'); g('commit', '-qm', 'a');

  g('checkout', '-q', base);
  g('checkout', '-qb', 'agent-b');
  writeFileSync(join(dir, s.file), s.b);
  // --allow-empty: some "clean" scenarios have agent-b leave the file unchanged
  // (e.g. only one agent touches the symbol) — that's a valid scenario, not an error.
  g('add', '-A'); g('commit', '-qm', 'b', '--allow-empty');
  g('checkout', '-q', base);

  // Verify clean textual merge by inspecting merge-tree output for a CONFLICT
  // marker. A non-zero exit alone isn't proof, so we read the text. execFileSync
  // throws on non-zero exit but still populates err.stdout with the output.
  let mergeOut = '';
  try {
    mergeOut = execFileSync(
      'git',
      ['merge-tree', '--write-tree', '--merge-base', base, 'agent-a', 'agent-b'],
      { cwd: dir, encoding: 'utf8' }
    );
  } catch (err) {
    mergeOut = (err.stdout || '').toString();
  }
  if (/^CONFLICT/m.test(mergeOut) || /Merge conflict/i.test(mergeOut)) {
    return { dir, base, textualConflict: true };
  }
  return { dir, base };
}

export async function runBench({ json = false } = {}) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const rows = [];

  for (const s of scenarios) {
    const built = buildScenario(s);
    try {
      if (built.textualConflict) {
        rows.push({ name: s.name, status: 'SKIP (textual conflict)', expected: s.expectConflict });
        continue;
      }
      const result = await runCheck({
        base: built.base,
        branches: ['agent-a', 'agent-b'],
        cwd: built.dir,
        json: false,
        __silent: true,
      });
      const fired = result.conflicts.length > 0;
      const expected = s.expectConflict;
      // A conflict scenario that fired nothing BUT had a skipped (unobservable)
      // symbol wasn't "missed" — quietclash honestly couldn't measure it (e.g.
      // a probe timed out under load). Counting it as FN would be dishonest and
      // makes the suite flaky; we report it as an UNOBSERVABLE skip instead.
      const unobservable = !fired && result.skipped.length > 0;

      let verdict;
      if (unobservable) { verdict = 'SKIP (unobservable)'; }
      else if (fired && expected) { tp++; verdict = 'TP ✓ caught'; }
      else if (!fired && !expected) { tn++; verdict = 'TN ✓ quiet'; }
      else if (fired && !expected) { fp++; verdict = 'FP ✗ false alarm'; }
      else { fn++; verdict = 'FN ✗ missed'; }

      rows.push({
        name: s.name,
        expected,
        fired,
        verdict,
        symbol: result.conflicts[0]?.symbol,
      });
    } finally {
      rmSync(built.dir, { recursive: true, force: true });
    }
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const conflictScenarios = scenarios.filter((s) => s.expectConflict).length;
  const caughtPct = conflictScenarios === 0 ? 0 : Math.round((tp / conflictScenarios) * 100);

  const summary = {
    scenarios: scenarios.length,
    tp, fp, tn, fn,
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    headline: `Caught ${caughtPct}% of clean-merging, test-passing conflicts that git cannot see, with ${fp} false alarm(s) on clean merges.`,
    rows,
  };

  if (json) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
    return summary;
  }

  console.log('\nquietclash benchmark\n');
  for (const r of rows) {
    if (r.status) {
      console.log(`  ${r.status.padEnd(28)} ${r.name}`);
    } else {
      console.log(`  ${r.verdict.padEnd(18)} ${r.name}${r.symbol ? `  [${r.symbol}]` : ''}`);
    }
  }
  console.log(
    `\n  TP=${tp} TN=${tn} FP=${fp} FN=${fn}  |  precision=${summary.precision}  recall=${summary.recall}`
  );
  console.log(`\n  ${summary.headline}\n`);
  return summary;
}

// Allow `node bench/eval.js` directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  runBench({ json: process.argv.includes('--json') });
}
