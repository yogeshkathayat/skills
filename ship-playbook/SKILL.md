---
name: ship-playbook
version: 1.13.0
description: |
  Take one feature request and run the entire delivery playbook automatically: plan it, review the
  plan, build it task by task, review the build, and optionally audit it for launch — then return the
  verified findings as feedback (one pass, no autonomous loop; the user decides on any fix round). It
  chains the existing skills as one runnable Workflow:
  plan-to-task-list-with-dag (plan + assign a specialist agent per task) → plan-founder-review →
  a specialist engineer/reviewer build across the DAG → a full claude ∥ codex/kiro cross-review →
  go-live-audit. It FOLLOWS the DAG — every task declares its dependencies, the plan's layers must be a
  topological order, plan review blocks an incomplete/mis-ordered graph, and the build aborts a plan that
  would run a task before its dependencies integrate (never building on a broken base). Per-task review is
  SLICE-SCOPED — it judges only that task's own change against its acceptance criteria and attributes
  whole-codebase end-state gaps to the task that owns them (impl review is the end-state gate), so the
  build isn't drowned in false blocks. Each run writes a live status file at .ulpi/workflows/<id>.json
  (overall + per-phase + per-task), with a bundled journal reader (helpers/wf-status.mjs) for at-a-glance
  status / stop / resume. Up front it shows what skills/agents would help (with install commands), then
  asks which gates to run and at what depth — code writing and each review independently pick native /
  codex / kiro (reviews can skip; writer and reviewer can differ), so the user controls quality vs token
  cost. Use when the user wants "prompt → planned, built, reviewed, audited" in one go
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
1. The Workflow runs ONE pass — plan → plan review → build → impl review → (audit) → verify — and
   RETURNS the verified findings as feedback. It does NOT loop on its own: a Workflow can't ask the
   user mid-run, and an autonomous fix-loop is what caused multi-hour grinds. When findings remain, the
   skill (Phase 3) presents them and the USER decides whether to run a fix round. The Workflow executes
   steps 3–14 as real phases; the skill does the intake (dependency check + prompt + gate questions)
   and feeds the choices in as `args`.
2. Intake order is FIXED: (1) dependency check + continue/restart, then (2) the SEVEN gate questions —
   who writes the plan, who reviews the plan, who writes the code, who reviews the code, impl review,
   go-live audit, map project — then (3) scope grounding + facts. ALWAYS ask the seven gate questions
   FIRST, right after the dependency check. (RESUME exception: when the user points at an existing,
   already-reviewed DAG plan, the first two — plan writer + plan reviewer — are skipped; ask the other
   five and pass the plan in as `planPath`/`plan` so the run starts at build.) NEVER precede them with scope/feature-clarification
   questions ("full platform or just the API?", "which protocol?") — the prompt is the scope; ground it
   in step 3 or let the plan phase challenge it. Honor the gate choices: full rigor or skip both valid.
3. The BUILD is a Workflow phase, not a description. Per task across the DAG layers: the ENGINEER
   implements on a task branch in an isolated worktree, an in-workflow INTEGRATE agent git-merges it
   onto the working branch AND removes each merged worktree, the REVIEWER reviews the integrated state
   (unless `taskReview skip`), and a bounded fix loop runs until the task passes. Engineer routes per
   `buildHarness` and reviewer per `taskReview` — INDEPENDENTLY (each ∈ native / `codex` / `kiro`; the
   writer and reviewer may be different harnesses).
4. The build picks the closest AVAILABLE specialist per task; it falls back to `general-purpose` ONLY
   with the user's consent after the skill notified them a specialist is missing — never silently. When
   a task's stack skill is installed, the engineer MUST use it (`/nextjs`, `/laravel`, `/rust`, …).
   (This applies to the native path; when the user handed building/reviewing to `codex` or `kiro`,
   those tasks route there instead.)
