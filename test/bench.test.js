import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBench } from '../bench/eval.js';

// Regression guard: the benchmark headline is the project's credibility anchor.
// If a change drops recall or introduces a false positive, this test fails.
test('benchmark: perfect recall and zero false positives on the labeled suite', async () => {
  // Silence the human-readable output during the test.
  const orig = console.log;
  console.log = () => {};
  let summary;
  try {
    summary = await runBench({ json: false });
  } finally {
    console.log = orig;
  }
  if (summary.fp || summary.fn) {
    const bad = (summary.rows || []).filter((r) => /✗/.test(r.verdict || ''));
    console.error('bench offenders:', JSON.stringify(bad, null, 2));
  }
  assert.equal(summary.fp, 0, 'no false positives allowed (the FP-rate is make-or-break)');
  assert.equal(summary.fn, 0, 'no missed conflicts');
  assert.ok(summary.tp >= 3, 'should catch the planted conflicts');
  assert.equal(summary.precision, 1);
  assert.equal(summary.recall, 1);
});
