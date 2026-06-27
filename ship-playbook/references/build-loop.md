# Build loop — the contract the Build phase implements (steps 10–11)

This is the contract the **Build phase of the playbook Workflow** (`workflow-template.js`)
implements. For every task in the approved DAG, one specialist ENGINEER agent implements (in an
isolated worktree on a task branch) and the matched specialist REVIEWER agent reviews; findings go
back to the engineer; repeat until the task passes. Between the two an in-workflow INTEGRATE agent
`git merge`s the task branch onto the working branch (a Workflow agent has Bash, so the git
integration runs inside the Workflow). The loop walks the DAG layer by layer with a barrier between
layers, so layer N is integrated before layer N+1 builds on it. The sections below are the rules
each of those agents is briefed with.

## Inputs from the plan JSON

- `tasks[]` — each with `id`, `Agent`, `description`, `writeScope`, `acceptanceCriteria`,
  `validateCommand`, and `review` (the harness for that task's review, usually the selected one).
- `dependencyMap` — the edges.
- `executionSummary.parallelLayers` — the ordered layers (parallel within a layer).

> These are the upstream `plan-to-task-list-with-dag` field names. The runnable
> `workflow-template.js` re-maps them to its own PLAN schema — `agent`, `reviewer`, `acceptance`,
> `validate`, `stackSkill`, and a flat `layers[][]` — and its `planBrief` instructs the planning
> agent to emit that shape. Same contract, lowercased; edit the schema in `workflow-template.js`,
> not this prose, if the fields change.

## Follow the DAG — dependencies decide layering (do NOT retry around it)

The build integrates **layer-by-layer with a barrier**, so a task only ever sees its dependencies if the
PLAN placed them in an earlier layer. This makes dependency ordering load-bearing, not advisory:

- Every task carries `dependsOn` = the ids of tasks whose output it needs (a migration/table, a
  catalog/registry row, a route or link target, an exported symbol it imports, a fixture, or a locked
  test another task grows).
- `layers[][]` MUST be a **topological order** of `dependsOn`: a task appears strictly AFTER everything it
  depends on. The build's `validatePlan` **aborts** a plan whose layers violate this (e.g. `TASK-053`
  scheduled in the same/earlier layer than the `TASK-015` catalog rows + `TASK-054` registry test it
  needs) — it refuses to build on a base where required upstream isn't integrated, rather than letting the
  engineer fail with "required upstream not integrated" and then thrashing.
- Each task's `validate` is **slice-scoped** — greenable once that slice plus its declared deps integrate,
  never a whole-suite/e2e that only passes at end-state.
- If two pieces **cannot each validate independently** (a registry and the locked test that asserts that
  exact registry mutually block), they are ONE unit — the plan must merge them, not split them.

The correct fix for a build task blocked on un-integrated upstream is to fix the **plan** (its `dependsOn`
edges / layer order), caught by plan review and enforced by `validatePlan` — NOT a runtime retry that
papers over a mis-ordered DAG.

At RUNTIME the build also enforces this directly: it tracks which tasks' code is actually integrated on the
working branch, and a task only builds once EVERY `dependsOn` is in that set. A task whose dependency
failed/never-merged is recorded `dep_blocked` (its dependents cascade-block) — one clear root cause, not a
scatter of failures. A task whose engineer passed but whose merge did NOT land is `dev_done` (code on its
branch only) and rebuilds on resume; neither `dep_blocked` nor `dev_done` seeds the dependency gate.

## Checkpoint resume + the final validate gate

Resume is **status-file driven**, not cache-based: the build reads `.ulpi/workflows/<id>.json` and skips
every task already `passed` (skip engineer + review) or on-branch (`integrated`/`reviewing`/`fixing`/
`blocked` — skip the engineer, re-review with the current reviewer); everything else rebuilds. This is
durable across template edits (the runtime agent cache is not).

After the build, a **final `VALIDATE_ALL` gate** runs once on the integrated working branch (checking out
`WORKING_BRANCH` first; excluding `.claude/worktrees/**`). It is the objective end-state truth and is
resume-safe by construction (runs even when every task was checkpoint-skipped). A non-green result blocks
convergence even if every per-task review was clean — because slices can each pass their own validate yet
break the merged tree, and the static reviewers can't catch a cross-file failure. Every gate **fails
closed**: a died/absent/empty reviewer, a died go-live audit, or a RED final validate is never counted
clean (`openRegister` stays non-empty), and the run reports which gate did/did not run.

## Per-task pipeline within a layer (NOT a per-layer batch)

