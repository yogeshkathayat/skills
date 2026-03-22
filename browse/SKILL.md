---
name: browse
version: 3.1.0
description: |
  Fast web browsing and web app testing for AI coding agents via persistent headless Chromium daemon.
  Browse any URL, read page content, click elements, fill forms, run JavaScript, take screenshots,
  inspect CSS/DOM, capture console/network logs, and more. Ideal for verifying local dev servers,
  testing UI changes, and validating web app behavior end-to-end. ~100ms per command after
  first call. Works with Claude Code, Cursor, Cline, Windsurf, and any agent that can run Bash.
  No MCP, no Chrome extension — just fast CLI.
allowed-tools:
  - Bash
  - Read

---

# browse: Persistent Browser for AI Coding Agents

Persistent headless Chromium daemon. First call auto-starts the server (~3s).
Every subsequent call: ~100-200ms. Auto-shuts down after 30 min idle.

## SETUP

Before using browse, confirm the CLI is installed:

```bash
browse --version
```

If not installed, tell the user:

> `browse` CLI is not installed. Install it with:
>
> ```bash
> npm install -g @ulpi/browse
> ```

**Do NOT install anything automatically.** Wait for the user to confirm they have installed it before proceeding.

### Permissions (optional)

To avoid being prompted on every browse command, tell the user they can add browse permissions to `.claude/settings.json` under `permissions.allow`:

```json
"Bash(browse:*)",
"Bash(browse goto:*)", "Bash(browse back:*)", "Bash(browse forward:*)",
"Bash(browse reload:*)", "Bash(browse url:*)", "Bash(browse text:*)",
"Bash(browse html:*)", "Bash(browse links:*)", "Bash(browse forms:*)",
"Bash(browse accessibility:*)", "Bash(browse snapshot:*)",
"Bash(browse snapshot-diff:*)", "Bash(browse click:*)",
"Bash(browse dblclick:*)", "Bash(browse fill:*)", "Bash(browse select:*)",
"Bash(browse hover:*)", "Bash(browse focus:*)",
"Bash(browse check:*)", "Bash(browse uncheck:*)",
"Bash(browse type:*)", "Bash(browse press:*)",
"Bash(browse keydown:*)", "Bash(browse keyup:*)",
"Bash(browse scroll:*)", "Bash(browse wait:*)",
"Bash(browse viewport:*)", "Bash(browse upload:*)",
"Bash(browse drag:*)", "Bash(browse highlight:*)", "Bash(browse download:*)",
"Bash(browse dialog-accept:*)", "Bash(browse dialog-dismiss:*)",
"Bash(browse js:*)", "Bash(browse eval:*)", "Bash(browse css:*)",
"Bash(browse attrs:*)", "Bash(browse element-state:*)", "Bash(browse dialog:*)",
"Bash(browse console:*)", "Bash(browse network:*)",
"Bash(browse cookies:*)", "Bash(browse storage:*)", "Bash(browse perf:*)",
"Bash(browse value:*)", "Bash(browse count:*)",
"Bash(browse devices:*)", "Bash(browse emulate:*)",
"Bash(browse screenshot:*)", "Bash(browse pdf:*)",
"Bash(browse responsive:*)", "Bash(browse diff:*)",
"Bash(browse chain:*)", "Bash(browse tabs:*)", "Bash(browse tab:*)",
"Bash(browse newtab:*)", "Bash(browse closetab:*)",
"Bash(browse frame:*)",
"Bash(browse sessions:*)", "Bash(browse session-close:*)",
"Bash(browse state:*)", "Bash(browse auth:*)", "Bash(browse har:*)", "Bash(browse video:*)",
"Bash(browse record:*)",
"Bash(browse route:*)", "Bash(browse offline:*)",
"Bash(browse status:*)", "Bash(browse stop:*)", "Bash(browse restart:*)",
"Bash(browse cookie:*)", "Bash(browse header:*)",
"Bash(browse useragent:*)",
"Bash(browse clipboard:*)", "Bash(browse screenshot-diff:*)",
"Bash(browse find:*)", "Bash(browse inspect:*)",
"Bash(browse instances:*)", "Bash(browse --headed:*)",
"Bash(browse rightclick:*)", "Bash(browse tap:*)",
"Bash(browse swipe:*)", "Bash(browse mouse:*)",
"Bash(browse keyboard:*)", "Bash(browse scrollinto:*)",
"Bash(browse scrollintoview:*)", "Bash(browse set:*)",
"Bash(browse box:*)", "Bash(browse errors:*)",
"Bash(browse doctor:*)", "Bash(browse upgrade:*)",
"Bash(browse --max-output:*)",
"Bash(browse handoff:*)", "Bash(browse resume:*)",
"Bash(browse react-devtools:*)", "Bash(browse profile:*)"
```