5. Gates that ARE enabled are real — never wave one through or fake a clean verdict to exit. But the
   user controls WHICH gates run: a skipped gate (`planReview skip`, `taskReview skip`, `implReview
   skip`, `goLive no`) is a deliberate choice, not a gate to sneak back in. Warn (don't block) when
   both per-task and impl review are off — nothing checks the build then.
6. There is NO global harness — every role (code writing, plan review, per-task review, impl review)
   independently picks its own executor: `native` (claude / the plan's specialist agent), `codex` (the
   `codex:codex-rescue` plugin), or `kiro` (the kiro path; reviews via `kiro-review`, builds via
   `hand-over-to-kiro`). Writer and reviewers are independent. (See `harness-routing.md`.)
7. There is no autonomous recursion. After one pass, surface the verified findings honestly and let
   the user choose to run a fix round (re-invoke with the findings as the prompt) — NEVER fake a clean
   verdict, and never silently loop.
8. Keep this body focused on launching + reporting the Workflow. Load the build contract, harness
   routing, state machine, and the Workflow script itself from `references/`.
9. Per-task review is SLICE-SCOPED, never an end-state gate. The build lands one slice at a time, so a
   per-task reviewer judges ONLY that task's own writeScope + diff against ITS acceptance criteria — it
   is given the rest of the plan and must attribute an unmet whole-codebase invariant (a legacy path a
   LATER task removes, a route/link a later task adds, an export a later task consumes) to the OWNING
   task as an OBSERVATION, NOT a BLOCK against the current slice. The fix loop only acts on findings
   INSIDE the task's writeScope (the engineer can't fix what it can't touch). The whole-codebase
   end-state is the IMPL-REVIEW gate (step 12) + the FINAL `validate` gate on the integrated tree (run
   ONCE after the build, when the whole suite can pass) — that is the real "is it working software"
   signal, not the per-task blocked count. Per-task integrate is MERGE-ONLY: it does NOT run the
   whole-workspace validate (a whole-suite failure in a half-migrated tree must never become a per-task
   blocker — that loops a clean slice to death).
10. Each run gets a LIVE status file at `<root>/.ulpi/workflows/<workflow-id>.json` — the SKILL creates
    it before launch (this sandboxed Workflow has no FS access), the Workflow updates it at every phase
    + DAG layer via cheap status-writer agents, and the skill reads it back in Phase 3. Status tracking
    is OBSERVABILITY and is NON-FATAL: a failed status write is logged and ignored, NEVER blocking the
    build. The file is the at-a-glance "where did we get to / stop / resume / retry" record.
11. CHECKPOINT RESUME is durable, not cache-based: the build reads the status file and SKIPS every task
    already marked done, rebuilding only the rest — independent of the runtime's agent cache (which any
    template edit invalidates). So on resume, REUSE the prior run's status file; do NOT overwrite it with a
    fresh all-`pending` document (that erases the checkpoint). A task builds only once its `dependsOn` are
    actually INTEGRATED on the working branch (DAG gate) — a task whose dependency never landed is
    `dep_blocked` (pointing at the ROOT), never built on a broken base.
12. GATES FAIL CLOSED — a configured gate that did not actually run is NEVER counted as clean. A died/
    absent/empty reviewer (native/codex/kiro), a died go-live audit, and a RED final workspace validate each
    keep `openRegister` non-empty so `converged` is false. The FINAL `validate` on the integrated tree is
    the load-bearing end-state truth (the "run the full suite on the final branch" gate): slices can each
    pass alone yet break the merged tree, so a non-green final validate blocks regardless of per-task
    verdicts. Report `planReviewRan`/`implReviewRan`/`auditRan`/`workspaceValidatePassed`/`endStateUngated`
    honestly — never present a build with a dead gate or a non-green tree as shippable.
</EXTREMELY-IMPORTANT>

# Ship Playbook

## Inputs

- `$request`: The feature prompt — what to plan, build, review, and ship. May carry overrides like
  `harness=codex` or `golive=yes` to seed intake. For a fix round, pass the prior findings as the prompt.
  To **RESUME** from an existing, already-reviewed DAG plan, point at it (e.g. `resume .ulpi/plans/<name>.md`
  or `--plan .ulpi/plans/<name>.json`): the run skips planning + plan-review and starts at build.

## Goal

Turn one prompt into shipped-quality work the same way every time, by running the delivery playbook
as a single runnable Workflow: a grounded DAG plan, an optional founder plan review, an implementation
built task-by-task across the DAG layers (each task written and reviewed by the executor the user
chose), an optional plan-vs-implementation review, and an optional go-live audit — then it RETURNS the
verified findings as feedback. It runs ONE pass and does not loop on its own; if findings remain, the
user decides whether to run a fix round.

The 14 steps map to the Workflow phases: **step 3 → Plan · steps 4–9 → Plan review (optional, bounded
loop) · steps 10–11 → Build (per-task review optional) · step 12 → Impl review (optional,
plan-vs-implementation) · step 14 → Verify (dedup + adversarial verify → feedback) · step 13 → Audit
(only if `goLive` AND build+impl verified-clean)**. The skill does the intake (dependency check + prompt
+ gate questions) up front. Each review gate runs at the depth the user chose (skip / native / codex /
kiro); there is no automatic recursion — the workflow returns its findings and stops.

## Phase 1 — Intake

### Step 0 — Decide the MODE: new run vs resume (do this FIRST)

The skill runs in one of two modes — detect which before anything else:

- **NEW RUN** (default — the user gives a feature prompt). Run the full intake below (dependency check +
  gate questions + scope grounding), create a FRESH status file, and launch with full `args`.
- **RESUME a previous run** (the user says "resume", "continue the build", gives a `wf_…` runId, or points
  at an existing `.ulpi/workflows/<id>.json`). Do NOT re-run intake and do NOT overwrite the status file.
  Instead, from the repo root run **`node <skill-dir>/helpers/wf-status.mjs --resume [<runId>]`** — it reads
  the run's status file and prints the exact `Workflow({ scriptPath, args })` to relaunch, already carrying
  `planPath` (skip re-planning), `checkpointResume:true` (skip tasks already done), and the same
  `statusFile`. Launch that verbatim. The durable checkpoint makes resume session-independent (no
  `resumeFromRunId`); the build rebuilds only what's left. (If `--resume` warns that `launchArgs` is
  missing — a pre-v1.7.0 run — supply the missing `validate`/`hardRules`; run `--write` first if there's no
  status file yet.) Then skip to Phase 3 reporting when it returns.

The rest of Phase 1 is the NEW-RUN path.