Each task is its own **unit**: `build → integrate → review → fix-loop`. A layer's tasks run that unit
**concurrently** (pipelined), so a task's review fires the moment THAT task integrates — not batched after
the whole layer builds. Between layers there is a BARRIER (the `await` over the layer's units): every task
in layer N must integrate before layer N+1 starts, because later layers depend on earlier code (the DAG).

```
for layer in parallelLayers:
    run, concurrently, one unit per task:
        runTask(t) = build(t, isolated worktree)
                   → integrate(t)   # git-merge t's branch onto the working branch, under the MERGE LOCK
                   → review(t)      # slice-scoped, read-only
                   → fix-loop(t)    # only on IN-SCOPE blockers, bounded by MAX_FIX
    await all units   ← LAYER BARRIER (every task integrated before the next layer)
```

Concurrency: builds and reviews run in parallel (gated by `MAX_BUILD_PARALLEL` / `MAX_PARALLEL`); only the
git **merge** step serializes, via a single-slot **merge lock** (`mergeLock`) — two `git merge`s onto the
shared working branch would race. The merge is seconds; the expensive build/review work stays parallel.

**Integrate is merge-only.** A per-task integrate just merges + removes the worktree — it does NOT re-run
the whole-workspace `VALIDATE_ALL` (that would mean a full typecheck/lint/test *per task*, and in a
half-migrated tree the whole suite fails on other tasks' unfinished code → every task falsely blocked).
The engineer validated its own slice in its worktree; the **whole tree is validated ONCE at the final
validate gate** after the build (see below). On a merge **conflict**, the merge agent RESOLVES it
(combining both sides, never dropping either's contribution), validates the resolution BEFORE committing,
and aborts only if it truly can't combine — it never bails blindly. The merge is **idempotent under retry**
(clears a leftover `MERGE_HEAD`; short-circuits if the task is already merged).

A task's status from its unit: `integrated` (merged) · `dev_done` (engineer passed but merge didn't land —
rebuilds on resume) · `dev_failed` (engineer validate failed) · `dep_blocked` (a dependency isn't
integrated) · `passed`/`blocked` (after review + fix loop). Only on-branch statuses seed the dependency
gate.

## The engineer ↔ reviewer pairing

The build loop picks the closest AVAILABLE specialist for every task. The plan's `Agent` field names
the specialist ENGINEER; its reviewer is the same agent name with a `-reviewer` suffix, so whatever
engineer a task is assigned, its reviewer is `<that-agent>-reviewer`. The plan is constrained to the
agents that exist in THIS environment (the skill passes `availableAgents` in), so it should never
assign one that isn't installed. If a task still arrives with an agent type this environment lacks,
the build degrades it to `general-purpose` (recorded in `missingAgents`) rather than crashing —
**but only because the skill already notified the user a specialist was missing and they chose to
continue**. Never silently prefer `general-purpose` when a real specialist exists; never invent agent
types. If a task arrives with no assigned agent, match it to the closest available specialist (and that
agent's `-reviewer`) before implementing.

## Enforce the per-stack skill

When the task's technology has a dedicated skill, the engineer brief MUST require the agent to use
that skill, and the reviewer brief must check it was followed. The skill carries the stack's current
best-practice rules, so this is mandatory, not a suggestion. For example:

- a Next.js task → the engineer must run `/nextjs`
- a Laravel task → the engineer must run `/laravel`
- a Rust task → the engineer must run `/rust`

The rule is general: if a skill matching the task's stack exists, enforce it in BOTH the engineer and
reviewer briefs. If no stack skill exists, the specialist agent proceeds on its own rubric.

## The per-task cycle

### 1. Implement — the engineer agent

Spawn the task's assigned specialist agent (the plan's `Agent` field) via the Agent tool:

- `subagent_type`: the plan's `Agent` for this task — the build loop MUST use a specialist agent and
  MUST NOT fall back to `general-purpose` for build work. Use the assigned agent as-is (never invent
  agent types); if a task has no assigned agent, MUST match the closest specialist for its technology.
- if the task's stack has a dedicated skill, the brief MUST instruct the agent to use it (`/nextjs`,
  `/laravel`, `/rust`, …) and honor its rules.
- `isolation: "worktree"` (code-writing) and `run_in_background: true` for parallel lanes.
- A COMPLETE brief — a fresh agent inherits no context:
  - task id + title + description, and WHY it exists (the slice/AC it serves)
  - exact `writeScope` (the only files it may touch) and `filesToCreate`
  - the acceptance criteria (all of them)
  - the `validateCommand` it must make pass before declaring done
  - the locked constraints it must honor (import boundaries, Node strip-only — no
    enum/parameter-property/namespace, `noUncheckedIndexedAccess`, money is BIGINT/string, RLS
    fail-closed, append-only ActivityLog, etc. — pull the relevant ones from root `CLAUDE.md`)
  - explicit instruction: implement only this task; run the validate command; report files touched +
    validate result + any deviation from the brief.

### 2. Review — the reviewer agent (SLICE-SCOPED, not an end-state gate)

This step is gated by `taskReview`: `skip` (no per-task reviewer or fix loop — the task passes on its
engineer validate alone), `native` (the matched `-reviewer` below), or `harness` (the global review
harness — codex/kiro). When review is enabled, on engineer-done spawn the reviewer read-only over the
task's diff.

**The dominant failure mode this guards against.** The build lands ONE slice at a time, so when a reviewer
sees task X the codebase is half-migrated: legacy paths task Z will remove are still present, routes/links
task Y will add don't exist yet, exports task X creates have no consumer until task W lands. A reviewer
that enforces the *whole-codebase end-state* against this mid-build tree BLOCKs task X for work it doesn't
own and can't fix — burning the entire fix loop doing nothing, then recording a false "blocked". (Observed:
72/81 reviews blocked, ~184 BLOCKs, dominated by one "legacy path still exists" finding the current task
had no scope to remove.) So:

