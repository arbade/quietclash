#!/usr/bin/env node
// quietclash — detects silent behavioral merge conflicts between parallel AI agents.
//
// The problem: two agents both edit code that merges cleanly (git sees no
// conflict) and passes tests, yet are behaviorally incompatible at runtime.
// quietclash finds the overlap surface, probes behavior, and explains the clash.
//
// Commands:
//   quietclash check --base <ref> --branches <a,b,...> [--json]
//   quietclash explain <symbol> --base <ref> --branches <a,b>
//   quietclash bench [--json]

import { parseArgs } from 'node:util';

const HELP = `quietclash — semantic conflict detection for parallel coding agents

USAGE
  quietclash check --base <ref> --branches <a,b,...> [--cwd <dir>] [--json]
      Find silent behavioral conflicts between branches that merge cleanly.

  quietclash explain <symbol> --base <ref> --branches <a,b> [--cwd <dir>]
      Deep-dive one conflicting symbol with a plain-language explanation.

  quietclash bench [--json]
      Run the evaluation suite; reports precision/recall and the headline
      "caught X% of test-passing merges with hidden behavioral conflicts".

  quietclash setup [--uninstall]
      Install (or remove) the Claude Code skill so Claude auto-triggers
      quietclash. Links the bundled skill into ~/.claude/skills/. Normally
      runs automatically on npm install; run it by hand if that was skipped.

OPTIONS
  --base       Git ref the agents branched from (e.g. main).
  --branches   Comma-separated agent branch refs to compare.
  --cwd        Repository directory (default: current dir).
  --json       Emit machine-readable JSON instead of a table.
  -h, --help   Show this help.

EXAMPLE
  quietclash check --base main --branches agent-a,agent-b

Why this exists: production code generation is solved; the bottleneck moved to
reviewing and trusting what agents produce. Git only sees TEXTUAL conflicts.
~5-10% of parallel-agent merges are textually clean but behaviorally broken
(CodeCRDT, arXiv:2510.18893). quietclash catches that slice.`;

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
    uninstall: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  };

  let parsed;
  try {
    parsed = parseArgs({ args: argv.slice(1), options, allowPositionals: true });
  } catch (err) {
    console.error(`quietclash: ${err.message}`);
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
        console.error('quietclash check: requires --base <ref> and --branches <a,b,...> (at least 2).');
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
        console.error('quietclash explain: requires <symbol>, --base <ref>, and --branches <a,b>.');
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
    case 'setup': {
      const { installSkill, uninstallSkill } = await import('../scripts/install-skill.js');
      const uninstall = positionals.includes('uninstall') || values.uninstall;
      const res = uninstall ? uninstallSkill() : installSkill();
      switch (res.status) {
        case 'linked':
          console.log(`✓ Claude Code skill linked → ${res.target}`);
          console.log('  In Claude Code, ask it to check two agent branches — the quietclash skill triggers automatically.');
          break;
        case 'copied':
          console.log(`✓ Claude Code skill copied → ${res.target}`);
          console.log(`  (${res.note})`);
          break;
        case 'already':
          console.log(`✓ Already installed → ${res.target} (${res.via})`);
          break;
        case 'removed':
          console.log(`✓ Removed → ${res.target}`);
          break;
        case 'not-installed':
          console.log(`Nothing to remove — no skill at ${res.target}.`);
          break;
        case 'skipped':
          console.log(`• Skipped: ${res.reason}`);
          if (!uninstall) console.log('  Load it per-session instead: claude --plugin-dir "$(npm root -g)/quietclash"');
          break;
        default:
          console.error(`✗ ${res.reason || 'unknown error'}`);
          process.exitCode = 1;
      }
      break;
    }
    default:
      console.error(`quietclash: unknown command "${command}". Run "quietclash --help".`);
      process.exit(2);
  }
}

main().catch((err) => {
  // Show a clean one-line message by default; full stack only when debugging.
  // A stack trace on a simple typo (bad ref) reads like the tool crashed.
  if (process.env.QUIETCLASH_DEBUG) {
    console.error(err.stack || err);
  } else {
    console.error(`quietclash: ${err.message || err}`);
  }
  process.exit(1);
});