### Step 1 — Dependency check & setup (do this FIRST)

Before anything else, tell the user what would make this skill do its BEST work, what's already here,
and what's missing — with copy-paste install commands. ship-playbook composes other skills and routes
to specialist agents; the more of these are installed, the better the result.

**How to detect — THREE states, not two.** A skill is only loaded into your available-skills list (and
an agent into your `subagent_type` options) at Claude STARTUP, so "installed on disk" ≠ "usable this
session". Classify each item:

- **Ready** — in your loaded available-skills list / `subagent_type` options. Usable now. Don't list it.
- **Installed, needs restart** — NOT in the loaded list, but present on disk. Check disk
  **symlink-aware** (skills register as symlinks into a shared store, e.g.
  `.claude/skills/map-project → ../../.agents/skills/map-project`): use `ls -laL .claude/skills/<name>`
  or `test -e .claude/skills/<name>` (follows symlinks) — NOT `find -type d` (silently misses symlinks).
  Report these as "installed — RESTART Claude to load", with NO install command (it's already installed).
- **Missing** — not in the loaded list and not on disk. Show the full install command.

The loaded list is the source of truth for what's USABLE now; the symlink-aware disk check only
distinguishes "installed but not loaded (restart)" from "truly missing", so an installed-but-not-yet-
loaded skill is never mislabeled plain "missing". Sanity check: if you'd report an obviously-present
skill (one you just used) as missing, your method is broken. Disk/PATH probing for the external
`kiro-cli` binary is separate (see below).

Detect the project's stack(s), then check (against those loaded lists) what's present vs missing across:

- **Composed skills** — `plan-to-task-list-with-dag`, `plan-founder-review`, `go-live-audit`,
  `map-project` / `map-project-monorepo`.
- **Specialist agents for this stack** — the engineer + reviewer pairs the build would assign. The
  reviewer name is the FULL engineer name + `-reviewer` (NOT an abbreviation): e.g.
  `nextjs-senior-engineer` + `nextjs-senior-engineer-reviewer`; `go-senior-engineer` +
  `go-senior-engineer-reviewer`; `laravel-senior-engineer` + `laravel-senior-engineer-reviewer`. Use the
  exact registered names — never shorten to `nextjs-reviewer`/`go-reviewer`. Missing ones force
  `general-purpose`, which is lower quality.
- **Stack skills** — `/nextjs`, `/laravel`, `/rust`, … for the detected stack.
- **Optional harness tooling** (only if the user might pick codex/kiro): the **codex** plugin
  (`codex:codex-rescue`); for **kiro**, the CLI plus the `kiro-review` skill (reviewing) and
  `hand-over-to-kiro` skill (building). **Detecting the kiro CLI — two gotchas:**
  - The binary is named **`kiro-cli`, NOT `kiro`** (bare `kiro` is usually the Kiro IDE symlink, not the
    CLI). Check `kiro-cli`.
  - It's commonly in `~/.local/bin`, which the sandboxed Bash PATH may NOT include — so `command -v
    kiro-cli` can come back empty even when it's installed. Detect with a location-tolerant check, e.g.
    `command -v kiro-cli || ls ~/.local/bin/kiro-cli ~/.kiro/bin/kiro-cli /usr/local/bin/kiro-cli 2>/dev/null`,
    and confirm it runs (`kiro-cli --version`). Docs: <https://kiro.dev/docs/cli>.

Present **TWO separate tables** — one for skills, one for agents — listing only items that are NOT
ready (i.e. "missing" OR "installed, needs restart"). Do NOT list ready items at all (no "present /
ready" section). Each row shows the item, its state, and the action:

- **state = installed, needs restart** → action: "Restart Claude to load" (NO install command — it's
  already on disk).
- **state = missing** → action: the **full, copy-paste install command**:
  - skills → `npx skills add https://github.com/ulpi-io/skills --skill <name>` (composed skills, stack
    skills, kiro helpers `kiro-review`/`hand-over-to-kiro`; `kiro-cli` itself → its docs link
    <https://kiro.dev/docs/cli>);
  - agents → `npx agentshq add ulpi-io/agents@<agent-name>`, using the EXACT registered name per row —
    e.g. `…@nextjs-senior-engineer` and `…@nextjs-senior-engineer-reviewer` (the reviewer is the full
    engineer name + `-reviewer`, never `…@nextjs-reviewer`).

If a table has no not-ready items, omit it entirely. Then **offer two choices** with `AskUserQuestion`:

- **Continue now** with what's installed (missing specialists fall back to `general-purpose`; missing
  harness options simply won't be offered).
- **I'll install them — restart** : the user installs the listed items, then RESTARTS Claude (newly
  installed skills/agents are only loaded at startup) and re-runs `/ship-playbook`. Tell them to come
  back and re-invoke after restarting.

Record what's available — it feeds `availableAgents` and constrains which intake options you offer.

### Step 2 — The workflow gate questions (ask these FIRST)

The prompt is `$request`. Ask the SEVEN gate questions (across two `AskUserQuestion` calls — up to 4
each), in EXECUTION order so they read like the run, unless `$request` already pins them.

