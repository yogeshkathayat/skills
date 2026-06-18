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

- B (plan) and C (plan review) run ONCE. C is a plan-QUALITY gate (scope, decomposition, phantom
  paths): ONE bounded loop (native ∥ selected harness; native-only when `harness == none`), exits on no
  BLOCK/CONCERN (OBSERVATIONs never block) OR non-convergence, capped at `MAX_REVIEW` (2).
- E barriers between DAG layers; each task loops engineer↔reviewer until it passes.
- F is the plan-vs-implementation gate.
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
  report, not acted on. If `goLive`, the audit then runs; a clean audit → DONE.
- **Feedback** = at least one verified BLOCK/CONCERN. The workflow RETURNS them in `openRegister` and
  STOPS. The skill presents them (file:line, issue, suggested fix, which gate) and offers the user:
  run a fix round (re-invoke with the findings as the prompt), hand-fix, or accept-with-risk. The
  workflow never loops on its own.

## Fix rounds are user-driven

There is no `maxRounds` and no autonomous recursion. A "fix round" is a fresh invocation the user
chooses after seeing the feedback, with the findings as the new prompt — small scope, its own pass.
This is deliberate: an autonomous fix-loop is what produced multi-hour grinds.

## Honesty rule

This mirrors the repo's gate philosophy: an implementation predicate that genuinely fails FAILS the
phase; a report-only/uncertain bar is surfaced as-is. The playbook reports the real state. A
deceptively green exit is worse than an honest "2 blockers remain — here they are."