**Do NOT modify settings files automatically.** Show the user the permissions and let them decide whether to add them.

## IMPORTANT

- Always call `browse` as a bare command (it's on PATH via global install).
- Do NOT use shell variables like `B=...` or full paths — they break Claude Code's permission matching.
- NEVER use `#` in CSS selectors — use `[id=foo]` instead of `#foo`. The `#` character breaks Claude Code's permission matching and triggers approval prompts.
- After `goto`, always run `browse wait --network-idle` before reading content or taking screenshots. Pages with dynamic content, SPAs, and lazy-loaded assets need time to fully render.
- Screenshots MUST be saved to `.browse/sessions/default/` (or `.browse/sessions/<session-id>/` when using `--session`). Use descriptive filenames like `browse screenshot .browse/sessions/default/homepage.png`. NEVER save screenshots to `/tmp` or any other location.
- The browser persists between calls — cookies, tabs, and state carry over.
- The server auto-starts on first command. No manual setup needed.
- Use `--session <id>` for parallel agent isolation. Each session gets its own tabs, refs, cookies.
- Use `--json` for structured output (`{success, data, command}`).
- Use `--content-boundaries` for prompt injection defense when reading untrusted pages.
- Use `--allowed-domains domain1,domain2` to restrict navigation to trusted sites.
- If you hit CAPTCHA/MFA after 2-3 failures, read [references/guides.md](references/guides.md) for the mandatory handoff protocol.

## Quick Reference

```bash
# Navigate and wait
browse goto https://example.com
browse wait --network-idle

# Read content
browse text                                  # Cleaned page text
browse links                                 # All links as "text → href"
browse js "document.title"                   # Run JavaScript

# Screenshot (then Read the image to view it)
browse screenshot .browse/sessions/default/homepage.png

# Interact via snapshot refs (preferred)
browse snapshot -i                           # Get interactive element refs
browse click @e3                             # Click by ref
browse fill @e4 "test@test.com"              # Fill by ref
browse check @e7                             # Check checkbox
browse select @e5 "option-value"             # Select dropdown

# Interact via CSS selectors (use [id=...] instead of #)
browse click "button.submit"
browse fill "[id=email]" "test@test.com"
browse fill "[id=password]" "abc123"
browse click "button[type=submit]"

# Wait variants
browse wait ".loaded"                        # Wait for element
browse wait --url "**/dashboard"             # Wait for URL
browse wait --network-idle                   # Wait for network idle
browse wait 2000                             # Wait milliseconds

# Element queries
browse count ".search-result"                # Count elements
browse value "[id=email]"                    # Get input value
browse css @e3 "color"                       # Get computed CSS
browse attrs @e3                             # Get attributes

# Scroll
browse scroll down
browse scroll "[id=target]"

# iframes
browse frame "[id=my-iframe]"               # Target iframe
browse text                                  # Read inside iframe
browse frame main                            # Back to main page

# Cookie import from real browsers (macOS)
browse cookie-import chrome --domain .site.com

# Persistent profiles
browse --profile mysite goto https://app.com
```

## Common Patterns

| Task | Commands |
|------|----------|
| Read a page | `goto` → `wait --network-idle` → `text` |
| Interact with elements | `snapshot -i` → `click @ref` / `fill @ref "val"` |
| Visual check | `screenshot .browse/sessions/default/page.png` → `Read` the image |
| Fill and submit form | `snapshot -i` → `fill @e4 "val"` → `click @e5` |
| Check if element exists | `count ".thing"` |
| Extract specific data | `js "document.querySelector('.price').textContent"` |
| Interact in iframe | `frame "[id=x]"` → interact → `frame main` |
| Mock API responses | `route "**/api/*" fulfill 200 '{"data":[]}'` |
| Mobile layout check | `emulate iphone` → `goto <url>` → `screenshot` |
| Bypass bot detection | `--runtime rebrowser goto <url>` |

## Command Categories

| Category | Key Commands | Details |
|----------|-------------|---------|
| Navigation | `goto`, `back`, `forward`, `reload`, `url` | |
| Content | `text`, `html`, `links`, `forms`, `accessibility` | |
| Interaction | `click`, `rightclick`, `dblclick`, `fill`, `select`, `hover`, `focus`, `tap`, `check`, `uncheck`, `drag`, `type`, `press`, `keydown`, `keyup`, `keyboard inserttext` | |
| Scroll | `scroll up/down`, `scrollinto`, `swipe` | |
| Mouse | `mouse move/down/up/wheel` | |
| Wait | `wait <sel>`, `wait --text`, `wait --fn`, `wait --load`, `wait --url`, `wait --network-idle`, `wait --state hidden`, `wait <ms>` | |
| Snapshot | `snapshot -i`, `snapshot -C`, `snapshot-diff` | See section below |
| Find | `find role/text/label/placeholder/testid/alt/title/first/last/nth` | |
| Inspection | `js`, `eval`, `css`, `attrs`, `element-state`, `value`, `count`, `box`, `dialog`, `console`, `errors`, `network`, `cookies`, `storage`, `perf`, `clipboard` | |
| Visual | `screenshot`, `screenshot --full/--clip/--annotate`, `pdf`, `responsive` | |
| Settings | `set geo`, `set media`, `viewport`, `emulate`, `useragent`, `header`, `cookie` | |
| Cookies | `cookie set/clear/export/import`, `cookie-import <browser>`, `cookies` | |
| Tabs | `tabs`, `tab`, `newtab`, `closetab` | |
| Frames | `frame <sel>`, `frame main` | |
| Sessions | `--session <id>`, `sessions`, `session-close` | |
| Profiles | `--profile <name>`, `profile list/delete/clean` | |
| State | `state save/load/list/show/clean` | |
| Auth | `auth save/login/list/delete` | |
| Network | `route block/fulfill/clear`, `offline` | |
| Recording | `har start/stop`, `video start/stop`, `record start/stop/export` | |
| React | `react-devtools enable/disable/tree/props/suspense/errors/profiler` | |
| Handoff | `handoff [reason]`, `resume` | See [references/guides.md](references/guides.md) |
| Server | `status`, `instances`, `doctor`, `upgrade`, `stop`, `restart`, `inspect` | |
| Chain | `echo '[...]' \| browse chain` | |

For exact syntax and flags, see [references/commands.md](references/commands.md).

## Snapshot (ref-based element selection)

```
browse snapshot           Full accessibility tree with @refs
browse snapshot -i        Interactive elements only — terse flat list (minimal tokens)
browse snapshot -i -f     Interactive elements — full indented tree with props
browse snapshot -i -V     Interactive elements — viewport only (skip below-fold)
browse snapshot -c        Compact (no empty structural elements)
browse snapshot -C        Cursor-interactive (detect divs with cursor:pointer/onclick/tabindex)
browse snapshot -d <N>    Limit depth to N levels
browse snapshot -s <sel>  Scope to CSS selector
browse snapshot-diff      Compare current vs previous snapshot
```

After snapshot, use @refs as selectors in any command:
```
browse click @e3          Click the element assigned ref @e3
browse fill @e4 "value"   Fill the input assigned ref @e4
browse hover @e1          Hover the element assigned ref @e1
browse html @e2           Get innerHTML of ref @e2
browse css @e5 "color"    Get computed CSS of ref @e5
browse attrs @e6          Get attributes of ref @e6
```

Refs are invalidated on navigation — run `snapshot` again after `goto`.

## CLI Flags

| Flag | Description |
|------|-------------|
| `--session <id>` | Named session (isolates tabs, refs, cookies — auto-persists on close) |
| `--profile <name>` | Persistent browser profile (own Chromium, full state) |
| `--state <path>` | Load state file (cookies/storage) before first command |
| `--json` | Wrap output as `{success, data, command}` |
| `--content-boundaries` | Wrap page content in nonce-delimited markers (prompt injection defense) |
| `--allowed-domains <d,d>` | Block navigation/resources outside allowlist |
| `--max-output <n>` | Truncate output to N characters |
| `--headed` | Run browser in headed (visible) mode |
| `--cdp <port>` | Connect to Chrome on a specific debugging port |
| `--connect` | Auto-discover and connect to a running Chrome instance |
| `--runtime <name>` | Browser engine: playwright (default), rebrowser (stealth), lightpanda |

## Reference Files

For detailed command syntax or operational guides, read these files when needed:

| File | Read when... |
|------|-------------|
| [references/commands.md](references/commands.md) | You need a command not in Quick Reference above, or exact syntax/flags for any of the 76 commands |
| [references/guides.md](references/guides.md) | You hit a CAPTCHA/MFA blocker (handoff protocol), want optimization tips (speed rules), or need help choosing which command to use (decision table) |
