---
name: ship-playbook
version: 1.0.0
description: |
  Take one feature request and run the entire delivery playbook automatically: plan it, review the
  plan, build it task by task, review the build, and optionally audit it for launch — looping on any
  findings until the gates are clean. It chains the existing skills as one runnable 14-step Workflow:
  plan-to-task-list-with-dag (plan + assign a specialist agent per task) → plan-founder-review (loop
  to APPROVE) → a specialist engineer/reviewer build across the DAG → a full claude ∥ codex/kiro
  cross-review → go-live-audit. Up front it asks two things — which harness cross-reviews
  (claude / codex / kiro / none) and whether to run a go-live audit at the end — then executes every
  step end to end. Use when the user wants "prompt → planned, built, reviewed, audited" in one go
  instead of running each phase by hand.
allowed-tools:
  - Skill
  - Agent
  - AskUserQuestion
  - Bash
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - TodoWrite
  - Workflow
disable-model-invocation: true
user-invocable: true
effort: high
argument-hint: "<feature prompt — what to plan, build, review, and ship>"
arguments:
  - request
when_to_use: |
  Use only when the user explicitly asks to run the full delivery playbook on a feature request —
  "ship this end to end", "run the playbook on <X>", "/ship-playbook build <X>", "plan, review,
  build and audit <X>". Do NOT use for a single phase: use plan-to-task-list-with-dag to only plan,
  plan-founder-review to only review a plan, go-live-audit to only audit, or the per-harness review
  skills to only cross-review. This skill spawns many agents over multiple rounds — it is
  explicit-user-only.
---

<EXTREMELY-IMPORTANT>
This skill drives a long-running, multi-agent delivery Workflow. Non-negotiable rules:
1. ALL 14 playbook steps run. They are not optional and none is demoted — the Workflow
   (`references/workflow-template.js`) executes steps 3–14 as real phases; the skill performs steps
   1, 2, 2.1 (the prompt + the two intake questions) and feeds them in as `args`.
2. ALWAYS ask the two intake questions first (plan-review harness + go-live audit). They are
   inputs to the Workflow, not steps the Workflow can skip.
3. The BUILD is a Workflow phase, not a description. Per task across the DAG layers: the matched
   specialist ENGINEER agent implements on a task branch in an isolated worktree, an in-workflow
   INTEGRATE agent git-merges it onto the working branch, the matched specialist REVIEWER agent
   reviews the integrated state, and a bounded fix loop runs until the task passes.
4. The build MUST pick a specialist agent for every task — never `general-purpose` for build work —
   and when a task's stack has a skill, the engineer MUST use it (`/nextjs`, `/laravel`, `/rust`, …).
5. Gates are real. The founder-review loops review → FIX → re-review until APPROVE / no issues; the
   build loops engineer → reviewer → fix until the task passes. Never wave a gate through.
6. Codex delegation goes through the codex plugin (`codex:codex-rescue` agentType). Kiro via the
   kiro path. "claude" = native. "none" = skip the external cross-review. (See `harness-routing.md`.)
7. The step-14 recursion is bounded by `maxRounds` (default 3). On exhaustion, surface the remaining
   findings honestly — NEVER fake a clean verdict to exit.
8. Keep this body focused on launching + reporting the Workflow. Load the build contract, harness
   routing, state machine, and the Workflow script itself from `references/`.
</EXTREMELY-IMPORTANT>

# Ship Playbook

## Inputs

- `$request`: The feature prompt — what to plan, build, review, and ship. May carry overrides like
  `harness=codex`, `golive=yes`, or `maxRounds=2` to seed intake.

## Goal

Turn one prompt into shipped-quality work the same way every time, by running the full 14-step
playbook as a single runnable Workflow: a grounded DAG plan, a plan that survives founder review
(native + an optional second harness, looped to APPROVE), an implementation built task-by-task with a
specialist engineer/reviewer pair across the DAG layers, a full implementation cross-review, an
optional go-live audit, and a self-correcting loop that re-plans and re-runs the whole playbook on
anything those gates surface — until the gates are genuinely clean.

The 14 steps map to the Workflow phases: **step 3 → Plan · steps 4–6 → Plan review · steps 7–9 →
Harness plan review · steps 10–11 → Build · step 12 → Impl review · step 13 → Audit · step 14 →
Recurse**. Steps 1, 2, 2.1 are the prompt and the two questions the skill collects up front.

## Phase 1 — Intake (steps 1, 2, 2.1)

The prompt is `$request` (step 1). Ask the two governing questions in a SINGLE `AskUserQuestion`
call (unless `$request` already pins them):

1. **Plan-review harness** (step 2) — which second harness cross-reviews the plan and the
   implementation: `claude`, `codex`, `kiro`, or `none`.
2. **Go-live audit at the end** (step 2.1) — `yes` adds the go-live audit after the build, `no` stops
   at the implementation review.

Then gather the project facts the Workflow needs (do not ask the user — read the repo): `root`
(absolute repo path), `workingBranch` (the current branch to build on — never build on a protected
branch without confirmation), `validate` (the workspace typecheck+lint+test command), and
`hardRules` (the load-bearing invariants from root `CLAUDE.md` / the spec). Open a master `TodoWrite`
mirroring the phases in `references/playbook-state.md`.

**Success criteria**: `harness`, `goLive`, `root`, `workingBranch`, `validate`, and `hardRules` are
all resolved.

## Phase 2 — Run the playbook Workflow (steps 3–14)

If `goLive == yes`, FIRST author the go-live audit so step 13 composes the proven audit rather than a
thin pass: run the **`go-live-audit`** skill to generate the project-tailored audit workflow and
capture the `scriptPath` the Workflow tool persists for it; pass that path in as `auditScriptPath`.
(If you skip this, step 13 falls back to an inline finder pass.)

