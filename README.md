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
| [browse-stealth](#browse-stealth) | Stealth browsing via camoufox runtime — Turnstile, Google, DataDome bypass with proxy rotation |
| [browse-config](#browse-config) | Guided camoufox profile generator — stealth, Google-safe, fast-scrape, or custom presets |
| [browse-seo](#browse-seo) | On-page SEO audit — meta tags, headings, schema, Core Web Vitals, mobile rendering |
| [browse-aeo](#browse-aeo) | Answer Engine Optimization — page audit + SERP analysis for AI Overviews and Perplexity |
| [browse-geo](#browse-geo) | Generative Engine Optimization monitoring — brand/domain visibility across AI search |
| [browse-qa](#browse-qa) | QA a feature from a ticket/URL/criteria, then generate reusable browse regression flows |
| [codemap](#codemap) | Code search + architecture analysis — hybrid vector/BM25, dependency graphs, PageRank |
| [plan-to-task-list-with-dag](#plan-to-task-list-with-dag) | Decompose features into parallel-ready task DAGs |
| [map-project](#map-project) | Generate CLAUDE.md from codebase scan |
| [map-project-monorepo](#map-project-monorepo) | Per-package CLAUDE.md for monorepos |
| [cost-estimate](#cost-estimate) | Estimate dev cost of repo, branch, or commit |
| [pr-retro](#pr-retro) | Branch retrospective with merge readiness verdict |
| [branch-review-before-pr](#branch-review-before-pr) | Structural review — race conditions, trust boundaries |
| [find-bugs](#find-bugs) | Security audit + bug finding on branch diff |
| [review-crate](#review-crate) | Deep end-to-end review of one Rust crate → canonical issue file |
| [bugfix-crate](#bugfix-crate) | Work a Rust crate's issue file — failing test, minimal fix, verify, per finding |
| [create-tests-extract](#create-tests-extract) | Extract large inline tests into adjacent files, preserving visibility |
| [go-live-audit](#go-live-audit) | Pre-launch audit — multi-agent workflow: gates, dimension finders, adversarial verify, critic |
| [ship-playbook](#ship-playbook) | Prompt → planned, built, reviewed, audited — chains plan/review/build/audit skills as one configurable Workflow (one pass, returns findings) |
| [bugfix](#bugfix) | Fix bugs with red-green workflow — reproducer, root cause, minimal fix, regression tests |
| [code-simplify](#code-simplify) | Review code for reuse, quality, efficiency |
| [frontend-design-ui-ux](#frontend-design-ui-ux) | Locked design language + UX/UI spec in `.ulpi/design` — anti-slop, browse inspiration, design-system routing, a11y; delegates the build (no code) |
| [update-claude-learnings](#update-claude-learnings) | Extract behavioral learnings to CLAUDE.md |
| [update-agent-learnings](#update-agent-learnings) | Propagate learnings to agent files |
| [update-skill-learnings](#update-skill-learnings) | Propagate learnings to skill files |
| [normalize-agent-for-claude](#normalize-agent-for-claude) | Convert a local AGENT.md into a Claude Code optimized agent |
| [normalize-skill-for-claude](#normalize-skill-for-claude) | Convert a local skill into a Claude Code optimized shape |
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
| [hand-over-to-kiro](#hand-over-to-kiro) | Delegate an implementation task to the Kiro CLI — injection-safe handoff, verified diff (credit: @thabti) |
| [find-agents](#find-agents) | Find, install, and manage AI agents across 43+ IDEs |
| [secrets](#secrets) | Credential management — encrypted vault, CLI injection, MCP shim |
| [build-dmg](#build-dmg) | Build distributable DMG installers for macOS Xcode projects |
| [lokei](#lokei) | Local dev proxy — named HTTPS domains on .test with valid TLS |
| [nextjs](#nextjs) | Next.js 16 App Router reference — Cache Components, i18n, data layer, atomic components |
| [laravel](#laravel) | Laravel 12 API framework — Actions pattern, AI SDK, Boost, MCP, Filament, Horizon, Pest |
| [laravel-filament](#laravel-filament) | Filament v5 admin panel — resources, schemas, tables, actions, widgets, v3-to-v5 migration |
| [rust](#rust) | Rust systems programming — storage engines, SIMD, pgwire, DataFusion, tantivy, HNSW, arenas |
| [nodejs](#nodejs) | Node.js/Bun backend reference — TS-first, pino, Zod, async, queues, testing |
| [nestjs](#nestjs) | NestJS reference — modules, DI, guards, interceptors, DTOs, BullMQ, OpenAPI |
| [docker](#docker) | Docker/containers — multi-stage builds, Compose, hardening, registries, CI |

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

## browse-stealth

```bash
npx skills add https://github.com/ulpi-io/skills --skill browse-stealth
```

**Stealth browsing for sites that block normal browsers.**

Same workflow as `browse` — navigate, inspect, interact, report — but with the camoufox runtime (anti-detection Firefox with C++-level fingerprint spoofing). Passes Cloudflare Turnstile, Google "unusual traffic", DataDome, and PerimeterX checks. Supports named camoufox profiles, persistent authenticated sessions, and per-region proxy rotation.

Requires: `npm install -g @ulpi/browse` + `npm install camoufox-js && npx camoufox-js fetch`

---

## browse-config

```bash
npx skills add https://github.com/ulpi-io/skills --skill browse-config
```

**Guided camoufox profile generator.**

Asks the user questions to build a `browse.json` camoufox section or a named profile JSON for `.browse/camoufox-profiles/`. Presets: **stealth** (geoip + humanize), **Google-safe** (geoip + humanize + random OS), **fast-scrape** (blocks images/WebRTC/WebGL, cache on), or **custom** walkthrough covering identity, privacy, performance, network, behavior, and advanced Firefox prefs.

Requires: `npm install -g @ulpi/browse`

---

## browse-seo

```bash
npx skills add https://github.com/ulpi-io/skills --skill browse-seo
```

**On-page SEO audit via the browse CLI.**

Extracts meta tags, heading hierarchy, structured data, navigation timing, link structure, and mobile rendering. Runs targeted JS checks for alt tags, hreflang, and lazy-loaded images. Produces a ranked report with pass/warning/fail per section and prioritized fixes. Switches to camoufox automatically when targets return 403 or a challenge page.

Requires: `npm install -g @ulpi/browse`

---

## browse-aeo

```bash
npx skills add https://github.com/ulpi-io/skills --skill browse-aeo
```

**Answer Engine Optimization — page audit and AI-SERP analysis.**

Two modes. **Page Audit** scores a URL on a 0-100 scale across structured data, meta quality, heading structure, answer readiness, and authority signals — flagging FAQ/HowTo/Article schema gaps that feed AI answers. **SERP Analysis** checks how a query surfaces in Google AI Overviews and Perplexity, identifying cited domains, featured snippets, and People Also Ask targets. Uses camoufox for anti-bot bypass.

Requires: `npm install -g @ulpi/browse` + `npm install camoufox-js && npx camoufox-js fetch`

---

## browse-geo

```bash
npx skills add https://github.com/ulpi-io/skills --skill browse-geo
```

**Generative Engine Optimization monitoring across AI search.**

Runs multi-query sweeps against Google AI Overviews, Perplexity, and ChatGPT Search (authenticated). Records citation presence, position, context, and competing domains per query. Compiles a visibility matrix with per-engine visibility rate, best-performing queries, gap queries, and top competing domains. Uses camoufox for Google and a persistent browser profile for ChatGPT.

Requires: `npm install -g @ulpi/browse` + `npm install camoufox-js && npx camoufox-js fetch` + ChatGPT Plus/Team account for ChatGPT Search.

---

## browse-qa

```bash
npx skills add https://github.com/ulpi-io/skills --skill browse-qa
```

**QA a feature from a ticket, URL, or plain-language spec — and leave reusable regression flows behind.**

Turns acceptance criteria, a ticket (e.g. LINEAR-123), a URL, or a description into explicit test scenarios, drives the browser or simulator via the `browse` skill, captures evidence for each failure, and writes a clean QA report. Optionally saves rerunnable `browse` flows so a manual pass becomes regression coverage. For QA loops, not static code review.

Requires: the `browse` skill (`npm install -g @ulpi/browse`)

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

Scans the project and produces a context file with exports, architecture, dev guide, and project-specific patterns. Also records an **Available Skills & MCP** section — the repo's own skills (`.claude/skills/`) and enabled MCP servers — inline in `CLAUDE.md` so agents prefer them instead of forgetting they exist. Keeps the AI context map current after each session or refactor. Supports Laravel, Next.js, NestJS, Expo/React Native, Node.js.

---

## map-project-monorepo

```bash
npx skills add https://github.com/ulpi-io/skills --skill map-project-monorepo
```

**Per-package CLAUDE.md for monorepos.**

Same as map-project but generates a focused CLAUDE.md for each subdirectory — exports, key files, dependencies, conventions. Each package gets its own self-contained context file, and the **root** CLAUDE.md gets an inline **Available Skills & MCP** section (the repo's skills + enabled MCP servers) so agents prefer them instead of forgetting they exist.

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

## go-live-audit

```bash
npx skills add https://github.com/ulpi-io/skills --skill go-live-audit
```

**Launch-readiness audit of an entire repo — authored fresh for each project.**

Generates a project-tailored multi-agent audit workflow from a bundled template and runs it via the Workflow tool: build/test/lint/typecheck gates in parallel, one read-only finder per applicable audit dimension (picked from a 20+ dimension catalog — authz, multi-tenancy, injection, data-loss, money-math, concurrency, supply-chain, …), agent-based dedup, adversarial verifiers that try to *refute* every finding (blockers get a code lens + spec lens), and a completeness critic that spawns follow-up finders for uncovered areas. Ends with a GO / NO-GO / GO-WITH-FIXES verdict. Typically 40–80 agents — for a quick branch-diff review use `find-bugs` instead.

---

## ship-playbook

```bash
npx skills add https://github.com/ulpi-io/skills --skill ship-playbook
```

**One feature prompt → planned, built, reviewed, and audited — end to end.**

The delivery capstone: it chains the repo's own skills into a single runnable Workflow that runs **one pass** and returns the verified findings as feedback — it does **not** loop on its own (an autonomous fix-loop is what caused multi-hour grinds; the user decides whether to run a fix round). Up front it shows which composed skills and specialist agents are installed (with install commands), then asks **seven gate questions** — who writes the plan, who reviews it, who writes the code, who reviews each task, impl review, go-live audit, and an optional project-map refresh. Every role **independently** picks its executor (`native` / `codex` / `kiro`; reviews can `skip`; the writer and a reviewer may be different harnesses), so you control quality vs token cost. Then it runs: **plan** (`plan-to-task-list-with-dag`, assigning a specialist engineer + `-reviewer` + stack skill per task) → **plan review** (`plan-founder-review`, bounded loop) → **build** (per task across the DAG layers: specialist engineer in an isolated worktree → in-workflow `git merge` → matched `-reviewer` → bounded fix loop) → **impl review** (plan-vs-implementation) → **verify** (dedup + adversarial verification) → **go-live audit** (composes `go-live-audit` inline, only when requested and the build comes back clean). It returns the verified findings honestly rather than faking a clean verdict. **Already have a reviewed DAG plan?** Point it at the plan (`resume .ulpi/plans/<name>.md`) and it resumes at build, skipping planning and plan-review. Explicit-user-only; spawns many agents over the run, behind concurrency caps **and rate-limit retry with exponential backoff** — so a Claude API rate-limit storm is re-attempted, not mis-recorded as blocked tasks.

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

## review-crate

```bash
npx skills add https://github.com/ulpi-io/skills --skill review-crate
```

**Deep end-to-end review of a single Rust crate.**

Reads every file in the crate, runs the crate tests, verifies real findings against the code, and writes or appends a canonical issue file under `.ulpi/issues/<crate>.md`. Runs as a forked analysis workflow with its own reasoning budget. For one crate at a time — for a branch diff use `find-bugs`.

---

## bugfix-crate

```bash
npx skills add https://github.com/ulpi-io/skills --skill bugfix-crate
```

**Work through a Rust crate's issue file, one finding at a time.**

The repair counterpart to `review-crate`: takes an existing `.ulpi/issues/<crate>.md` and fixes each finding with a failing regression test first, a minimal fix second, full crate test + clippy verification third, then updates the issue file's status. Strict red-green discipline; uses the `rust` skill for conventions.

---

## create-tests-extract

```bash
npx skills add https://github.com/ulpi-io/skills --skill create-tests-extract
```

**Move bulky inline tests out of source files without weakening them.**

Extracts large inline `#[cfg(test)]` modules (or equivalent) into adjacent test files while preserving the original visibility and helper-access model — so private unit tests don't silently degrade into weaker integration tests. Touches production code only as much as module wiring requires, then runs the narrowest relevant tests.

---

## frontend-design-ui-ux

```bash
npx skills add https://github.com/ulpi-io/skills --skill frontend-design-ui-ux
```

**A distinctive, consistent, buildable design language — not generic AI output, and not code.**

Commits to one bold aesthetic direction, then **locks** it in `.ulpi/design/DESIGN.md` (palette, type, scales, signature, voice, and the design system to build on) so every screen and future session stays consistent. Bans AI-slop by name (purple-glow, cream defaults, 3-equal-cards, em-dashes…), and can **visit inspiration links with the `browse` skill** to extract real design DNA and synthesize — never clone. For product UIs it routes to an established design system (Radix/shadcn, Material 3, Carbon, Polaris…) to build on rather than reinvent. Keeps the rigor most design skills skip: full state coverage, user flows with edge cases, and WCAG/ARIA/keyboard accessibility. Ends with a scored pre-flight gate, then **delegates the build** to an engineering agent via an explicit handoff ("implement exactly this"). All artifacts are written under `.ulpi/design/`. For new features, redesigns, design-system work, or making an existing UI look less templated.

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

## normalize-agent-for-claude

```bash
npx skills add https://github.com/ulpi-io/skills --skill normalize-agent-for-claude
```

**Convert a local AGENT.md into a Claude Code optimized agent.**

Audits one agent against Claude Code's agent runtime, produces a per-agent rewrite plan with source-backed guardrails, and optionally rewrites the frontmatter + system-prompt body so the agent is thinner and more role-specific. Defaults to plan mode; rewrites only when asked.

---

## normalize-skill-for-claude

```bash
npx skills add https://github.com/ulpi-io/skills --skill normalize-skill-for-claude
```

**Convert a local skill into a Claude Code optimized shape.**

Audits one skill folder or SKILL.md against Claude Code's skill runtime, produces a per-skill rewrite plan with source-backed guardrails, and optionally rewrites frontmatter, body, and references for better routing, a smaller prompt footprint, and safer execution. Defaults to plan mode; rewrites only when asked.

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

## hand-over-to-kiro

```bash
npx skills add https://github.com/ulpi-io/skills --skill hand-over-to-kiro
```

**Delegate an implementation task to the Kiro CLI — and get a verified report back.**

Hand a plan or a task to Amazon's Kiro to *build* (the write-side counterpart to `/kiro-review`). Claude gathers context, builds a self-contained, **injection-safe** prompt (written to a temp file, never interpolated into the shell; user input rephrased and wrapped in boundary tags), runs `kiro-cli` with tool-trust opt-in (no `--trust-all-tools` unless you ask), then verifies the result against `git diff` and reports files changed, errors, and what's left. Used by `/ship-playbook` as its kiro build handoff.

Credit: original skill by **Sabeur Thabti** ([@thabti](https://github.com/thabti/hand-over-to-kiro)), MIT — adapted to the @ulpi/skills conventions.

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

---

## nodejs

```bash
npx skills add https://github.com/ulpi-io/skills --skill nodejs
```

**Node.js / Bun backend reference for AI coding agents.**

TypeScript-first backend conventions: structured error handling, pino logging, Zod validation, async patterns, HTTP server conventions, database access, auth, queues, caching, testing, security, CLI tooling, and observability — across both Node.js and Bun runtimes. A routing shell over a reference set; loads only what the task needs.

---

## nestjs

```bash
npx skills add https://github.com/ulpi-io/skills --skill nestjs
```

**NestJS reference for AI coding agents.**

Module-based architecture skill covering modules, controllers, providers, DTOs with class-validator, TypeORM/Prisma, guards, interceptors, pipes, BullMQ queues, WebSockets, microservices, testing, OpenAPI, and CLI scaffolding. A routing shell over a reference set; loads only the references the task needs.

---

## docker

```bash
npx skills add https://github.com/ulpi-io/skills --skill docker
```

**Docker and container infrastructure for AI coding agents.**

Covers Dockerfiles, multi-stage builds, Compose, networking, volumes, health checks, registries, BuildKit, security hardening, CI/CD integration, and debugging. Defaults to multi-stage builds and non-root production users. A routing shell over a reference set; for Kubernetes manifests use a k8s skill instead.
