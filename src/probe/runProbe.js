// Observe a symbol's behavior in a given worktree by importing the module and
// calling the symbol with synthesized inputs, capturing a stable "behavior
// signature" per input: the JSON-ish shape of the return value, or the error
// kind. We run in a SEPARATE node process so a hang/crash/infinite-loop in
// agent code can't take down quietclash, and so module side effects are isolated.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

// The harness script we run in the child process. It imports the target module,
// resolves the symbol (supporting `Class.method` via a fresh instance), calls it
// for each input tuple, and prints a JSON array of behavior signatures.
function harnessSource(absModulePath, symbol, inputsJson) {
  return `
import * as mod from ${JSON.stringify('file://' + absModulePath)};
const inputs = ${inputsJson};
const symbolName = ${JSON.stringify(symbol)};

function resolveCallable(mod, name) {
  if (name.includes('.')) {
    const [cls, method] = name.split('.');
    const C = mod[cls] ?? mod.default?.[cls];
    if (typeof C !== 'function') return null;
    try { const inst = new C(); return (typeof inst[method] === 'function') ? inst[method].bind(inst) : null; }
    catch { return null; }
  }
  const fn = mod[name] ?? mod.default?.[name] ?? (mod.default && mod.default.name === name ? mod.default : null);
  return typeof fn === 'function' ? fn : null;
}

// Reduce a value to a stable signature: type + a normalized representation.
// Dates -> ISO; functions/symbols -> kind only. Keeps it comparable across runs.
function sig(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'number') return Number.isNaN(v) ? 'number:NaN' : 'number:' + v;
  if (t === 'bigint') return 'bigint:' + v;
  if (t === 'boolean') return 'boolean:' + v;
  if (t === 'string') return 'string:' + v;
  if (t === 'function') return 'function';
  if (v instanceof Date) return 'date:' + (isNaN(v.getTime()) ? 'Invalid' : v.toISOString());
  try { return 'json:' + JSON.stringify(v); } catch { return 'object:unserializable'; }
}

const fn = resolveCallable(mod, symbolName);
const results = [];
if (!fn) {
  console.log(JSON.stringify({ ok: false, reason: 'not-callable' }));
  process.exit(0);
}
for (const args of inputs) {
  try {
    const out = fn(...args);
    if (out && typeof out.then === 'function') { results.push('promise'); }
    else results.push(sig(out));
  } catch (e) {
    results.push('throw:' + (e && e.name ? e.name : 'Error'));
  }
}
console.log(JSON.stringify({ ok: true, results }));
`;
}

// Run the symbol in one worktree. Returns { ok, results } where results is an
// array of behavior signatures aligned to `inputs`, or { ok:false, reason }.
export async function probeSymbol(worktreePath, relFile, symbol, inputs) {
  const absModule = resolve(worktreePath, relFile);
  const harnessDir = mkdtempSync(join(tmpdir(), 'quietclash-h-'));
  const harnessPath = join(harnessDir, 'harness.mjs');
  writeFileSync(harnessPath, harnessSource(absModule, symbol, JSON.stringify(inputs)));
  try {
    const { stdout } = await execFileAsync('node', [harnessPath], {
      timeout: 10000, // guard against infinite loops in agent code (generous for slow/loaded CI)
      maxBuffer: 8 * 1024 * 1024,
    });
    const line = stdout.trim().split('\n').filter(Boolean).pop() || '{}';
    return JSON.parse(line);
  } catch (err) {
    // Timeout, import failure (e.g. TS file node can't load), or crash.
    const reason = err.killed ? 'timeout' : 'load-error';
    return { ok: false, reason, detail: (err.stderr || err.message || '').slice(0, 300) };
  } finally {
    rmSync(harnessDir, { recursive: true, force: true });
  }
}
