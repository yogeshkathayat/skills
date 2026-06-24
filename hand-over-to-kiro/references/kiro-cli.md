# Kiro CLI Reference

Source: https://kiro.dev/docs/cli/reference/cli-commands/

## Global Flags

| Flag | Description |
|------|-------------|
| `--verbose` / `-v` | Increase logging verbosity (repeatable: `-v`, `-vv`, `-vvv`) |
| `--agent <name>` | Use a specific custom agent configuration |
| `--help` / `-h` | Show help for current command |
| `--help-all` | Show help for all subcommands |
| `--version` / `-V` | Print version |

## chat

Start an interactive chat session or execute a one-shot task.

```bash
kiro-cli chat "prompt"                                      # interactive session
kiro-cli chat "prompt" --no-interactive                     # one-shot, stdout only
kiro-cli chat --no-interactive --trust-tools=fs_read,execute_bash "prompt"            # read-only (review)
kiro-cli chat --no-interactive --trust-tools=fs_read,fs_write,execute_bash "prompt"   # implement (edits files)
kiro-cli chat --no-interactive --trust-all-tools "prompt"   # fully autonomous (unsafe-by-default; opt-in)
```

kiro also reads the prompt from **stdin** when no positional arg is given
(`printf '%s' "$prompt" | kiro-cli chat --no-interactive …`) — verified on kiro-cli 2.6.0.
`helpers/run-kiro.sh` uses this so the prompt never lands on argv or passes through shell parsing.

**Flags:**

| Flag | Description |
|------|-------------|
| `--no-interactive` | Print first response to stdout, skip TUI |
| `--trust-all-tools` | Allow all tool calls without confirmation |
| `--trust-tools <list>` | Whitelist specific tools (comma-separated) |
| `--require-mcp-startup` | Fail if MCP servers are unavailable |
| `--resume` / `-r` | Resume previous conversation |
| `--resume-id <ID>` | Resume a specific session by ID |
| `--resume-picker` | Interactive session picker |
| `--list-sessions` | List saved sessions |
| `--delete-session <ID>` | Delete a session |
| `--list-models` | Show available models |
| `--agent <name>` | Use a specific agent |
| `--wrap <mode>` | Line wrapping: `always` / `never` / `auto` |

**In-chat slash commands:**

| Command | Description |
|---------|-------------|
| `/chat new` | Start a fresh conversation |
| `/chat new <prompt>` | New conversation with initial prompt |
| `/chat resume` | Interactive session picker |
| `/chat save <path>` | Export conversation to file |
| `/chat load <path>` | Import conversation from file |

## Skills (Agent Skills)

Kiro discovers `SKILL.md` skills and matches them by description, or exposes them as `/<name>` slash commands.

- **Locations (auto-discovered by the DEFAULT agent):** `.kiro/skills/<name>/SKILL.md` (workspace) and
  `~/.kiro/skills/<name>/SKILL.md` (global). skills.sh installs them here (symlinks). No config needed
  for the default agent.
- **No `Skill` tool / no `--trust-tools` token for skills.** A skill is not invoked by a tool call;
  once loaded it drives the agent's own `fs_read`/`execute_bash`. Trust still governs *those*
  (`--trust-tools=fs_read,…`). Native tool names: `fs_read`, `fs_write`, `execute_bash`, `use_aws`,
  `report_issue`, `@<mcp>` (aliases `read`/`write`/`shell`).
- **Custom agents do NOT auto-load skills.** A `--agent <name>` only sees skills its config lists under
  `resources`: `file://<path>` preloads the whole file at startup; `skill://<glob>` loads metadata up
  front and the body on demand (e.g. `"resources": ["skill://.kiro/skills/*/SKILL.md"]`).
- **One-shot `--no-interactive`:** auto-activation/slash-commands are unreliable in a single turn. To
  make kiro FOLLOW a specific skill deterministically, either (a) **inline the SKILL.md body in the
  prompt** (what this skill does — see SKILL.md Step 2.5), or (b) run `--agent` with
  `resources: ["file://.kiro/skills/<name>/SKILL.md"]` preloaded.

Docs: <https://kiro.dev/docs/cli/skills/> · <https://kiro.dev/docs/cli/custom-agents/configuration-reference/>

