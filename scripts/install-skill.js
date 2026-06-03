// quietclash — install/uninstall the Claude Code skill into the user's
// personal skills directory (~/.claude/skills/quietclash).
//
// Used two ways:
//   - as an npm `postinstall` hook (best-effort, never fails the install)
//   - as the `quietclash setup` / `quietclash setup --uninstall` command
//     (explicit, prints clear success/failure)
//
// Claude Code does NOT scan node_modules for skills, so an npm install alone
// doesn't surface the skill. Linking the bundled skill into ~/.claude/skills/
// makes Claude Code auto-discover it like any personal skill.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The skill that ships inside this package.
const PKG_SKILL = path.resolve(__dirname, '..', 'skills', 'quietclash');
// Where Claude Code looks for personal skills.
const CLAUDE_SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const TARGET = path.join(CLAUDE_SKILLS_DIR, 'quietclash');

/**
 * Result codes so callers can decide how loud to be.
 *   linked / copied / already / removed / not-installed / skipped / error
 */
export function installSkill({ quiet = false } = {}) {
  const log = (msg) => { if (!quiet) console.log(msg); };

  // The skill must exist in the package (it always should; guard anyway).
  if (!fs.existsSync(path.join(PKG_SKILL, 'SKILL.md'))) {
    return { status: 'error', reason: `bundled skill not found at ${PKG_SKILL}` };
  }

  try {
    fs.mkdirSync(CLAUDE_SKILLS_DIR, { recursive: true });
  } catch (err) {
    return { status: 'skipped', reason: `cannot create ${CLAUDE_SKILLS_DIR}: ${err.message}` };
  }

  // If something is already there, decide whether it's our up-to-date link.
  const existing = lstatSafe(TARGET);
  if (existing) {
    if (existing.isSymbolicLink()) {
      const current = readlinkSafe(TARGET);
      if (current && path.resolve(path.dirname(TARGET), current) === PKG_SKILL) {
        return { status: 'already', target: TARGET, via: 'symlink' };
      }
      // Stale symlink (old install path) — replace it.
      rmSafe(TARGET);
    } else {
      // A real dir/file is in the way. Don't clobber something the user may
      // have authored by hand; only refresh if it's clearly ours (a copy we
      // made, marked by the bundled SKILL.md content matching).
      if (isOurCopy(TARGET)) {
        rmSafe(TARGET);
      } else {
        return { status: 'skipped', reason: `${TARGET} already exists and was not created by quietclash; leaving it untouched` };
      }
    }
  }

  // Prefer a symlink (updates with the package automatically). Fall back to a
  // copy on platforms/permissions where symlinks aren't allowed (e.g. Windows
  // without Developer Mode).
  try {
    fs.symlinkSync(PKG_SKILL, TARGET, 'dir');
    log(`quietclash: linked skill → ${TARGET}`);
    return { status: 'linked', target: TARGET };
  } catch (symlinkErr) {
    try {
      copyDir(PKG_SKILL, TARGET);
      log(`quietclash: copied skill → ${TARGET}`);
      return { status: 'copied', target: TARGET, note: 'symlink unavailable; re-run "quietclash setup" after upgrades' };
    } catch (copyErr) {
      return { status: 'skipped', reason: `could not link or copy skill: ${symlinkErr.message}; ${copyErr.message}` };
    }
  }
}

export function uninstallSkill({ quiet = false } = {}) {
  const log = (msg) => { if (!quiet) console.log(msg); };
  const existing = lstatSafe(TARGET);
  if (!existing) {
    return { status: 'not-installed', target: TARGET };
  }
  // Only remove what we own: our symlink, or a copy we made.
  if (existing.isSymbolicLink()) {
    const current = readlinkSafe(TARGET);
    if (current && path.resolve(path.dirname(TARGET), current) === PKG_SKILL) {
      rmSafe(TARGET);
      log(`quietclash: removed skill link ${TARGET}`);
      return { status: 'removed', target: TARGET };
    }
    return { status: 'skipped', reason: `${TARGET} is a symlink to something else; leaving it` };
  }
  if (isOurCopy(TARGET)) {
    rmSafe(TARGET);
    log(`quietclash: removed skill copy ${TARGET}`);
    return { status: 'removed', target: TARGET };
  }
  return { status: 'skipped', reason: `${TARGET} was not created by quietclash; leaving it untouched` };
}

// --- helpers ----------------------------------------------------------------

function lstatSafe(p) { try { return fs.lstatSync(p); } catch { return null; } }
function readlinkSafe(p) { try { return fs.readlinkSync(p); } catch { return null; } }
function rmSafe(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ } }

// A copy is "ours" if its SKILL.md byte-matches the bundled one.
function isOurCopy(dir) {
  try {
    const a = fs.readFileSync(path.join(dir, 'SKILL.md'));
    const b = fs.readFileSync(path.join(PKG_SKILL, 'SKILL.md'));
    return a.equals(b);
  } catch { return false; }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// --- CLI / postinstall entrypoints -----------------------------------------

// `node scripts/install-skill.js [--uninstall] [--postinstall]`
function runFromArgv() {
  const args = process.argv.slice(2);
  const wantUninstall = args.includes('--uninstall');
  const isPostinstall = args.includes('--postinstall');

  // During `postinstall` we must NEVER fail the npm install, and we should be
  // quiet in CI / non-interactive / sandboxed installs where touching ~/.claude
  // is unwanted or impossible.
  if (isPostinstall) {
    if (shouldSkipPostinstall()) return; // silent — user can run `quietclash setup`
    const res = installSkill({ quiet: true });
    if (res.status === 'linked' || res.status === 'copied') {
      console.log(`quietclash: Claude Code skill installed → ${res.target}`);
      console.log('quietclash: try it in Claude Code, or run "quietclash setup" to re-link.');
    }
    // Any other status (already/skipped/error) → stay silent; never throw.
    return;
  }

  const res = wantUninstall ? uninstallSkill() : installSkill();
  printResult(res, wantUninstall);
}

function shouldSkipPostinstall() {
  // Honor explicit opt-out and common CI signals; skip when there's no home dir.
  if (process.env.QUIETCLASH_NO_POSTINSTALL) return true;
  if (process.env.CI) return true;
  try { if (!os.homedir()) return true; } catch { return true; }
  return false;
}

function printResult(res, wasUninstall) {
  switch (res.status) {
    case 'linked':
      console.log(`✓ Claude Code skill linked → ${res.target}`);
      console.log('  Open Claude Code and ask it to check two agent branches — the quietclash skill will trigger automatically.');
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
      if (!wasUninstall) console.log('  You can load it per-session instead: claude --plugin-dir "$(npm root -g)/quietclash"');
      break;
    case 'error':
    default:
      console.error(`✗ ${res.reason || 'unknown error'}`);
      process.exitCode = 1;
  }
}

// Run only when invoked directly (not when imported by the CLI).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFromArgv();
}