**RESUME mode.** If `$request` points at an existing reviewed plan (a `.ulpi/plans/<name>` path, or the
user asks to resume), the run starts at BUILD: **skip gate questions 1 (who writes the plan) and 2 (who
reviews it)** — both are already done — and ask only the remaining five (code writer, code reviewer,
impl review, go-live, map). Read the plan's `.json` and confirm it is well-formed (tasks[] with id /
agent / writeScope / validate, and layers[][]) before proceeding; if it is malformed or stale, say so
and offer to (re)plan instead of resuming.

**These gate questions come FIRST — immediately after the dependency check (Step 1).** Do NOT precede
them with scope/feature-clarification questions ("full platform or just the API?", "which SSO
protocol?", etc.). The prompt IS the scope; if it's broad or ambiguous, you ground it in Step 3 (AFTER
these gates) or let the plan phase challenge scope during planning — never with a question round before
the gates. The user expects the workflow configuration first.

**Every role independently picks its executor** (each write and each review is separate — write with
codex, review with kiro is fine). Only offer `codex`/`kiro` for roles whose tooling Step 1 found
installed. Defaults are LIGHT to control token cost; the user can dial each up to full rigor or skip.

**Option ordering rule:** list `native` first (mark it Recommended/default), then `codex`, then
`kiro`, and put **`skip` as the LAST option you provide** (it then renders second-to-last, right before
the auto-added "Other"). Plan writing and code writing are NOT skippable (they must happen); the four
optional gates (plan review, code review, impl review, go-live audit, map) each include `skip`.

1. **Who WRITES the plan** — the DAG decomposition: `native` (plan-to-task-list-with-dag — default),
   `codex`, or `kiro`. Passed as `planHarness`. (No skip — the plan must be written.)
2. **Who REVIEWS the plan** — founder review (scope, decomposition, phantom paths): `native` (default),
   `codex`, `kiro`, or `skip`. Passed as `planReview`.
3. **Who WRITES the code** — every task + its fixes: `native` (the plan's specialist engineer agents —
   default), `codex`, or `kiro`. Passed as `buildHarness`. (No skip.)
4. **Who REVIEWS the code** — each built task in the build loop: `native` (the matched `-reviewer` —
   default), `codex`, `kiro`, or `skip` (no per-task reviewer or fix loop — biggest token save). Passed
   as `taskReview`.
5. **Implementation review after all tasks** — the plan-vs-implementation review: `native` (default),
   `codex`, `kiro`, or `skip`. Passed as `implReview`.
6. **Run the go-live audit** — `run` (the go-live audit, only fires if build+impl come back
   verified-clean) or `skip` (default). Passed as `goLive` (run → true).
