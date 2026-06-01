// Orchestrator: wires overlap detection -> behavioral probing (4 worlds) ->
// behavioral diff -> false-positive filtering -> explanation -> report.
//
// This is what `sentinel check` runs. The flow per overlapping symbol:
//   1. Probe it in base / branchA / branchB / merged worktrees on the same
//      synthesized inputs.
//   2. diffSymbol() decides if merged behavior betrays either agent's intent.
//   3. filterFP() drops non-deterministic / low-signal findings.
//   4. Survivors get a plain-language explanation and are reported.

import { resolveRef, checkoutTree, checkoutMerged, mergesCleanly } from './git/worktrees.js';
import { detectOverlap } from './overlap/detectOverlap.js';
import { arityOf, synthInputs } from './probe/synthTests.js';
import { probeSymbol } from './probe/runProbe.js';
import { diffSymbol } from './analyze/behavioralDiff.js';
import { isStable, applyFilters } from './analyze/filterFP.js';
import { explainConflicts } from './analyze/explain.js';
import { renderTerminal, toJSON } from './report/render.js';

// Probe one symbol across the four worlds and judge it. Returns either a
// conflict object, a skip record, or null (no conflict, kept quiet).
async function judgeSymbol({ overlap, base, branchRefs, worlds, cwd }) {
  const { file, symbol } = overlap;

  // Derive probe inputs from the symbol's arity (use the richest branch text).
  const sampleText = overlap.branches.find((b) => b.branchText)?.branchText || '';
  const arity = arityOf(sampleText);
  const inputs = synthInputs(arity);

  // Stability gate first: if the symbol is non-deterministic in base, skip it.
  const stability = await isStable(worlds.base.path, file, symbol, inputs);
  if (stability.stable === false && stability.reason !== 'non-deterministic') {
    // load-error / timeout / not-callable -> unobservable, report as skipped.
    return { skip: { file, symbol, reason: stability.reason } };
  }

  const [bRes, aRes, bbRes, mRes] = await Promise.all([
    probeSymbol(worlds.base.path, file, symbol, inputs),
    probeSymbol(worlds.a.path, file, symbol, inputs),
    probeSymbol(worlds.b.path, file, symbol, inputs),
    probeSymbol(worlds.merged.path, file, symbol, inputs),
  ]);

  const verdict = diffSymbol({ inputs, base: bRes, a: aRes, b: bbRes, m: mRes });
  if (verdict.reason === 'unobservable') {
    return { skip: { file, symbol, reason: 'unobservable' } };
  }

  const filter = applyFilters(verdict, stability);
  if (!filter.keep) return null;

  return {
    conflict: {
      file,
      symbol,
      kind: overlap.kind,
      dominantKind: verdict.dominantKind,
      kindCounts: verdict.kindCounts,
      conflictingInputs: verdict.conflictingInputs,
      totalInputs: verdict.totalInputs,
      evidence: verdict.evidence,
      branches: overlap.branches,
    },
  };
}

export async function runCheck({ base, branches, cwd, json, __silent = false }) {
  // Validate refs up front for a clean error.
  await resolveRef(base, cwd);
  for (const b of branches) await resolveRef(b, cwd);

  // v0 judges pairwise. With >2 branches we compare the first two and note it.
  const [bA, bB] = branches;
  const merge = await mergesCleanly(bA, bA, bB, cwd);

  const result = {
    base,
    branches,
    cleanMerge: merge.clean,
    overlapCount: 0,
    probedCount: 0,
    conflicts: [],
    skipped: [],
    contractHints: [],
  };

  if (!merge.clean) {
    output(result, json, __silent);
    return result;
  }

  const { direct, contract } = await detectOverlap(base, [bA, bB], cwd);
  result.overlapCount = direct.length;
  result.contractHints = contract;

  if (direct.length === 0) {
    output(result, json, __silent);
    return result;
  }

  // Materialize the four worlds once, reuse across symbols.
  const worlds = {
    base: await checkoutTree(base, cwd),
    a: await checkoutTree(bA, cwd),
    b: await checkoutTree(bB, cwd),
    merged: await checkoutMerged(bA, bA, bB, cwd),
  };

  try {
    if (worlds.merged.conflict) {
      result.cleanMerge = false;
      output(result, json, __silent);
      return result;
    }
    for (const overlap of direct) {
      result.probedCount++;
      const judged = await judgeSymbol({ overlap, base, branchRefs: [bA, bB], worlds, cwd });
      if (judged?.conflict) result.conflicts.push(judged.conflict);
      else if (judged?.skip) result.skipped.push(judged.skip);
    }
  } finally {
    worlds.base.cleanup?.();
    worlds.a.cleanup?.();
    worlds.b.cleanup?.();
    worlds.merged.cleanup?.();
  }

  await explainConflicts(result.conflicts);
  output(result, json, __silent);
  return result;
}

export async function runExplain({ symbol, base, branches, cwd }) {
  // Run a full check, then surface just the requested symbol in detail.
  const result = await runCheckSilent({ base, branches, cwd });
  const cf = result.conflicts.find((x) => x.symbol === symbol || x.symbol.endsWith('.' + symbol));
  if (!cf) {
    console.log(`No silent behavioral conflict found for "${symbol}".`);
    return;
  }
  await explainConflicts([cf]);
  console.log(`Symbol: ${cf.symbol}  (${cf.file})`);
  console.log(`Conflict: ${cf.dominantKind}`);
  console.log(`Diverged on ${cf.conflictingInputs}/${cf.totalInputs} probe inputs.`);
  console.log(`\nWhy: ${cf.explanation}`);
  console.log(`\nEvidence:`);
  for (const e of cf.evidence) {
    console.log(`  input ${JSON.stringify(e.input)}: base=${e.detail.base} A=${e.detail.a} B=${e.detail.b} merged=${e.detail.m}`);
  }
}

async function runCheckSilent(args) {
  return await runCheck({ ...args, json: false, __silent: true });
}

function output(result, json, silent) {
  if (silent) return;
  if (json) console.log(JSON.stringify(toJSON(result), null, 2));
  else console.log(renderTerminal(result));
}
