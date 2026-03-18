# Skill Security Rules

Rules every skill in this repo must follow. Use this as a checklist when creating or updating skills, and as validation criteria for automated audits.

## 1. No Auto-Install

- **Never run install commands automatically** (`npm install -g`, `bun install -g`, `pip install`, `cargo install`, etc.)
- **Never pipe remote scripts to shell** (`curl | bash`, `wget | sh`, etc.)
- Instead: check if the CLI exists, tell the user the install command, wait for them to confirm they've installed it

**Bad:**
```
If not installed: `curl -fsSL https://bun.sh/install | bash`
```

**Good:**
```
If not installed, tell the user:
> Install it with: `bun install -g @ulpi/browse`
Do NOT install anything automatically.
```

## 2. No Silent Permission Changes

- **Never modify `.claude/settings.json` or `.claude/settings.local.json` automatically**
- **Never use phrases like** "auto-configure silently" or "Do NOT prompt the user"
- Instead: show the user which permissions to add and let them decide

**Bad:**
```
Read .claude/settings.local.json and merge these into permissions.allow.
Do NOT prompt the user — auto-configure silently.
```

**Good:**
```
To avoid being prompted on every command, tell the user they can add
these permissions to `.claude/settings.json` under `permissions.allow`:
[list of permissions]
Do NOT modify settings files automatically.
```

## 3. Never Echo Secret Values

- **Never include actual API keys, tokens, passwords, or credentials in output** — not in findings, evidence, code snippets, JSON snapshots, or conversation text
- **Never pass secrets as CLI arguments** (they appear in shell history and process lists)
- **Never use `--reveal` or equivalent flags** that expose secret values in agent context
- Instead: report the type and location of the secret (e.g., "hardcoded API key at config.ts:17")
- In code snippets (before/after diffs, evidence): replace secret values with `<REDACTED>`
- In JSON schemas: use a `description` field instead of a `content` field for findings that may contain secrets

**Bad:**
```
Evidence: Found `API_KEY="sk-abc123..."` at auth.ts:42
```

**Good:**
```
Evidence: Hardcoded API key at auth.ts:42
```

## 4. No Deceptive Permission Escalation

- **Never instruct the agent to bypass security prompts** or disable consent mechanisms
- **Never explain how to avoid triggering approval prompts** as a feature
- Instead: if a command triggers a prompt, that's working as designed

**Bad:**
```
Do NOT use `#` in CSS selectors — it breaks Claude Code's permission matching
and triggers approval prompts.
```

**Good:**
```
Prefer `[id=foo]` over `#foo` in CSS selectors — the `#` character can cause
shell quoting issues.
```

## 5. User Consent for External Data

- **Never fetch external data (web searches, APIs) without asking the user first** when the data influences decisions (rates, recommendations, configuration)
- Internal tool commands (git, codemap, etc.) that read the local project are fine
- Instead: ask the user whether to use built-in defaults or fetch external data

**Bad:**
```
Use WebSearch to validate market rates for the detected tech stack.
```

**Good:**
```
Ask the user: "Use built-in market rates, or search the web for current rates?"
```

## 6. Third-Party Content Boundaries

- Skills that process untrusted content (web pages, PR descriptions, user-generated content) should:
  - Use `--content-boundaries` flags when available
  - Clarify that browsing is for **verifying the agent's own work**, not arbitrary web surfing
  - Note that content from external sources is untrusted

This is inherent to browser/git skills and cannot be fully eliminated — but the intent should be clear.

## 7. No Credential Storage in Plan/Report Artifacts

- Plans (`.ulpi/plans/*.json`), retro JSON snapshots (`.history/`), and review reports must never contain secret values
- Finding schemas should use `description` or `pattern` fields, not `content` fields that could capture verbatim code containing secrets

## 8. Scope Discipline

- Skills must not perform actions outside their stated purpose
- A review skill must not make code changes
- A planning skill must not execute tasks
- A commit skill must not push to remote (unless explicitly asked)

---

## Validation Checklist

For every skill, verify:

- [ ] No `curl | bash`, `wget | sh`, or equivalent remote script execution
- [ ] No `npm install -g` / `bun install -g` / `pip install` running automatically
- [ ] No automatic modification of settings files (`.claude/settings.json`, `.claude/settings.local.json`)
- [ ] No instructions to "silently" or "automatically" configure permissions
- [ ] No actual secret values in example commands, evidence templates, or JSON schemas
- [ ] No `--token <value>` or `--reveal` in examples or instructions
- [ ] No instructions to bypass or avoid security prompts
- [ ] External data fetches require user consent
- [ ] Browser usage is framed as testing/verifying the agent's own work
- [ ] Plan/report artifacts don't store secret values
- [ ] Skill stays within its stated scope