- `isolation: "worktree"` against the engineer's branch/worktree; do NOT let it edit.
- Brief it to review ONLY the task's own slice — its `writeScope` + diff — against ITS OWN acceptance
  criteria. Pass it **the rest of the plan** (each other task's id, title, `writeScope`) so it can
  attribute end-state gaps to the owning task.
- An unmet whole-codebase invariant that a LATER task owns (a legacy path not yet removed, a route/link
  not yet built, an export whose consumer task hasn't landed) is an **OBSERVATION attributed to that
  task — NEVER a BLOCK/CONCERN against the current slice**. Pre-existing code the task didn't touch, and
  exports-for-a-later-consumer, are out of scope (not "dead wiring").
- BLOCK/CONCERN ONLY for a defect WITHIN the task's `writeScope` it can fix now: an acceptance criterion
  not actually met, a bug it introduced, the per-stack skill not followed in its own files, or an internal
  inconsistency in its diff. Verify `validateCommand` passed (the integrate step ran it; review statically
  — a check you can't run in-sandbox is an OBSERVATION).
- If the task's `review` field names a harness (codex/kiro), ALSO run that harness review on the
  task diff per `harness-routing.md` and merge findings.

### 3. Fix loop — IN-SCOPE blockers only

Filter the reviewer's findings through the task's `writeScope`. Loop **only on BLOCK/CONCERN whose `file`
the task can actually touch** — hand those back to the engineer; it fixes, re-merges (merge-only, under the
lock), re-reviews. The loop condition is **purely the in-scope review findings** — a CLEAN review (no
in-scope BLOCK/CONCERN) ends the loop immediately. Findings OUTSIDE `writeScope` are end-state gaps another
task owns: count them (`crossTaskDeferred`), defer to impl review, but NEVER feed them to this engineer and
NEVER let them block the slice. Repeat until no in-scope BLOCK/CONCERN remains, bounded by `MAX_FIX`.

> **Do NOT inject a whole-workspace validate failure as a per-task blocker.** Earlier the re-integrate ran
> the whole-suite `VALIDATE_ALL` and a failure (caused by *other* tasks' unfinished code in the
> half-migrated tree) was fabricated into a BLOCK against the current task — so a task with a CLEAN review
> looped pointlessly until `MAX_FIX`, then was falsely blocked. The fix loop must depend ONLY on the slice
> review. Whole-tree validation belongs to the single **final validate gate**, not the per-task loop.

If an in-scope blocker still remains after `MAX_FIX`, surface the task as blocked rather than merging broken
work. The whole-codebase end-state is enforced LATER — by impl review (step 12) over the fully-integrated
tree, plus the **final `VALIDATE_ALL` gate** (once, on the complete tree, when the suite can actually pass).
That, not the per-task blocked count, is the "is it real working software" signal.

### 4. Integrate the task (per-task, merge-only, under the lock)

Each task integrates **on its own** the moment its engineer passes — NOT batched at end-of-layer. Under
the `mergeLock` (so merges never race), the merge agent: git-merges the task's branch onto the working
branch, removes that task's transient worktree (tolerant `|| true` so a retry can't fail on an
already-removed one), and reports `merged[]`/`conflicted[]`. It does **not** run the whole-workspace
validate here (that's the single final gate). On a conflict it **resolves intentionally** — reads both
sides, combines them so neither's contribution is dropped, validates the resolution BEFORE committing, and
aborts only if it genuinely can't combine. The merge is **idempotent under retry** (clears a leftover
`MERGE_HEAD`; short-circuits if the task is already merged / its branch is gone). Build worktrees are also
pruned at preflight, before the final validate, and at end-of-run, so `tsc`/`eslint .` never walk a stale
`.claude/worktrees/` checkout and false-fail the gate.

## Task-exit gate

A task is "done" only when ALL hold (mirrors the structured-plan exit discipline):

1. Every acceptance criterion is demonstrably met, including the failure/edge criterion.
2. `validateCommand` passes on the merged tree.
3. No new lint/boundary/typecheck violation is introduced (`pnpm lint`, `tsc --noEmit`).
4. If the task is identity/routing/registry/isolation-sensitive (auth, RLS, route barrel, adapter
   registry, secret handling), the engineer proved the negative case too (the unauthorized/empty/
   cross-tenant path fails closed), not just the happy path.
5. New files that must be exported/registered/wired WITHIN THIS TASK'S scope are actually reachable (no
   dead wiring) — a created-but-unregistered route/export whose registration is *this task's* job is a
   fail-closed defect, not "done". But an export whose CONSUMER is a later planned task is expected
   mid-build — that wiring completes when the consumer task lands, and is the impl-review end-state gate's
   concern, not a blocker on this slice.
