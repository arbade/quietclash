// False-positive filtering — the make-or-break step. Naive behavioral diffing
// drowns in false positives; the academic state of the art (RefFilter) exists
// almost entirely to cut them. v0 attacks the two dominant FP sources for a
// probe-based detector:
//
//   1. NON-DETERMINISM. A symbol that uses Date.now()/Math.random()/iteration
//      order produces different signatures on identical inputs. That looks like
//      a "behavior change" but is noise. We detect it by probing the SAME world
//      twice and discarding any symbol whose own behavior isn't stable.
//
//   2. PURE REFACTORING. A rename/move with identical behavior. Our symbol
//      matching is name-based, so a rename shows up as add+remove (not a direct
//      overlap) and never reaches here. But a body that was reformatted or had a
//      local variable renamed can still be flagged by the AST diff upstream; the
//      behavioral probe is the backstop — if behavior is identical across all
//      four worlds, diffSymbol already returns conflict:false. So #2 is mostly
//      handled by construction; this module documents and double-checks it.
//
// We also guard against "unobservable" symbols (TS files node can't import,
// timeouts) — those are reported as skipped, never as conflicts. Silent
// truncation of coverage would read as "all clear" when it isn't.

import { probeSymbol } from '../probe/runProbe.js';

// Probe a symbol twice in the same worktree; if the two runs disagree on any
// input, the symbol is non-deterministic and unsafe to judge behaviorally.
export async function isStable(worktreePath, relFile, symbol, inputs) {
  const r1 = await probeSymbol(worktreePath, relFile, symbol, inputs);
  if (!r1.ok) return { stable: false, reason: r1.reason };
  const r2 = await probeSymbol(worktreePath, relFile, symbol, inputs);
  if (!r2.ok) return { stable: false, reason: r2.reason };
  const stable = JSON.stringify(r1.results) === JSON.stringify(r2.results);
  return { stable, reason: stable ? null : 'non-deterministic', baseline: r1 };
}

// Given a raw conflict verdict (from diffSymbol) plus stability info, decide
// whether to KEEP it as a real finding or DROP it as a likely false positive.
// Returns { keep: boolean, droppedReason?: string }.
export function applyFilters(verdict, stability) {
  if (!verdict.conflict) return { keep: false, droppedReason: 'no-behavioral-difference' };
  if (stability && stability.stable === false) {
    return { keep: false, droppedReason: `unstable:${stability.reason}` };
  }
  // Require the conflict to show up on more than a single fluke input UNLESS
  // it's a hard clash (both agents changed the same input differently). A
  // lone "lost-A/lost-B" on one input is more likely probe-pool noise than a
  // hard clash, so we treat single-input soft losses conservatively.
  const hardKinds = ['clash-A-lost', 'clash-B-lost', 'clash-both-broken', 'lost-both'];
  const hasHard = Object.keys(verdict.kindCounts || {}).some((k) => hardKinds.includes(k));
  if (!hasHard && verdict.conflictingInputs < 2) {
    return { keep: false, droppedReason: 'single-soft-input' };
  }
  return { keep: true };
}
