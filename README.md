# sentinel

**Detects silent behavioral merge conflicts between parallel AI coding agents** — the ones git can't see.

> Agent A rewrites `parseDate()` to assume UTC. Agent B, working in parallel, adds a caller that passes a local-time string. Both branches merge cleanly. Git reports no conflict. The tests pass. It breaks at runtime.
>
> No tool catches this today. `sentinel` does.

## The problem

Production code generation is solved. The bottleneck has moved to **reviewing and trusting** what agents produce. A study of 1,255 engineering teams (Faros AI, 2026) found that high-AI-adoption teams open **98% more PRs** but spend **91% more time in review** — with no net throughput gain. The reviewing is the wall.

When you run multiple agents in parallel (git worktrees, Claude Code agent teams, Conductor, vibe-kanban…), git only protects you from **textual** conflicts. It has no idea whether two changes that overlap in *meaning* are compatible. Recent work measured this: **5–10% of parallel-agent merges are textually clean and test-passing but behaviorally conflicting** (CodeCRDT, [arXiv:2510.18893](https://arxiv.org/abs/2510.18893)).

The orchestration "runner" layer (spawn N agents in N worktrees) has 60+ tools. The **review-and-reconcile** layer does not. And *semantic* conflict detection between parallel agents is not shipped by anyone — even Composio lists it as an unbuilt "Reconciler" on their roadmap. That's the gap `sentinel` fills.

## How it works

Given a base ref and N agent branches that all merge cleanly:

1. **Overlap surface** — parse each branch's diff (AST) and find the *symbols* (functions, methods, exports) that **2+ agents touched**. These are the only places a silent conflict can hide.
2. **Behavioral probe** — synthesize characterization tests for each overlapping symbol (the [SAM](https://spgroup.github.io/papers/sam-semantic-merge-tool.html) approach), then run them against `base`, each branch alone, and the merged result.
3. **Behavioral diff** — flag any symbol where the merged behavior diverges from what *either* branch intended on its own.
4. **False-positive filter** — drop divergences explained by pure refactoring (rename/move), the [RefFilter](https://arxiv.org/abs/2510.01960) idea. This is the make-or-break step; naive semantic analysis drowns in false positives.
5. **Explain** — for each surviving conflict, a plain-language explanation of *why* the two changes clash (optional, via the Claude API).

Agent-agnostic. No backend. It's a CLI/CI check that reads git and emits a per-symbol report.

## Install

```bash
npm install -g agent-sentinel    # or: npx agent-sentinel
```

## Usage

```bash
# Find silent behavioral conflicts between two agent branches
sentinel check --base main --branches agent-a,agent-b

# Deep-dive one symbol
sentinel explain parseDate --base main --branches agent-a,agent-b

# Run the evaluation suite (precision/recall + headline number)
sentinel bench
```

## Status

v0 — TypeScript/JavaScript only, pairwise (2-branch) conflicts, pure-function probing. Honest about its limits (see `bench/`). Roadmap: more languages, N-way conflicts, GitHub Action, richer FP filtering.

## Prior art it builds on

- **CodeCRDT** ([arXiv:2510.18893](https://arxiv.org/abs/2510.18893)) — measured the 5–10% silent-conflict rate; the dataset/framing behind our eval.
- **SAM — Detecting Semantic Conflicts with Unit Tests** ([paper](https://spgroup.github.io/papers/sam-semantic-merge-tool.html)) — the test-synthesis approach.
- **RefFilter** ([arXiv:2510.01960](https://arxiv.org/abs/2510.01960)) — refactoring-aware false-positive reduction.

## License

MIT
