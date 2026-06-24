---
name: kiro-review
version: 2.2.0
description: |
  Run Kiro CLI as an independent reviewer over the current branch, a specific commit, or
  uncommitted changes. Builds a focused prompt from the real diff and returns a compact review
  summary.
allowed-tools:
  - Bash
  - Read
  - Write
user-invocable: true
argument-hint: "[branch review, uncommitted, or specific commit]"
arguments:
  - request
when_to_use: |
  Use only when the user explicitly asks for a Kiro review or cross-review. Examples:
  "/kiro-review", "run kiro on this branch", "get a second opinion from kiro". Do not use for
  direct code editing or when the user asked for Claude or Codex instead.
effort: high
---

<EXTREMELY-IMPORTANT>
This skill orchestrates an external reviewer and must stay disciplined.

Non-negotiable rules:
1. Read the real diff before writing the Kiro prompt.
2. Make the prompt specific to the changed areas and likely risks.
3. Never put secrets or credentials in the prompt.
4. Carry forward exclusion lists on later rounds.
5. Verify returned findings before acting on them.
6. A review is READ-ONLY: launch kiro via `helpers/run-kiro.sh --mode review` (scoped trust
   `fs_read,execute_bash`). NEVER use `--trust-all-tools` / `-a` — the auto-mode classifier blocks
   unrestricted trust on a non-mutating task, so all-tools just dead-ends.
</EXTREMELY-IMPORTANT>

# Kiro Review

## Inputs

- `$request`: Optional scope hint such as `last commit`, `uncommitted`, `auth focus`, or `round 2`

## Goal

Use `kiro-cli` to get an external review pass that:

- uses the right diff scope
- focuses on the actual change surface
- returns structured findings instead of generic commentary

## Step 0: Verify Kiro availability

Check:

- `which kiro-cli`
- `kiro-cli whoami` or the minimal auth check needed in this environment

If the CLI is unavailable or not authenticated, explain the blocker and stop.

**Success criteria**: Kiro can run successfully from the current repository.

## Step 1: Resolve review scope

Determine whether to review:

- the full branch
- uncommitted changes
- a specific commit

Read the diff summary and changed-file list first.

If there is nothing to review, stop and say so explicitly.

**Success criteria**: The review target is explicit and backed by a real diff.

## Step 2: Build the focused Kiro prompt

Create a compact prompt that includes:

- what changed
- the major risk areas
- any previously fixed issues to exclude on later rounds
- an instruction to verify findings against the actual code
- the expected compact output format
- if a stack/convention skill is installed for kiro (`.kiro/skills/<name>/SKILL.md`), inline its body so
  kiro reviews against those conventions — kiro has no `Skill` tool to load it itself, and one-shot
  `--no-interactive` runs can't rely on auto-activation

Avoid generic prompts. They produce weak results.

**Success criteria**: The prompt is specific to the change set rather than reusable boilerplate.

## Step 3: Run Kiro read-only via the helper

Do NOT hand-roll the kiro command (mktemp/heredoc/trust flags broke before). Instead:

1. **Write the prompt to a file with the Write tool** (literal bytes — no shell, no heredoc, no mktemp).
   Use an absolute path, e.g. `/tmp/kiro-review-prompt.txt`, and write a FRESH file each round.
2. **Run the helper in review mode:**

```bash
bash <skill-dir>/helpers/run-kiro.sh --mode review --prompt-file /tmp/kiro-review-prompt.txt 2>&1
```

`--mode review` scopes trust to **`--trust-tools=fs_read,execute_bash`** — kiro can read files and run
`grep`/`find`/`git` to verify findings against source, with NO write access. Do NOT use
`--trust-all-tools` / `-a`: a review is read-only and the auto-mode classifier blocks unrestricted
trust on non-mutating tasks. The helper feeds the prompt via kiro's stdin, refuses to launch on an
empty prompt, and captures a git baseline. (If a specific model is required, set kiro's default first:
`kiro-cli settings chat.defaultModel <model>`.)

Use a Bash timeout of 600000 ms for a large review. If the helper exits with "prompt file is EMPTY",
re-write the prompt and retry — never run kiro on an empty prompt.

**Success criteria**: Kiro runs read-only on the intended scope and returns parseable findings.

## Step 4: Summarize findings

Report:

- review scope
- findings by priority
- file and line references when available
- explicit clean result when no material findings are returned

If the user wants fixes, verify each finding locally before changing code.

**Success criteria**: The user gets a readable review summary instead of raw CLI logs.

## Step 5: Iterate only with exclusions

On later rounds:

- list prior fixed findings in the exclusion block
- narrow the scope to newly changed files when possible
- avoid repeated full-branch reviews unless the code changed broadly again

**Success criteria**: Follow-up rounds target new issues instead of recycling old ones.

## Guardrails

- Do not run this skill PROACTIVELY on your own initiative — only on explicit user intent (e.g.
  `/kiro-review`) or when an explicit user-invoked workflow composes it as the kiro reviewer (e.g.
  `/ship-playbook` with a kiro review role). It is no longer `disable-model-invocation`, so workflows
  can call it; that is not license to run it unprompted.
- Do not put secrets, tokens, or private config into the prompt.
- Do not trust findings blindly without local verification.
- Do not skip diff reading before prompt construction.
- Launch kiro only via `helpers/run-kiro.sh --mode review` (scoped read-only trust); never
  `--trust-all-tools`/`-a` for a review, and never hand-roll mktemp/heredoc to pass the prompt.

## Output Contract

Report:

1. the review scope
2. the main focus areas given to Kiro
3. findings by priority with locations when available
4. explicit clean result if nothing material was found
5. whether a next round should exclude previously fixed issues
