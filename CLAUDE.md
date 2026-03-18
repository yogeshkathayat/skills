# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**@ulpi/skills** — A collection of AI coding agent skills distributed via [skills.sh](https://skills.sh). Skills work across Claude Code, Cursor, Cline, Windsurf, and 15+ other IDEs.

Install all skills: `npx skills add https://github.com/ulpi-io/skills`
Install one skill: `npx skills add https://github.com/ulpi-io/skills --skill <name>`

## Architecture

This is a flat monorepo of ~25 independent skills. Each skill is a self-contained directory at the repo root — there is no shared build system, no package.json, no test framework. Skills are documentation and reference materials, not executable code (exception: `cost-estimate/helpers/` has Python scripts).

### Skill Directory Structure

Every skill directory contains a `SKILL.md` (or `SKILL.MD`) as its primary file, with optional supporting directories:

```
<skill-name>/
├── SKILL.md              # Frontmatter (name, version, description, allowed-tools) + implementation guide
├── references/           # Optional: detailed reference materials, examples, patterns
├── helpers/              # Optional: utility scripts (Python, etc.)
└── checklist.md          # Optional: standalone checklists
```

### SKILL.md Format

```yaml
---
name: skill-name
version: X.Y.Z
description: |
  What the skill does and when to invoke it.
allowed-tools:
  - Bash
  - Read
  - Write  # only if the skill needs to create/edit files
---
```

The markdown body follows a consistent structure:
- `<EXTREMELY-IMPORTANT>` block — critical guardrails and safety rules
- `## MANDATORY FIRST RESPONSE PROTOCOL` — pre-execution checklist
- Numbered phases with gating conditions between them
- User confirmation points via `AskUserQuestion`

### Skill Categories

- **Browser/Search**: `browse`, `codemap`
- **Planning**: `plan-to-task-list-with-dag`, `plan-founder-review`, `start`
- **Code Review/Quality**: `find-bugs`, `pr-retro`, `branch-review-before-pr`, `code-simplify`
- **Project Mapping**: `map-project`, `map-project-monorepo`, `update-claude-settings`
- **Git/VCS**: `commit`, `create-pr`, `git-merge-expert`, `git-merge-expert-worktree`
- **Learning Propagation**: `update-claude-learnings`, `update-agent-learnings`, `update-skill-learnings`
- **Parallel Execution**: `run-parallel-agents-feature-build`, `run-parallel-agents-feature-debug`
- **Specialized**: `ast-grep`, `cost-estimate`, `frontend-design-ui-ux`, `find-agents`

## Conventions

- **Versioning**: Skills use semver in their frontmatter. Commit messages follow the pattern: `<Skill Name> v<X.Y.Z> — <changelog summary>`.
- **allowed-tools**: Each skill declares the minimum set of tools it needs. Most skills only need `Bash` and `Read`; add `Write`/`Edit` only when the skill creates or modifies files.
- **Safety-first design**: Every skill that performs mutations includes an `<EXTREMELY-IMPORTANT>` block with verification checklists and "never" rules. Maintain this pattern when editing or creating skills.
- **No co-author trailers**: The `commit` skill explicitly excludes co-author lines from commits.
- **External tool dependencies**: `browse` requires `@ulpi/browse` (bun), `codemap` requires `@ulpi/codemap` (npm), `ast-grep` requires the `ast-grep` CLI. Skills check for these at runtime.

## Working with Skills

When editing a skill, read the full `SKILL.md` first — the `<EXTREMELY-IMPORTANT>` blocks and mandatory protocols define the skill's contract. When creating a new skill, follow the frontmatter format and phase-based structure used by existing skills.
