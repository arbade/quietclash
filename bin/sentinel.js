#!/usr/bin/env node
// sentinel — detects silent behavioral merge conflicts between parallel AI agents.
//
// The problem: two agents both edit code that merges cleanly (git sees no
// conflict) and passes tests, yet are behaviorally incompatible at runtime.
// sentinel finds the overlap surface, probes behavior, and explains the clash.
//
// Commands:
//   sentinel check --base <ref> --branches <a,b,...> [--json]
//   sentinel explain <symbol> --base <ref> --branches <a,b>
//   sentinel bench [--json]

import { parseArgs } from 'node:util';

const HELP = `sentinel — semantic conflict detection for parallel coding agents

USAGE
  sentinel check --base <ref> --branches <a,b,...> [--cwd <dir>] [--json]
      Find silent behavioral conflicts between branches that merge cleanly.

  sentinel explain <symbol> --base <ref> --branches <a,b> [--cwd <dir>]
      Deep-dive one conflicting symbol with a plain-language explanation.

  sentinel bench [--json]
      Run the evaluation suite; reports precision/recall and the headline
      "caught X% of test-passing merges with hidden behavioral conflicts".

OPTIONS
  --base       Git ref the agents branched from (e.g. main).
  --branches   Comma-separated agent branch refs to compare.
  --cwd        Repository directory (default: current dir).
  --json       Emit machine-readable JSON instead of a table.
  -h, --help   Show this help.

EXAMPLE
  sentinel check --base main --branches agent-a,agent-b

Why this exists: production code generation is solved; the bottleneck moved to
reviewing and trusting what agents produce. Git only sees TEXTUAL conflicts.
~5-10% of parallel-agent merges are textually clean but behaviorally broken
(CodeCRDT, arXiv:2510.18893). sentinel catches that slice.`;

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === '-h' || command === '--help' || command === 'help') {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }

  // Shared option schema. Positionals captured separately per command.
  const options = {
    base: { type: 'string' },
    branches: { type: 'string' },
    cwd: { type: 'string', default: process.cwd() },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  };

  let parsed;
  try {
    parsed = parseArgs({ args: argv.slice(1), options, allowPositionals: true });
  } catch (err) {
    console.error(`sentinel: ${err.message}`);
    process.exit(2);
  }
  const { values, positionals } = parsed;

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  switch (command) {
    case 'check': {
      const { runCheck } = await import('../src/check.js');
      const branches = (values.branches ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!values.base || branches.length < 2) {
        console.error('sentinel check: requires --base <ref> and --branches <a,b,...> (at least 2).');
        process.exit(2);
      }
      await runCheck({ base: values.base, branches, cwd: values.cwd, json: values.json });
      break;
    }
    case 'explain': {
      const { runExplain } = await import('../src/check.js');
      const symbol = positionals[0];
      const branches = (values.branches ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!symbol || !values.base || branches.length < 2) {
        console.error('sentinel explain: requires <symbol>, --base <ref>, and --branches <a,b>.');
        process.exit(2);
      }
      await runExplain({ symbol, base: values.base, branches, cwd: values.cwd });
      break;
    }
    case 'bench': {
      const { runBench } = await import('../bench/eval.js');
      await runBench({ json: values.json });
      break;
    }
    default:
      console.error(`sentinel: unknown command "${command}". Run "sentinel --help".`);
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`sentinel: ${err.stack || err.message || err}`);
  process.exit(1);
});
