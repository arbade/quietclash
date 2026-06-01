import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchedSymbols } from '../src/git/changedSymbols.js';

test('detects a modified function body', () => {
  const base = `export function parseDate(s) { return new Date(s); }`;
  const branch = `export function parseDate(s) { return new Date(s + 'Z'); }`;
  const touched = touchedSymbols(base, branch);
  const t = touched.find((x) => x.name === 'parseDate');
  assert.ok(t, 'parseDate should be touched');
  assert.equal(t.status, 'modified');
});

test('ignores pure whitespace reformatting', () => {
  const base = `export function f(a){return a+1;}`;
  const branch = `export function f(a) {\n  return a + 1;\n}`;
  const touched = touchedSymbols(base, branch);
  assert.equal(touched.find((x) => x.name === 'f'), undefined, 'reformat should not count as touched');
});

test('detects added symbol', () => {
  const base = `export function a() {}`;
  const branch = `export function a() {}\nexport function b() { return a(); }`;
  const touched = touchedSymbols(base, branch);
  const b = touched.find((x) => x.name === 'b');
  assert.equal(b?.status, 'added');
  assert.ok(b.references.has('a'), 'b should reference a');
});

test('surfaces class methods independently', () => {
  const base = `class C { foo() { return 1; } bar() { return 2; } }`;
  const branch = `class C { foo() { return 99; } bar() { return 2; } }`;
  const touched = touchedSymbols(base, branch);
  assert.ok(touched.find((x) => x.name === 'C.foo' && x.status === 'modified'), 'C.foo modified');
  assert.equal(touched.find((x) => x.name === 'C.bar'), undefined, 'C.bar unchanged');
});

test('handles unparseable source without throwing', () => {
  const base = `function ok() {}`;
  const branch = `function ok( {{{ broken`;
  assert.doesNotThrow(() => touchedSymbols(base, branch));
});
