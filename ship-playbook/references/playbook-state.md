# Playbook state machine

The playbook is a bounded loop, not a straight line. This file pins the master state, the finding
schema, dedup, convergence, and the recursion budget.

## Phases as a state machine

```
A intake ──> B plan ──> C native plan-review loop ──> D harness plan-review loop
                                                              │
                                                              v
                                                        E build loop
                                                              │
                                                              v
                                            F impl review (native ∥ harness)
                                                              │
                                                              v
                                       G go-live audit (native ∥ harness)   [if goLive]
                                                              │
                                                              v
                                            H converge?  ── clean ──> DONE
                                                  │
                                            findings remain
                                                  │
                                  round < maxRounds │ round == maxRounds
                                                  v                 v
                              new fix-prompt ──> back to B      STOP + escalate
```

- C loops on itself until APPROVE / no issues.
- D loops on itself (selected harness ∥ native) until both clean. Skipped when `harness == none`.
- E barriers between DAG layers; each task loops engineer↔reviewer until it passes.
- F and G feed ONE merged finding register that H evaluates.
- H either finishes or re-enters B with the consolidated findings as the new request.

## Master TodoWrite shape

Open one master todo at intake and keep it current across rounds:

```
[ ] Round <n> — intake: harness=<x>, goLive=<y>, maxRounds=<m>
[ ] Round <n> — plan: <plan-name> (<task count> tasks, critical path …)
[ ] Round <n> — native plan-review: APPROVE/REVISE/REJECT (loop k)
[ ] Round <n> — harness plan-review (<harness>): clean? (loop k)   # or "skipped (none)"
[ ] Round <n> — build: layer i/N — task TASK-00x by <agent>: pass/fix-loop
[ ] Round <n> — impl review: native + <harness> → <#confirmed> findings
[ ] Round <n> — go-live audit: GO/NO-GO/GO-WITH-FIXES → <#blockers>   # or "skipped"
[ ] Round <n> — converge: clean | recurse | escalate
```

Mark each `in_progress` when entered, `completed` when its success criterion is met. On recursion,
append a new Round block rather than overwriting the previous one — the history is the audit trail.

## Finding schema (merged register)

Every finding from any gate (native or harness, plan or code or audit) is normalized to:

```
{ id, source: "native"|"codex"|"kiro", phase: "plan"|"impl"|"audit",
  severity: "BLOCK"|"CONCERN"|"OBSERVATION",   # audit blockers map to BLOCK
  file, line, issue, evidence, suggestedFix, status: "open"|"fixed"|"rejected" }
```

Map each harness's own scale into this one: founder-review BLOCK/CONCERN/OBSERVATION pass through;
code-review P1/P2/P3 → BLOCK/CONCERN/OBSERVATION; go-live blocker/high/medium → BLOCK/CONCERN/
OBSERVATION.

## Dedup

Before acting, merge findings that share a root cause: same `file` + overlapping `line` range, or
the same described defect reported by two sources. Keep the highest severity, record
`alsoReportedBy`. Two independent harnesses flagging the same thing RAISES confidence — never drop
it as a "duplicate of itself".

## Adversarial verification (optional, recommended for big rounds)

For BLOCK/CONCERN findings before spending a fix or a recursion round, spawn 1–2 skeptic agents to
try to REFUTE each one against the actual code (default to "real" only if it survives). Drop refuted
findings (record the count). This stops a plausible-but-wrong finding from triggering a whole extra
playbook round. The bundled workflow has a verify stage for this.

## Convergence rules

- **Clean** = no `open` finding with severity BLOCK or CONCERN across the merged register. Remaining
  OBSERVATIONs are listed in the final report, not looped on.
- **Recurse** = at least one open BLOCK/CONCERN AND `round < maxRounds`. Consolidate the open
  BLOCK/CONCERN findings into a single precise fix-prompt (group by file/subsystem, name the exact
  defect + the fix), increment `round`, re-enter Phase B with a `HOLD`/`REDUCTION` mode hint so the
  fix-plan stays tight.
- **Escalate** = open BLOCK/CONCERN remain AND `round == maxRounds`. Stop. Present the open findings,
  what was tried each round, and options (raise maxRounds, hand-fix, accept-with-risk). NEVER fake a
  clean verdict to exit.

## Recursion budget

- `maxRounds` default = 3 (override via `$request` `maxRounds=N` or the intake).
- Each round re-runs B→H for the *new* findings only — not the original full scope. Fix-plans are
  small; the build loop touches only the files the fixes need.
- Track a per-round finding count; if a round does not reduce the open BLOCK/CONCERN count, treat it
  as non-converging and escalate early rather than burning the remaining rounds.

## Honesty rule

This mirrors the repo's gate philosophy: an implementation predicate that genuinely fails FAILS the
phase; a report-only/uncertain bar is surfaced as-is. The playbook reports the real state. A
deceptively green exit is worse than an honest "2 blockers remain after 3 rounds — here they are."
