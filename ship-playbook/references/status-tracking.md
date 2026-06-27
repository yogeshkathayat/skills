# Live status tracking — `.ulpi/workflows/<id>.json`

Every ship-playbook run gets one durable, project-local status file. It answers, at a glance: where did
we get to, where did we stop, can we resume, and which step to retry. It is **observability, not control**
— a failed status write is logged and ignored, and never blocks the build.

## Why a file at all (the journal already exists)

The Workflow runtime writes a per-run `journal.jsonl` (every agent's `started` + `result`) under
`~/.claude/projects/<slug>/<session>/subagents/workflows/<run>/`. `helpers/wf-status.mjs` reconstructs
per-task status from it with **zero** template changes — that is the live, free reader, and the right tool
for an in-flight run. But the journal has two gaps the durable file fills:

1. **It is session-scoped and runtime-internal**, not a committable artifact in the project. The durable
   file lives in the repo, survives across sessions, and other tooling/humans can read it without a Claude
   session.
2. **The journal has no labels or phases** — only result *payloads*. So it can't say "we're in plan
   review" or carry the final verdict. The durable file records real semantics (phase, overall status,
   `openRegister`) because the orchestrator writes them.

So: the file is the durable record + cross-session resume pointer; the journal reader is the live view.
They reference each other by `runId`.

## Who writes it, and when

| When | Writer | What |
|---|---|---|
| Before launch | **the skill** (has FS access; the Workflow sandbox does not) | creates the file: `workflowId`, `config`, `prompt`, `root`, `workingBranch`, all phases `pending`, `status: initializing` |
| Right after launch | the skill | stamps `runId` + the exact `resume` command + `status: running` |
| Each phase + each DAG layer | **the Workflow**, via `statusStep()` — one cheap (haiku, low-effort) Bash agent that `jq` deep-merges a small patch | overall `status`, per-phase status, per-task lifecycle |
| Final | the Workflow | `status: done`/`needs_fix`/`aborted`, `openRegister`, `result` summary |
| On report | the skill | reads it to enrich the report (and `wf-status.mjs --write` to refresh from the journal if a run died mid-flight) |

**No concurrent writes.** Every `statusStep()` call originates from the *sequential* orchestrator — never
from inside a `parallel()` fan-out. The orchestrator marks a whole layer `in_progress` before launching
its engineers, then marks each task's outcome after they return. So one file, no locks, no races. (Writing
from inside parallel engineers would also be wrong: each runs in its own throwaway `isolation:'worktree'`
checkout, not the main repo.) Set `trackStatus:false` (or omit `statusFile`) to disable — the run is byte
-for-byte the same minus the status agents.

## Schema

`tasks` and `phases` are objects keyed by id/name so `jq -s '.[0] * .[1]'` deep-merges a patch in place.

```json
{
  "schemaVersion": 1,
  "workflowId": "ship-20260627T093000Z-mcp-marketplace",
  "runId": "wf_51d473f0-204",
  "status": "building",
  "prompt": "…", "root": "/abs/repo", "workingBranch": "feat/mcp-marketplace",
  "createdAt": "2026-06-27T09:30:00Z", "updatedAt": "2026-06-27T09:44:00Z",
  "config": { "planHarness":"native","planReview":"native","buildHarness":"codex",
              "taskReview":"codex","implReview":"codex","goLive":false },
  "resume": "Workflow({ scriptPath:\"…/workflow-template.js\", resumeFromRunId:\"wf_51d473f0-204\", args:{…} })",
  "plan": { "name":"mcp-marketplace", "path":".ulpi/plans/mcp-marketplace.json", "taskCount":75 },
  "phases": {
    "plan":        { "status":"done" },
    "plan_review": { "status":"done" },
    "build":       { "status":"in_progress", "layer":"2/3" },
    "impl_review": { "status":"pending" },
    "verify":      { "status":"pending" },
    "audit":       { "status":"skipped", "detail":"goLive off" }
  },
  "tasks": {
    "TASK-001": { "title":"…","agent":"codex","branch":"wf/build/TASK-001","status":"integrated","fixes":0 },
    "TASK-008": { "status":"pending" },
    "TASK-016": { "status":"blocked","fixes":3,"crossTaskDeferred":4 }
  },
  "openRegister": [],
  "result": null
}
```

