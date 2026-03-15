# @ulpi/skills

Skills for AI coding agents. Works with [skills.sh](https://skills.sh) — install with one command, works across Claude Code, Cursor, Cline, Windsurf, and 15+ other agents.

```bash
npx skills add https://github.com/ulpi-io/skills
```

## browse

**Give AI agents a real browser — without flooding the context with HTML.**

A persistent headless Chromium daemon that stays running between commands. The agent navigates, clicks, fills forms, takes screenshots, and reads page content through simple CLI commands — each returning minimal, structured output instead of dumping raw HTML or full accessibility trees.

```bash
browse goto https://www.mumzworld.com     # → "Navigated to ... (200)"  (11 tokens)
browse snapshot -i                         # → interactive elements with @refs
browse fill @e3 "strollers"                # → "Filled @e3"  (15 tokens)
browse click @e5                           # → "Clicked @e5"  (15 tokens)
browse text                                # → clean visible text, no HTML
```

**Why not @playwright/mcp?** Playwright MCP dumps the full snapshot on every action (~16K tokens per navigate/click/type). `browse` returns a one-liner. The agent requests a snapshot only when it needs one. Over a 10-step session: **12K tokens vs 146K** — 13x less context burned.

**48 commands** including: navigation, content extraction, ref-based interaction, cursor-interactive detection (`-C` catches `div[onclick]` and `cursor:pointer` that ARIA misses), device emulation (150+ devices), screenshots, page diffing, snapshot diffing, multi-tab, multi-agent sessions, network/console logs, cookies, performance timing.

**Persistent daemon**: first command starts the server (~2s), every command after: ~100ms. Auto-shutdown after 30 min idle. Crash recovery built in.

```bash
# Install the CLI
bun install -g @ulpi/browse

# Or just the skill (CLI must be installed separately)
npx skills add https://github.com/ulpi-io/skills --skill browse
```

[Full docs and benchmarks →](https://github.com/ulpi-io/browse)

---

## codemap

**Code search and architecture analysis that actually understands your codebase.**

Indexes your project with hybrid vector + BM25 search, builds a dependency graph, and gives the agent tools to find code by concept, trace dependencies, detect circular imports, and understand file importance — all through fast CLI commands or MCP tools.

```bash
codemap search "error handling"           # → semantic + keyword search
codemap symbols "handleError"             # → find functions/classes by name
codemap deps src/server.ts                # → what this file imports
codemap dependents src/types.ts           # → what imports this file
codemap rank                              # → PageRank importance scores
codemap cycles                            # → circular dependency detection
codemap coupling                          # → afferent/efferent coupling metrics
codemap summary src/cli.ts                # → file overview with symbols
```

**CLI or MCP** — works both ways. As a CLI skill, agents call commands via Bash. As an MCP server (`codemap serve`), agents get native tool calls like `mcp__codemap__search_code`.

**20 commands** including: hybrid search, symbol lookup, dependency analysis, dependents tracing, PageRank scoring, cycle detection, coupling metrics, graph stats, file summaries, live watch mode, and self-update.

```bash
# Install the CLI
npm install -g @ulpi/codemap

# Set up MCP (optional, for native tool access)
claude mcp add codemap codemap serve

# Or just the skill
npx skills add https://github.com/ulpi-io/skills --skill codemap
```

[Full docs →](https://github.com/ulpi-io/codemap)