## settings

Read and write configuration values.

```bash
kiro-cli settings list                                # show configured settings
kiro-cli settings list --all                          # show all available settings with descriptions
kiro-cli settings list --format json-pretty           # JSON output
kiro-cli settings chat.defaultModel claude-opus-4.7   # set a value
kiro-cli settings --delete chat.defaultModel          # remove a setting
kiro-cli settings open                                # open config in default editor
```

## agent

Create and manage custom agent configurations.

```bash
kiro-cli agent list                  # list available agents
kiro-cli agent create <name>         # create new agent config
kiro-cli agent edit [name]           # edit agent (defaults to current)
kiro-cli agent validate              # verify agent config at path
kiro-cli agent migrate               # convert legacy profiles to agents
kiro-cli agent set-default <name>    # set default agent for sessions
```

## mcp

Manage Model Context Protocol servers.

```bash
kiro-cli mcp list [workspace|global]                          # list MCP servers
kiro-cli mcp add --name <NAME> --command <CMD> --scope <S>    # add server
kiro-cli mcp remove --name <NAME> --scope <S>                 # remove server
kiro-cli mcp import --file <CONFIG> [--force] [SCOPE]         # import config
kiro-cli mcp status --name <NAME>                             # check server status
```

`--scope` is `workspace` or `global`. Add supports `--env KEY=VAL` and `--timeout MS`.

## translate

Code translation.

```bash
kiro-cli translate [INPUT...]    # translate code
kiro-cli translate -n 3          # generate up to 5 completions
```

## inline

Manage inline code suggestions.

```bash
kiro-cli inline enable               # activate suggestions
kiro-cli inline disable              # deactivate suggestions
kiro-cli inline status               # current state
kiro-cli inline set-customization    # select model
kiro-cli inline show-customizations  # list available options
```

## integrations

Install and manage editor/tool integrations.

```bash
kiro-cli integrations install [integration]     # add integration
kiro-cli integrations uninstall [integration]   # remove integration
kiro-cli integrations reinstall [integration]   # reinstall
kiro-cli integrations status                    # check status
```

Supports `--silent` / `-s` and `--format` / `-f` flags.

**Kiro Command Router** (v1.26.0+) routes the `kiro` command between CLI and IDE:
```bash
kiro-cli integrations install kiro-command-router
kiro set-default cli|ide
```

## Auth & Identity

```bash
kiro-cli login                                  # authenticate (opens browser)
kiro-cli login --license pro                    # Identity Center (pro)
kiro-cli login --license free                   # Builder ID (free)
kiro-cli login --use-device-flow                # device flow for SSH/remote
kiro-cli login --social google|github           # social login
kiro-cli login --identity-provider <URL>        # Identity Center URL
kiro-cli login --region <REGION>                # AWS region
kiro-cli logout                                 # sign out (preserves config/sessions)
kiro-cli whoami                                 # current user info
kiro-cli whoami --format json-pretty            # JSON output
```

## Diagnostics & System

```bash
kiro-cli doctor                     # run diagnostic checks and suggest fixes
kiro-cli doctor --all               # run all tests without applying fixes
kiro-cli doctor --strict            # treat warnings as errors
kiro-cli update                     # update kiro-cli
kiro-cli update -y                  # update without confirmation
kiro-cli diagnostic                 # system info report
kiro-cli diagnostic --format json   # JSON output
kiro-cli diagnostic --force         # limited output without app running
kiro-cli version                    # version info
kiro-cli version --changelog        # current version changelog
kiro-cli version --changelog=all    # full changelog
kiro-cli issue "description"        # file a bug report
```

## Theme

```bash
kiro-cli theme dark|light|system    # set theme
kiro-cli theme --list               # list available themes
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `KIRO_LOG_LEVEL` | `error` / `warn` / `info` / `debug` / `trace` |
| `KIRO_LOG_NO_COLOR` | Disable colored output (`1` / `true` / `yes`) |

## Log Locations

- **macOS**: `$TMPDIR/kiro-log/`
- **Linux**: `$XDG_RUNTIME_DIR` or `/tmp/kiro-log/`