7. **Run map-project at the end** — `map-project`, `map-project-monorepo`, or `skip` (default). Detect
   the repo layout and recommend the matching variant. Held as `mapRefresh` — this is NOT a Workflow arg
   (it isn't in the `args` object); the SKILL runs the chosen map skill itself in Phase 3, after the
   Workflow returns, on a real (non-aborted) run.

**Defaults** (light, kept safe): `planHarness native`, `planReview native`, `buildHarness native`,
`taskReview native`, `implReview native`, `goLive skip`, map `skip`. The user can go **full swing**
(every review on, codex/kiro where wanted, go-live on), **delegate writing and reviewing to harnesses**
(any write/review role → codex|kiro — and the writer and reviewer may be DIFFERENT harnesses), or go
fast (skip the reviews). **Warn (do not block)** if BOTH `taskReview skip` AND `implReview skip`:
nothing then checks the build, so a clean verdict only means the engineer validates passed.

### Step 3 — Scope grounding, project facts, git preflight, agent list

**Now (AFTER the gate questions) ground the scope.** Read the repo to understand what exists. If
`$request` is broad or ambiguous (e.g. "a self-hostable SaaS platform with SSO"), narrow it HERE: prefer
inferring scope from the repo, and only ask focused scope questions if you genuinely cannot proceed —
or pass the broad prompt through and let the plan phase challenge scope. Fold the resolved scope into
the `prompt` you pass in `args`.

Gather the facts the Workflow needs (do not ask the user — read the repo): `root` (absolute repo path),
`workingBranch` (never build on a protected branch without confirmation), `validate` (the workspace
typecheck+lint+test command), and `hardRules` (the load-bearing invariants from root `CLAUDE.md` / the spec).

**Verify `root` is a git work tree** — `git -C <root> rev-parse --is-inside-work-tree` must print `true`,
and `workingBranch` must exist with at least one commit. The build creates and merges task branches, so
a non-git folder (or a branch with no commit) cannot be built. If `root` is not a git repo, STOP and
tell the user — offer `git init` + a baseline commit, or correct the path — and do not launch.

Pass `availableAgents` (the specialist engineer + `-reviewer` names that exist here, from Step 1) and
`allowGeneralFallback` (`true` only if the user chose Continue with gaps) into the Workflow `args`. The
plan then assigns ONLY agents from that list (it can't invent one that isn't installed); the Workflow
returns `missingAgents` for anything that still slips through. Never silently substitute
`general-purpose` for a missing specialist without the user having seen the gap in Step 1.

**When RESUMING from an existing plan**, also resolve the plan here: read `.ulpi/plans/<name>.json`
(the `.md` renders from it), validate the DAG shape (tasks[] with id / agent / writeScope / validate,
acyclic layers[][]), and pass `planPath` (the path) — or the parsed `plan` object — in `args`. Do NOT
re-plan. The Workflow loads/validates it and skips both the plan and plan-review phases. If the plan is
missing or malformed, stop and offer to (re)plan instead.

Open a master `TodoWrite` mirroring the phases in `references/playbook-state.md`.

**Success criteria**: dependency status was shown and the user chose continue-or-restart;
`planHarness`, `planReview`, `buildHarness`, `taskReview`, `implReview`, `goLive`, `mapRefresh`, `root`
(a confirmed git work tree), `workingBranch`, `validate`, `hardRules`, and `availableAgents`
(+ `allowGeneralFallback` if gaps) are all resolved.

## Phase 2 — Run the playbook Workflow (steps 3–14)

If `goLive == yes`, FIRST author the go-live audit so step 13 composes the proven audit rather than a
thin pass: run the **`go-live-audit`** skill to generate the project-tailored audit workflow and
capture the `scriptPath` the Workflow tool persists for it; pass that path in as `auditScriptPath`.
(If you skip this, step 13 falls back to an inline finder pass.)

**First, create the live status file** (the Workflow sandbox has no filesystem access, so the SKILL must
create it). Pick a `workflowId` — `ship-<UTC timestamp>-<short-slug-of-the-prompt>` (e.g. via Bash
`date -u +%Y%m%dT%H%M%SZ`) — set `statusFile = <root>/.ulpi/workflows/<workflowId>.json` (ABSOLUTE), and
`Write` the initial document so a watcher sees the run the instant it launches.

**RESUME — do NOT clobber an existing status file.** The build now does CHECKPOINT RESUME: it reads the
status file and SKIPS every task already marked done (`passed`/`integrated`/`reviewing`/`fixing`/`blocked`),
rebuilding only the rest. So when resuming a prior run, REUSE its existing `<root>/.ulpi/workflows/<id>.json`
(pass that same `workflowId`/`statusFile`) — do NOT overwrite it with a fresh all-`pending` document, or the
checkpoint is lost and everything rebuilds. Only `Write` the initial document for a brand-NEW run.

```json
{ "schemaVersion": 1, "workflowId": "<id>", "skill": "ship-playbook", "status": "initializing",
  "prompt": "<prompt>", "root": "<root>", "workingBranch": "<branch>", "createdAt": "<UTC now>",
  "config": { "planHarness": "...", "planReview": "...", "buildHarness": "...", "taskReview": "...",
              "implReview": "...", "goLive": false },
  "plan": null,
  "phases": { "plan": {"status":"pending"}, "plan_review": {"status":"pending"},
              "build": {"status":"pending"}, "impl_review": {"status":"pending"},
              "verify": {"status":"pending"}, "audit": {"status":"pending"} },
  "tasks": {}, "openRegister": [], "result": null }
```

Then launch `references/workflow-template.js` via the **Workflow** tool, passing intake as `args`:

```
Workflow({ scriptPath: ".../references/workflow-template.js",
           args: { prompt, root, workingBranch, validate, hardRules, goLive,
                   planHarness, planReview, buildHarness, taskReview, implReview,
                   auditScriptPath, availableAgents, allowGeneralFallback, warmWorktree,
                   planPath, kiroModel,
                   workflowId, statusFile, trackStatus, checkpointResume } })   // planPath → RESUME at build;
                                                              // workflowId/statusFile → live .ulpi/workflows/<id>.json
                                                              // (trackStatus:false disables); checkpointResume:false →
                                                              // force a full rebuild (default true: skip done tasks);
                                                              // warmWorktree:false → plain per-worktree install
                                                              // (default true: CoW-seed node_modules/vendor/Pods + sccache)
```

**After launch, stamp the run id AND the full launch args.** The Workflow tool returns a `runId` (`wf_…`)
immediately (it runs in the background). Write `runId`, `status:"running"`, and — critically — the COMPLETE
`launchArgs` (the exact `args` object you just passed: prompt, root, workingBranch, validate, hardRules,
all harnesses, goLive, …) into the status file via Bash+jq:
`jq --argjson la '<the args object>' '. + {runId:"<runId>", status:"running", launchArgs:$la}'`
This makes the status file a **self-describing, deterministic resume source** — `wf-status.mjs --resume`
reads `launchArgs` back verbatim so a resume re-fires the identical config (no hand-assembly, no drift).

**Resuming a previous run? Use `wf-status.mjs --resume` — do NOT hand-assemble args.** From the repo root:
`node <skill-dir>/helpers/wf-status.mjs --resume [<runId>]` reads the run's status file and prints the exact
`Workflow({ scriptPath, args })` to relaunch — already carrying `planPath` (skip re-planning),
`checkpointResume:true` (skip tasks already done), and the same `statusFile`. Launch that verbatim. The
durable status-file checkpoint makes resume **session-independent** — no `resumeFromRunId` needed. (If the
run predates v1.7.0 / has no `launchArgs`, `--resume` warns and you supply the missing `validate`/`hardRules`;
`--write [<runId>]` first backfills a status file from the journal.)

`mapRefresh` is deliberately NOT in `args` — it's the only intake answer the Workflow doesn't run.
The map refresh regenerates `CLAUDE.md` from the FINISHED code, so the skill runs it itself in Phase 3
after the Workflow returns (see Q7). All other gate answers go in `args` above.

**Pass `args` as a real JSON object, NOT a JSON-encoded string.** A stringified blob reaches the
script as one string, fails its `typeof args === 'object'` check, and every input silently falls to a
`FILL:` placeholder. The script hard-THROWS on that instead of returning a fake `converged:true`, so a
stringified-args launch errors loudly — if you hit it, relaunch as a FRESH run (no resume) with `args`
as an object. (Each role arg coerces to a safe default if invalid, so a typo degrades gracefully.)

The Workflow then executes the playbook in one pass, running each gate at the level the user chose:

- **Plan (step 3)** — the planner (per `planHarness`: native / codex / kiro) follows the
  plan-to-task-list-with-dag methodology unattended (mode auto-selected), grounds every path in the
  real repo, assigns a specialist engineer + `-reviewer` + stack skill to each task, writes
  `.ulpi/plans/<name>.md`+`.json`, returns `{tasks, layers}`. **RESUME:** when `planPath`/`plan` is
  supplied, this phase instead LOADS that already-reviewed plan (an agent reads + validates + normalizes
  it; no re-planning) and **plan review is skipped** — the run resumes at build.
- **Plan review (steps 4–9)** — reviewer per `planReview` (`skip` / `native` / `codex` / `kiro`). ONE
  bounded loop → fix the plan (JSON-first, re-render MD; fix is always native) → re-review; exits on no
  BLOCK/CONCERN (OBSERVATIONs never block) OR non-convergence, capped at `MAX_REVIEW` (2).
- **Build (steps 10–11)** — walk the DAG layers; per task: engineer (worktree, task branch) →
  in-workflow integrate agent (`git merge` onto the working branch, removing each merged worktree as it
  goes) → reviewer (unless `taskReview skip`) → bounded fix loop until it passes; barrier between layers.
  Each fresh worktree is **provisioned fast** (`warmWorktree`, default on): a one-time warm step (overlapping
  planning) primes caches, then engineers CoW-clone `node_modules`/`vendor`/`Pods` from the primary checkout
  when the lockfile is unchanged (Rust shares crate compilation via `sccache` instead of cloning `target/`),
  falling back to a normal frozen install; `warmWorktree:false` restores a plain per-worktree install.
  Engineer routes per `buildHarness`; reviewer per `taskReview` — and the two are INDEPENDENT (write
  codex, review kiro is fine). The build and verify fan-outs run behind concurrency gates so a wide DAG
  layer or a long findings list can't trip Claude's API rate limits: at most `MAX_BUILD_PARALLEL` (4)
  worktree engineers and `MAX_PARALLEL` (6) reviewers/verifiers run at once. Total agent count is
  unchanged — only how many run simultaneously is bounded. Tune those two constants in
  `references/workflow-template.js` if you hit 429s (lower) or have a high-limit account (raise); never
  set them to 1–2. If an agent is still rate-limited despite the caps (returns empty / cut off
  mid-flight), it is **retried with exponential backoff** (`RETRY_DELAYS`, up to 4 attempts) before
  being recorded as blocked — so a rate-limit storm no longer turns into false "blocked task" noise.
- **Impl review (step 12)** — reviewer per `implReview` (`skip` / `native` / `codex` / `kiro`). The
  plan-vs-implementation review of everything built.
- **Verify (step 14)** — dedup + adversarially verify the build+impl findings. These become the
  returned `openRegister` — the feedback. No automatic re-plan/re-build; the workflow returns and stops.
- **Audit (step 13)** — runs only when `goLive` AND build+impl come back verified-clean: COMPOSE the
  proven `go-live-audit` workflow inline via the `workflow()` hook (`auditScriptPath`) — gates →
  finders → dedup → dual-lens verify → critic — ∥ a second-harness audit lane; its findings become
  `openRegister`.

Watch progress three ways: the `/workflows` panel (live agent tree), the **status file**
(`cat <root>/.ulpi/workflows/<id>.json` — overall status, per-phase, per-task), or the bundled reader
`node <skill-dir>/helpers/wf-status.mjs` (reconstructs per-task status straight from the run's journal —
works even mid-flight and even if status tracking is off). See `references/status-tracking.md`. To iterate
on the script, edit the saved `scriptPath` the tool returns and re-invoke with `{scriptPath}` (and
`resumeFromRunId` to reuse cached agent results). **On any resume, re-pass the SAME `args` object** —
`resumeFromRunId` reuses cached *agent* results but the script re-executes from the top, so omitting `args`
empties `CFG` and the script hard-throws on the `FILL:` guard. Always include the full `args` object you
launched with (including `workflowId`/`statusFile`).

**Success criteria**: The Workflow runs to completion and returns
`{ converged, ranReal, plan, planSupplied, build, openRegister, missingAgents, reviewConfig, noReviewGate,
planReviewRan, implReviewRan, auditRan, workspaceValidatePassed, endStateUngated, blockedTaskCount,
workflowId, statusFile }`.

## Phase 3 — Report and escalate

Read the Workflow result:

- **First, confirm the run is real — not a false-clean.** If the result has `ranReal: false` (or an
  `aborted` message), the inputs never reached the script (or a preflight failed). Report that failure
  and relaunch (fresh run) with `args` as a real JSON object; do NOT treat `converged` as meaningful.
- **If `missingAgents` is non-empty**, some tasks ran on `general-purpose` because the assigned
  specialist isn't installed here. Surface the list (which agents, how to install) so the user can
  decide whether to install them and re-run for higher-quality output.
- **If `noReviewGate: true`** (the user skipped BOTH per-task review and impl review), CAVEAT any
  clean verdict: it only means the engineer validates passed, nothing reviewed the build. Report
  `reviewConfig` so the user sees which gates ran.
- **Gate honesty — a configured gate that did NOT actually run is never "clean".** The Workflow already
  keeps `openRegister` non-empty (so `converged` is false) when a gate died, but report the cause so the
  user knows WHY: `planReviewRan === false` / `implReviewRan === false` → the configured plan/impl reviewer
  couldn't run (e.g. kiro CLI absent); `auditRan === false` → the go-live audit died (launch NOT confirmed);
  `workspaceValidatePassed === false` → the final `validate` on the integrated tree is RED (it does not
  typecheck/lint/test — the most load-bearing blocker). `endStateUngated === true` (impl review skipped) →
  CAVEAT that the whole-codebase semantic end-state was never gated even if the tree compiles.
- **`blockedTaskCount > 0`** → that many tasks did not pass (engineer-failed, review-blocked, or
  `dep_blocked` because an upstream dependency never integrated — a `blocked on dependency <X>` reason
  points at the ROOT). These are in `openRegister`; surface them with their reasons.
- **Pre-existing-failure attribution.** A `build[]` entry may carry a `preexistingNote` — its slice is
  correct and was integrated, but its validate was red ONLY from pre-existing / out-of-scope failures it
  doesn't own (the build no longer discards such correct work; the engineer self-classifies new-vs-pre-existing
  against the base). And when `workspaceValidatePassed === false`, the `workspace-validate` marker now
  distinguishes failures INTRODUCED by this run (the real blockers) from ones PRE-EXISTING on the base (need a
  separate owning task — not caused by this run), with a per-step `[steps: typecheck=pass, lint=FAIL, …]`
  breakdown. Surface this split so the user fixes the right thing and a green-slice build whose tree is red
  from inherited breakage is read correctly (work preserved + real cause named), not as "the build broke it."