Then launch `references/workflow-template.js` via the **Workflow** tool, passing intake as `args`:

```
Workflow({ scriptPath: ".../references/workflow-template.js",
           args: { prompt, harness, goLive, root, workingBranch, validate, hardRules, maxRounds,
                   auditScriptPath } })
```

**Pass `args` as a real JSON object, NOT a JSON-encoded string.** A stringified blob reaches the
script as one string, fails its `typeof args === 'object'` check, and every input silently falls to a
`FILL:` placeholder. The script now hard-THROWS on that (and on a `harness` outside
`claude|codex|kiro|none`) instead of returning a fake `converged:true`, so a stringified-args launch
errors loudly — if you hit it, relaunch as a FRESH run (no resume) with `args` as an object.

The Workflow then executes the rest of the playbook, in order, as real phases — there is no step it
skips:

- **Plan (step 3)** — a planning agent follows the plan-to-task-list-with-dag methodology unattended
  (mode auto-selected; EXPANSION-ish round 1, HOLD/REDUCTION on recursion), grounds every path in the
  real repo, assigns a specialist engineer + `-reviewer` + stack skill to each task, writes
  `.ulpi/plans/<name>.md`+`.json`, and returns `{tasks, layers}`.
- **Plan review (steps 4–6)** — native founder review → fix the plan (JSON-first, re-render MD) →
  re-review, until APPROVE / no blocking findings.
- **Harness plan review (steps 7–9)** — if `harness != none`, the selected harness ∥ native founder
  review → fix → repeat until both clean.
- **Build (steps 10–11)** — walk the DAG layers; per task: specialist engineer (worktree, task
  branch) → in-workflow integrate agent (`git merge` onto the working branch) → matched specialist
  reviewer → bounded fix loop until it passes; barrier between layers.
- **Impl review (step 12)** — full implementation review, native ∥ selected harness.
- **Audit (step 13)** — if `goLive`, the playbook COMPOSES the proven `go-live-audit` workflow inline
  via the Workflow `workflow()` hook (`auditScriptPath`) — its gates → finders → dedup → dual-lens
  verify → critic — in parallel with a selected-harness audit lane; findings fold into the register.
- **Recurse (step 14)** — dedup + adversarially verify the findings; if any survive and
  `round < maxRounds`, re-plan them and run the whole playbook again; else stop.

Watch progress via `/workflows`. To iterate on the script, edit the saved `scriptPath` the tool
returns and re-invoke with `{scriptPath}` (and `resumeFromRunId` to reuse cached agent results).

**Success criteria**: The Workflow runs to completion and returns
`{ converged, roundsRun, history, openRegister }`.

## Phase 3 — Report and escalate

Read the Workflow result:

- **First, confirm the run is real — not a false-clean.** If the result has `ranReal: false` (or an
  `aborted` message), `roundsRun` is 0, or `harness` comes back as a `FILL:` string, the inputs never
  reached the script. Report that failure and relaunch (fresh run) with `args` as a real JSON object;
  do NOT treat `converged` as meaningful.
- **`converged: true`** (real run, `openRegister` empty) → DONE. Report the rounds run, the build
  outcome per task, the review/audit verdicts, and where the plans landed.
- **`openRegister` non-empty** (recursion hit `maxRounds`) → STOP and escalate honestly: present the
  remaining BLOCK/CONCERN findings, what each round tried (`history`), and options (raise
  `maxRounds`, hand-fix, accept-with-risk). Never represent this as clean.

**Success criteria**: Either the gates are genuinely clean, or the user is handed an honest list of
what still blocks, with the round budget respected.

## Guardrails

- Do not run proactively; this is explicit-user-only (it spawns many agents across rounds).
- Do not drop or reorder steps — all 14 run; the Workflow owns 3–14, the skill owns 1–2.1.
- Do not hand-roll the plan — the Workflow's plan phase follows the plan-to-task-list-with-dag
  methodology and assigns a specialist agent per task.
- The build MUST assign a specialist agent to every task; `general-purpose` is not an acceptable
  build agent. When a stack skill exists (`/nextjs`, `/laravel`, `/rust`, …), the engineer MUST use it.
- Do not exit a gate with open BLOCK/CONCERN findings, and never fabricate a clean verdict to break
  the loop.
- Do not let the recursion run unbounded; honor `maxRounds`.
- Do not pass secrets/tokens into any agent brief; reference by location, redact values.
- Do not build on a protected branch without explicit confirmation of `workingBranch`.

## When To Load References

- `references/workflow-template.js`
  The runnable Workflow that executes the entire 14-step playbook (plan → founder-review loops →
  specialist build across DAG layers with in-workflow git integration → impl review → go-live audit
  → bounded recursion). Launch it via the Workflow tool with the intake `args`; edit + re-run it to
  iterate.
- `references/build-loop.md`
  The build CONTRACT the build phase implements: MUST-pick-a-specialist pairing, per-stack skill
  enforcement, DAG layering + git integration, and the task-exit gate.
- `references/harness-routing.md`
  How `claude` / `codex` / `kiro` / `none` map to concrete invocations (the `codex:codex-rescue`
  plugin, kiro, native) for plan-review, code-review, and go-live-audit.
- `references/playbook-state.md`
  The state machine, master TodoWrite shape, finding schema + dedup, convergence rules, and the
  `maxRounds` recursion budget.

## Output Contract

Report:

1. intake — selected harness and go-live choice, resolved working branch
2. rounds run and convergence status
3. per-round plan name + build outcome per task (passed / fixes / blocked)
4. implementation review — native + harness findings (confirmed vs rejected)
5. go-live audit — verdict and blockers (or "skipped")
6. final state — clean, or the honest remaining-findings list with the round budget status
