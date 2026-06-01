// Extract the named top-level symbols (functions, methods, exported consts) a
// branch changed in a given file, relative to base. We parse both versions to
// AST and compare each symbol's source text. A symbol is "touched" if its
// normalized source differs between base and branch (or it was added/removed).
//
// Symbols are the unit of a behavioral conflict: two agents clash when they
// both change the behavior of the SAME symbol, or when one changes a symbol's
// contract and the other changes a caller of it. v0 detects the first, direct
// kind (same symbol touched by 2+ branches); cross-symbol caller conflicts are
// flagged more weakly via the overlap of referenced names.

import { parse } from '@typescript-eslint/typescript-estree';

const PARSE_OPTS = { loc: true, range: true, jsx: true, errorOnUnknownASTType: false };

// Parse source to AST, returning null on syntax error (we skip unparseable
// files rather than crash — a branch mid-edit shouldn't kill the whole run).
function safeParse(source) {
  if (source == null) return null;
  try {
    return parse(source, PARSE_OPTS);
  } catch {
    return null;
  }
}

// Walk top-level (and one level into class bodies) declarations, yielding
// { name, kind, range } for each named symbol. We deliberately stay shallow:
// nested closures aren't independently mergeable units.
function collectSymbols(ast, source) {
  const symbols = new Map(); // name -> { name, kind, text, references:Set }
  if (!ast) return symbols;

  const add = (name, kind, node) => {
    if (!name) return;
    const text = source.slice(node.range[0], node.range[1]);
    symbols.set(name, { name, kind, text, references: collectReferences(node, source) });
  };

  for (const node of ast.body) {
    switch (node.type) {
      case 'FunctionDeclaration':
        if (node.id) add(node.id.name, 'function', node);
        break;
      case 'ClassDeclaration':
        if (node.id) {
          add(node.id.name, 'class', node);
          // Also surface each method as Class.method so two agents editing
          // different methods of one class don't false-collide on the class.
          for (const member of node.body.body) {
            if (member.type === 'MethodDefinition' && member.key?.name) {
              add(`${node.id.name}.${member.key.name}`, 'method', member);
            }
          }
        }
        break;
      case 'VariableDeclaration':
        for (const d of node.declarations) {
          if (d.id?.type === 'Identifier') {
            const kind = d.init?.type?.includes('Function') ? 'function' : 'const';
            add(d.id.name, kind, d);
          }
        }
        break;
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration': {
        const inner = node.declaration;
        if (!inner) break;
        if (inner.type === 'FunctionDeclaration' && inner.id) add(inner.id.name, 'function', inner);
        else if (inner.type === 'ClassDeclaration' && inner.id) {
          add(inner.id.name, 'class', inner);
          for (const member of inner.body.body) {
            if (member.type === 'MethodDefinition' && member.key?.name) {
              add(`${inner.id.name}.${member.key.name}`, 'method', member);
            }
          }
        } else if (inner.type === 'VariableDeclaration') {
          for (const d of inner.declarations) {
            if (d.id?.type === 'Identifier') {
              const kind = d.init?.type?.includes('Function') ? 'function' : 'const';
              add(d.id.name, kind, d);
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return symbols;
}

// Identifiers referenced inside a node — used later to detect cross-symbol
// (caller/callee) conflicts: agent A changes foo's contract, agent B adds a
// call to foo. Cheap textual-ish scan over the node's identifier names.
function collectReferences(node, source) {
  const text = source.slice(node.range[0], node.range[1]);
  const refs = new Set();
  // Match identifier-like tokens; good enough as a reference hint for v0.
  for (const m of text.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
    refs.add(m[1]);
  }
  return refs;
}

// Normalize source for comparison by TOKENIZING and rejoining. This makes the
// comparison whitespace- and formatting-insensitive (`a+1` ≡ `a + 1` ≡ a
// reflowed multi-line body) so pure reformatting is never mistaken for a
// behavioral change. We also strip line/block comments — a comment edit isn't
// a behavior change. This is a coarse first pass; the semantic refactoring
// filter (rename/move) lives in analyze/filterFP.js.
function normalize(text) {
  const noComments = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  // Token = identifier/number run, OR a single non-space punctuation char.
  const tokens = noComments.match(/[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) || [];
  return tokens.join(' ');
}

// Compare base vs branch versions of one file's source. Returns the set of
// touched symbols: { name, kind, status: 'added'|'removed'|'modified',
// baseText, branchText, references }.
export function touchedSymbols(baseSource, branchSource) {
  const baseSyms = collectSymbols(safeParse(baseSource), baseSource ?? '');
  const branchSyms = collectSymbols(safeParse(branchSource), branchSource ?? '');
  const touched = [];

  for (const [name, b] of branchSyms) {
    const base = baseSyms.get(name);
    if (!base) {
      touched.push({ name, kind: b.kind, status: 'added', baseText: null, branchText: b.text, references: b.references });
    } else if (normalize(base.text) !== normalize(b.text)) {
      touched.push({ name, kind: b.kind, status: 'modified', baseText: base.text, branchText: b.text, references: b.references });
    }
  }
  for (const [name, base] of baseSyms) {
    if (!branchSyms.has(name)) {
      touched.push({ name, kind: base.kind, status: 'removed', baseText: base.text, branchText: null, references: base.references });
    }
  }
  return touched;
}
