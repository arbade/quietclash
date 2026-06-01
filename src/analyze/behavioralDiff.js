// The core judgement. Given a symbol's behavior signatures in four worlds —
// base, branchA-alone, branchB-alone, and merged — decide, per probe input,
// whether the merge SILENTLY lost or broke an agent's intent.
//
// Per input, with signatures (base, a, b, m):
//   - aChanged = a !== base   (branch A altered behavior on this input)
//   - bChanged = b !== base   (branch B altered behavior on this input)
//   Cases:
//     neither changed                  -> no signal
//     only A changed:  conflict iff m !== a   (A's intent didn't survive)
//     only B changed:  conflict iff m !== b   (B's intent didn't survive)
//     both changed, a === b:           compatible iff m === a, else conflict
//     both changed, a !== b:           genuine clash. m===a -> B lost;
//                                       m===b -> A lost; else -> both broken.
//
// We aggregate per-input verdicts into a per-symbol conflict with evidence
// (which inputs, which kind). Inputs where any world failed to run
// (load-error/timeout/not-callable) are skipped, never counted as conflict —
// we only assert on inputs we actually observed in all four worlds.

export function classifyInput(base, a, b, m) {
  // Any missing observation -> inconclusive for this input.
  if (base === undefined || a === undefined || b === undefined || m === undefined) {
    return { kind: 'inconclusive' };
  }
  const aChanged = a !== base;
  const bChanged = b !== base;

  if (!aChanged && !bChanged) return { kind: 'none' };

  if (aChanged && !bChanged) {
    return m === a ? { kind: 'none' } : { kind: 'lost-A', detail: { base, a, b, m } };
  }
  if (bChanged && !aChanged) {
    return m === b ? { kind: 'none' } : { kind: 'lost-B', detail: { base, a, b, m } };
  }

  // Both branches changed behavior on this input.
  if (a === b) {
    // They converged on the same new behavior — compatible iff merge kept it.
    return m === a ? { kind: 'none' } : { kind: 'lost-both', detail: { base, a, b, m } };
  }
  // They diverged — a genuine behavioral clash regardless of what merge chose.
  if (m === a) return { kind: 'clash-B-lost', detail: { base, a, b, m } };
  if (m === b) return { kind: 'clash-A-lost', detail: { base, a, b, m } };
  return { kind: 'clash-both-broken', detail: { base, a, b, m } };
}

const CONFLICT_KINDS = new Set([
  'lost-A',
  'lost-B',
  'lost-both',
  'clash-A-lost',
  'clash-B-lost',
  'clash-both-broken',
]);

// Aggregate per-input classifications for one symbol into a verdict.
// `runs` = { base, a, b, m } where each is a probe result { ok, results } and
// `inputs` is the aligned input tuples.
export function diffSymbol({ inputs, base, a, b, m }) {
  // If any world failed to even load/call the symbol, we can't judge behavior.
  const worldOk = [base, a, b, m].every((r) => r && r.ok && Array.isArray(r.results));
  if (!worldOk) {
    return { conflict: false, reason: 'unobservable', evidence: [] };
  }

  const allEvidence = [];
  const kindCounts = {};
  for (let i = 0; i < inputs.length; i++) {
    const c = classifyInput(base.results[i], a.results[i], b.results[i], m.results[i]);
    if (CONFLICT_KINDS.has(c.kind)) {
      kindCounts[c.kind] = (kindCounts[c.kind] || 0) + 1;
      allEvidence.push({ input: inputs[i], ...c });
    }
  }

  // Prefer the most READABLE evidence: inputs where no world produced NaN or a
  // thrown error make the clearest illustration of the clash. Fall back to the
  // rest if every conflicting input is noisy.
  const isClean = (e) =>
    [e.detail.base, e.detail.a, e.detail.b, e.detail.m].every(
      (s) => typeof s === 'string' && !s.includes('NaN') && !s.startsWith('throw:')
    );
  const evidence = [...allEvidence].sort((x, y) => Number(isClean(y)) - Number(isClean(x))).slice(0, 5);

  const conflict = evidence.length > 0;
  // The dominant kind characterizes the conflict for reporting/explanation.
  let dominantKind = null;
  let max = 0;
  for (const [k, n] of Object.entries(kindCounts)) {
    if (n > max) { max = n; dominantKind = k; }
  }

  return {
    conflict,
    dominantKind,
    kindCounts,
    conflictingInputs: Object.values(kindCounts).reduce((s, n) => s + n, 0),
    totalInputs: inputs.length,
    evidence,
  };
}
