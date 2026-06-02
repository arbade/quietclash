// Orchestrator: wires overlap detection -> behavioral probing (4 worlds) ->
// behavioral diff -> false-positive filtering -> explanation -> report.
//
// This is what `quietclash check` runs. The flow per overlapping symbol:
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

// Behaviorally PROVE a contract conflict. A contract overlap means: producer
// branch changed symbol S's behavior, while consumer branch (independently)
// added/changed a function C that calls S. C was written against S's OLD
// contract. We test this directly: run C in the consumer-alone world (where S
// is still old — C's intended behavior) and in the merged world (where S is now
// new). If C behaves differently, the merge silently broke C's intent — a
// proven conflict, not just a hint.
//
// Needs the consumer's source to derive arity; we read it from the consumer
// world. consumerWorld is 'a' or 'b' depending on which branch added C.
async function judgeContract({ contract, worlds, branchRefs }) {
  const { file, consumerSymbol, consumer, changedSymbol, producer } = contract;
  const [bA] = branchRefs;
  const consumerWorld = consumer === bA ? worlds.a : worlds.b;

  // Derive arity by probing with a few arities? Simpler: read consumer source.
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  let consumerSrc = '';
  try {
    consumerSrc = readFileSync(resolve(consumerWorld.path, file), 'utf8');
  } catch {
    return { unobservable: 'read-error' }; // can't read -> couldn't measure
  }
  // Pull just the consumer symbol's definition to read its arity.
  const defMatch = consumerSrc.match(
    new RegExp(`(?:function\\s+${consumerSymbol}\\s*\\(([^)]*)\\)|\\b${consumerSymbol}\\s*=\\s*\\(([^)]*)\\)\\s*=>)`)
  );
  const params = (defMatch?.[1] ?? defMatch?.[2] ?? '').trim();
  const arity = params ? params.split(',').filter((p) => p.trim()).length : 0;
  const inputs = synthInputs(arity);

  // Consumer must be deterministic to judge it. Distinguish a genuine
  // non-deterministic verdict (a real "can't claim") from a probe that simply
  // couldn't run (timeout/load-error under load) — the latter is UNOBSERVABLE,
  // not "no conflict". Conflating them would silently drop real conflicts.
  const stability = await isStable(consumerWorld.path, file, consumerSymbol, inputs);
  if (stability.stable === false) {
    if (stability.reason === 'non-deterministic') return null; // genuine no-claim
    return { unobservable: stability.reason }; // timeout/load-error -> couldn't measure
  }

  const [intended, actual] = await Promise.all([
    probeSymbol(consumerWorld.path, file, consumerSymbol, inputs),
    probeSymbol(worlds.merged.path, file, consumerSymbol, inputs),
  ]);
  if (!intended.ok || !actual.ok) {
    return { unobservable: intended.reason || actual.reason || 'probe-failed' };
  }

  // Find inputs where the consumer's behavior changed between its own world and
  // the merged world — that divergence IS the silently-broken contract.
  const evidence = [];
  for (let i = 0; i < inputs.length; i++) {
    if (intended.results[i] !== actual.results[i]) {
      evidence.push({ input: inputs[i], detail: { intended: intended.results[i], merged: actual.results[i] } });
      if (evidence.length >= 5) break;
    }
  }
  if (evidence.length === 0) return null; // contract held -> no conflict

  return {
    file,
    symbol: consumerSymbol,
    kind: 'contract',
    dominantKind: 'broken-contract',
    changedSymbol,
    producer,
    consumer,
    conflictingInputs: evidence.length,
    totalInputs: inputs.length,
    evidence: evidence.map((e) => ({
      input: e.input,
      detail: { base: '(n/a)', a: e.detail.intended, b: e.detail.intended, m: e.detail.merged },
    })),
  };
}

export async function runCheck({ base, branches, cwd, json, __silent = false }) {
  // v0 judges pairwise. With >2 branches we compare the first two and SAY SO,
  // rather than silently ignoring the rest (and we only validate the refs we
  // actually use, so a stray 3rd branch doesn't abort the run).
  const [bA, bB] = branches;
  const ignored = branches.slice(2);
  if (ignored.length && !__silent) {
    console.error(
      `quietclash: v0 compares two branches at a time — checking ${bA} vs ${bB}, ignoring: ${ignored.join(', ')}`
    );
  }

  // Validate the refs we use, for a clean error.
  await resolveRef(base, cwd);
  await resolveRef(bA, cwd);
  await resolveRef(bB, cwd);

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

  // Nothing overlaps at all -> nothing to probe.
  if (direct.length === 0 && contract.length === 0) {
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
    // Direct overlaps: same symbol changed by 2+ agents.
    for (const overlap of direct) {
      result.probedCount++;
      const judged = await judgeSymbol({ overlap, base, branchRefs: [bA, bB], worlds, cwd });
      if (judged?.conflict) result.conflicts.push(judged.conflict);
      else if (judged?.skip) result.skipped.push(judged.skip);
    }
    // Contract overlaps: producer changed S, consumer calls S. Behaviorally
    // prove whether the consumer's intent survived the merge. Proven ones
    // become real conflicts; unproven ones remain as the weaker hints.
    const provenConsumers = new Set();
    for (const c of contract) {
      result.probedCount++;
      const judged = await judgeContract({ contract: c, worlds, branchRefs: [bA, bB] });
      if (judged?.unobservable) {
        // Couldn't measure (timeout/load-error). Record as skipped so it never
        // masquerades as "no conflict"; leave the hint in place.
        result.skipped.push({ file: c.file, symbol: c.consumerSymbol, reason: judged.unobservable });
      } else if (judged) {
        result.conflicts.push(judged);
        provenConsumers.add(`${c.file}::${c.consumerSymbol}`);
      }
    }
    // Demote hints that we managed to prove (avoid double-reporting).
    result.contractHints = contract.filter(
      (c) => !provenConsumers.has(`${c.file}::${c.consumerSymbol}`)
    );
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