### Overall `status`
`initializing → running → planning → plan_review → building → impl_review → verifying → auditing →
done | needs_fix | aborted`.

### Task lifecycle
`pending → in_progress → dev_done → integrated → (reviewing) → passed | blocked` — plus `dev_failed`
(engineer validate failed) and `conflicted` (merge aborted). Mapping to plain language: *dev_done* = the
engineer's slice validates green on its branch; *integrated* = merged onto the working branch; *passed* =
slice review clean; *blocked* = a real in-scope blocker remains after the fix loop. `crossTaskDeferred` is
the count of end-state findings this task can't own (another task does) — deliberately NOT blocking.

> Note: this workflow merges each task branch onto the **working branch** during the build (the
> *integrated* state). A final merge to `main` / opening a PR is out of scope here — use `create-pr`
> afterward. So "merged" in the playbook means *integrated onto the working branch*.

## The three verbs

```bash
# STATUS — at a glance
cat .ulpi/workflows/<id>.json | jq '{status, phases, tasks: (.tasks|map_values(.status))}'
node <skill-dir>/helpers/wf-status.mjs            # live, reconstructed from the journal
node <skill-dir>/helpers/wf-status.mjs --list     # every run for this project
node <skill-dir>/helpers/wf-status.mjs --json     # machine-readable
node <skill-dir>/helpers/wf-status.mjs --write    # refresh .ulpi/workflows/<run>.json from the journal

# STOP — nothing is lost; the journal caches every finished agent
#   TaskStop the run, or use the /workflows panel.

# RESUME — cached agents return instantly; only unfinished/conflicted tasks re-run
#   Workflow({ scriptPath, resumeFromRunId:"<runId>", args:{…same args, same workflowId/statusFile…} })
```

`wf-status.mjs` is read-only by default, scopes to the current project (cwd) unless `--all`, and matches a
run to its durable file by `runId` to show overall status + phase. `--write` is the on-demand materializer:
it reconstructs per-task status from the journal and merges it over the durable file, without clobbering
the skill-written `config`/`prompt`/`phases` — use it when a run had tracking off, or died before its final
write.

## Backfill a run that predates v1.5.0 (incl. an in-flight one)

A run launched with an older ship-playbook never wrote a status file. Build one from its journal:

```bash
cd <the repo where the run is building>
node <skill-dir>/helpers/wf-status.mjs --write           # newest run for this project
node <skill-dir>/helpers/wf-status.mjs --write <runId>   # a specific run
```

This recovers, **from the journal**: the plan name + path, the working branch (from the preflight result),
the full task list with each task's title/agent/branch + current status, the layer count, and live counts
+ merge conflicts. It writes `./.ulpi/workflows/<runId>.json`, marked `partial: true`.

**The one thing the journal can't give: the launch args.** Gate config (`planReview`/`taskReview`/…),
`hardRules`, `validate`, and the original `prompt` were *inputs to the script*, not agent results, so they
are not in the journal. Only the session that launched the run knows them. Supply them to complete the
resume recipe:

```bash
node <skill-dir>/helpers/wf-status.mjs --write <runId> \
  --args '{"planReview":"skip","buildHarness":"native","taskReview":"codex","implReview":"codex","validate":"pnpm -w typecheck && pnpm -w lint && pnpm -w test"}'
```

The backfilled file's `.resume` is **planPath-based** (the plan already exists on disk, so resume adopts it
and skips re-planning — fewer inputs needed): `Workflow({ scriptPath, resumeFromRunId, args:{ planPath,
workingBranch, root, …your --args… } })`. Resuming an old run with the *current* template is fine and even
beneficial — `resumeFromRunId` replays every cached agent by content hash; only uncached/changed calls
re-run, so the slice-scoped reviewer applies to the work that's left.

## Guardrails

- Status tracking never blocks delivery. A failed write is logged and ignored.
- Never report a run failed because its status file is stale — reconstruct from the journal instead.
- Consider adding `.ulpi/workflows/` to the project `.gitignore` if you don't want run state committed
  (it's ephemeral); keep it tracked if you want a durable, reviewable history of runs.