- **If `planSupplied: true`**, the run RESUMED from a pre-reviewed plan: planning and plan-review were
  skipped by design — say so, so a clean verdict isn't misread as "the plan went unreviewed."
- **`converged: true`** (real run, `openRegister` empty) → DONE. Report the build outcome per task,
  the review/audit verdicts (per `reviewConfig`), and where the plan landed.
- **`openRegister` non-empty** → PRESENT the feedback and let the user decide. List the verified
  BLOCK/CONCERN findings (file:line, issue, suggested fix, which gate found them). Then offer the next
  move: **run a fix round** (re-invoke the workflow with the findings as the prompt — same intake),
  **hand-fix**, or **accept-with-risk**. The workflow does not loop on its own; never represent open
  findings as clean.

The Workflow already wrote the final state into `<root>/.ulpi/workflows/<id>.json` (`status` =
`done`/`needs_fix`/`aborted`, per-task outcome, `openRegister`). Read it to enrich the report and tell the
user where it lives — it is the durable record of this run. If a run died mid-flight (no final write),
refresh the file from the journal with `node <skill-dir>/helpers/wf-status.mjs --write` before reporting.

**Live status, stop & resume** — three verbs, all backed by the status file + run journal:
- **status** → `cat <root>/.ulpi/workflows/<id>.json` (or `node <skill-dir>/helpers/wf-status.mjs`) — at a
  glance: overall status, which phase, and each task's state (pending → in_progress → dev_done →
  integrated → passed/blocked).
