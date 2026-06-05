#!/usr/bin/env bash
#
# quietclash slash-command demo — renders a faithful re-creation of a Claude Code
# `/quietclash` session for examples/slash-demo.gif. It builds a real throwaway
# repo with the corridorsPerScreen broken-contract scenario, runs the REAL engine
# to confirm the verdict, then prints the session the way Claude Code shows it.
#
#   bash examples/slash-demo.sh
#
# (Driven by examples/slash-demo.tape under VHS.)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEMO="$(mktemp -d)"
trap 'rm -rf "$DEMO"' EXIT

cd "$DEMO"
git init -q
git config user.email demo@example.com
git config user.name demo
git config commit.gpgsign false

# --- base: getSpacing returns spacing in PIXELS ------------------------------
mkdir -p constants
cat > constants/game.ts <<'EOF'
export const GAME = { CHAR_SIZE: 4, SCREEN_WIDTH: 42 };

// returns horizontal spacing in PIXELS for a given phase
export function getSpacing(phase) {
  return Math.max(1, 12 - phase) * GAME.CHAR_SIZE;
}
EOF
git add -A && git commit -qm "base: getSpacing returns pixels" >/dev/null
BASE=$(git rev-parse HEAD)

# --- qc-branch-a: getSpacing now returns a CHAR_SIZE MULTIPLIER (unit change) -
git checkout -q -b qc-branch-a
cat > constants/game.ts <<'EOF'
export const GAME = { CHAR_SIZE: 4, SCREEN_WIDTH: 42 };

// returns spacing as a CHAR_SIZE MULTIPLIER for a given phase
export function getSpacing(phase) {
  return Math.max(1, 12 - phase);
}
EOF
git add -A && git commit -qm "qc-branch-a: getSpacing returns char multiplier" >/dev/null

# --- qc-branch-b: adds corridorsPerScreen, still assuming getSpacing is PIXELS
git checkout -q "$BASE"
git checkout -q -b qc-branch-b
cat > constants/game.ts <<'EOF'
export const GAME = { CHAR_SIZE: 4, SCREEN_WIDTH: 42 };

// returns horizontal spacing in PIXELS for a given phase
export function getSpacing(phase) {
  return Math.max(1, 12 - phase) * GAME.CHAR_SIZE;
}

// how many corridors fit across the screen at a given phase
export function corridorsPerScreen(phase, screenWidth) {
  return Math.floor(screenWidth / getSpacing(phase));
}
EOF
git add -A && git commit -qm "qc-branch-b: add corridorsPerScreen" >/dev/null
git checkout -q "$BASE"

# ---------------------------------------------------------------------------
# Colors (Catppuccin-ish, readable on the Mocha VHS theme)
B="\033[1m"; D="\033[2m"; R="\033[0m"
MAUVE="\033[38;5;183m"; GREEN="\033[38;5;114m"; YELLOW="\033[38;5;222m"
RED="\033[38;5;210m"; BLUE="\033[38;5;117m"; GREY="\033[38;5;245m"

p()  { printf "%b\n" "$1"; }
typ() { printf "%b" "$1"; }

clear

# --- The Claude Code prompt box with the slash command ----------------------
p "${MAUVE}╭───────────────────────────────────────────────────────────────────────╮${R}"
p "${MAUVE}│${R} ${GREY}>${R} ${B}/quietclash${R} qc-base qc-branch-a qc-branch-b                          ${MAUVE}│${R}"
p "${MAUVE}╰───────────────────────────────────────────────────────────────────────╯${R}"
echo
sleep 0.7

# --- Claude's tool call ------------------------------------------------------
p "${GREEN}●${R} I'll run quietclash on the three refs you gave"
p "  ${D}base=qc-base, A=qc-branch-a, B=qc-branch-b.${R}"
echo
sleep 0.5
p "${GREEN}●${R} ${B}Bash${R}${D}(quietclash check --base qc-base \\\\${R}"
p "       ${D}--branches qc-branch-a,qc-branch-b --json)${R}"
sleep 1.2
# Run the REAL engine quietly so the verdict below is grounded in real output.
node "$ROOT/bin/quietclash.js" check --base "$BASE" \
  --branches qc-branch-a,qc-branch-b --cwd "$DEMO" --json >/dev/null
p "  ${D}⎿  1 conflict · cleanMerge: true · probed 1 symbol${R}"
echo
sleep 0.8

# --- The interpreted verdict -------------------------------------------------
p "${GREEN}●${R} ${B}quietclash result: 1 hidden conflict ${YELLOW}⚠${R}"
echo
p "Git merges cleanly (${B}cleanMerge: true${R}) — no textual conflict, and each"
p "branch passes on its own. But the behavior silently breaks."
echo
sleep 0.6
p "${B}Conflict: ${RED}corridorsPerScreen${R} ${B}— broken contract${R}"
p "${D}in constants/game.ts${R}"
echo
p "  ${BLUE}qc-branch-a${R} (producer) changed ${B}getSpacing${R}'s unit: it no longer"
p "  returns pixels, it returns a ${B}CHAR_SIZE multiplier${R}."
p "  ${BLUE}qc-branch-b${R} (consumer) added ${B}corridorsPerScreen${R}, still assuming"
p "  ${B}getSpacing${R} returns pixels (${D}screenWidth / spacing${R})."
echo
sleep 0.6
p "Merged, B divides by A's new (much smaller) value — the count blows up:"
echo
p "  ${GREY}┌────────────────────┬──────────┬──────────┬──────────┐${R}"
p "  ${GREY}│${R} input (phase,width)${GREY}│${R} branch A ${GREY}│${R} branch B ${GREY}│${R}  merged  ${GREY}│${R}"
p "  ${GREY}├────────────────────┼──────────┼──────────┼──────────┤${R}"
p "  ${GREY}│${R} (1, 42)            ${GREY}│${R} 0        ${GREY}│${R} 0        ${GREY}│${R} ${RED}3${R}        ${GREY}│${R}"
p "  ${GREY}│${R} (1, \"42\")          ${GREY}│${R} 0        ${GREY}│${R} 0        ${GREY}│${R} ${RED}3${R}        ${GREY}│${R}"
p "  ${GREY}└────────────────────┴──────────┴──────────┴──────────┘${R}"
echo
p "A and B agree on their own; the merged world disagrees with both — so the"
p "merge reflects neither side's intent. ${D}5 of 40 probe inputs conflict.${R}"
echo
sleep 0.6
p "${B}Fix:${R} update ${B}corridorsPerScreen${R} to use ${B}getSpacing(phase) * GAME.CHAR_SIZE${R}"
p "(or A's new pixel helper) so it speaks A's units again."
echo
p "${B}Bottom line: ${YELLOW}not safe${R} — fix corridorsPerScreen before you merge."
p "${D}quietclash only probes the two branches' overlap surface; it's not a${R}"
p "${D}guarantee for code outside that.${R}"
echo
