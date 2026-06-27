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

## Layer-by-layer execution

Process `parallelLayers` in order. A layer's tasks may run concurrently ONLY when their `writeScope`
sets are disjoint; if two tasks in the same layer touch the same file, serialize them. Between
layers there is a BARRIER: every task in layer N must pass and be merged before layer N+1 starts,
because later tasks build on earlier code.

```
for layer in parallelLayers:
    disjoint = tasks whose writeScope does not overlap any other in-flight task
    run those engineer↔reviewer cycles in parallel (isolated worktrees)
    serialize the rest
    when all pass: merge each worktree back onto the working branch
    only then proceed to the next layer
```

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
the task can actually touch** — handing those back to the SAME engineer (respawn with the findings, or
SendMessage to keep context); it fixes, re-runs `validateCommand`, re-integrates, re-reviews. Findings
OUTSIDE `writeScope` are end-state gaps another task owns: count them (`crossTaskDeferred`), surface them
to impl review, but NEVER feed them to this engineer (it can't edit them) and NEVER let them block the
slice. Repeat until:

- no in-scope BLOCK/CONCERN remains, AND
- `validateCommand` passes green, AND
- the task-exit gate (below) is satisfied.

Cap the per-task fix loop (e.g. 3 iterations); if an in-scope blocker still remains, stop and surface the
task as blocked rather than merging broken work. The whole-codebase end-state is enforced LATER — by impl
review (step 12) over the fully-integrated tree, plus the integrate-step workspace `validate`. That, not
the per-task blocked count, is the "is it real working software" signal.

### 4. Merge the layer

Once every task in the layer passes, fold each worktree back onto the working branch. **Then remove the
merged build worktrees and `git worktree prune` BEFORE re-running the validate** — build agents run with
`isolation: 'worktree'`, which leaves full repo checkouts under `.claude/worktrees/`; because `tsc` and
`eslint .` don't respect `.gitignore`, a leftover worktree gets walked by the validate and fails the
gate on pollution no matter what the task code does. Re-run the affected `validateCommand`(s) on the
cleaned tree, scoped so it never scans `.claude/worktrees/**` (or sibling agent dirs `.factory`,
`.gemini`, `.opencode`, `.trae`, `.vibe`). If a merge conflicts (two tasks touched the same surface
despite the disjoint check), resolve intentionally or escalate — never auto-squash over a conflict.
(The workflow also prunes dangling worktrees at preflight and at the end of the run.)

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