- **stop** → `TaskStop` the run, or the `/workflows` panel. Nothing is lost — the journal caches every
  finished agent.
- **resume** → re-invoke `Workflow({ scriptPath, resumeFromRunId: "<runId>", args: {…same args…} })`
  (the `resume` command is stored in the status file). Cached agents return instantly; only
  unfinished/conflicted tasks re-run. Re-pass `workflowId`/`statusFile` so it keeps the same file.

**A run launched before v1.5.0 (no status file)?** Backfill one from its journal:
`node <skill-dir>/helpers/wf-status.mjs --write [<runId>]` — recovers the plan, branch, task list + status,
and conflicts. The journal has no launch args, so add `--args '{…gate config + validate…}'` (which only the
launching session knows) to complete the `resume` recipe. See `references/status-tracking.md`.

**Then, if the user chose a project-map refresh at intake AND the run was real (`ranReal`, not
aborted), run it last** — invoke the chosen skill (`map-project` or `map-project-monorepo`) so the
`CLAUDE.md` context map reflects the code the build just landed. Skip it on an aborted/false-clean run
(there's nothing new to map). This is the final step, after reporting.

**Success criteria**: Either the enabled gates are genuinely clean (caveated by `reviewConfig` /
`noReviewGate`), or the user is handed an honest list of what still blocks plus next moves; the durable
status file reflects the final state; and the project map is refreshed if requested.

## Guardrails

- Do not run proactively; this is explicit-user-only (it spawns many agents across rounds).
- The workflow runs ONE pass and never loops on its own; a fix round is a deliberate user choice
  (re-invoke with the findings as the prompt). Review gates are user-selected per run — honor the
  user's `planReview`/`taskReview`/`implReview` choices, and warn (don't block) when both per-task and
  impl review are skipped. The Workflow owns steps 3–14; the skill owns intake (dependency check +
  questions) and the Phase-3 report.
