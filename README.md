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
| [browse](#browse) | Headless browser CLI — 76+ commands, ref-based interaction, 13x fewer tokens than @playwright/mcp |
| [codemap](#codemap) | Code search + architecture analysis — hybrid vector/BM25, dependency graphs, PageRank |
| [plan-to-task-list-with-dag](#plan-to-task-list-with-dag) | Decompose features into parallel-ready task DAGs |
| [map-project](#map-project) | Generate CLAUDE.md from codebase scan |
| [map-project-monorepo](#map-project-monorepo) | Per-package CLAUDE.md for monorepos |
| [cost-estimate](#cost-estimate) | Estimate dev cost of repo, branch, or commit |
| [pr-retro](#pr-retro) | Branch retrospective with merge readiness verdict |
| [branch-review-before-pr](#branch-review-before-pr) | Structural review — race conditions, trust boundaries |
| [find-bugs](#find-bugs) | Security audit + bug finding on branch diff |
| [bugfix](#bugfix) | Fix bugs with red-green workflow — reproducer, root cause, minimal fix, regression tests |
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
| [claude-review](#claude-review) | Independent self-review via Claude agent in worktree isolation |
| [codex-review](#codex-review) | Independent AI review via OpenAI Codex CLI — second opinion on your changes |
| [kiro-review](#kiro-review) | Independent AI review via Kiro CLI — second opinion on your changes |
| [find-agents](#find-agents) | Find, install, and manage AI agents across 43+ IDEs |
| [secrets](#secrets) | Credential management — encrypted vault, CLI injection, MCP shim |
| [build-dmg](#build-dmg) | Build distributable DMG installers for macOS Xcode projects |
| [lokei](#lokei) | Local dev proxy — named HTTPS domains on .test with valid TLS |
| [nextjs](#nextjs) | Next.js 16 App Router reference — Cache Components, i18n, data layer, atomic components |
| [laravel](#laravel) | Laravel 12 API framework — Actions pattern, AI SDK, Boost, MCP, Filament, Horizon, Pest |
| [laravel-filament](#laravel-filament) | Filament v5 admin panel — resources, schemas, tables, actions, widgets, v3-to-v5 migration |
| [rust](#rust) | Rust systems programming — storage engines, SIMD, pgwire, DataFusion, tantivy, HNSW, arenas |

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

**Why not @playwright/mcp?** Playwright MCP dumps ~16K tokens on every action. `browse` returns a one-liner. Over a 10-step session: **12K tokens vs 146K** — 13x less context burned. 76+ commands, ref-based interaction, cursor-interactive detection, 150+ device emulation, multi-agent sessions, persistent profiles, React DevTools, command recording, cookie import from real browsers.

Requires: `npm install -g @ulpi/browse` | [Full docs →](https://github.com/ulpi-io/browse)

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

## bugfix

```bash
npx skills add https://github.com/ulpi-io/skills --skill bugfix
```

**Fix bugs with surgical precision — red-green workflow enforced.**

Parses findings from `/find-bugs` or user reports, writes a failing test that reproduces the bug before any fix code, traces root cause through data-flow analysis, implements the minimal fix, and verifies no regressions. Includes bug-type-specific playbooks (security, logic, async, null safety, race conditions) and framework-specific references for 18 frameworks: Express, React, Next.js, Fastify, Hono, Remix, Laravel, Go, Gin, Echo, Fiber, Swift, Bun, Rust, Axum, Actix Web, Rocket, React Native.

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

---

## find-agents

```bash
npx skills add https://github.com/ulpi-io/skills --skill find-agents
```

**Find, install, and manage AI agents across 43+ coding IDEs.**

Full CLI wrapper for [agentshq](https://agentshq.sh) — the package manager for AI coding agents. Search the registry, install agents from GitHub repos or URLs, list/remove/update installed agents. Agents are automatically translated to each IDE's native format on install.

```bash
npx agentshq find <query>                    # → search for agents by keyword
npx agentshq add <owner>/<repo>              # → install agents from a GitHub repo
npx agentshq list                            # → list installed agents
npx agentshq update                          # → update all agents to latest
```

---

## secrets

```bash
npx skills add https://github.com/ulpi-io/skills --skill secrets
```

**Credential management for AI coding agents.**

Encrypted local vault that stores API keys, tokens, and credentials. Injects them transparently into CLI tools and MCP servers. Auto-detects agents and writes hooks + MCP entries.

```bash
secrets add github --token ghp_your_token    # → store credentials
secrets enable github                        # → enable MCP server in .mcp.json
secrets init                                 # → auto-detect agents, write hooks
secrets status                               # → overview of vault, hooks, agents
```

Built-in services: github, anthropic, openai, aws, slack, jira, google-cloud, vercel, stripe, linear

---

## codex-review

```bash
npx skills add https://github.com/ulpi-io/skills --skill codex-review
```

**Independent AI review via OpenAI Codex CLI.**

Get a second opinion on code changes. Analyzes the diff, builds focused review instructions, runs `codex review` with sandbox permissions, parses prioritized findings, and supports iterative multi-round reviews. Use for cross-review before merging or when you want a rival AI to verify Claude's work.

Requires: `codex` CLI + OpenAI API key

---

## claude-review

```bash
npx skills add https://github.com/ulpi-io/skills --skill claude-review
```

**Independent self-review via Claude agent in worktree isolation.**

Spawns a separate Claude Code agent in a read-only worktree to review code changes. Builds focused review prompts from the actual diff, parses prioritized findings, and supports iterative multi-round reviews. Part of the review trifecta alongside `/codex-review` and `/kiro-review`. No external dependencies — uses Claude's built-in Agent tool.

---

## kiro-review

```bash
npx skills add https://github.com/ulpi-io/skills --skill kiro-review
```

**Independent AI review via Kiro CLI.**

Get a second opinion on code changes using Amazon's Kiro. Analyzes the diff, builds focused review prompts, runs `kiro-cli chat` in non-interactive mode with full tool access, parses prioritized findings, and supports iterative multi-round reviews. Use for cross-review before merging or when you want a rival AI to verify Claude's work.

Requires: `kiro-cli` + logged in (`kiro-cli login`)

---

## build-dmg

```bash
npx skills add https://github.com/ulpi-io/skills --skill build-dmg
```

**Build distributable DMG installers for macOS Xcode projects.**

Auto-detects app name, scheme, project/workspace, and team ID from project files. Handles archiving, code signing, DMG creation with styled Finder window, and version management. Supports xcodegen projects and optional ExportOptions.plist configuration.

Requires: Xcode command-line tools

---

## lokei

```bash
npx skills add https://github.com/ulpi-io/skills --skill lokei
```

**Local dev proxy — named HTTPS domains on .test with valid TLS.**

Auto-detects 30+ frameworks (Next.js, Vite, Rails, Django, etc.) and injects correct port/host flags. Creates local HTTPS domains (e.g., `https://myapp.test`) with valid TLS certificates signed by a local CA. Supports public tunnel sharing, Docker Compose integration, traffic inspection, and multi-service orchestration via `.test.yaml`.

```bash
lokei run                                    # → auto-detect framework, assign https://project.test
lokei run npm run dev                        # → explicit command
lokei share                                  # → public tunnel URL
lokei doctor                                 # → verify setup
```

Requires: `npm i -g lokei && lokei setup`

---

## nextjs

```bash
npx skills add https://github.com/ulpi-io/skills --skill nextjs
```

**Next.js 16 App Router reference for AI coding agents.**

Comprehensive framework skill covering Cache Components, proxy.ts API-backed data layer, multilingual-first with next-intl, atomic components, structured logging, and analytics tracking. Enforces strict conventions: all strings via `t()`, components max 150 lines, pages max 300 lines. Includes 19 reference files for stack overview, folder structure, components, pages, data fetching, forms, caching, i18n, error handling, logging, analytics, testing, auth, security, SEO, and accessibility.

---

## laravel

```bash
npx skills add https://github.com/ulpi-io/skills --skill laravel
```

**Laravel 12 API framework reference for AI coding agents.**

Comprehensive API-only framework skill enforcing thin controllers, Actions pattern for business logic, Form Requests for validation, API Resources for responses, and Eloquent strict mode. Covers the full Laravel AI ecosystem: AI SDK (agents, embeddings, image/audio generation, vector search, streaming), Boost (AI-assisted development with MCP tools and guidelines), and MCP (exposing your app to external AI clients). Includes 22 reference files for stack overview, folder structure, routing, controllers, validation, Eloquent models, API resources, service layer, auth, database, error handling, logging, caching, queues/jobs, testing, security, API docs, observability, Filament admin, Docker, notifications, file storage, scheduling, AI SDK, Boost, and MCP.

---

## laravel-filament

```bash
npx skills add https://github.com/ulpi-io/skills --skill laravel-filament
```

**Filament v5 admin panel reference for AI coding agents.**

Dedicated skill for building Filament v5 admin panels with correct v5 namespaces, extracted schema/table classes, and unified action imports. Covers the critical v3-to-v5 migration (unified `Filament\Actions` namespace, `->recordActions()` replacing `->actions()`, `Schemas\Components` replacing `Forms\Components` for layout, `BadgeColumn` removal). Includes 12 reference files for namespace mapping, resources, forms, tables, actions, filters, relationships, widgets, panels/navigation, notifications, testing, and infolists.

---

## rust

```bash
npx skills add https://github.com/ulpi-io/skills --skill rust
```

**Rust systems programming reference for AI coding agents.**

Comprehensive skill for building high-performance Rust systems — database storage engines, custom binary formats, wire protocols, query execution, search, and vector indexes. Covers WAL/mmap/MVCC storage with pluggable backends, zero-copy binary formats (BMAP, BARR, packed decimal), DataFusion/Arrow SQL execution with custom table providers and UDFs, pgwire and MySQL wire protocol servers with full ORM compatibility, tantivy full-text search with HNSW vector indexing and SIMD distance functions, arena-allocated graph engines with traversal algorithms, R-tree geospatial with bi-temporal time-travel, tokio async patterns with io_uring and lock-free concurrency, proptest property testing, and unsafe Rust patterns for mmap/SIMD/FFI. Includes 12 reference files covering stack, storage engine, binary formats, type system, DataFusion/Arrow, wire protocols, search/vector, arena/graph, geo/temporal, async/concurrency, testing, and error handling/unsafe.
