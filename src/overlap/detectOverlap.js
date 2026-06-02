// Compute the OVERLAP SURFACE across branches: the symbols where a silent
// behavioral conflict can live. Two flavors:
//
//   1. DIRECT  — 2+ branches independently modified the same symbol. The merge
//                picks one or interleaves; behavior may match neither intent.
//   2. CONTRACT — branch A changed a symbol's behavior/contract, while branch B
//                 added or changed a *reference* to that symbol (a caller). The
//                 caller was written against the OLD contract.
//
// Everything downstream (probing, explanation) operates on this surface, so the
// overlap step is what keeps quietclash focused — we never probe symbols only one
// agent touched, because those carry no cross-agent conflict risk.

import { changedFiles, fileAtRef } from '../git/worktrees.js';
import { touchedSymbols } from '../git/changedSymbols.js';

const TS_JS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// Build, per branch, a map of file -> touched symbols. Skips non-JS/TS files
// (v0 scope) and deleted files (nothing to probe).
async function touchedByBranch(base, branch, cwd) {
  const files = await changedFiles(base, branch, cwd);
  const byFile = new Map();
  for (const { path, status } of files) {
    if (!TS_JS.test(path)) continue;
    if (status === 'D') continue;
    const [baseSrc, branchSrc] = await Promise.all([
      fileAtRef(base, path, cwd),
      fileAtRef(branch, path, cwd),
    ]);
    const touched = touchedSymbols(baseSrc, branchSrc);
    if (touched.length) byFile.set(path, touched);
  }
  return byFile;
}

// Detect overlaps for a set of branches. Returns:
//   { direct: [...], contract: [...], perBranch: Map }
// where each direct entry is { file, symbol, kind, branches: [{branch, status, baseText, branchText}] }
// and each contract entry is { file, symbol, producer, consumer, ... }.
export async function detectOverlap(base, branches, cwd) {
  const perBranch = new Map();
  for (const branch of branches) {
    perBranch.set(branch, await touchedByBranch(base, branch, cwd));
  }

  // --- DIRECT overlaps: same (file, symbol) touched by 2+ branches. ---
  // Key by file::symbol so the same symbol name in different files stays distinct.
  const index = new Map(); // key -> { file, symbol, kind, hits: [{branch, ...}] }
  for (const [branch, byFile] of perBranch) {
    for (const [file, syms] of byFile) {
      for (const s of syms) {
        const key = `${file}::${s.name}`;
        if (!index.has(key)) index.set(key, { file, symbol: s.name, kind: s.kind, hits: [] });
        index.get(key).hits.push({
          branch,
          status: s.status,
          baseText: s.baseText,
          branchText: s.branchText,
          references: s.references,
        });
      }
    }
  }

  const direct = [];
  for (const entry of index.values()) {
    if (entry.hits.length >= 2) {
      direct.push({
        file: entry.file,
        symbol: entry.symbol,
        kind: entry.kind,
        branches: entry.hits.map(({ branch, status, baseText, branchText }) => ({
          branch,
          status,
          baseText,
          branchText,
        })),
      });
    }
  }

  // --- CONTRACT overlaps: branch P modified symbol S; branch C (≠P) touched a
  // symbol whose body references S. The consumer may rely on S's old behavior. ---
  const contract = [];
  // Set of symbols each branch modified (producers of a changed contract).
  const modifiedByBranch = new Map();
  for (const [branch, byFile] of perBranch) {
    const mod = new Set();
    for (const syms of byFile.values()) {
      for (const s of syms) if (s.status === 'modified' || s.status === 'removed') mod.add(s.name);
    }
    modifiedByBranch.set(branch, mod);
  }

  for (const [producer, prodMod] of modifiedByBranch) {
    for (const sym of prodMod) {
      for (const [consumer, byFile] of perBranch) {
        if (consumer === producer) continue;
        for (const [file, syms] of byFile) {
          for (const s of syms) {
            // Consumer touched a DIFFERENT symbol that references the changed one.
            if (s.name !== sym && s.references?.has(sym)) {
              // De-dup: don't also report this if it's already a direct overlap.
              const key = `${file}::${s.name}`;
              const alreadyDirect = index.get(key)?.hits.length >= 2;
              if (alreadyDirect) continue;
              contract.push({
                file,
                changedSymbol: sym,
                producer,
                consumerSymbol: s.name,
                consumer,
              });
            }
          }
        }
      }
    }
  }

  return { direct, contract, perBranch };
}
