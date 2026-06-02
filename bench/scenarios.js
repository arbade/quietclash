// Benchmark scenarios. Each is a pair of parallel agent edits to a base, plus
// the ground truth: does this merge hide a silent behavioral conflict?
//
// CONFLICT scenarios: merge cleanly (textually), pass any per-symbol test, but
// the merged behavior matches NEITHER agent's intent. These are what quietclash
// must catch.
//
// CLEAN scenarios: merge cleanly AND the merged behavior is fine. quietclash must
// STAY QUIET — firing here is a false positive, the thing that kills these tools.
//
// IMPORTANT for conflict scenarios: to keep the TEXTUAL merge clean while both
// agents edit the SAME function, the two edited lines must be far enough apart
// that git's 3-line merge context doesn't see them as one hunk. We pad the
// function body with filler lines so agent-A's line and agent-B's line are
// separated — this mirrors real life, where two agents touch the top and bottom
// of a long function and git merges both without complaint.

// Filler that separates the two edit sites by more than git's context window.
const PAD = (label) => Array.from({ length: 6 }, (_, i) => `  let _${label}${i} = ${i};`).join('\n');

export const scenarios = [
  // ---- TRUE CONFLICTS (quietclash must fire) ----
  {
    name: 'double-vs-add (same fn, far-apart lines, combined ≠ either)',
    expectConflict: true,
    file: 'm.mjs',
    base:
      `export function score(x) {\n  let v = x;\n  v = v; // A-site\n${PAD('p')}\n  v = v; // B-site\n  return v;\n}\n`,
    a:
      `export function score(x) {\n  let v = x;\n  v = v * 2; // A-site\n${PAD('p')}\n  v = v; // B-site\n  return v;\n}\n`,
    b:
      `export function score(x) {\n  let v = x;\n  v = v; // A-site\n${PAD('p')}\n  v = v + 10; // B-site\n  return v;\n}\n`,
  },
  {
    name: 'scale clash (A×100 vs B rounds — order changes result)',
    expectConflict: true,
    file: 'm.mjs',
    base:
      `export function cost(n) {\n  let c = n;\n  c = c; // A-site\n${PAD('q')}\n  c = c; // B-site\n  return c;\n}\n`,
    a:
      `export function cost(n) {\n  let c = n;\n  c = c * 100; // A-site\n${PAD('q')}\n  c = c; // B-site\n  return c;\n}\n`,
    b:
      `export function cost(n) {\n  let c = n;\n  c = c; // A-site\n${PAD('q')}\n  c = Math.round(c); // B-site\n  return c;\n}\n`,
  },
  {
    name: 'guard clash (A clamps low, B negates — non-commutative)',
    expectConflict: true,
    file: 'm.mjs',
    base:
      `export function f(x) {\n  let v = x;\n  v = v; // A-site\n${PAD('r')}\n  v = v; // B-site\n  return v;\n}\n`,
    a:
      `export function f(x) {\n  let v = x;\n  v = v < 0 ? 0 : v; // A-site\n${PAD('r')}\n  v = v; // B-site\n  return v;\n}\n`,
    b:
      `export function f(x) {\n  let v = x;\n  v = v; // A-site\n${PAD('r')}\n  v = -v; // B-site\n  return v;\n}\n`,
  },

  // ---- CLEAN (quietclash must stay quiet) ----
  {
    name: 'independent functions (no shared symbol)',
    expectConflict: false,
    file: 'm.mjs',
    // Separate the two functions by padding so agent edits land in different
    // git hunks and merge cleanly — they're genuinely independent changes.
    base: `export function a(x){ return x; }\n${PAD('u')}\nexport function b(x){ return x; }\n`,
    a: `export function a(x){ return x + 1; }\n${PAD('u')}\nexport function b(x){ return x; }\n`,
    b: `export function a(x){ return x; }\n${PAD('u')}\nexport function b(x){ return x * 2; }\n`,
  },
  {
    name: 'compatible identical change (both agents make the same edit)',
    expectConflict: false,
    file: 'm.mjs',
    base:
      `export function g(x){\n  let v = x;\n  v = v; // site\n${PAD('s')}\n  return v;\n}\n`,
    a:
      `export function g(x){\n  let v = x;\n  v = v + 1; // site\n${PAD('s')}\n  return v;\n}\n`,
    b:
      `export function g(x){\n  let v = x;\n  v = v + 1; // site\n${PAD('s')}\n  return v;\n}\n`,
  },
  {
    name: 'only one agent touches the symbol',
    expectConflict: false,
    file: 'm.mjs',
    base: `export function h(x){ return x; }\n`,
    a: `export function h(x){ return x * 3; }\n`,
    b: `export function h(x){ return x; }\n`,
  },
  {
    name: 'pure reformat vs real change (reformat must not false-fire)',
    expectConflict: false,
    file: 'm.mjs',
    base:
      `export function k(x){\n  let v = x;\n  v = v + 1; // A-site\n${PAD('t')}\n  v = v; // B-site\n  return v;\n}\n`,
    a:
      `export function k(x) {\n  let v = x;\n  v   =   v + 1;   // A-site (reformatted only)\n${PAD('t')}\n  v = v; // B-site\n  return v;\n}\n`,
    b:
      `export function k(x){\n  let v = x;\n  v = v + 1; // A-site\n${PAD('t')}\n  v = v + 5; // B-site\n  return v;\n}\n`,
  },

  // ---- CONTRACT conflict (producer changes a fn; consumer adds a caller) ----
  {
    name: 'broken contract (A changes parsePrice to cents, B adds dollar-assuming caller)',
    expectConflict: true,
    file: 'm.mjs',
    // A edits parsePrice (top of file); B appends formatTotal (bottom). The PAD
    // between them keeps the two edits in separate git hunks -> clean merge.
    base: `export function parsePrice(s){ return Number(s); }\n${PAD('c')}\n`,
    a: `export function parsePrice(s){ return Math.round(Number(s) * 100); }\n${PAD('c')}\n`,
    b: `export function parsePrice(s){ return Number(s); }\n${PAD('c')}\nexport function formatTotal(s){ return '$' + parsePrice(s).toFixed(2); }\n`,
  },
  {
    name: 'compatible contract (A leaves parsePrice behavior intact, B adds caller — must stay quiet)',
    expectConflict: false,
    file: 'm.mjs',
    // A reformats parsePrice (behavior identical); B adds a caller. Contract
    // holds -> quietclash must NOT fire.
    base: `export function parsePrice(s){ return Number(s); }\n${PAD('d')}\n`,
    a: `export function parsePrice(s){\n  return Number(s); // parse numeric price\n}\n${PAD('d')}\n`,
    b: `export function parsePrice(s){ return Number(s); }\n${PAD('d')}\nexport function formatTotal(s){ return '$' + parsePrice(s).toFixed(2); }\n`,
  },
];
