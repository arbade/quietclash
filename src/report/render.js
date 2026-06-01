// Render the conflict report — a terminal summary and a stable JSON shape.
// The headline leads with the one fact that matters: these branches merge
// cleanly and pass textual review, yet N symbols behave in a way no agent
// intended.

const KIND_LABEL = {
  'lost-A': "branch A's change was silently dropped by the merge",
  'lost-B': "branch B's change was silently dropped by the merge",
  'lost-both': "both branches' shared change was dropped by the merge",
  'clash-A-lost': "branches changed it incompatibly; A's intent was lost",
  'clash-B-lost': "branches changed it incompatibly; B's intent was lost",
  'clash-both-broken': 'branches changed it incompatibly; the merge matches neither',
};

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', cyan: '\x1b[36m',
};
const useColor = process.stdout.isTTY;
const paint = (s, color) => (useColor ? color + s + c.reset : s);

export function toJSON(result) {
  return {
    schemaVersion: '0',
    base: result.base,
    branches: result.branches,
    summary: {
      cleanMerge: result.cleanMerge,
      overlapSymbols: result.overlapCount,
      probed: result.probedCount,
      conflicts: result.conflicts.length,
      skipped: result.skipped.length,
    },
    conflicts: result.conflicts,
    skipped: result.skipped,
    contractHints: result.contractHints || [],
  };
}

export function renderTerminal(result) {
  const lines = [];
  const { conflicts, skipped, branches } = result;

  if (!result.cleanMerge) {
    lines.push(paint('⚠ Branches do not merge cleanly (textual conflict).', c.yellow));
    lines.push(paint('  sentinel adds nothing here — git already flags this. Resolve the textual conflict first.', c.dim));
    return lines.join('\n');
  }

  // Headline
  const n = conflicts.length;
  if (n === 0) {
    lines.push(paint('✓ No silent behavioral conflicts detected.', c.green));
    lines.push(
      paint(
        `  Probed ${result.probedCount} overlapping symbol(s) across ${branches.length} branches; all merged behavior matched agent intent.`,
        c.dim
      )
    );
  } else {
    lines.push(
      paint(`✖ ${n} silent behavioral conflict${n > 1 ? 's' : ''} found`, c.bold + c.red) +
        paint(` — these branches merge cleanly and pass tests, but behave in ways no agent intended.`, c.reset)
    );
  }

  // Conflicts
  for (const cf of conflicts) {
    lines.push('');
    lines.push(paint(`  ${cf.symbol}`, c.bold) + paint(`  (${cf.file})`, c.dim));
    lines.push(`    ${paint('what', c.cyan)}: ${KIND_LABEL[cf.dominantKind] || cf.dominantKind}`);
    lines.push(
      `    ${paint('evidence', c.cyan)}: diverged on ${cf.conflictingInputs}/${cf.totalInputs} probe inputs`
    );
    const ex = cf.evidence?.[0];
    if (ex) {
      lines.push(
        paint(
          `      e.g. input ${JSON.stringify(ex.input)} → base=${ex.detail.base} | A=${ex.detail.a} | B=${ex.detail.b} | merged=${ex.detail.m}`,
          c.dim
        )
      );
    }
    if (cf.explanation) {
      lines.push(`    ${paint('why', c.cyan)}: ${cf.explanation}`);
    }
  }

  // Contract hints (cross-symbol, weaker signal)
  if (result.contractHints?.length) {
    lines.push('');
    lines.push(paint(`  ${result.contractHints.length} contract hint(s) (a changed symbol has a new caller on another branch):`, c.yellow));
    for (const h of result.contractHints.slice(0, 5)) {
      lines.push(paint(`    ${h.changedSymbol} (changed on ${h.producer}) is called by ${h.consumerSymbol} (added on ${h.consumer})`, c.dim));
    }
  }

  // Skipped (honesty about coverage)
  if (skipped.length) {
    lines.push('');
    lines.push(paint(`  ${skipped.length} symbol(s) skipped (not behaviorally observable):`, c.dim));
    const byReason = {};
    for (const s of skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
    for (const [reason, count] of Object.entries(byReason)) {
      lines.push(paint(`    ${count}× ${reason}`, c.dim));
    }
  }

  return lines.join('\n');
}