- Do not hand-roll the plan — the Workflow's plan phase follows the plan-to-task-list-with-dag
  methodology and assigns a specialist agent per task.
- The build assigns the closest AVAILABLE specialist per task; fall back to `general-purpose` only with
  the user's consent after notifying them a specialist is missing (never silently). When a stack skill
  is installed, the engineer MUST use it (`/nextjs`, `/laravel`, `/rust`, …).
- Never fabricate a clean verdict — open BLOCK/CONCERN findings are returned as feedback, not hidden.
- The workflow runs ONE pass and never loops on its own; a fix round is a deliberate user choice
  (re-invoke with the findings as the prompt). Do not re-introduce autonomous recursion.
- Do not pass secrets/tokens into any agent brief; reference by location, redact values.
- Do not build on a protected branch without explicit confirmation of `workingBranch`.
- Do not launch the build in a non-git folder or an empty repo — the build creates and merges task
  branches, so it requires a git work tree with a committed `workingBranch`.
- Keep build worktrees from poisoning the gate: the workflow prunes its `.claude/worktrees/` build
  checkouts (at preflight, after each integrate, and at end), and the integrate validate must never
  scan `.claude/worktrees/**` or sibling agent dirs. If a run's gate fails on files outside the task's
  scope, suspect leftover worktrees before suspecting the code.
- Follow the DAG; never build a task before its dependencies are integrated. The build integrates
  layer-by-layer with a barrier, so correctness depends on the PLAN ordering tasks properly: every task's
  `dependsOn` must be complete and `layers` must be a topological order (each task strictly after all it
  depends on). The plan phase sets `dependsOn`, plan review BLOCKs an incomplete/mis-ordered graph, and
  the build's `validatePlan` ABORTS a plan whose layers violate `dependsOn` rather than building on a
  broken base. A task that needs another's output (catalog/registry row, migration, route, exported
  symbol, a test another task grows) and would run first is a PLAN defect — fix the ordering, never paper
  over it with a runtime retry. If two pieces can't each validate independently, they must be ONE task.
  Each task's `validate` must be slice-scoped (greenable once that slice + its deps integrate), never a
  whole-suite e2e that only passes at end-state.
- Per-task review is slice-scoped, not an end-state gate: a per-task BLOCK is valid only for a defect
  INSIDE that task's writeScope. An unmet whole-codebase invariant a LATER task owns (legacy path not yet
  removed, route/link/consumer not yet built) is an OBSERVATION attributed to that task — never a blocker
  on the current slice, and never fed to the fix loop. The end-state is enforced by impl review (step 12)
  + the integrate workspace validate. When triaging a noisy "blocked task" count, check whether the
  blocks are end-state gaps owned elsewhere before treating the slice as broken.
- Status tracking is non-fatal observability: a failed `.ulpi/workflows/<id>.json` write is logged and
  ignored, never blocking the build. Never gate delivery on a status write, and never report a run as
  failed solely because its status file is stale — reconstruct from the journal (`wf-status.mjs`) instead.

## When To Load References

- `references/workflow-template.js`
  The runnable Workflow that executes the playbook in one pass (plan → bounded plan review →
  specialist build across DAG layers with in-workflow git integration → impl review → verify →
  go-live audit) and returns the verified findings. Launch it via the Workflow tool with the intake
  `args`; edit + re-run it to iterate.
- `references/build-loop.md`
  The build CONTRACT the build phase implements: MUST-pick-a-specialist pairing, per-stack skill
  enforcement, DAG layering + git integration, and the task-exit gate.
- `references/harness-routing.md`
  How `claude` / `codex` / `kiro` / `none` map to concrete invocations (the `codex:codex-rescue`
  plugin, kiro, native) for plan-review, code-review, and go-live-audit.
- `references/playbook-state.md`
  The single-pass state machine, master TodoWrite shape, finding schema + dedup, the Verify phase, and
  the clean-vs-feedback decision (fix rounds are user-driven, not automatic).
- `references/status-tracking.md`
  The live status file (`.ulpi/workflows/<id>.json`) schema + lifecycle, who writes it when, the three
  verbs (status / stop / resume), and the `helpers/wf-status.mjs` journal reader. Load when wiring the
  launch/report status writes or debugging a run's progress.

## Output Contract

Report:

1. intake — the review config used (`reviewConfig`: harness + which gates ran at what depth), go-live
   choice, resolved working branch
2. plan name + build outcome per task (passed / fixes / blocked)
3. plan review and implementation review — findings by enabled gate (confirmed vs rejected), or "skipped"
4. go-live audit — verdict and blockers (or "skipped")
5. final state — clean (caveated if `noReviewGate`), or the honest remaining-findings list + next moves
