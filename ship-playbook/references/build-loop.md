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

The build loop MUST pick a specialist agent for every task — it MUST NOT run build work on
`general-purpose`. The plan's `Agent` field names the specialist ENGINEER; its reviewer is the same
agent name with a `-reviewer` suffix, so whatever engineer a task is assigned, its reviewer is
`<that-agent>-reviewer`. Use the assigned agent as-is; never invent agent types. If a task arrives
without an assigned agent, the build loop MUST match it to the closest specialist for its technology
(and that agent's `-reviewer`) before implementing.

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

### 2. Review — the reviewer agent

When the engineer reports done, spawn the MATCHED specialist reviewer (the engineer's name +
`-reviewer`) read-only over that task's diff:

- `isolation: "worktree"` against the engineer's branch/worktree; do NOT let it edit.
- Brief: read the task's diff + surrounding context, verify each acceptance criterion is actually
  met (not just claimed), check the locked constraints, verify the per-stack skill was applied when
  one exists, and verify the `validateCommand` truly passes. Report findings as
  `| # | Severity | File:Line | Issue | Fix |` with severities BLOCK / MAJOR / MINOR, or an explicit
  "clean".
- If the task's `review` field names a harness (codex/kiro), ALSO run that harness review on the
  task diff per `harness-routing.md` and merge findings.

### 3. Fix loop

Hand the reviewer's findings back to the SAME engineer agent (continue it via SendMessage so it
keeps its context, or respawn with the findings appended to the original brief). The engineer fixes,
re-runs `validateCommand`, reports. Re-review. Repeat until:

- the reviewer returns clean (no BLOCK/MAJOR), AND
- `validateCommand` passes green, AND
- the task-exit gate (below) is satisfied.

Cap the per-task fix loop (e.g. 3 iterations); if it still fails, stop and surface the task as
blocked rather than merging broken work.

### 4. Merge the layer

Once every task in the layer passes, fold each worktree back onto the working branch. Re-run the
affected `validateCommand`(s) on the merged tree to catch integration breakage before the next
layer. If a merge conflicts (two tasks touched the same surface despite the disjoint check),
resolve intentionally or escalate — never auto-squash over a conflict.

## Task-exit gate

A task is "done" only when ALL hold (mirrors the structured-plan exit discipline):

1. Every acceptance criterion is demonstrably met, including the failure/edge criterion.
2. `validateCommand` passes on the merged tree.
3. No new lint/boundary/typecheck violation is introduced (`pnpm lint`, `tsc --noEmit`).
4. If the task is identity/routing/registry/isolation-sensitive (auth, RLS, route barrel, adapter
   registry, secret handling), the engineer proved the negative case too (the unauthorized/empty/
   cross-tenant path fails closed), not just the happy path.
5. New files that must be exported/registered/wired are actually reachable (no dead wiring) — a
   created-but-unregistered route/export is a fail-closed defect, not "done".
