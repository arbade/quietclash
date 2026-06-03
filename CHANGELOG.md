# Changelog

All notable changes to quietclash are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0]

### Added
- **Claude Code skill** (`skills/quietclash/SKILL.md`). Claude now reaches for
  quietclash on its own when you ask whether two parallel-agent branches are
  safe to merge — no slash command to remember. The skill calls the same CLI
  engine (`quietclash check --json`) and reports the result in plain language.
  Verified end-to-end in a live Claude Code session: the skill auto-triggers,
  runs the engine, and explains the conflict it finds.

### Changed
- README now documents both ways to use quietclash inside Claude Code (the
  auto-triggering skill and the `/quietclash` command) and how to load the
  plugin via `--plugin-dir`.
- `skills/` is now included in the published npm package.

## [0.1.0]

### Added
- Initial release.
- CLI: `quietclash check`, `quietclash explain`, `quietclash bench`.
- v0 pipeline: git overlap detection → four-world behavioral probe
  (base / branch A / branch B / merged) → behavioral diff → false-positive
  filter → plain-language explanation → report.
- Detects both direct symbol divergences and broken contracts (one branch
  changes a symbol another branch depends on).
- TypeScript support, async-function handling, side-effect guard in the probe
  harness, and honest "skipped" reporting for unmeasurable overlaps.
- Claude Code plugin with the `/quietclash` slash command.
- Benchmark suite: precision = recall = 1 on the labeled scenario set.

[0.2.0]: https://github.com/arbade/quietclash/releases/tag/v0.2.0
[0.1.0]: https://github.com/arbade/quietclash/releases/tag/v0.1.0
