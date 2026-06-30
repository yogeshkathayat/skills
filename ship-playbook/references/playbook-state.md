# Playbook state machine

The playbook is a SINGLE forward pass, not a loop. It runs the gates once and RETURNS the verified
findings as feedback; the user decides whether to run a fix round. This file pins the master state, the
finding schema, dedup, verification, and the clean/feedback decision.

## Phases as a state machine

```
A intake ──> B plan ──> C plan-review loop (native ∥ harness, bounded)
                                          │
                                          v
                                    E build loop
                                          │
                                          v
                        F impl review (native ∥ harness)   ← plan-vs-implementation gate
                                          │
                                          v
                        V verify findings (dedup + adversarial refute)
                                          │
                            ┌─────────────┴─────────────┐
                         clean                     findings remain
                            │                            │
                            v                            v
              G go-live audit [if goLive]      RETURN openRegister = feedback
                            │                            │
                            v                            v
                          DONE                user decides: fix round / hand-fix / accept
```

- B (plan) runs once. C (plan review) runs per `planReview` (`skip` / `native` / `codex` / `kiro`) — a
  single reviewer (the FIX is always native). When it runs it's a plan-QUALITY gate (scope,
  decomposition, phantom paths): ONE bounded loop, exits on no BLOCK/CONCERN (OBSERVATIONs never block)
  OR non-convergence, capped at `MAX_REVIEW` (2).
- **Fix-then-reload** — C's fix rounds edit the plan FILES on disk (`.json` source of truth, then re-render
  `.md`), so the in-memory plan goes stale while the build (E) reads `plan.tasks` directly. After any review
  that applied a fix, the run RELOADS the plan from disk before E so the build walks the FIXED DAG, not the
  pre-fix one. If the reloaded plan fails validation, the pre-fix in-memory plan is kept.
- E barriers between DAG layers; each task loops engineer↔reviewer until it passes — unless `taskReview
  skip`, then there is no per-task reviewer/fix loop and a task passes on its engineer validate alone.
  The per-task review is **slice-scoped**: it judges only the task's own writeScope + diff against its
  acceptance criteria, and the fix loop acts only on in-scope blockers. End-state gaps a later task owns
  are deferred (OBSERVATION), never blocking the slice. (See `build-loop.md`.)
- F (impl review) runs per `implReview` (`skip` / `native` / `codex` / `kiro`) — the plan-vs-implementation
  gate AND the **end-state gate**: now that every task has landed, the whole-codebase invariants the
  per-task reviews deferred (legacy paths gone, routes/links exist, exports consumed) MUST hold. With the
  integrate-step workspace validate, this is the real "is it working software" signal — not the per-task
  blocked count.
- V dedups + adversarially verifies the build+impl findings. Survivors are `openRegister`.
- If `openRegister` is empty and `goLive`, G (the heaviest phase) runs; otherwise the workflow RETURNS
  `openRegister` as feedback. There is NO automatic loop back to B/E — a fix round is a deliberate
  user choice (re-invoke the workflow with the findings as the prompt).

## Master TodoWrite shape

Open one master todo at intake and keep it current through the pass:

```
[ ] intake: harness=<x>, goLive=<y>, build=<bh>, review=<trh>, map=<m>
[ ] plan: <plan-name> (<task count> tasks, critical path …)
[ ] plan-review (native ∥ <harness>): clean? (loop k of MAX_REVIEW, or stopped non-converging)
[ ] build: layer i/N — task TASK-00x by <agent>: pass/fix-loop
[ ] impl review: native + <harness> → <#confirmed> findings
[ ] verify: <#> findings survived → feedback
[ ] go-live audit: GO/NO-GO/GO-WITH-FIXES → <#blockers>   # or "skipped (findings remain / no goLive)"
[ ] report: clean → done, or present feedback → user decides (fix round / hand-fix / accept)
```

Mark each `in_progress` when entered, `completed` when its success criterion is met. If the user
chooses a fix round, that is a fresh invocation with its own todo block.

## Finding schema (merged register)

Every finding from any gate (native or harness, plan or code or audit) is normalized to:

```
{ id, source: "native"|"codex"|"kiro", phase: "plan"|"impl"|"audit",
  severity: "BLOCK"|"CONCERN"|"OBSERVATION",   # audit blockers map to BLOCK
  file, line, issue, evidence, suggestedFix, status: "open"|"fixed"|"rejected" }
```

Map each harness's own scale into this one: founder-review BLOCK/CONCERN/OBSERVATION pass through;
code-review P1/P2/P3 → BLOCK/CONCERN/OBSERVATION; go-live blocker/high/medium → BLOCK/CONCERN/
OBSERVATION. The surviving verified findings are returned to the user as `openRegister`.

## Dedup

Before acting, merge findings that share a root cause: same `file` + overlapping `line` range, or
the same described defect reported by two sources. Keep the highest severity, record
`alsoReportedBy`. Two independent harnesses flagging the same thing RAISES confidence — never drop
it as a "duplicate of itself".

## Adversarial verification (the Verify phase)

For every BLOCK/CONCERN finding, the Verify phase spawns skeptic agents to try to REFUTE it against
the actual code (BLOCK gets a code lens + a spec lens; CONCERN gets code) — a finding is kept only if
it survives. Refuted findings are dropped. This stops a plausible-but-wrong finding from being handed
back to the user as a real defect. The survivors are `openRegister`.

## Clean vs feedback

- **Clean** = no verified BLOCK/CONCERN finding survives. Remaining OBSERVATIONs are listed in the
  report, not acted on. If `goLive`, the audit then runs; a clean audit → DONE. On DONE (converged), the
  workflow's LAST step ARCHIVES the delivered plan to `.ulpi/plans/done/` (returns `planArchived:true`) so
  the active plans dir holds only in-flight work — skipped on a `needs_fix` run (a fix round may reuse it).
- **Feedback** = at least one verified BLOCK/CONCERN. The workflow RETURNS them in `openRegister` and
  STOPS. The skill presents them (file:line, issue, suggested fix, which gate) and offers the user:
  run a fix round (re-invoke with the findings as the prompt), hand-fix, or accept-with-risk. The
  workflow never loops on its own.

## Fix rounds are user-driven

There is no `maxRounds` and no autonomous recursion. A "fix round" is a fresh invocation the user
chooses after seeing the feedback, with the findings as the new prompt — small scope, its own pass.
This is deliberate: an autonomous fix-loop is what produced multi-hour grinds.

## Live status file

Each run mirrors this state machine into a durable `.ulpi/workflows/<id>.json` (overall status, per-phase,
per-task lifecycle, final `openRegister`). The skill creates it before launch and reads it at report; the
Workflow updates it at every phase + DAG layer via cheap status-writer agents. It is the at-a-glance
"where did we get to / stop / resume / retry" record — non-fatal observability that never blocks delivery.
Full schema, lifecycle, and the status/stop/resume verbs are in `status-tracking.md`; the journal reader is
`helpers/wf-status.mjs`.

## Honesty rule

This mirrors the repo's gate philosophy: an implementation predicate that genuinely fails FAILS the
phase; a report-only/uncertain bar is surfaced as-is. The playbook reports the real state. A
deceptively green exit is worse than an honest "2 blockers remain — here they are."
