---
name: quietclash
description: >-
  Detect silent behavioral merge conflicts between two parallel agent branches
  that merge cleanly and pass tests but are behaviorally incompatible at runtime.
  Use this when about to merge, combine, or compare two branches produced by
  parallel coding agents (or any two feature branches that touched related code),
  when the user asks "is it safe to merge these", "do these branches conflict",
  "will these agents' changes break each other", or after a clean `git merge` /
  worktree run when you want to be sure the combined behavior is what both sides
  intended. Catches conflicts git CANNOT see — e.g. one branch makes a function
  return cents while another adds a caller that still assumes dollars.
argument-hint: "[base-ref] [branch-a] [branch-b]"
allowed-tools: Bash(node:*), Bash(git branch:*), Bash(git log:*), Bash(git worktree:*), Bash(git rev-parse:*), Bash(npx quietclash:*), Bash(quietclash:*)
---

You are running **quietclash** — a tool that catches behavioral merge conflicts
that git cannot see. Two agent branches can merge cleanly (no textual conflict)
and pass their tests, yet produce different runtime behavior on the symbols they
both touched, or on a contract one branch changed and another depends on.
quietclash probes those symbols in four worlds (base, branch A, branch B, merged)
and reports where behavior silently diverged.

## When this skill applies

Trigger when the user is about to merge / combine / compare two branches from
parallel coding agents, or explicitly asks whether two branches are safe to
merge or behaviorally conflict. If the situation involves only one branch, or a
plain textual `git merge` conflict the user just needs resolved, this skill does
not apply — say so briefly instead of forcing a run.

## Your task

If the user invoked this with arguments, interpret them positionally as
`[base-ref] [branch-a] [branch-b]`. Otherwise infer them (see Step 1).

### Step 1 — Resolve what to compare

- If all three of base, branch-a, branch-b were given, use them directly.
- If they are missing or ambiguous, run `git branch --sort=-committerdate` and
  `git log --oneline --graph -15 --all` to discover candidate branches, then
  infer the base (usually `main` or `master`) and the two most recent
  agent/feature branches. **Briefly state which base and two branches you chose
  and why** before running the check. If you genuinely cannot tell which two
  branches the user means, ask them.
- quietclash v0 compares exactly two branches at a time. If the user named more
  than two, pick the two most relevant, run the check, and tell them which you
  compared and which you skipped.

### Step 2 — Run the engine (do NOT reimplement any logic)

Run the real CLI and capture machine-readable output. Prefer the locally
installed binary; fall back to npx; if this repo IS the quietclash checkout,
run the local entrypoint:

```
quietclash check --base <BASE> --branches <A>,<B> --json
# fallback:        npx quietclash check --base <BASE> --branches <A>,<B> --json
# in-repo:         node bin/quietclash.js check --base <BASE> --branches <A>,<B> --json
```

Always pass `--json` so you get structured output to interpret. Pass `--cwd
<repo>` if the target repo is not the current directory. The JSON shape is:

```
{
  "schemaVersion": string,
  "base": string,
  "branches": string[],
  "summary": {
    "cleanMerge": boolean,    // false => git already sees a textual conflict
    "overlapSymbols": number, // symbols both branches changed directly
    "probed": number,         // symbols actually behaviorally probed
    "conflicts": number,      // count of confirmed divergences
    "skipped": number         // count of overlaps that couldn't be measured
  },
  "conflicts": [
    {
      "file": string,
      "symbol": string,            // the symbol whose behavior diverged
      "kind": "direct" | "contract",
      "dominantKind": string,      // e.g. "broken-contract", "value-divergence"
      "changedSymbol": string,     // (contract) the upstream symbol that changed
      "producer": string,          // (contract) branch that changed it
      "consumer": string,          // (contract) branch that depends on it
      "conflictingInputs": number,
      "totalInputs": number,
      "evidence": [ { "input": [...], "detail": { "base","a","b","m" } } ],
      "explanation": string        // ready-made plain-language summary
    }
  ],
  "skipped": [ { "file","symbol","reason" } ],
  "contractHints": [ ... ]         // weaker producer/consumer leads, if any
}
```

Read the counts from `summary.*` (NOT top-level), and prefer each conflict's own
`explanation` field as the basis for your write-up — it already states what each
branch did and why the merged behavior is wrong. The `evidence[]` array gives
concrete input → (base/a/b/merged) rows you can quote.

### Step 3 — Interpret the result for the user

Translate the JSON into a short, calm, human verdict. Do not dump raw JSON.

- **`summary.cleanMerge: false`** → "Git already flags a textual conflict here —
  resolve that first; quietclash is for the conflicts git CAN'T see." Stop there.
- **`conflicts` array empty, `summary.overlapSymbols` low/zero** → Green light:
  "No behavioral divergence found on the symbols both branches touched. Safe to
  merge as far as quietclash can tell." Note this is not a proof of total safety
  — it only probed the overlap surface.
- **conflicts present** → This is the headline. For each conflict, explain in
  plain language: which symbol, what each branch made it do, and why the merged
  behavior is wrong or ambiguous. Lead with the most severe.
- **skipped present** → Be honest: these overlaps couldn't be measured (e.g.
  non-deterministic, side-effecting, or load errors). Flag them as "needs a human
  look", never silently treat them as safe.
- **contractHints present** → Surface as softer "worth checking" items: one
  branch changed a symbol another branch calls.

End with a one-line bottom line: **safe to merge / review these N symbols first /
git conflict — resolve textually first**.

## Guardrails

- Never invent conflicts the JSON didn't report, and never downgrade a reported
  conflict to make the merge look safe.
- quietclash only inspects the overlap surface between two branches — say so; a
  clean result is "no detected divergence", not a guarantee.
- If the CLI errors, show the user the actual error (re-run with
  `QUIETCLASH_DEBUG=1` for a stack trace) rather than guessing.
