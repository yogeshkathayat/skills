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

---

## browse

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

**Decompose features into parallel-ready task DAGs.**

Explores the codebase, challenges scope with the user, breaks features into atomic tasks with dependency mapping, priority assignment, and agent matching. Outputs machine-parseable markdown + JSON for parallel agent execution.

---

## map-project

**Generate CLAUDE.md from a codebase scan.**

Scans the project and produces a context file with exports, architecture, dev guide, and project-specific patterns. Keeps the AI context map current after each session or refactor. Supports Laravel, Next.js, NestJS, Expo/React Native, Node.js.

---

## map-project-monorepo

**Per-package CLAUDE.md for monorepos.**

Same as map-project but generates a focused CLAUDE.md for each subdirectory — exports, key files, dependencies, conventions. Each package gets its own self-contained context file.

---

## cost-estimate

**Estimate development cost of a codebase, branch, or commit.**

Analyzes LOC, git history, complexity metrics, and generates a cost report. Supports scoping by full repo, branch diff, or single commit.

---

## pr-retro

**Branch retrospective before merging.**

Analyzes all commits on the branch: size metrics, test LOC ratio, focus score, session analysis, commit hygiene, self-review scan (TODOs, debug artifacts, secrets). Delivers a merge readiness verdict — GREEN / YELLOW / RED.

---

## branch-review-before-pr

**Pre-landing structural review.**

Catches issues tests don't: race conditions, trust boundary violations, query safety, conditional side effects. Critical findings block shipping.

---

## find-bugs

**Security audit + bug finding on branch diff.**

Analyzes full diff against main, maps attack surfaces, runs security checklist against every changed file, verifies findings against context. Prioritized output.

---

## code-simplify

**Review code for reuse, quality, and efficiency.**

Analyzes changed code for unnecessary complexity, duplication, and missed reuse opportunities. Fixes issues it finds.

---

## frontend-design-ui-ux

**UI/UX design methodology for implementation-ready specs.**

Produces component briefs, design tokens, and user flow specifications for handoff to engineering agents. For designing new features, creating design systems, or specifying component behavior.

---

## update-claude-learnings

**Extract behavioral learnings to CLAUDE.md.**

After a session reveals patterns or project-specific instructions, this skill adds them to the project's CLAUDE.md so future sessions benefit.

---

## update-agent-learnings

**Propagate learnings to agent files.**

Extracts insights from a session and routes them to the right agent files based on scope — global (all subagents), Claude Code only, or agent-specific.

---

## update-skill-learnings

**Propagate learnings to skill files.**

When a session reveals patterns about structuring skills, this skill updates the central skill learnings file and syncs to appropriate skills.
