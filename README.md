# @ulpi/skills

Skills for AI coding agents. Works with [skills.sh](https://skills.sh) — install with one command, works across Claude Code, Cursor, Cline, Windsurf, and 15+ other agents.

```bash
npx skills add https://github.com/ulpi-io/skills
```

Or install individual skills:

```bash
npx skills add https://github.com/ulpi-io/skills --skill browse
```

## Skills

| Skill | What it does |
|-------|-------------|
| [browse](#browse) | Headless browser CLI — 48 commands, ref-based interaction, 13x fewer tokens than @playwright/mcp |
| [codemap](#codemap) | Code search + architecture analysis — hybrid vector/BM25, dependency graphs, PageRank |
| [plan-to-task-list-with-dag](#plan-to-task-list-with-dag) | Decompose features into parallel-ready task DAGs |
| [map-project](#map-project) | Generate CLAUDE.md from codebase scan |
| [map-project-monorepo](#map-project-monorepo) | Per-package CLAUDE.md for monorepos |
| [cost-estimate](#cost-estimate) | Estimate dev cost of repo, branch, or commit |
| [pr-retro](#pr-retro) | Branch retrospective with merge readiness verdict |
| [branch-review-before-pr](#branch-review-before-pr) | Structural review — race conditions, trust boundaries |
| [find-bugs](#find-bugs) | Security audit + bug finding on branch diff |
| [code-simplify](#code-simplify) | Review code for reuse, quality, efficiency |
| [frontend-design-ui-ux](#frontend-design-ui-ux) | UI/UX design specs and component briefs |
| [update-claude-learnings](#update-claude-learnings) | Extract behavioral learnings to CLAUDE.md |
| [update-agent-learnings](#update-agent-learnings) | Propagate learnings to agent files |
| [update-skill-learnings](#update-skill-learnings) | Propagate learnings to skill files |
| [start](#start) | Session init — discover skills, select agent persona |
| [commit](#commit) | Smart conventional commits, pre-commit checks, secret scanning |
| [create-pr](#create-pr) | Auto-generate PR title/body, push, create via gh |
| [git-merge-expert](#git-merge-expert) | Merge branches, resolve conflicts, rollback |
| [git-merge-expert-worktree](#git-merge-expert-worktree) | Isolated merges in git worktrees |
| [plan-founder-review](#plan-founder-review) | Technical founder review of a plan before execution |
| [run-parallel-agents-feature-build](#run-parallel-agents-feature-build) | Orchestrate parallel agents for feature building |
| [run-parallel-agents-feature-debug](#run-parallel-agents-feature-debug) | Orchestrate parallel agents for debugging |
| [update-claude-settings](#update-claude-settings) | Detect tech stack, generate Claude Code permissions |
| [ast-grep](#ast-grep) | Structural code search via AST patterns |

---

## browse

```bash
npx skills add https://github.com/ulpi-io/skills --skill browse
```

**Give AI agents a real browser — without flooding the context with HTML.**

A persistent headless Chromium daemon that stays running between commands. The agent navigates, clicks, fills forms, takes screenshots, and reads page content through simple CLI commands — each returning minimal, structured output instead of dumping raw HTML or full accessibility trees.

```bash
browse goto https://www.mumzworld.com     # → "Navigated to ... (200)"  (11 tokens)
browse snapshot -i                         # → interactive elements with @refs
browse fill @e3 "strollers"                # → "Filled @e3"  (15 tokens)
browse click @e5                           # → "Clicked @e5"  (15 tokens)
```

**Why not @playwright/mcp?** Playwright MCP dumps ~16K tokens on every action. `browse` returns a one-liner. Over a 10-step session: **12K tokens vs 146K** — 13x less context burned. 48 commands, ref-based interaction, cursor-interactive detection, 150+ device emulation, multi-agent sessions.

Requires: `bun install -g @ulpi/browse` | [Full docs →](https://github.com/ulpi-io/browse)

---

## codemap

```bash
npx skills add https://github.com/ulpi-io/skills --skill codemap
```

**Code search and architecture analysis that understands your codebase.**

Hybrid vector + BM25 search, dependency graphs, PageRank importance scoring, coupling metrics, circular dependency detection. CLI or MCP.

```bash
codemap search "error handling"            # → semantic + keyword search
codemap deps src/server.ts                 # → what this file imports
codemap rank                               # → most important files by PageRank
codemap cycles                             # → circular dependency detection
```

Requires: `npm install -g @ulpi/codemap` | MCP: `claude mcp add codemap codemap serve`

---

## plan-to-task-list-with-dag

```bash
npx skills add https://github.com/ulpi-io/skills --skill plan-to-task-list-with-dag
```

**Decompose features into parallel-ready task DAGs.**

Explores the codebase, challenges scope with the user, breaks features into atomic tasks with dependency mapping, priority assignment, and agent matching. Outputs machine-parseable markdown + JSON for parallel agent execution.

---

## map-project

```bash
npx skills add https://github.com/ulpi-io/skills --skill map-project
```

**Generate CLAUDE.md from a codebase scan.**

Scans the project and produces a context file with exports, architecture, dev guide, and project-specific patterns. Keeps the AI context map current after each session or refactor. Supports Laravel, Next.js, NestJS, Expo/React Native, Node.js.

---

## map-project-monorepo

```bash
npx skills add https://github.com/ulpi-io/skills --skill map-project-monorepo
```

**Per-package CLAUDE.md for monorepos.**

Same as map-project but generates a focused CLAUDE.md for each subdirectory — exports, key files, dependencies, conventions. Each package gets its own self-contained context file.

---

## cost-estimate

```bash
npx skills add https://github.com/ulpi-io/skills --skill cost-estimate
```

**Estimate development cost of a codebase, branch, or commit.**

Analyzes LOC, git history, complexity metrics, and generates a cost report. Supports scoping by full repo, branch diff, or single commit.

---

## pr-retro

```bash
npx skills add https://github.com/ulpi-io/skills --skill pr-retro
```

**Branch retrospective before merging.**

Analyzes all commits on the branch: size metrics, test LOC ratio, focus score, session analysis, commit hygiene, self-review scan (TODOs, debug artifacts, secrets). Delivers a merge readiness verdict — GREEN / YELLOW / RED.

---

## branch-review-before-pr

```bash
npx skills add https://github.com/ulpi-io/skills --skill branch-review-before-pr
```

**Pre-landing structural review.**

Catches issues tests don't: race conditions, trust boundary violations, query safety, conditional side effects. Critical findings block shipping.

---

## find-bugs

```bash
npx skills add https://github.com/ulpi-io/skills --skill find-bugs
```

**Security audit + bug finding on branch diff.**

Analyzes full diff against main, maps attack surfaces, runs security checklist against every changed file, verifies findings against context. Prioritized output.

---

## code-simplify

```bash
npx skills add https://github.com/ulpi-io/skills --skill code-simplify
```

**Review code for reuse, quality, and efficiency.**

Analyzes changed code for unnecessary complexity, duplication, and missed reuse opportunities. Fixes issues it finds.

---

## frontend-design-ui-ux

```bash
npx skills add https://github.com/ulpi-io/skills --skill frontend-design-ui-ux
```

**UI/UX design methodology for implementation-ready specs.**

Produces component briefs, design tokens, and user flow specifications for handoff to engineering agents. For designing new features, creating design systems, or specifying component behavior.

---

## update-claude-learnings

```bash
npx skills add https://github.com/ulpi-io/skills --skill update-claude-learnings
```

**Extract behavioral learnings to CLAUDE.md.**

After a session reveals patterns or project-specific instructions, this skill adds them to the project's CLAUDE.md so future sessions benefit.

---

## update-agent-learnings

```bash
npx skills add https://github.com/ulpi-io/skills --skill update-agent-learnings
```

**Propagate learnings to agent files.**

Extracts insights from a session and routes them to the right agent files based on scope — global (all subagents), Claude Code only, or agent-specific.

---

## update-skill-learnings

```bash
npx skills add https://github.com/ulpi-io/skills --skill update-skill-learnings
```

**Propagate learnings to skill files.**

When a session reveals patterns about structuring skills, this skill updates the central skill learnings file and syncs to appropriate skills.

---

## start

```bash
npx skills add https://github.com/ulpi-io/skills --skill start
```

**Session init — discover skills, select agent persona.**

Mandatory first skill for any conversation. Discovers available skills, invokes the right ones, selects the correct specialized agent persona for the task domain, and establishes required workflows before coding begins.

---

## commit

```bash
npx skills add https://github.com/ulpi-io/skills --skill commit
```

**Smart conventional commits with quality gates.**

Analyzes diffs deeply to draft intelligent commit messages, detects scope from branch names and file paths, runs pre-commit checks (TypeScript, ESLint, Prettier), scans for secrets and debug artifacts, splits unrelated changes into separate commits.

---

## create-pr

```bash
npx skills add https://github.com/ulpi-io/skills --skill create-pr
```

**Auto-generate and submit pull requests.**

Validates branch state, analyzes all commits since divergence, runs pre-PR quality checks, generates structured PR title and body with summary/test-plan/breaking-changes sections, pushes branch, creates PR via gh CLI.

---

## git-merge-expert

```bash
npx skills add https://github.com/ulpi-io/skills --skill git-merge-expert
```

**Merge branches and resolve conflicts.**

Expert in merge strategies, conflict resolution, PR readiness checks, rollback, and GitHub workflow automation. Handles rebases, cherry-picks, and complex multi-branch merges.

---

## git-merge-expert-worktree

```bash
npx skills add https://github.com/ulpi-io/skills --skill git-merge-expert-worktree
```

**Isolated merges in git worktrees.**

Same merge expertise but in isolated worktrees — worktree lifecycle management, parallel worktree operations, and cleanup automation. For when you need merge isolation without touching the working directory.

---

## plan-founder-review

```bash
npx skills add https://github.com/ulpi-io/skills --skill plan-founder-review
```

**Technical founder review of a plan before execution.**

Reads a plan from `.ulpi/plans/<name>.md`, verifies file paths exist, challenges scope and architecture decisions, audits risk coverage and test gaps, scores sections, and delivers a verdict — APPROVE / REVISE / REJECT. Quality gate between planning and execution.

---

## run-parallel-agents-feature-build

```bash
npx skills add https://github.com/ulpi-io/skills --skill run-parallel-agents-feature-build
```

**Orchestrate parallel agents for feature building.**

Detects independent tasks, matches each to the right specialized agent, and launches them concurrently via the Agent tool with `isolation: "worktree"` for safe parallel file modifications. Verifies independence, prepares complete briefs, aggregates results, and checks for conflicts. Integrates with codemap for codebase understanding and browse sessions for parallel web work.

---

## run-parallel-agents-feature-debug

```bash
npx skills add https://github.com/ulpi-io/skills --skill run-parallel-agents-feature-debug
```

**Orchestrate parallel agents for debugging.**

Clusters independent bugs by subsystem, verifies no shared root cause or cascading failures, matches each problem to the right expert agent, and launches concurrent debugging sessions. Uses `codemap deps` in briefs so agents understand impact radius. Aggregates fixes and validates no conflicts.

---

## update-claude-settings

```bash
npx skills add https://github.com/ulpi-io/skills --skill update-claude-settings
```

**Detect tech stack, generate Claude Code permissions.**

Analyzes the repository to detect languages, package managers, frameworks, services, and monorepo structure. Generates `.claude/settings.local.json` with correct permissions for the detected stack — including @ulpi tools (browse, codemap) when installed. Only includes commands for tools actually detected. Suggests MCP servers for detected services.

---

## ast-grep

```bash
npx skills add https://github.com/ulpi-io/skills --skill ast-grep
```

**Structural code search via AST patterns.**

Find code by structure, not text. Search for async functions without error handling, specific API call patterns, missing guards, or any structural pattern that grep can't express. Guides the agent through writing, testing, and validating ast-grep rules with `stopBy: end` discipline, `--debug-query` for AST inspection, and proper shell escaping. Requires `ast-grep` CLI.
