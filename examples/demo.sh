#!/usr/bin/env bash
#
# quietclash demo — builds a throwaway repo where two "agents" make changes that
# merge cleanly and pass review, yet silently break each other, then runs
# quietclash to catch it. Great for recording an asciinema cast for the README:
#
#   asciinema rec --command "examples/demo.sh" demo.cast
#
# Run from the repo root:  bash examples/demo.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEMO="$(mktemp -d)"
trap 'rm -rf "$DEMO"' EXIT

cd "$DEMO"
git init -q
git config user.email demo@example.com
git config user.name demo
git config commit.gpgsign false

# --- base: parsePrice returns dollars as a number ---------------------------
cat > price.mjs <<'EOF'
export function parsePrice(s) {
  return Number(s);
}
EOF
git add -A && git commit -qm "base: parsePrice returns dollars"
BASE=$(git rev-parse HEAD)

# --- agent A: changes parsePrice to return CENTS (a contract change) ---------
git checkout -q -b agent-a
cat > price.mjs <<'EOF'
export function parsePrice(s) {
  // switched to integer cents to avoid float rounding bugs
  return Math.round(Number(s) * 100);
}
EOF
git add -A && git commit -qm "agent-a: parsePrice now returns cents"

# --- agent B: adds a caller that assumes DOLLARS (the old contract) ----------
git checkout -q "$BASE"
git checkout -q -b agent-b
cat > price.mjs <<'EOF'
export function parsePrice(s) {
  return Number(s);
}
export function formatTotal(s) {
  return '$' + parsePrice(s).toFixed(2);
}
EOF
git add -A && git commit -qm "agent-b: add formatTotal()"
git checkout -q "$BASE"

echo
echo "Two agents worked in parallel. Their branches merge with NO git conflict:"
echo
git merge-tree --write-tree --merge-base "$BASE" agent-a agent-b >/dev/null \
  && echo "  \$ git merge agent-a agent-b   →   clean merge, no conflicts ✓" \
  || echo "  (unexpected textual conflict)"
echo
echo "But quietclash runs the code and sees what git can't:"
echo
echo "  \$ quietclash check --base main --branches agent-a,agent-b"
echo
node "$ROOT/bin/quietclash.js" check --base "$BASE" --branches agent-a,agent-b --cwd "$DEMO"
echo
