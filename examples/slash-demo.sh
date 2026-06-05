#!/usr/bin/env bash
#
# quietclash slash-command demo — a faithful re-creation of a Claude Code
# `/quietclash` session for examples/slash-demo.gif:
#
#   1. the Claude Code splash (as if the user just ran `claude`)
#   2. the user typing `/quietclash qc-base qc-branch-a qc-branch-b` in the
#      prompt box, with the command autocomplete hint appearing
#   3. Claude running the engine and reporting the hidden corridorsPerScreen
#      broken-contract conflict
#
# It builds a REAL throwaway repo with the scenario and runs the REAL engine, so
# the verdict is grounded in actual output — only the surrounding TUI is staged.
#
#   bash examples/slash-demo.sh         (driven by examples/slash-demo.tape)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEMO="$(mktemp -d)"
trap 'rm -rf "$DEMO"' EXIT

# ---------------------------------------------------------------------------
# Build the scenario repo (base + two cleanly-merging, behaviorally clashing
# branches) up front and quietly.
cd "$DEMO"
git init -q
git config user.email demo@example.com
git config user.name demo
git config commit.gpgsign false

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
git branch -q qc-base

git checkout -q -b qc-branch-a
cat > constants/game.ts <<'EOF'
export const GAME = { CHAR_SIZE: 4, SCREEN_WIDTH: 42 };

// returns spacing as a CHAR_SIZE MULTIPLIER for a given phase
export function getSpacing(phase) {
  return Math.max(1, 12 - phase);
}
EOF
git add -A && git commit -qm "qc-branch-a: getSpacing returns char multiplier" >/dev/null

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
git checkout -q qc-base

# ---------------------------------------------------------------------------
# Palette (Catppuccin-ish, readable on the Mocha VHS theme)
B="\033[1m"; D="\033[2m"; R="\033[0m"
ORANGE="\033[38;5;215m"; MAUVE="\033[38;5;183m"; GREEN="\033[38;5;114m"
YELLOW="\033[38;5;222m"; RED="\033[38;5;210m"; BLUE="\033[38;5;117m"
GREY="\033[38;5;245m"; CYAN="\033[38;5;116m"

p() { printf "%b\n" "$1"; }

# Type a string into the (already drawn) prompt box, char by char.
type_in() {
  local s="$1" i ch
  for (( i=0; i<${#s}; i++ )); do
    ch="${s:$i:1}"
    printf "%b" "$ch"
    sleep 0.035
  done
}

clear

# --- 1. Claude Code splash ---------------------------------------------------
echo
p " ${ORANGE}▐▛███▜▌${R}   ${B}Claude Code${R} ${D}v2.1.165${R}"
p " ${ORANGE}▝▜█████▛▘${R}  ${D}Opus 4.8 · /Users/arbade/games/runner${R}"
p "   ${ORANGE}▘▘ ▝▝${R}"
echo
p " ${D}Tips for getting started:${R}"
p "  ${GREY}/init to set up a CLAUDE.md  ·  /help for commands  ·  ? for shortcuts${R}"
echo
sleep 1.0

# --- 2. Prompt box + user types the slash command ---------------------------
p "${GREY}╭──────────────────────────────────────────────────────────────────────────╮${R}"
printf "%b" "${GREY}│${R} ${MAUVE}>${R} "
sleep 0.4
type_in "/quietclash"
# Command autocomplete hint pops under the box as the slash command is matched.
printf "\n"
p "${GREY}╰──────────────────────────────────────────────────────────────────────────╯${R}"
p "  ${CYAN}/quietclash${R} ${D}qc-base qc-branch-a qc-branch-b${R}"
p "  ${D}Detect silent behavioral merge conflicts between two parallel branches${R}"
sleep 0.9
# Redraw the box with the full command (args typed in), hint cleared.
printf "\033[4A\r"            # move up over box-bottom + 2 hint lines + into box
printf "\033[J"              # clear from cursor down
printf "%b" "${GREY}│${R} ${MAUVE}>${R} ${B}/quietclash${R} "
type_in "qc-base qc-branch-a qc-branch-b"
printf "\n"
p "${GREY}╰──────────────────────────────────────────────────────────────────────────╯${R}"
sleep 0.5
# "Enter" — submit.
printf "\n"

# --- 3. Claude responds ------------------------------------------------------
p "${GREEN}●${R} I'll run quietclash on the three refs you gave"
p "  ${D}base=qc-base, A=qc-branch-a, B=qc-branch-b.${R}"
echo
sleep 0.4
p "${GREEN}●${R} ${B}Bash${R}${D}(quietclash check --base qc-base \\\\${R}"
p "       ${D}--branches qc-branch-a,qc-branch-b --json)${R}"
sleep 1.0
node "$ROOT/bin/quietclash.js" check --base qc-base \
  --branches qc-branch-a,qc-branch-b --cwd "$DEMO" --json >/dev/null
p "  ${D}⎿  1 conflict · cleanMerge: true · probed 1 symbol${R}"
echo
sleep 0.7

p "${GREEN}●${R} ${B}quietclash result: 1 hidden conflict ${YELLOW}⚠${R}"
echo
p "Git merges cleanly (${B}cleanMerge: true${R}) — no textual conflict, and each"
p "branch passes on its own. But the behavior silently breaks."
echo
sleep 0.5
p "${B}Conflict: ${RED}corridorsPerScreen${R} ${B}— broken contract${R}"
p "${D}in constants/game.ts${R}"
echo
p "  ${BLUE}qc-branch-a${R} (producer) changed ${B}getSpacing${R}'s unit: it no longer"
p "  returns pixels, it returns a ${B}CHAR_SIZE multiplier${R}."
p "  ${BLUE}qc-branch-b${R} (consumer) added ${B}corridorsPerScreen${R}, still assuming"
p "  ${B}getSpacing${R} returns pixels (${D}screenWidth / spacing${R})."
echo
sleep 0.5
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
sleep 0.5
p "${B}Fix:${R} update ${B}corridorsPerScreen${R} to use ${B}getSpacing(phase) * GAME.CHAR_SIZE${R}"
p "(or A's new pixel helper) so it speaks A's units again."
echo
p "${B}Bottom line: ${YELLOW}not safe${R} — fix corridorsPerScreen before you merge."
p "${D}quietclash only probes the two branches' overlap surface; it's not a${R}"
p "${D}guarantee for code outside that.${R}"
echo
