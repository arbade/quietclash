// Git plumbing: resolve refs, confirm branches merge cleanly (textually), and
// materialize file contents at each ref. sentinel only cares about branches
// that merge WITHOUT textual conflict — those are exactly where a silent
// behavioral conflict can hide. If git already flags a conflict, the human
// already knows; we add nothing.

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Run a git command in `cwd`, returning stdout. Throws with stderr on failure.
async function git(args, cwd, { allowFail = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    if (allowFail) return { failed: true, err };
    throw new Error(`git ${args.join(' ')} failed: ${err.stderr || err.message}`);
  }
}

export async function resolveRef(ref, cwd) {
  const out = await git(['rev-parse', '--verify', `${ref}^{commit}`], cwd, { allowFail: true });
  if (out.failed) throw new Error(`ref not found: ${ref}`);
  return out.trim();
}

// The merge-base of base and a branch. We diff against this, not the literal
// base ref, so that "files this branch changed" means changes the branch
// introduced, not changes base accrued since they forked.
export async function mergeBase(a, b, cwd) {
  const out = await git(['merge-base', a, b], cwd);
  return out.trim();
}

// Files a branch changed relative to its fork point from base. Returns paths
// (repo-relative) with their change status (A/M/D/R...).
export async function changedFiles(base, branch, cwd) {
  const mb = await mergeBase(base, branch, cwd);
  const out = await git(['diff', '--name-status', '--no-renames', mb, branch], cwd);
  const files = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [status, ...rest] = line.split('\t');
    files.push({ status: status.trim(), path: rest.join('\t').trim() });
  }
  return files;
}

// Read a file's contents at a given ref. Returns null if the file does not
// exist at that ref (e.g. added on one branch, absent at base).
export async function fileAtRef(ref, path, cwd) {
  const out = await git(['show', `${ref}:${path}`], cwd, { allowFail: true });
  if (out.failed) return null;
  return out;
}

// Materialize a ref's tree into a fresh temp directory (a detached checkout via
// `git worktree add`). Returns { path, cleanup }. Used to actually RUN code at
// base / each branch. We use real worktrees (not `git show` per file) so that
// imports between files resolve naturally when we execute a symbol.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function checkoutTree(ref, cwd) {
  const path = mkdtempSync(join(tmpdir(), 'sentinel-wt-'));
  await git(['worktree', 'add', '--detach', '-q', path, ref], cwd);
  const cleanup = () => {
    // Synchronous + swallowed: cleanup must not leave async activity dangling
    // after callers finish, and a double-remove must never throw.
    try {
      execFileSync('git', ['worktree', 'remove', '--force', path], { cwd, stdio: 'ignore' });
    } catch {
      /* best effort */
    }
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  return { path, cleanup };
}

// Produce the MERGED tree of branchA+branchB as a temp worktree, given they
// merge cleanly. Returns { path, cleanup } or { conflict: true } if textual
// conflict (in which case sentinel has nothing to add — git already warns).
export async function checkoutMerged(base, branchA, branchB, cwd) {
  const mb = await mergeBase(branchA, branchB, cwd);
  const treeOut = await git(
    ['merge-tree', '--write-tree', '--merge-base', mb, branchA, branchB],
    cwd,
    { allowFail: true }
  );
  if (treeOut.failed) return { conflict: true };
  const treeOid = treeOut.trim().split('\n')[0];
  if (!/^[0-9a-f]{7,64}$/.test(treeOid)) return { conflict: true };
  // Commit the tree so we can add a worktree at it.
  const commitOut = await git(['commit-tree', treeOid, '-m', 'sentinel-merged'], cwd, {
    allowFail: true,
  });
  if (commitOut.failed) return { conflict: true };
  const commitOid = commitOut.trim();
  return await checkoutTree(commitOid, cwd);
}

// Does branchB merge cleanly into branchA (no textual conflict)? Uses a dry
// merge-tree so we never touch the working tree or index. Returns
// { clean: boolean, conflictedPaths: string[] }.
//
// git 2.38+ merge-tree --write-tree prints conflict info we can parse; we fall
// back to scanning for conflict markers if the porcelain isn't available.
export async function mergesCleanly(base, branchA, branchB, cwd) {
  const mb = await mergeBase(branchA, branchB, cwd);
  const out = await git(
    ['merge-tree', '--write-tree', '--merge-base', mb, branchA, branchB],
    cwd,
    { allowFail: true }
  );
  if (out.failed) {
    // Older git: merge-tree (no --write-tree) emits <<<<<<< markers on conflict.
    const legacy = await git(['merge-tree', mb, branchA, branchB], cwd, { allowFail: true });
    if (legacy.failed) return { clean: false, conflictedPaths: [], unknown: true };
    const clean = !legacy.includes('<<<<<<<');
    return { clean, conflictedPaths: [] };
  }
  // --write-tree output: first line is the tree oid, then (on conflict) an
  // "Conflicts" section listing paths. Exit code is non-zero on conflict, which
  // execFile already turned into allowFail — so reaching here with a string
  // means a clean merge.
  return { clean: true, conflictedPaths: [] };
}
