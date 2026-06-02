// Synthesize characterization inputs for a symbol. We don't have a spec, so we
// generate a spread of probe inputs and OBSERVE behavior — the SAM idea: the
// symbol's own past behavior is the spec. If merged behavior diverges from both
// branches' behavior on the same inputs, that's a conflict.
//
// v0 targets pure-ish functions. We derive argument count from the source and
// draw from a typed value pool so each argument position gets varied inputs.
// This is deliberately simple; the goal is to TRIP a behavioral difference, not
// to achieve coverage.

// Extract the parameter count of a function symbol from its source text.
// Handles `function f(a,b)`, `const f = (a,b) =>`, `f(a, b) {` (method).
export function arityOf(source) {
  if (!source) return 0;
  // Try, in order: classic `function name(params)`, method `name(params) {`,
  // or arrow `(params) =>` / `param =>`. We take the FIRST parameter list that
  // belongs to the symbol's own definition.
  let params = null;
  const fn = source.match(/function\s*[A-Za-z0-9_$]*\s*\(([^)]*)\)/);
  if (fn) {
    params = fn[1];
  } else {
    const arrowParen = source.match(/\(([^)]*)\)\s*=>/);
    if (arrowParen) {
      params = arrowParen[1];
    } else {
      const arrowBare = source.match(/(?:^|=\s*)([A-Za-z0-9_$]+)\s*=>/);
      if (arrowBare) params = arrowBare[1];
      else {
        // Method shorthand: `name(params) {`
        const method = source.match(/[A-Za-z0-9_$]+\s*\(([^)]*)\)\s*\{/);
        if (method) params = method[1];
      }
    }
  }
  if (params == null) return 0;
  const trimmed = params.trim();
  if (!trimmed) return 0;
  return trimmed.split(',').filter((p) => p.trim()).length;
}

// A typed pool of probe values. Mixing types is intentional: a function that
// changed its assumption about input type (string date vs timestamp) will
// behave differently across these.
const POOL = [
  // strings (incl. date-like)
  '2026-01-15',
  '2026-01-15T10:30:00',
  'hello',
  '',
  '42',
  // numbers
  0,
  1,
  -1,
  42,
  3.14,
  1700000000000,
  // booleans / nullish
  true,
  false,
  null,
  undefined,
  // structured
  [1, 2, 3],
  { a: 1 },
];

// Build a list of argument-tuples to call the symbol with. For arity N we take
// the cartesian-ish product but cap it: each position cycles through the pool,
// plus all-same-index tuples to keep it cheap but varied.
//
// We vary one position at a time against TWO neutral fills — a numeric 1 and a
// string — because a single neutral biases the probe: an all-string fill makes
// multi-arg numeric functions return NaN everywhere (no observable behavior),
// and vice versa. Trying both neutrals dramatically widens what we can observe.
export function synthInputs(arity, cap = 40) {
  if (arity === 0) return [[]];
  const tuples = [];
  const neutrals = [1, '1']; // numeric and string neutral fills
  for (const neutral of neutrals) {
    for (let pos = 0; pos < arity; pos++) {
      for (const v of POOL) {
        const tuple = new Array(arity).fill(neutral);
        tuple[pos] = v;
        tuples.push(tuple);
        if (tuples.length >= cap) return tuples;
      }
    }
  }
  // Diagonal tuples (same pool index across positions) catch correlated args.
  for (let i = 0; i < POOL.length && tuples.length < cap; i++) {
    tuples.push(new Array(arity).fill(POOL[i]));
  }
  return tuples.slice(0, cap);
}
