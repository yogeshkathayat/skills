// ship-playbook — the runnable Workflow that executes the playbook in ONE forward pass.
//
// The phases, in order (each review gate runs at the level the user chose — skip / native / codex / kiro):
//   step 3       → plan          (plan-to-task-list-with-dag methodology; assigns specialist agents)
//   steps 4–9    → plan review   (reviewer per planReview → fix → re-review; bounded, stops if not improving)
//   steps 10–11  → build         (per task across DAG layers: engineer per buildHarness → in-workflow git
//                                 integrate + per-merge worktree removal → reviewer per taskReview → fix loop)
//   step 12      → impl review   (final plan-vs-implementation review by the implReview reviewer)
//   step 14      → verify        (dedup + adversarially verify findings → RETURN as feedback; no auto-loop)
//   step 13      → audit         (go-live audit, only if goLive AND build+impl verified-clean)
//
// Steps 1, 2, 2.1 (the prompt + the two intake questions) are collected by the SKILL at the front
// door — a Workflow cannot AskUserQuestion mid-run — and passed in via `args`. They are still part of
// the playbook; the skill just supplies them as inputs to this script. Everything else runs here.
//
// HOW TO USE: the skill launches this with
//   args = { prompt, root, workingBranch, validate, hardRules, goLive,   // execution-order roles:
//            planHarness,                              // 'native' | 'codex' | 'kiro'  (who WRITES the plan)
//            planReview,                               // 'skip' | 'native' | 'codex' | 'kiro'  (who REVIEWS the plan)
//            buildHarness,                             // 'native' | 'codex' | 'kiro'  (who WRITES each task + fixes)
//            taskReview,                               // 'skip' | 'native' | 'codex' | 'kiro'  (who REVIEWS each built task)
//            implReview,                               // 'skip' | 'native' | 'codex' | 'kiro'  (impl review after all tasks)
//            auditScriptPath, availableAgents, allowGeneralFallback,
//            planPath | plan,                          // RESUME: an already-reviewed DAG plan (path or parsed object)
//            workflowId, statusFile, trackStatus }     // LIVE STATUS: id + absolute .ulpi/workflows/<id>.json path
//   (auditScriptPath is optional — see the comment at its CFG read below. planPath/plan are optional —
//    when set, the run RESUMES at the build phase: prompt/planHarness/planReview are ignored.
//    workflowId/statusFile are optional — when statusFile is set (the skill creates the file before launch,
//    since this sandbox has no FS access), the run writes live progress to it via cheap status-writer
//    agents at each phase + DAG layer; trackStatus:false or an absent statusFile disables it, run unchanged.)
//   Every role picks its own executor (writer + each reviewer INDEPENDENT — write codex, review kiro is
//   fine). Reviews also allow 'skip'. From full-rigor (every review on, codex/kiro where wanted, goLive)
//   down to fast (every review skip). Lighter is the default.
// Or fill the FILL: fallbacks and run directly. Keep `meta` a pure literal or the Workflow tool
// rejects it. Build agents have Bash, so the in-workflow integrate agent does the git merges.

export const meta = {
  name: 'ship-playbook',
  description: 'Runs the ship playbook in one pass: plan → bounded plan review → specialist build across DAG layers → impl review → verify → go-live audit, returning a verified finding register as feedback',
  phases: [
    { title: 'Plan', detail: 'plan-DAG methodology; assign specialist agents' },
    { title: 'Plan review', detail: 'reviewer per planReview → fix → re-review (bounded; stops when not improving)' },
    { title: 'Build', detail: 'per task: engineer (buildHarness) → git integrate → reviewer (taskReview) → fix' },
    { title: 'Impl review', detail: 'final plan-vs-implementation review (implReview reviewer)' },
    { title: 'Verify', detail: 'dedup + dual-lens verify findings → return as feedback' },
    { title: 'Audit', detail: 'go-live audit (compose go-live-audit) — only if goLive and build+impl clean' },
  ],
}

// ── config (args first, FILL: fallbacks for direct runs) ────────────────────────
// args should arrive as a real JSON object. If the launcher stringified it (a common tool-call
// mistake), parse the string too — otherwise CFG silently empties and every value below falls to its
// FILL: placeholder, producing a fake-clean run that did nothing.
let CFG = {}
if (args && typeof args === 'object') CFG = args
else if (typeof args === 'string' && args.trim()) { try { CFG = JSON.parse(args) } catch { CFG = {} } }
const ROOT = CFG.root || 'FILL: absolute repo path'
const WORKING_BRANCH = CFG.workingBranch || 'FILL: branch to build on (e.g. main or a feature branch)'
const VALIDATE_ALL = CFG.validate || 'FILL: workspace validate, e.g. pnpm -w exec tsc --noEmit && pnpm lint'
const HARD_RULES = CFG.hardRules || `FILL: load-bearing invariants (import boundaries, Node strip-only,
money is BIGINT/string, RLS fail-closed, append-only ActivityLog, route-barrel wiring, …)`
let PROMPT = CFG.prompt || 'FILL: the feature request'
const GO_LIVE = CFG.goLive === true
const MAX_REVIEW = 2                          // bounded plan-review iterations (a plan isn't code; non-convergence also early-exits)
const MAX_FIX = 3                             // bounded per-task engineer↔reviewer fix iterations

// ── concurrency caps (avoid Claude API rate limits / 429s) ───────────────────────
// The runtime only caps concurrent agents at min(16, cpu-2) — too loose to keep a
// wide fan-out from tripping Claude's API rate limits. These bound how many agents
// run AT ONCE; the TOTAL number of agents is unchanged. Build engineers are heavy
// (each is isolation:'worktree' = a full repo checkout), so they get a tighter cap
// than the light read-only reviewers/verifiers — that also relieves disk + CPU.
// Keep them sane: NOT 1–2 (that serializes the run). The two gates are independent,
// but the build fan-out and the read-only phases barely overlap, so peak stays low.
const MAX_BUILD_PARALLEL = 4                  // concurrent build/fix engineers (worktree-isolated)
const MAX_PARALLEL = 6                        // concurrent reviewers / verifiers / other read-only agents

// ── retry transient failures (chiefly Claude API rate limits) ────────────────────
// Under a rate-limit STORM whole waves of agents get rejected at the door (0 tokens) or cut off
// mid-flight. agent() surfaces that as a null return (the subagent died on a terminal API error after
// the runtime's own retries); some transient faults throw. Those are NOT real build/review failures, so
// re-attempt with exponential backoff before giving up — otherwise a rate-limit wave is mis-recorded as
// blocked tasks. Fixed delay schedule (no Math.random/Date.now) keeps resume deterministic; holding a
// gate slot during the backoff also naturally relieves concurrency while the storm clears.
const RETRY_DELAYS = [3000, 10000, 30000]    // ms; 3 retries ⇒ up to 4 attempts
const isRateLimit = (e) => /rate.?limit|429|overloaded|529|too many requests|quota/i.test(String((e && (e.message || e)) || ''))
const sleep = (ms) => (typeof setTimeout === 'function' ? new Promise(r => setTimeout(r, ms)) : Promise.resolve())
async function withRetry(fn, label) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fn()
      if (r != null) return r                  // success
      // null ⇒ terminal API death (commonly a rate limit) after the runtime's own retries, or a skip
    } catch (e) {
      if (!isRateLimit(e)) throw e             // a genuine error → preserve existing behavior, surface it
    }
    if (attempt >= RETRY_DELAYS.length) return null   // exhausted ⇒ give up; caller handles null as before
    log(`${label || 'agent'} came back empty (attempt ${attempt + 1}/${RETRY_DELAYS.length + 1}) — likely a rate limit; backing off ${RETRY_DELAYS[attempt] / 1000}s`)
    await sleep(RETRY_DELAYS[attempt])
  }
}

function makeGate(limit) {
  let inFlight = 0
  const queue = []
  return async function gate(fn) {
    if (inFlight >= limit) await new Promise(resolve => queue.push(resolve))   // park; slot handed over on release (no ++)
    else inFlight++
    try { return await withRetry(fn) }
    finally {
      const next = queue.shift()
      if (next) next()        // hand the in-flight slot straight to the next waiter (no decrement)
      else inFlight--         // nobody waiting → free the slot
    }
  }
}
const buildGate = makeGate(MAX_BUILD_PARALLEL)   // gates build/fix engineers (buildSpawn)
const agentGate = makeGate(MAX_PARALLEL)         // gates reviewers (taskReviewSpawn) + verify lenses
// MERGE LOCK — a promise-chain mutex serializing git merges onto the shared WORKING_BRANCH. The per-task
// pipeline runs many tasks concurrently, but each task's integrate (and fix re-integrate) merges the same
// branch; concurrent merges would race the git index. mergeLock(fn) runs fn only after the previous
// holder settles, so merges happen strictly one-at-a-time while builds/reviews stay parallel.
function makeLock() {
  let tail = Promise.resolve()
  return (fn) => {
    const run = tail.then(fn, fn)            // run after the previous merge settles (success OR failure)
    tail = run.then(() => {}, () => {})      // swallow so one failed merge doesn't break the chain
    return run
  }
}
const mergeLock = makeLock()
// retrying wrapper for the NON-gated sequential agent() calls (plan, preflight, integrate, plan-fix,
// cleanup, routed reviews). The gated fan-out calls already retry inside makeGate.
const rAgent = (prompt, opts) => withRetry(() => agent(prompt, opts), opts && opts.label)

// ── review/build roles (each independently dialable; writer and each reviewer pick their own harness) ──
// Every role chooses its own executor: 'native' (claude / the plan's specialist agent), 'codex', or
// 'kiro'. There is NO shared global harness — writing and reviewing can use DIFFERENT harnesses
// (e.g. write codex, review kiro). Review gates additionally allow 'skip' to save tokens.
const PLAN_HARNESS = ['native', 'codex', 'kiro'].includes(CFG.planHarness) ? CFG.planHarness : 'native'    // who WRITES the plan
const PLAN_REVIEW = ['skip', 'native', 'codex', 'kiro'].includes(CFG.planReview) ? CFG.planReview : 'native'  // founder review of the plan
const BUILD_HARNESS = ['native', 'codex', 'kiro'].includes(CFG.buildHarness) ? CFG.buildHarness : 'native'   // who WRITES each task (+ fixes)
const TASK_REVIEW = ['skip', 'native', 'codex', 'kiro'].includes(CFG.taskReview) ? CFG.taskReview : 'native'  // review of each built task
const IMPL_REVIEW = ['skip', 'native', 'codex', 'kiro'].includes(CFG.implReview) ? CFG.implReview : 'native'  // final plan-vs-implementation review

// step 13: path to a FILLED go-live-audit workflow script (the skill authors it via the go-live-audit
// skill and passes its scriptPath). When set, the Audit phase COMPOSES that proven workflow inline via
// the workflow() hook; when unset, it falls back to an inline finder pass.
const AUDIT_SCRIPT_PATH = CFG.auditScriptPath || null
// Specialist agents/skills differ per install. The skill resolves what THIS environment has and passes
// it in: availableAgents = the specialist agent names that actually exist (null = unconstrained — trust
// the plan + runtime fallback); allowGeneralFallback = the user consented to degrade a missing
// specialist to general-purpose (the skill NOTIFIES the user before setting this).
const AVAILABLE_AGENTS = Array.isArray(CFG.availableAgents) ? CFG.availableAgents : null
const ALLOW_GENERAL_FALLBACK = CFG.allowGeneralFallback !== false   // default true: degrade, don't crash

// RESUME from an existing, already-reviewed DAG plan: skip plan-WRITING and plan-REVIEW, start at BUILD.
// The skill passes either the parsed plan object (CFG.plan) or a path to it (CFG.planPath). The sandbox
// can't read files, so a path is loaded + validated + normalized by an agent. When either is set, the
// Plan and Plan-review phases are skipped and PROMPT is not required (the plan IS the spec).
const EXISTING_PLAN = (CFG.plan && typeof CFG.plan === 'object' && Array.isArray(CFG.plan.tasks)) ? CFG.plan : null
const PLAN_PATH = (typeof CFG.planPath === 'string' && CFG.planPath.trim()) ? CFG.planPath.trim() : null
const RESUME_PLAN = !!(EXISTING_PLAN || PLAN_PATH)

// Model for kiro runs (build via hand-over-to-kiro, review via kiro-review). Latest Opus by default —
// kiro model names differ from Claude-Code's ("opus" is invalid; valid: claude-opus-4.8/4.7/4.6,
// claude-sonnet-4.6/…, auto). Override with CFG.kiroModel. See hand-over-to-kiro/references/kiro-cli.md.
const KIRO_MODEL = (typeof CFG.kiroModel === 'string' && CFG.kiroModel.trim()) ? CFG.kiroModel.trim() : 'claude-opus-4.8'

// ── live status file (.ulpi/workflows/<id>.json) ─────────────────────────────────
// The skill creates the durable status file before launch (it has FS access; this sandbox does not) and
// passes its ABSOLUTE path in CFG.statusFile. As the playbook advances, statusStep() spawns ONE cheap
// (haiku, low-effort) writer agent at each sequential boundary to deep-merge a small JSON patch into it —
// so `cat`/`wf-status.mjs` shows where the run is, LIVE. All status writes originate from the SEQUENTIAL
// orchestrator (never from inside parallel()), so there are NO concurrent writes and no lock is needed.
// Status bookkeeping must NEVER break delivery: a failed write is logged and ignored. Set CFG.trackStatus
// = false (or omit statusFile, e.g. a direct run) to disable — the helper no-ops and the run is unchanged.
const STATUS_FILE = (typeof CFG.statusFile === 'string' && CFG.statusFile.trim()) ? CFG.statusFile.trim() : null
const TRACK_STATUS = !!STATUS_FILE && CFG.trackStatus !== false
const WORKFLOW_ID = (typeof CFG.workflowId === 'string' && CFG.workflowId.trim()) ? CFG.workflowId.trim() : null

// Fail LOUD if inputs never reached the script. Without this, the values above stay at their FILL:
// placeholders, the plan agent is handed "FILL: the feature request", returns no tasks, and the run
// reports a fake converged:true. Refuse to start on placeholders rather than emit a false clean.
// (PROMPT is only required when WRITING a plan — a resume supplies the plan instead.)
const _need = RESUME_PLAN ? { ROOT, WORKING_BRANCH, VALIDATE_ALL } : { ROOT, WORKING_BRANCH, VALIDATE_ALL, PROMPT }
const _missing = Object.entries(_need)
  .filter(([, v]) => typeof v !== 'string' || v.startsWith('FILL:')).map(([k]) => k)
if (_missing.length) {
  throw new Error(`ship-playbook: inputs did not reach the script — ${_missing.join(', ')} still at FILL: placeholder (typeof args="${typeof args}"). Pass args as a real JSON object per the skill's Phase 2 contract, NOT a stringified blob, then relaunch as a FRESH run.`)
}

// Route ONE read-only review to whichever executor a role picked: native claude, codex, or kiro.
// codex → the codex plugin agent; kiro → the kiro-review skill driving the Kiro CLI (never a silent
// native substitute). The brief carries the actual review instructions; this just picks the executor.
const isAgentNotFound = (e) => /agent type .*not found|not a valid agent|unknown agent|no such agent|available agents:/i.test(String((e && e.message) || e))
async function routeReview(who, brief, label, phaseTitle) {
  if (who === 'codex') {
    // codex review: if the codex plugin isn't installed here, agent() throws "agent type not found" —
    // catch it and return null (→ a NON-run gate / died-reviewer marker) instead of crashing the run.
    try { return await rAgent(`READ-ONLY review — do NOT edit. If you cannot drive the codex CLI here, return \`gateNotRun: true\` (verdict 'blocked', empty findings) — do NOT return a clean result.\n${brief}`, { label, phase: phaseTitle, schema: FINDINGS, agentType: 'codex:codex-rescue' }) }
    catch (e) { if (isAgentNotFound(e)) { log(`codex reviewer not available — recording as a non-run gate`); return null } throw e }
  }
  if (who === 'kiro')
    return rAgent(`Use the kiro-review skill (\`/kiro-review\`) to drive the Kiro CLI over the surface below, READ-ONLY — do NOT edit; run kiro with \`--model ${KIRO_MODEL}\` (latest Opus). If the Kiro CLI is unavailable, return \`gateNotRun: true\` (with verdict 'blocked', empty findings) — do NOT substitute your own native review and do NOT return a clean/empty result that would count as a passed gate.\n${brief}`, { label, phase: phaseTitle, schema: FINDINGS, agentType: 'general-purpose' })
  return rAgent(`${brief}\n(native claude)`, { label, phase: phaseTitle, schema: FINDINGS })   // native
}
const rank = { BLOCK: 3, CONCERN: 2, OBSERVATION: 1 }
const hasBlocking = (fs) => (fs || []).some(f => f.severity === 'BLOCK' || f.severity === 'CONCERN')
const blockingCount = (fs) => (fs || []).filter(f => f.severity === 'BLOCK' || f.severity === 'CONCERN').length

// Specialist agents differ per install — the plan may assign an agent type (e.g.
// 'nestjs-backend-engineer' or its '-reviewer') that THIS environment doesn't have. We do NOT hardcode
// a registry (it goes stale and wrongly downgrades agents that exist elsewhere). Instead: honor the
// skill-supplied availableAgents when present, and let spawnSpecialist catch any runtime "not found",
// record it in missingAgents, and (only when the user consented via allowGeneralFallback) retry on
// general-purpose. The return surfaces missingAgents so the skill can notify the user.
const missingAgents = new Set()
function resolveAgent(type) {
  if (typeof type !== 'string' || !type) return 'general-purpose'
  if (AVAILABLE_AGENTS && !AVAILABLE_AGENTS.includes(type)) { missingAgents.add(type); return ALLOW_GENERAL_FALLBACK ? 'general-purpose' : type }
  return type
}
async function spawnSpecialist(brief, opts) {
  try { return await agent(brief, opts) }
  catch (e) {
    const msg = String((e && e.message) || e)
    const notFound = opts.agentType && opts.agentType !== 'general-purpose' && /agent type .*not found|not a valid agent|unknown agent|no such agent|available agents:/i.test(msg)
    if (notFound) {
      missingAgents.add(opts.agentType)
      if (ALLOW_GENERAL_FALLBACK) { log(`agentType "${opts.agentType}" not available in this environment — using general-purpose`); return await agent(brief, { ...opts, agentType: 'general-purpose' }) }
    }
    throw e
  }
}

// ── StructuredOutput schemas ────────────────────────────────────────────────────
const PLAN = {
  type: 'object', additionalProperties: false,
  required: ['planName', 'tasks', 'layers'],
  properties: {
    planName: { type: 'string' },
    planPath: { type: 'string' },
    tasks: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'agent', 'reviewer', 'title', 'writeScope', 'acceptance', 'validate'],
        properties: {
          id: { type: 'string' }, agent: { type: 'string' }, reviewer: { type: 'string' },
          title: { type: 'string' }, description: { type: 'string' },
          writeScope: { type: 'array', items: { type: 'string' } },
          dependsOn: { type: 'array', items: { type: 'string' } },   // ids of tasks whose output this needs; layers MUST place those earlier
          acceptance: { type: 'array', items: { type: 'string' } },
          validate: { type: 'string' },
          stackSkill: { type: ['string', 'null'] },   // '/nextjs' | '/laravel' | '/rust' | null
        },
      },
    },
    layers: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
  },
}
const FINDINGS = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['approve', 'clean', 'concerns', 'blocked', 'revise', 'reject'] },
    findings: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'file', 'issue'],
        properties: {
          severity: { type: 'string', enum: ['BLOCK', 'CONCERN', 'OBSERVATION'] },
          file: { type: 'string' }, line: { type: 'integer' },
          issue: { type: 'string' }, evidence: { type: 'string' }, suggestedFix: { type: 'string' },
        },
      },
    },
    gateNotRun: { type: 'boolean' },   // TRUE ⇒ the configured reviewer (e.g. kiro CLI) could NOT run — must count as a NON-run gate, never clean
  },
}
const FIX_RESULT = { type: 'object', additionalProperties: false, required: ['applied'], properties: { applied: { type: 'boolean' }, notes: { type: 'string' } } }
const TASK_RESULT = {
  type: 'object', additionalProperties: false,
  required: ['taskId', 'status', 'validatePassed'],
  properties: {
    taskId: { type: 'string' }, status: { type: 'string', enum: ['passed', 'blocked'] }, validatePassed: { type: 'boolean' },
    filesTouched: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
    // D3 — non-destructive failure handling. When validate is RED, the engineer re-runs it against the
    // untouched base (in its worktree) and partitions the failures so the build can tell "I broke this"
    // from "already broken / not mine". `committed` MUST be true whenever the engineer wrote+committed its
    // slice (even on a red whole-suite validate) so the commit survives on its task branch and is never lost.
    blockedReason: { type: 'string', enum: ['none', 'in_scope', 'preexisting_out_of_scope', 'engineer_incomplete'] },
    newFailuresVsBaseline: { type: 'array', items: { type: 'string' } },   // failures THIS task introduced (not on the base) — the ones that truly block it
    preexistingFailures: { type: 'array', items: { type: 'string' } },     // failures already red on the base / outside writeScope — NOT this task's to fix
    committed: { type: 'boolean' },                                        // true ⇒ the slice is committed on the task branch (recoverable even if blocked)
    commitSha: { type: 'string' },                                         // the slice's commit SHA on the task branch — recovery anchor for a blocked-but-committed slice
  },
}
const INTEGRATE_RESULT = {
  type: 'object', additionalProperties: false,
  required: ['merged', 'conflicted', 'validatePassed'],
  properties: { merged: { type: 'array', items: { type: 'string' } }, conflicted: { type: 'array', items: { type: 'string' } }, validatePassed: { type: 'boolean' } },
}
const VERDICT = { type: 'object', additionalProperties: false, required: ['real'], properties: { real: { type: 'boolean' }, reason: { type: 'string' } } }
const STATUS_ACK = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } }

// ── live status writer: deep-merge a small JSON patch into .ulpi/workflows/<id>.json ──
// One cheap (haiku, low-effort) Bash agent per call — the workflow sandbox has no FS access, so an agent
// does the write. ONLY ever called from the SEQUENTIAL orchestrator (never inside parallel()), so writes
// never overlap and no lock is needed. `tasks` and `phases` are objects keyed by id/name so jq's `*`
// deep-merges a patch in place. Non-fatal by contract: a failed status write is logged and ignored — it
// must NEVER block delivery. The `<<'WFPATCH'` heredoc is single-quoted so the JSON is taken verbatim.
function statusPatchBrief(patch) {
  return `Bookkeeping ONLY — update the ship-playbook live status file. Do NOT touch the run, the git tree, or any other file. Run these bash commands exactly:
F='${STATUS_FILE}'
mkdir -p "$(dirname "$F")"
[ -f "$F" ] || echo '{}' > "$F"
cat > "$F.patch" <<'WFPATCH'
${JSON.stringify(patch)}
WFPATCH
jq -s '.[0] * .[1] * {updatedAt:(now|todateiso8601)}' "$F" "$F.patch" > "$F.tmp" && jq -e . "$F.tmp" >/dev/null && mv "$F.tmp" "$F" && rm -f "$F.patch"
The \`*\` operator deep-merges objects recursively, so tasks/phases keyed by id/name update in place while arrays (openRegister) are replaced. Report ok:true if the final mv succeeded (status file is valid JSON), else ok:false with the error. Keep it to these few commands.`
}
async function statusStep(patch, label) {
  if (!TRACK_STATUS) return
  try { await rAgent(statusPatchBrief(patch), { label: `status:${label}`, schema: STATUS_ACK, agentType: 'general-purpose', model: 'haiku', effort: 'low' }) }
  catch (e) { log(`status update "${label}" failed (non-fatal): ${String((e && e.message) || e)}`) }
}

// ── checkpoint resume: read the status file we maintain and SKIP work already marked done ─────────
// This is DURABLE resume that does NOT depend on the runtime's agent-result cache (which any template
// edit or plan re-normalization invalidates, forcing a full rebuild). At build start, read the per-task
// status from the status file; buildPlan then skips rebuilding anything already done. Off when there's no
// status file or CFG.checkpointResume === false (then it's a normal full build).
const CHECKPOINT_RESUME = TRACK_STATUS && CFG.checkpointResume !== false
const CHECKPOINT_SCHEMA = { type: 'object', additionalProperties: false, required: ['tasks'], properties: { tasks: { type: 'object', additionalProperties: { type: 'string' } }, detail: { type: 'string' } } }
async function readCheckpoints() {
  if (!CHECKPOINT_RESUME) return {}
  const r = await rAgent(`READ-ONLY checkpoint read for a ship-playbook RESUME — do NOT modify anything. If the status file ${STATUS_FILE} exists, read it and return \`tasks\` = an object mapping each task id to its current .tasks[<id>].status string (e.g. {"TASK-001":"passed","TASK-002":"blocked","TASK-003":"integrated"}). If the file is missing or has no .tasks, return tasks:{}. This lets the build SKIP rebuilding work already marked done.`, { label: 'checkpoints', phase: 'Build', schema: CHECKPOINT_SCHEMA, model: 'haiku', effort: 'low', agentType: 'general-purpose' })
  return (r && r.tasks) || {}
}

// ── slice-scoping: a per-task review must judge only the task's OWN slice ─────────
// Match a finding's file against a task's writeScope (exact file, directory boundary, or simple glob
// prefix). Used to (a) keep the fix loop from burning rounds on findings the engineer can't touch, and
// (b) separate in-scope defects from cross-task end-state gaps another task owns. No writeScope ⇒ don't
// over-filter (treat as in scope) so a malformed plan never silently swallows real findings.
function fileInScope(file, writeScope) {
  if (!file) return false
  if (!Array.isArray(writeScope) || !writeScope.length) return true
  const norm = (s) => String(s).replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '').replace(/^\.$/, '')
  const root = norm(ROOT)
  const stripRoot = (s) => (root && s.startsWith(root + '/')) ? s.slice(root.length + 1) : s   // absolute → repo-relative
  const f = stripRoot(norm(file))
  const scopes = writeScope.map(w => stripRoot(norm(w))).filter(Boolean)   // strip ROOT from BOTH sides; drop empty/'/'/'.'-only
  if (!scopes.length) return true                                     // no real scope → don't over-filter (never swallow a finding)
  return scopes.some(p => {
    const star = p.indexOf('*')
    if (star < 0) return f === p || f.startsWith(p + '/')              // exact file, or directory boundary
    const pre = p.slice(0, star)                                       // literal prefix before the first '*'
    const suf = p.slice(p.lastIndexOf('*') + 1)                        // literal suffix after the last '*'
    return f.startsWith(pre) && f.endsWith(suf)                        // simple glob: prefix AND suffix (never all-false on a leading '*')
  })
}
const isBlocking = (f) => f && (f.severity === 'BLOCK' || f.severity === 'CONCERN')

// ── briefs ──────────────────────────────────────────────────────────────────────
const branchFor = (t) => `wf/build/${t.id}`
const fixBranchFor = (t, n) => `wf/build/${t.id}-fix${n}`

// The rest-of-plan context a per-task reviewer needs to attribute end-state gaps to the task that OWNS
// them (so it doesn't BLOCK the current slice for work a later task will deliver). Compact: id, title,
// and the files each other task owns.
function otherTasksBrief(plan, t) {
  const others = (plan.tasks || []).filter(x => x && x.id !== t.id)
  if (!others.length) return ''
  const lines = others.map(x => `  - ${x.id}: ${x.title || ''} — owns ${(x.writeScope || []).join(', ') || '(unspecified)'}`).join('\n')
  return `\nThis is a MID-BUILD review of ONE slice of a ${(plan.tasks || []).length}-task plan. The tree is PARTIALLY migrated — these OTHER tasks may NOT have landed yet, and each OWNS the files listed (an unmet end-state condition in those files is THEIR job, not ${t.id}'s):\n${lines}\n`
}

function planBrief(prompt) {
  return `Follow the plan-to-task-list-with-dag methodology for this request, UNATTENDED (do NOT ask
the user anything — pick the mode that fits the request: EXPANSION/HOLD/REDUCTION). Request:\n${prompt}\n
Ground every path in the real repo at ${ROOT}; never invent files. Decompose into atomic tasks (≤3
files each). For EVERY task assign an engineer \`agent\` and set \`reviewer\` = that agent name +
'-reviewer'. ${AVAILABLE_AGENTS ? `Choose \`agent\` ONLY from the agents that exist in THIS environment: ${AVAILABLE_AGENTS.join(', ')}. Pick the closest specialist; if none fits use 'general-purpose'. Set \`reviewer\` to the agent's '-reviewer' ONLY if that exact name is also in that list, otherwise 'general-purpose'. Do NOT invent agent names outside that list.` : `Prefer the closest specialist over general-purpose.`} Set \`stackSkill\` to the slash-skill to enforce for the
task's stack ('/nextjs','/laravel','/rust',…) or null. Give each task writeScope, 2–3 acceptance
criteria (≥1 failure/edge), and a validate command.
DEPENDENCIES & LAYERING ARE LOAD-BEARING — the build integrates layer-by-layer with a barrier, so a task
that runs before the work it needs is integrated builds on a BROKEN base and fails. Therefore:
- Set \`dependsOn\` on EVERY task to the ids of tasks whose output it needs: a migration/table, a
  catalog/registry row, a route or link target, an exported symbol it imports, a fixture, or a locked
  test another task grows. Be exhaustive — a missing edge is what causes "required upstream not integrated"
  build failures.
- \`layers[][]\` MUST be a valid TOPOLOGICAL ORDER of \`dependsOn\`: every task appears in a layer strictly
  AFTER all tasks in its \`dependsOn\`. Never place a task in the same or an earlier layer than something it
  depends on.
- Each task's \`validate\` must exercise ONLY that task's own slice — NOT a whole-suite/e2e that can't pass
  until every task lands. A slice's validate must be greenable the moment that slice (plus its declared
  deps) is integrated.
- If two pieces CANNOT each validate independently — neither's validate passes until both land (e.g. a
  registry and the locked test that asserts that exact registry, which mutually block) — they are ONE
  unit: MERGE them into a single task. Do not split work that can't be validated separately.
Write .ulpi/plans/<name>.md + .json (JSON is the source of truth; render MD from it). Return planName,
planPath, tasks[] (incl. dependsOn), and layers[][] (a topological order of the parallel execution layers).`
}
function founderBrief(plan, who) {
  const lens = who === 'native' ? 'as native claude' : `via the ${who} harness (READ-ONLY, do NOT edit)`
  return `Founder-review the plan ${plan.planPath || plan.planName} (.md + .json) ${lens}, against the
codebase at ${ROOT}. Verify: every filesToModify path exists; filesToCreate has a creator; markdown↔
JSON task ids/paths/deps agree; reuse claims are real; scope/mode fits; the dependency graph is
acyclic; each task has a failure/edge acceptance criterion; no phantom paths. Hard rules: ${HARD_RULES}.
DAG ORDERING (the build integrates layer-by-layer, so mis-ordering = build-time failures) — BLOCK on:
- any task whose acceptance criteria or \`validate\` need state ANOTHER task produces (a table/migration,
  catalog/registry row, route, exported symbol, fixture, or a test that task grows) without that task in
  its \`dependsOn\` AND in a strictly EARLIER layer;
- \`layers[][]\` not being a valid topological order of \`dependsOn\` (a task at/before something it depends on);
- a \`validate\` that is a whole-suite/e2e which cannot pass until every task lands — validate must be
  slice-scoped (greenable once this slice + its declared deps are integrated);
- two tasks split such that NEITHER can validate without the other (mutually blocking) — they must be merged.
Classify findings BLOCK/CONCERN/OBSERVATION with file:line evidence; verdict approve/revise/reject.`
}
function planFixBrief(plan, findings) {
  return `Fix the plan ${plan.planPath || plan.planName} for ALL of these founder-review findings.
Edit the .json FIRST (source of truth), then re-render the .md from it so they never drift. Address
every BLOCK and CONCERN (and OBSERVATIONs where cheap). Findings: ${JSON.stringify(findings)}.
Report applied:true. Do NOT touch code — only the plan files.`
}
function engineerBrief(t) {
  return `You are the specialist engineer (${t.agent}) for ${t.id}: ${t.title}.
${t.description || ''}
${t.stackSkill ? `If the ${t.stackSkill} skill is available here, you MUST use it and honor its rules; if it is not installed, proceed on your own best-practice rubric and note that in your report.` : ''}
Work in THIS isolated worktree. Base your task branch on the latest integrated state:
  git checkout -B ${branchFor(t)} ${WORKING_BRANCH}
${(t.dependsOn && t.dependsOn.length) ? `Your dependencies (${t.dependsOn.join(', ')}) are ALREADY merged into ${WORKING_BRANCH} — the build verified this before launching you, so their tables/rows/routes/exports exist in your branch. BUILD ON them; do NOT re-create or stub them, and import/consume them as the real thing.` : ''}
WORKTREE SETUP (this is a fresh checkout — it may lack deps/env): if your validate needs them and node_modules is absent, run \`pnpm install --frozen-lockfile\` (or the repo's documented install); if your tests need env, the repo .env (when present) is at ${ROOT}/.env — symlink or copy it into the worktree (NEVER print, log, or inline secret VALUES; reference by location only). DB/Temporal/object-store services are expected to be running on the host — if a service the validate needs is unreachable, say so in notes and treat its failures as environment (preexisting), not your slice.
Edit ONLY: ${(t.writeScope || []).join(', ')}. Honor the locked rules: ${HARD_RULES}.
Meet ALL acceptance criteria: ${(t.acceptance || []).join(' | ')}.
COMMIT YOUR WORK NO MATTER WHAT — as soon as your slice is implemented, commit it so it is never lost:
  git add -A && git commit -m "${t.id}: ${t.title}"
Set committed:true and report commitSha. (The build can integrate a correct slice even if the WHOLE validate is red for reasons outside your scope — but only if you committed.)
Now run your validate and CLASSIFY the result (this is how the build avoids discarding correct work):
  Run: ${t.validate}
  • GREEN → status:'passed', validatePassed:true, blockedReason:'none'.
  • RED → for EACH failure, decide whether YOUR change caused it: re-run the failing test(s) against the UNTOUCHED base (e.g. \`git stash\` your changes — or compare against ${WORKING_BRANCH} — re-run the same command, then restore your changes with \`git stash pop\`). Partition the failures:
      - newFailuresVsBaseline = failures present WITH your change but NOT on the base, OR inside your writeScope → these are YOURS.
      - preexistingFailures = failures already red on the untouched base, or originating in files OUTSIDE your writeScope (another task/area owns them) → NOT yours.
    Then: if newFailuresVsBaseline is non-empty → status:'blocked', validatePassed:false, blockedReason:'in_scope' (these are real defects you introduced — FIX them and re-run; do not stop while any remain). If your slice is correct and ALL red is preexisting/out-of-scope (newFailuresVsBaseline empty) → status:'blocked', validatePassed:false, blockedReason:'preexisting_out_of_scope', list the preexistingFailures (test names + the files/area that own them). If you ran out of steps before finishing the slice → blockedReason:'engineer_incomplete'.
  NEVER relax a rule, stub a dependency, or delete/weaken an unrelated test to force green. Honesty beats a fake pass — a correctly-classified preexisting_out_of_scope is integrated and surfaced, a faked green corrupts the tree.
Report taskId, status, validatePassed, blockedReason, newFailuresVsBaseline, preexistingFailures, committed, commitSha, filesTouched.
Implement ONLY this task.`
}
// merge ONE task branch onto the working branch — used by the per-task pipeline (under the merge lock).
// Merge-only for the clean case: the engineer already validated its slice, and the FINAL workspace-validate
// gate is the authoritative whole-tree check, so a clean merge does NOT re-run VALIDATE_ALL (a full
// typecheck/lint per task would be brutal). On CONFLICT it does NOT just bail — it RESOLVES intentionally
// (combine both sides, never drop either's contribution), then runs the task's own validate to confirm the
// resolution is sound; it only aborts if the conflict genuinely can't be combined or validate still fails.
function mergeBrief(t, branch) {
  return `On ${WORKING_BRANCH} in ${ROOT}, merge the single task branch ${branch} (task ${t.id}: ${t.title || ''}).
  0. IDEMPOTENCY (a prior attempt may have died AFTER side-effects under retry — handle both windows).
     The check below is about THIS SPECIFIC branch (${branch}) — NEVER a task-id prefix (the original
     task commit and a fix branch share the \`${t.id}:\` prefix, so an id-grep would wrongly skip a real
     fix-branch merge and discard the fix). Do, in order:
     a. \`git -C ${ROOT} merge --abort 2>/dev/null || true\` to clear any leftover in-progress merge
        (MERGE_HEAD) — safe, as the slice is validated in its worktree and any resolution is re-derivable.
     b. ALREADY-MERGED short-circuit for ${branch} SPECIFICALLY — treat as already merged (report
        merged[]=[${branch}], skip the merge, run step 3 cleanup as a tolerant no-op) ONLY with POSITIVE
        proof that THIS branch's tip is already on ${WORKING_BRANCH}: \`git -C ${ROOT} rev-parse --verify
        ${branch}\` SUCCEEDS and \`git -C ${ROOT} merge-base --is-ancestor ${branch} ${WORKING_BRANCH}\`
        SUCCEEDS. Do NOT use \`git log --grep="^${t.id}:"\` (matches sibling commits). If the branch ref is
        GONE, do NOT assume it merged — fall through; step 1 will fail-CLOSED below.
  1. \`git -C ${ROOT} checkout ${WORKING_BRANCH}\`, then \`git -C ${ROOT} merge --no-edit ${branch}\`.
     - If it reports "Already up to date" → already merged (report merged[]=[${branch}], go to cleanup).
     - If \`${branch}\` does NOT exist (\`fatal: ... not something we can merge\` / "merge: ${branch} - not
       something we can merge") → do NOT report merged. Report merged[]=[] and conflicted[]=[${branch}]
       (the branch isn't present and is not provably on ${WORKING_BRANCH}) — FAIL CLOSED so the task is
       recorded not-on-branch (it rebuilds on resume), NEVER falsely marked integrated.
     - If it reports "MERGE_HEAD exists / you have not concluded your merge", \`git -C ${ROOT} merge --abort\` and re-merge.
  2. IF IT CONFLICTS — do NOT blindly abort. RESOLVE it intentionally, and VALIDATE BEFORE COMMITTING so a
     broken resolution never lands on ${WORKING_BRANCH} (the merge stays in-progress — MERGE_HEAD present —
     so \`git merge --abort\` is still valid if it fails):
     - For each conflicted file, read BOTH sides (\`git -C ${ROOT} diff\`). The two sides are the
       already-integrated work and ${t.id}'s changes; they are almost always ADDITIVE (e.g. both append a
       row to a catalog/registry, both add an export). Combine them so NEITHER side's contribution is lost
       — keep both additions; where the same line was edited, merge the SEMANTICS of both, never discard
       one side. Resolve within ${t.id}'s scope (${(t.writeScope || []).join(', ')}) and the overlapping lines only.
     - \`git -C ${ROOT} add -A\` to mark resolved, but do NOT commit yet. Then run \`${t.validate}\` on the
       resolved (still-uncommitted) tree to confirm the resolution is sound. The validate must cover ONLY the
       project at ${ROOT} — never scan \`.claude/worktrees/**\` or sibling agent dirs
       (\`.factory\`,\`.gemini\`,\`.opencode\`,\`.trae\`,\`.kiro\`,\`.vibe\`); if the configured command would walk them
       (e.g. \`eslint .\` / \`tsc\` without excludes), restrict it (add \`--ignore-pattern '.claude/**'\`, scope the
       tsconfig invocation, or scope to ${t.id}'s writeScope) — a failure originating UNDER those transient
       worktrees is NOT a resolution failure and must NOT trigger an abort.
     - If \`${t.validate}\` passes → \`git -C ${ROOT} commit --no-edit\` to finalize, and report under merged[].
     - ONLY if you cannot combine both sides without dropping work, OR \`${t.validate}\` genuinely fails (real
       project errors, not worktree pollution) → \`git -C ${ROOT} merge --abort\` (valid — nothing was
       committed) and report under conflicted[] (a real blocker needing attention — never force a destructive
       or broken resolution, and never leave a broken merge committed on the branch).
  3. On a clean merge / validated resolution / already-merged, REMOVE the transient build worktree — all
     TOLERANT (a retry may find them already gone): find its path via \`git -C ${ROOT} worktree list
     --porcelain\`, \`git -C ${ROOT} worktree remove --force <path> 2>/dev/null || true\`, then
     \`git -C ${ROOT} branch -D ${branch} 2>/dev/null || true\`, then \`git -C ${ROOT} worktree prune\`.
Report merged[] = [${branch}] (verbatim) if it merged cleanly OR you resolved+validated it; conflicted[] =
[${branch}] if you aborted; and validatePassed (the \`${t.validate}\` result if you ran it after resolving, else true).`
}
function reviewerBrief(t, plan) {
  return `READ-ONLY review of ${t.id} (${t.title || ''}) as it now stands on ${WORKING_BRANCH} in ${ROOT}.
SCOPE — review ONLY this task's OWN slice, judged from its CURRENT integrated state (NOT a single stale commit):
  read the current content of its writeScope files (e.g. \`git -C ${ROOT} show ${WORKING_BRANCH}:<file>\` or open them), and
  list its commits with \`git -C ${ROOT} log --oneline --grep="^${t.id}:" -- ${(t.writeScope || []).join(' ')}\`
  (there may be an initial commit AND later \`${t.id}: fix#N\` commits — review the LATEST state, never just the first commit).
Do NOT review files outside ${(t.writeScope || []).join(', ')} — those belong to other tasks. Judge ${t.id}
against its OWN acceptance criteria, verifying each is truly met not just claimed: ${(t.acceptance || []).join(' | ')}.
${otherTasksBrief(plan, t)}
CRITICAL — do NOT block this task because the whole-codebase END-STATE is not yet reached. The build lands
one slice at a time, so when you review ${t.id} the tree is half-migrated. If a locked/end-state invariant
is unmet because a LATER task (see the list above) owns the file that resolves it — an old paste/api-key
path still present, a route or link target not built yet, an export whose consumer task hasn't landed,
a not-yet-removed legacy path — that is EXPECTED mid-build: record it as an OBSERVATION attributing it to
the owning task id; it is NEVER a BLOCK or CONCERN against ${t.id}. Likewise do NOT flag pre-existing code
${t.id} did not touch (outside its writeScope) as ${t.id}'s defect, and do NOT call a symbol ${t.id}
exports for a later consumer task "dead wiring".
BLOCK / CONCERN ONLY for a defect WITHIN ${t.id}'s writeScope that ${t.id} can fix NOW: an acceptance
criterion it does not actually meet, a bug it introduced, ${t.stackSkill ? `the ${t.stackSkill} rules not followed in its OWN files, ` : ''}or an internal inconsistency in its own diff.
Honor the locked rules INSOFAR as they apply to ${t.id}'s own changes — a global end-state rule a later
task satisfies is not this task's blocker: ${HARD_RULES}.
Do NOT execute build/test/validate commands — you are READ-ONLY and a test runner must create temp dirs,
which EPERMs in this sandbox. The engineer already ran "${t.validate}" green in its worktree before this
task integrated, and the workflow runs a FINAL whole-workspace validate after the build — so review
STATICALLY against the diff. A check you cannot run in this sandbox is an OBSERVATION, NEVER a BLOCK or
CONCERN. Do NOT edit. verdict 'blocked' only if a real IN-SCOPE BLOCK remains, else 'clean'/'concerns';
classify findings BLOCK/CONCERN/OBSERVATION with file:line (sandbox/environment limits, and end-state gaps
another task owns = OBSERVATION).`
}
function fixBrief(t, findings, n) {
  return `Fix ${t.id} for these reviewer findings. In THIS isolated worktree, branch off the latest:
  git checkout -B ${fixBranchFor(t, n)} ${WORKING_BRANCH}
Edit ONLY ${(t.writeScope || []).join(', ')}. ${t.stackSkill ? `Use the ${t.stackSkill} skill. ` : ''}Make
${t.validate} pass, then commit with a ${t.id}:-prefixed message so the reviewer can find this fix:
  git add -A && git commit -m "${t.id}: fix${n} — <one-line summary>"
Findings: ${JSON.stringify(findings)}. Report status/validatePassed/filesTouched.`
}
const implBrief = (plan) => `Full implementation review of everything built for ${plan.planName} on
${WORKING_BRANCH} in ${ROOT}, against the plan and the hard rules (${HARD_RULES}).
THIS IS THE END-STATE GATE. The per-task reviews were deliberately scoped to one slice each and DEFERRED
whole-codebase invariants to you — so now that ALL ${(plan.tasks || []).length} tasks have landed, the
end-state MUST actually hold. Verify the migration is COMPLETE, not half-done: legacy paths the plan
removes are truly gone (e.g. no old paste/api-key path remains), routes/links the plan adds exist and
resolve, exported symbols are consumed (no dead wiring at end-state), and every plan acceptance criterion
is met across the integrated whole. A gap here IS a real BLOCK/CONCERN now — unlike mid-build, there is no
"a later task will fix it". Read the diff + surrounding context, verify each finding before reporting, do
NOT edit. Do NOT execute build/test/lint commands — you are READ-ONLY and a test runner must create temp
dirs, which EPERMs in this sandbox; the integrate step already ran the workspace validate on the final
tree, so review STATICALLY. A check you cannot run in this sandbox is an OBSERVATION, NEVER a BLOCK or
CONCERN. verdict + findings BLOCK/CONCERN/OBSERVATION with file:line.`
const auditBrief = `READ-ONLY launch-readiness (go-live) audit of ${ROOT}. Check the hard invariants
(${HARD_RULES}), build/test/lint honesty, secrets (redact values), tenancy/security, dead wiring,
placeholder/TODO in shipping code. Do NOT execute build/test/lint commands — you are READ-ONLY and a
test runner must create temp dirs, which EPERMs in this sandbox; review STATICALLY. A check you cannot
run in this sandbox is an OBSERVATION, NEVER a BLOCK or CONCERN. verdict + findings
BLOCK/CONCERN/OBSERVATION with file:line + evidence (sandbox/environment limits = OBSERVATION).`

// a verdict that asserts the gate did NOT pass — must never read as clean even with empty findings.
const BLOCKING_VERDICTS = new Set(['blocked', 'revise', 'reject'])
// run a single read-only review by the chosen executor (who ∈ native|codex|kiro), tagging the source.
// Returns NULL when the reviewer agent DIED (so the caller can distinguish "did not run" from "ran clean"
// — a died configured reviewer must never count as a clean gate); otherwise { findings, verdict }. The
// VERDICT is surfaced so the caller can catch a blocking verdict paired with empty findings (else such a
// review would contribute nothing and read as clean).
async function reviewOnce(who, label, phaseTitle, brief) {
  const r = await routeReview(who, brief, `${label}:${who}`, phaseTitle)
  if (!r || r.gateNotRun) return null   // agent died OR the configured reviewer (e.g. kiro CLI) could not run ⇒ NOT a clean gate
  return { findings: (r.findings || []).map(f => ({ ...f, source: who })), verdict: r.verdict }
}

// adversarial verify (go-live-audit pattern): refute by CODE; BLOCK also refuted by SPEC. Keep a
// finding only if a lens still affirms it (all-lenses-refute ⇒ dropped).
const REFUTE_CODE = `You are an adversarial verifier in ${ROOT} (read-only). REFUTE the finding below by
reading the cited file + its callers/tests. Common refutations: handled upstream, misreads the code,
the scenario can't occur, the cited line/evidence is wrong, or a test pins it as intended. Set
real=true ONLY if it still stands after a genuine refutation attempt. Finding:\n`
const REFUTE_SPEC = `You are an adversarial verifier in ${ROOT} (read-only). REFUTE the finding below BY
SPEC: read the authority docs (root CLAUDE.md / spec / the affected member's CLAUDE.md). Maybe the
behavior is intended or explicitly in/out of scope — a documented scoping decision is not a defect.
Set real=true ONLY if it still stands against the spec. Finding:\n`
async function verifyFinding(f, phaseTitle) {
  const desc = `[${f.severity}] ${f.file}${f.line ? ':' + f.line : ''}\n${f.issue}\nEvidence: ${f.evidence || '(none)'}`
  const lenses = f.severity === 'BLOCK' ? ['code', 'spec'] : ['code']
  const verdicts = (await parallel(lenses.map(lens => () =>
    agentGate(() => agent((lens === 'code' ? REFUTE_CODE : REFUTE_SPEC) + desc, { label: `verify:${lens}`, phase: phaseTitle, schema: VERDICT }))))).filter(Boolean)
  const stillReal = verdicts.length === 0 ? true : verdicts.some(v => v.real)   // keep unless every lens refutes
  return stillReal ? f : null
}

// ingest the composed go-live-audit result (its severities: blocker/high/medium/low; statuses:
// confirmed/uncertain/rejected). Finder FINDINGS are refutable code claims → go through dedupVerify.
// GATE failures (a typecheck/test/lint/build command that exited non-zero) are command FACTS, not code
// claims — they must BYPASS adversarial refute (else a verifier can drop a real failed launch gate into a
// clean verdict), so they're returned separately as non-refutable markers.
function ingestGoLiveFindings(result) {
  const sev = { blocker: 'BLOCK', high: 'CONCERN', medium: 'OBSERVATION', low: 'OBSERVATION' }
  return (result && result.findings ? result.findings : [])
    .filter(f => f.status !== 'rejected')
    .map(f => ({ severity: sev[f.severity] || 'OBSERVATION', file: f.file, line: f.line, issue: f.title, evidence: f.evidence, source: 'native', phase: 'audit' }))
}
function ingestGoLiveGateMarkers(result) {
  return (result && result.gates ? result.gates : [])
    .filter(g => g && g.passed === false)
    .flatMap(g => {
      const fails = g.failures || []
      // a failed gate with NO itemized failures (e.g. its agent died: passed:false, failures:[]) must
      // still emit a marker — otherwise the failed launch gate is silently dropped → false converged.
      if (!fails.length) return [{ severity: 'BLOCK', file: g.gate, issue: `${g.gate} gate failed: ${g.summary || 'gate did not complete / no detail reported'}`, source: 'native', phase: 'audit', blockedTask: true }]
      return fails.map(x => ({ severity: 'BLOCK', file: x.member, issue: `${g.gate} gate failed: ${x.detail}`, source: 'native', phase: 'audit', blockedTask: true }))
    })
}

// ── plan review by the chosen reviewer (native|codex|kiro) — bounded; exits clean OR non-convergence ──
// The reviewer (founder review) is routed per PLAN_REVIEW; the FIX is always native (the orchestrator
// edits the plan files). Cap iterations AND stop the moment a fix round fails to REDUCE the blocking
// count — a strong reviewer keeps surfacing fresh CONCERNs on a plan, so never grind. (OBSERVATIONs
// never block; only BLOCK/CONCERN count toward looping.)
async function planReviewLoop(plan, who) {
  let prev = Infinity
  let fixed = false                                    // did any fix round edit the plan files on disk?
  for (let i = 0; i < MAX_REVIEW; i++) {
    const r = await routeReview(who, founderBrief(plan, who), `plan-review:${who}:${i}`, 'Plan review')
    if (!r) return { ran: false, fixed }               // reviewer agent died → the plan gate did NOT run
    if (r.gateNotRun) return { ran: false, fixed }     // configured reviewer (e.g. kiro CLI) could not run → NOT a clean/approved plan
    const n = blockingCount(r.findings)
    if (r.verdict === 'approve' || n === 0) return { ran: true, fixed }     // clean — OBSERVATIONs never block
    if (n >= prev) return { ran: true, fixed }         // not improving → stop churning, proceed to build
    prev = n
    await rAgent(planFixBrief(plan, r.findings), { label: `plan-fix:${i}`, phase: 'Plan review', schema: FIX_RESULT })   // fix is always native
    fixed = true                                       // plan files on disk now differ from the in-memory `plan` → caller must reload before build
  }
  return { ran: true, fixed }
}

// ── worktree hygiene: prune dangling build worktrees ────────────────────────────
// Build agents run with isolation:'worktree', which creates full repo checkouts under
// .claude/worktrees/. Committed ones are NOT auto-removed and accumulate across runs — and since
// `tsc`/`eslint .` don't respect .gitignore, the integrate validate walks those sibling checkouts and
// fails on pollution no matter what the task code does. This cleans this workflow's leftovers (and any
// prior run's) so the gate measures the code, not stray worktrees.
const CLEANUP_SCHEMA = { type: 'object', additionalProperties: false, required: ['removed'], properties: { removed: { type: 'integer' }, remaining: { type: 'integer' }, detail: { type: 'string' } } }
async function cleanupWorktrees(when) {
  return rAgent(`Worktree hygiene in ${ROOT} — remove this workflow's transient build worktrees so they can't pollute later validates. READ git state, then:
1. \`git -C ${ROOT} worktree list --porcelain\` — identify worktrees whose path is under \`.claude/worktrees/\` OR whose branch matches \`wf/build/*\` (these are ship-playbook build worktrees, including prior runs' leftovers). Do NOT touch the main working tree (${ROOT}) or any unrelated worktree.
2. For each: \`git -C ${ROOT} worktree remove --force <path>\` to remove the transient checkout. Then delete its branch with \`git -C ${ROOT} branch -d <branch>\` — lowercase \`-d\`, the SAFE "delete only if already merged" form. CRITICAL: do NOT \`-D\` (force-delete) an unmerged \`wf/build/*\` branch — an un-integrated engineer commit is RECOVERABLE work (a slice that failed its gate can be cherry-picked later), so a leftover unmerged branch is intentional recovery state, never garbage. \`-d\` keeps merged branches pruned while preserving unmerged ones.
3. \`git -C ${ROOT} worktree prune\` to clear stale admin entries.
4. Clear any LEFTOVER in-progress merge on the main checkout (a build/merge agent may have died mid-merge, leaving MERGE_HEAD that would break the next merge / the final-validate checkout): \`git -C ${ROOT} merge --abort 2>/dev/null || true\`. Do NOT discard committed work — this only aborts an UNcommitted in-progress merge.
Never delete non-worktree files and never remove the main checkout. Report removed (count), remaining (worktrees still present), and a short detail.`, { label: `cleanup-worktrees:${when}`, phase: 'Plan', schema: CLEANUP_SCHEMA })
}

// ── build/review handoff: who WRITES & who REVIEWS each task (independent picks) ──────────
// buildHarness (who WRITES) ∈ native|codex|kiro; taskReview (who REVIEWS) ∈ skip|native|codex|kiro.
// They are independent — write codex, review kiro is fine. native = the plan's specialist agent
// (resolveAgent + missingAgents); codex = the codex plugin agent; kiro = the hand-over-to-kiro skill
// (build) / kiro-review skill (review) wrapping the Kiro CLI, each with a self-implementation fallback
// if the skill/CLI is absent.
function buildSpawn(t, brief, label) {
  return buildGate(() => {
  if (BUILD_HARNESS === 'codex')
    return spawnSpecialist(`You MAY edit files to implement this task.\n${brief}`, { label, phase: 'Build', schema: TASK_RESULT, agentType: 'codex:codex-rescue', isolation: 'worktree' })
  if (BUILD_HARNESS === 'kiro')
    return spawnSpecialist(`Use the hand-over-to-kiro skill (\`/hand-over-to-kiro\`) to delegate implementing this task to kiro-cli — it writes an injection-safe prompt to a file and launches kiro via its helper in this worktree, then verifies the diff. This is UNATTENDED: use the skill's \`implement\` mode (scoped write trust \`fs_read,fs_write,execute_bash\`) — do NOT use \`--trust-all-tools\` (unsafe-by-default; the harness blocks it). Run kiro with \`--model ${KIRO_MODEL}\` (latest Opus). ${t.stackSkill ? `Have kiro FOLLOW the ${t.stackSkill} skill — kiro has no Skill tool, so pass it to the hand-over helper as \`--skill <name>\` (the matching \`.kiro/skills/<name>\`), which injects the skill into kiro's prompt over stdin. ` : ''}If the hand-over-to-kiro skill or kiro-cli is unavailable, say so and implement the task yourself.\n${brief}`, { label, phase: 'Build', schema: TASK_RESULT, agentType: 'general-purpose', isolation: 'worktree' })
  return spawnSpecialist(brief, { label, phase: 'Build', schema: TASK_RESULT, agentType: resolveAgent(t.agent), isolation: 'worktree' })
  })
}
// only called when TASK_REVIEW !== 'skip' (the skip case is handled in buildPlan, no reviewer spawned).
function taskReviewSpawn(t, brief, label) {
  return agentGate(() => {
  if (TASK_REVIEW === 'codex')
    return spawnSpecialist(`READ-ONLY review — do NOT edit. If you cannot drive the codex CLI here, return \`gateNotRun: true\` (verdict 'blocked', empty findings) — do NOT return a clean result.\n${brief}`, { label, phase: 'Build', schema: FINDINGS, agentType: 'codex:codex-rescue' })
  if (TASK_REVIEW === 'kiro')
    return spawnSpecialist(`Use the kiro-review skill (\`/kiro-review\`) to review this task via the Kiro CLI, READ-ONLY, with \`--model ${KIRO_MODEL}\` (latest Opus); if the Kiro CLI is unavailable, return \`gateNotRun: true\` (verdict 'blocked', empty findings) — do NOT substitute a native review and do NOT return a clean result.\n${brief}`, { label, phase: 'Build', schema: FINDINGS, agentType: 'general-purpose' })
  return spawnSpecialist(brief, { label, phase: 'Build', schema: FINDINGS, agentType: resolveAgent(t.reviewer) })   // native
  })
}

// ── steps 10–11: build across DAG layers, engineer → integrate → reviewer → fix ──
// CHECKPOINT RESUME: `prior` is the per-task status read from the status file at build start. A task the
// status file marks done is NOT rebuilt — durable resume independent of the runtime's agent cache. Per task:
//   • 'passed' → skip the engineer AND the review (fully done; re-record it).
//   • on-branch ('integrated'|'reviewing'|'fixing'|'blocked' — code proven ON WORKING_BRANCH) → skip the
//     ENGINEER, RE-REVIEW with the current reviewer (rescues ex-false-blocks WITHOUT a rebuild).
//   • everything else ('pending'|'dev_failed'|'dev_done'|'dep_blocked'|'building'|unknown) → build it.
//     'dev_done' = engineer passed but the merge did NOT land; 'dep_blocked' = never built. Neither is on
//     the branch, so both rebuild on resume and NEVER seed the dependency gate.
async function buildPlan(plan, prior) {
  const byId = new Map(plan.tasks.map(t => [t.id, t]))
  // derive layers topologically from dependsOn when the plan has none (never collapse deps into one layer)
  const layers = (plan.layers && plan.layers.length) ? plan.layers : (topoLayers(plan.tasks) || [plan.tasks.map(t => t.id)])
  const N = layers.length
  const out = []
  const inScopeBlockers = (review, t) => (review.findings || []).filter(f => isBlocking(f) && fileInScope(f.file, t.writeScope))
  const crossTaskCount = (review, t) => (review.findings || []).filter(f => isBlocking(f) && !fileInScope(f.file, t.writeScope)).length
  const priorOf = (id) => (prior && prior[id]) || null
  // ON_BRANCH = statuses that PROVE the task's code reached WORKING_BRANCH. NOT 'dev_done' (engineer
  // passed but merge failed → code on its task branch only) and NOT 'dep_blocked' (never built).
  const ON_BRANCH = new Set(['integrated', 'reviewing', 'fixing', 'blocked'])
  // DAG DEPENDENCY GATE — `integrated` = tasks whose code is actually ON the working branch a task cuts
  // from. Seeded from checkpoint tasks proven on-branch; this run's integrations are added as they land.
  // A task builds ONLY once every dependsOn is in this set — never on a branch missing the code it needs.
  const integrated = new Set(plan.tasks.filter(t => priorOf(t.id) === 'passed' || ON_BRANCH.has(priorOf(t.id))).map(t => t.id))
  const missingDeps = (t) => (t.dependsOn || []).filter(d => !integrated.has(d))
  let nDone = 0, nReReview = 0, nDepBlocked = 0

  // match a task's branch against an integrate agent's reported merged[] — id-agnostic, formatting-tolerant.
  const mergedHas = (integ, t) => ((integ && integ.merged) || []).map(s => String(s).trim()).some(m => m === branchFor(t) || m === t.id || m.endsWith('/' + t.id))
  // one scoped review of a task → normalized {verdict, findings, _errored?}. NULL (agent died) and
  // gateNotRun (kiro/codex CLI absent) and THROW all map to a blocked _errored verdict — never a silent pass.
  const reviewTask = (t, n) => taskReviewSpawn(t, reviewerBrief(t, plan), n ? `review:${t.id}#${n}` : `review:${t.id}`)
    .then(r => (r && !r.gateNotRun) ? r : { verdict: 'blocked', findings: [], _errored: true },
          () => ({ verdict: 'blocked', findings: [], _errored: true }))

  // PER-TASK PIPELINE UNIT — build → integrate (under mergeLock) → review → bounded fix-loop. Reviews fire
  // the moment THIS task integrates (not batched per layer). alreadyOnBranch tasks (checkpoint re-review)
  // skip build+integrate and go straight to re-review. Records EXACTLY ONE terminal entry in out/layerPatch.
  async function runTask(t, alreadyOnBranch, layerPatch) {
    // D3: set when the engineer's slice is correct + committed but its validate is red ONLY from
    // pre-existing/out-of-scope failures — carried to the terminal record as a non-blocking note.
    let preexistingNote = null
    try {
      if (!alreadyOnBranch) {
        const r = await buildSpawn(t, engineerBrief(t), `build:${t.id}`).catch(() => null)   // throw/null → dev_failed
        // D3 — DO NOT discard correct, committed work. A slice whose ONLY red is pre-existing / out-of-scope
        // (the engineer introduced NO new failures and COMMITTED its work) is INTEGRATED, not thrown away; the
        // pre-existing failures are surfaced as a note and the FINAL workspace-validate still gates the tree.
        const newFails = (r && Array.isArray(r.newFailuresVsBaseline)) ? r.newFailuresVsBaseline : null
        const preexistingOnly = !!r && r.status !== 'passed' && r.blockedReason === 'preexisting_out_of_scope'
          && newFails !== null && newFails.length === 0 && r.committed === true
        if (!r || (r.status !== 'passed' && !preexistingOnly)) {
          const why = !r ? 'engineer agent errored (no result)'
            : (r.blockedReason === 'engineer_incomplete' ? 'engineer did not finish the slice'
               : `engineer introduced in-scope failures it must fix: ${(newFails || []).slice(0, 6).join('; ') || '(in-scope validate failure)'}`)
          out.push({ task: t.id, status: 'blocked', reason: why, fixes: 0, findings: [] })
          layerPatch[t.id] = { status: 'dev_failed' }; return
        }
        if (preexistingOnly) {
          preexistingNote = `slice correct + committed, but its validate (${t.validate}) is red only from pre-existing / out-of-scope failures it does not own: ${(r.preexistingFailures || []).slice(0, 8).join('; ') || '(unspecified)'} — needs a separate owning task; the final workspace-validate still gates the tree`
          log(`${t.id}: integrating despite a red whole-validate — failures are pre-existing/out-of-scope (engineer introduced none)`)
        }
        // integrate JUST this task's branch — serialized by the merge lock (concurrent merges would race);
        // the merge agent RESOLVES conflicts (combining both sides), not bails — see mergeBrief.
        // .catch→null so a THROWN integrate (e.g. schema-validation failure) collapses to the SAME
        // not-on-branch path as a null/conflict (→ dev_done, rebuilds on resume) — never the outer catch's
        // 'blocked', which is an ON_BRANCH status and would wrongly seed the dependency gate on resume.
        const integ = await mergeLock(() => rAgent(mergeBrief(t, branchFor(t)), { label: `integrate:${t.id}`, phase: 'Build', schema: INTEGRATE_RESULT })).catch(() => null)
        if (!mergedHas(integ, t)) {   // conflict / null integrate → code on the task branch only, NOT on WORKING_BRANCH
          out.push({ task: t.id, status: 'blocked', reason: `engineer passed but the merge did not land (conflict / integrate failure) — ${t.id}'s code is on its task branch only, not on ${WORKING_BRANCH}`, fixes: 0, findings: [] })
          layerPatch[t.id] = { status: 'dev_done' }; return
        }
        integrated.add(t.id)                 // code is now on the working branch → unblocks dependents (next layer)
        layerPatch[t.id] = { status: 'integrated', ...(preexistingNote ? { preexistingOnly: true } : {}) }
      }
      // on the branch now → review THIS task (skip if no per-task reviewer)
      if (TASK_REVIEW === 'skip') { out.push({ task: t.id, status: 'passed', fixes: 0, findings: [], ...(preexistingNote ? { preexistingNote } : {}) }); layerPatch[t.id] = { status: 'passed' }; return }
      let review = await reviewTask(t)
      let fixes = 0
      let blockers = inScopeBlockers(review, t)           // ONLY findings this task can act on
      let deferred = crossTaskCount(review, t)
      try {
        while (blockers.length && fixes < MAX_FIX) {
          fixes++
          await buildSpawn(t, fixBrief(t, blockers, fixes), `fix:${t.id}#${fixes}`).catch(() => null)
          await mergeLock(() => rAgent(mergeBrief(t, fixBranchFor(t, fixes)), { label: `reintegrate:${t.id}#${fixes}`, phase: 'Build', schema: INTEGRATE_RESULT }))
          review = await reviewTask(t, fixes)
          blockers = inScopeBlockers(review, t)
          deferred = crossTaskCount(review, t)
        }
      } catch (e) {
        log(`fix loop for ${t.id} errored (non-fatal): ${String((e && e.message) || e)}`)
        if (!blockers.length) blockers = [{ severity: 'BLOCK', file: t.id, issue: `fix/re-integrate agent errored: ${String((e && e.message) || e)}` }]
      }
      // a reviewer that returned a BLOCKING verdict but NO in-scope finding and NO deferred cross-task gap
      // is ambiguous — block (don't silently pass). Guarded by !deferred so a verdict driven by correctly-
      // deferred end-state gaps does NOT over-block the slice.
      const verdictBlocks = BLOCKING_VERDICTS.has(review.verdict) && !blockers.length && !deferred
      const status = (blockers.length || review._errored || verdictBlocks) ? 'blocked' : 'passed'
      out.push({ task: t.id, status, fixes, findings: (review.findings || []).filter(f => fileInScope(f.file, t.writeScope)), crossTaskDeferred: deferred, ...(preexistingNote ? { preexistingNote } : {}), ...(verdictBlocks ? { reason: `reviewer returned a blocking verdict (${review.verdict}) with no itemized in-scope finding` } : {}) })
      layerPatch[t.id] = { status, fixes, ...(deferred ? { crossTaskDeferred: deferred } : {}) }
    } catch (e) {
      // any uncaught throw in the unit → record blocked, never lose the task or crash the build. Use the
      // GROUND TRUTH (integrated.has) for the persisted status: an on-branch task → 'blocked' (re-review on
      // resume); a task whose code never landed → 'dev_failed' (rebuild on resume). Never mislabel a
      // not-on-branch task as the ON_BRANCH 'blocked'.
      log(`task ${t.id} pipeline errored (non-fatal): ${String((e && e.message) || e)}`)
      out.push({ task: t.id, status: 'blocked', reason: `task pipeline errored: ${String((e && e.message) || e)}`, fixes: 0, findings: [] })
      layerPatch[t.id] = { status: integrated.has(t.id) ? 'blocked' : 'dev_failed' }
    }
  }

  for (let li = 0; li < N; li++) {
    const layer = layers[li].map(id => byId.get(id)).filter(Boolean)
    const layerPatch = {}   // mutated by concurrent runTask closures — safe (JS single-threaded; each record is synchronous)
    // CHECKPOINT partition (status file is the source of truth for "already done")
    const doneSkip = layer.filter(t => priorOf(t.id) === 'passed')                         // skip entirely
    const onBranch = layer.filter(t => ON_BRANCH.has(priorOf(t.id)))                        // skip engineer, re-review
    const fresh = layer.filter(t => priorOf(t.id) !== 'passed' && !ON_BRANCH.has(priorOf(t.id)))
    // DAG GATE: a fresh task may build ONLY if every dependency is already integrated on WORKING_BRANCH.
    // A task with an un-integrated dep is recorded 'dep_blocked' (pointing at the ROOT) and NOT built; its
    // dependents cascade-block. 'dep_blocked' is not on-branch, so on resume it re-evaluates and is NEVER
    // seeded into the dependency gate. (Intra-layer tasks are independent — all deps live in EARLIER layers,
    // already integrated before this layer starts — so the gate is decided once here, before the pipeline.)
    const depBlocked = fresh.filter(t => missingDeps(t).length > 0)
    const toBuild = fresh.filter(t => missingDeps(t).length === 0)
    for (const t of doneSkip) { out.push({ task: t.id, status: 'passed', fixes: 0, findings: [], resumed: true }); layerPatch[t.id] = { status: 'passed' }; nDone++ }
    for (const t of depBlocked) {
      const miss = missingDeps(t)
      out.push({ task: t.id, status: 'blocked', reason: `dependency not integrated: ${miss.join(', ')} — its code is not on ${WORKING_BRANCH}, so ${t.id} cannot be built on it; fix the upstream task first`, fixes: 0, findings: [], blockedOn: miss })
      layerPatch[t.id] = { status: 'dep_blocked', blockedOn: miss }
      nDepBlocked++
    }
    nReReview += onBranch.length

    // persist doneSkip/depBlocked + mark the tasks we'll work on as in_progress (ONE sequential write,
    // BEFORE the parallel pipeline — never write the status file from inside the concurrent pipeline).
    await statusStep({ status: 'building', phases: { build: { status: 'in_progress', layer: `${li + 1}/${N}` } },
      tasks: { ...Object.fromEntries([...toBuild, ...onBranch].map(t => [t.id, { status: 'in_progress' }])), ...layerPatch } }, `L${li}-start`)

    // PER-TASK PIPELINE: each task flows build→integrate→review→fix as its own unit, concurrently within the
    // layer (merges serialized by mergeLock; builds/reviews parallel under their gates). The `await` is the
    // LAYER BARRIER — layer N+1 starts only once every task here is integrated (the DAG gate depends on it).
    await parallel([
      ...toBuild.map(t => () => runTask(t, false, layerPatch)),
      ...onBranch.map(t => () => runTask(t, true, layerPatch)),
    ])

    // defensive: every worked task must have recorded an outcome (runTask always does; this catches a bug)
    const recorded = new Set(out.map(o => o.task))
    for (const t of [...toBuild, ...onBranch]) if (!recorded.has(t.id)) { out.push({ task: t.id, status: 'blocked', reason: 'task unit produced no result', fixes: 0, findings: [] }); layerPatch[t.id] = { status: 'blocked' } }
    // ONE sequential write of the whole layer's outcomes — race-free (after the barrier)
    await statusStep({ tasks: layerPatch }, `L${li}-done`)
  }
  if (nDone || nReReview || nDepBlocked) log(`build: ${nDone} already-passed skipped, ${nReReview} on-branch re-reviewed (no rebuild), ${nDepBlocked} blocked on un-integrated dependencies`)
  return out
}

// dedup (keep highest severity per file/line/issue) + dual-lens adversarial verify of the actionable
// findings; survivors are the open register for step 14.
async function dedupVerify(all, phaseTitle) {
  const byKey = new Map()
  for (const f of all) {
    const key = `${f.file}:${Math.floor((f.line || 0) / 5)}:${(f.issue || '').slice(0, 40)}`
    const prev = byKey.get(key)
    if (!prev || rank[f.severity] > rank[prev.severity]) byKey.set(key, { ...f, alsoReportedBy: prev ? [prev.source] : [] })
    else prev.alsoReportedBy = [...(prev.alsoReportedBy || []), f.source]
  }
  const deduped = [...byKey.values()]
  const actionable = deduped.filter(f => f.severity === 'BLOCK' || f.severity === 'CONCERN')
  const verified = await parallel(actionable.map(f => () => verifyFinding(f, phaseTitle)))
  return verified.filter(Boolean)
}

// ── preflight: ROOT must be a git work tree with a committed WORKING_BRANCH ──────
// The build phase creates task branches and git-merges them (git checkout -B / commit / merge in
// ROOT). In a non-git folder — or a repo with no commit on WORKING_BRANCH — every build agent's git
// command fails and the run collapses into blocked-task noise. Verify once up front and abort cleanly.
phase('Plan')
const PREFLIGHT_SCHEMA = { type: 'object', additionalProperties: false, required: ['isGitRepo'], properties: { isGitRepo: { type: 'boolean' }, currentBranch: { type: 'string' }, workingBranchExists: { type: 'boolean' }, baseSha: { type: 'string' }, detail: { type: 'string' } } }
const pre = await rAgent(`Report git readiness for a build that will checkout/commit/merge in ${ROOT} — READ-ONLY, do NOT init/create/modify anything. Run \`git -C ${ROOT} rev-parse --is-inside-work-tree\`: isGitRepo=true only if it prints "true" with exit 0 (false on any error / "not a git repository"). If a repo: report currentBranch (\`git -C ${ROOT} rev-parse --abbrev-ref HEAD\`) and workingBranchExists = whether \`git -C ${ROOT} rev-parse --verify --quiet "${WORKING_BRANCH}^{commit}"\` succeeds (the branch exists AND has a commit to branch from). Also report baseSha = the output of \`git -C ${ROOT} rev-parse ${WORKING_BRANCH}\` when the branch exists (the branch TIP at run start — the pre-run baseline the final gate uses to tell pre-existing failures from ones this run introduced); '' if it does not exist.`, { label: 'preflight:git', phase: 'Plan', schema: PREFLIGHT_SCHEMA })
if (!pre || pre.isGitRepo !== true) {
  return { converged: false, ranReal: false, aborted: `ROOT is not a git repository: ${ROOT}. ship-playbook builds by creating task branches and git-merging them onto ${WORKING_BRANCH}, so it needs a git work tree. Run \`git init\` and commit a baseline (or point root at the actual repo), then relaunch.`, goLive: GO_LIVE }
}
if (pre.workingBranchExists === false) {
  return { converged: false, ranReal: false, aborted: `ROOT is a git repo but WORKING_BRANCH "${WORKING_BRANCH}" has no commit to branch from (current branch: ${pre.currentBranch || 'unknown'}). The build needs a committed base — make a baseline commit on "${WORKING_BRANCH}" (or set workingBranch to an existing committed branch), then relaunch.`, goLive: GO_LIVE }
}
// D2 — the pre-run baseline anchor: the WORKING_BRANCH tip BEFORE this run's tasks land. The final gate
// compares a red tree against this commit to ATTRIBUTE failures (pre-existing vs run-introduced) instead of
// blaming the run for breakage it inherited. '' when unknown (the gate then can't attribute, only report).
const BASE_SHA = (pre && typeof pre.baseSha === 'string' && pre.baseSha.trim()) ? pre.baseSha.trim() : ''
// Clear dangling build worktrees from prior runs BEFORE building, so the integrate validate starts clean.
await cleanupWorktrees('preflight')

// Derive parallel execution layers as a topological sort of dependsOn (by levels). Returns null on a
// cycle (no valid build order). Only considers in-plan deps. Used when a plan has no explicit layers, so
// a dependency-bearing plan is still built in correct DAG order instead of collapsed into one layer.
function topoLayers(tasks) {
  const ids = new Set(tasks.map(t => t && t.id))
  const deps = new Map(tasks.map(t => [t.id, (t.dependsOn || []).filter(d => ids.has(d))]))
  const done = new Set(); const layers = []
  let remaining = tasks.map(t => t.id)
  while (remaining.length) {
    const ready = remaining.filter(id => deps.get(id).every(d => done.has(d)))
    if (!ready.length) return null            // cycle — no remaining task has all its deps satisfied
    layers.push(ready)
    ready.forEach(id => done.add(id))
    remaining = remaining.filter(id => !done.has(id))
  }
  return layers
}

// Structural sanity check on a plan (supplied OR freshly written) before the build trusts it.
function validatePlan(p) {
  if (!p || !Array.isArray(p.tasks) || !p.tasks.length) return 'no tasks in the plan — nothing to build (verify the plan/planPath reached the script and the plan has a non-empty tasks[])'
  const ids = new Set(p.tasks.map(t => t && t.id))
  const bad = p.tasks.filter(t => !t || !t.id || !t.agent || !Array.isArray(t.writeScope) || !t.writeScope.length || !t.validate)
  if (bad.length) return `plan has ${bad.length} task(s) missing required build fields (id / agent / writeScope[] / validate) — re-run plan-to-task-list-with-dag or fix the plan json`
  // dependsOn edges must reference real tasks — checked INDEPENDENTLY of layering so dangling deps never slip through
  const unknownDeps = [...new Set(p.tasks.flatMap(t => (t && Array.isArray(t.dependsOn) ? t.dependsOn : []).filter(d => !ids.has(d))))]
  if (unknownDeps.length) return `plan has dependsOn edges referencing unknown task ids: ${unknownDeps.join(', ')} — fix the plan json`
  const hasDeps = p.tasks.some(t => t && Array.isArray(t.dependsOn) && t.dependsOn.length)
  if (Array.isArray(p.layers) && p.layers.length) {
    const unknown = [...new Set(p.layers.flat().filter(id => !ids.has(id)))]
    if (unknown.length) return `plan layers reference unknown task ids: ${unknown.join(', ')}`
    // every task MUST be scheduled in some layer, else the build (which only walks layers) silently skips it
    const flat = p.layers.flat()
    const covered = new Set(flat)
    const uncovered = p.tasks.map(t => t && t.id).filter(id => id && !covered.has(id))
    if (uncovered.length) return `plan layers omit ${uncovered.length} task(s) entirely: ${uncovered.join(', ')} — every task must be scheduled in some layer (in topological order), or it is silently never built`
    // and EXACTLY once — a duplicated id is built/integrated twice (two engineers on the same branch)
    const dups = [...new Set(flat.filter((id, i) => flat.indexOf(id) !== i))]
    if (dups.length) return `plan layers schedule task id(s) more than once: ${dups.join(', ')} — each task must appear in exactly one layer, or the build builds and integrates it multiple times`
    // DAG ordering: the build integrates layer-by-layer, so every task's dependencies MUST sit in a
    // STRICTLY earlier layer. A task scheduled at/before a dep builds on a base where that dep isn't
    // integrated and fails (e.g. "required upstream not integrated"). Reject such a plan rather than
    // building it on a broken base — follow the DAG, don't paper over it at runtime.
    const layerOf = new Map()
    p.layers.forEach((layer, i) => layer.forEach(id => { if (!layerOf.has(id)) layerOf.set(id, i) }))
    const misordered = []
    for (const t of p.tasks) {
      if (!t || !Array.isArray(t.dependsOn) || !t.dependsOn.length) continue
      const ti = layerOf.get(t.id)
      if (ti == null) continue
      for (const dep of t.dependsOn) {
        if (!ids.has(dep)) { misordered.push(`${t.id} dependsOn "${dep}" which is not a task in the plan`); continue }
        const di = layerOf.get(dep)
        if (di == null || di >= ti) misordered.push(`${t.id} (layer ${ti}) depends on ${dep} (${di == null ? 'not scheduled in any layer' : 'layer ' + di}) — a dependency MUST integrate in an earlier layer`)
      }
    }
    if (misordered.length) return `plan DAG is mis-ordered — ${misordered.length} task(s) are scheduled before their dependencies, so they would build on a base where required upstream isn't integrated: ${misordered.slice(0, 6).join('; ')}${misordered.length > 6 ? ` … (+${misordered.length - 6} more)` : ''}. Fix the layers (topological order) or the dependsOn edges and re-plan.`
  } else if (hasDeps && !topoLayers(p.tasks)) {
    // no explicit layers but there ARE dependencies → the build will derive layers topologically; reject
    // only if the dependsOn graph has a CYCLE (no valid build order exists).
    return `plan has dependsOn edges but no layers, and the dependency graph has a CYCLE — no valid build order exists. Break the cycle (merge mutually-dependent tasks) or provide topological layers.`
  }
  return null
}
// RESUME loader: an agent reads the existing plan file (the sandbox can't), validates it against the
// real repo, normalizes it, and returns the PLAN object — it must NOT re-plan.
const loadPlanBrief = (path) => `Load an EXISTING ship-playbook plan to RESUME from at the build phase — do NOT re-plan or invent tasks.
Read the plan at ${path} in ${ROOT} (if it is a .md, also read its sibling .json — the JSON is the source of truth). Return it as structured output: planName, planPath, tasks[] (each: id, agent, reviewer, title, writeScope[], dependsOn[], acceptance[], validate, stackSkill|null) and layers[][] (the parallel execution layers as task-id arrays).
Normalize, don't redesign. Map the common DAG-plan field ALIASES to the canonical names so nothing is silently dropped: assignedAgent → agent; validation (an array of commands) → validate (join the commands with ' && '); acceptanceCriteria → acceptance; if a task has no reviewer, set it to its agent name + '-reviewer'; fold findingRefs/implementation into description. Preserve each task's dependsOn as written (else derive it from a top-level dependencyMap if present, else []). For layers: use top-level layers[][] if present; else use parallelization.lanes ONLY if it is a valid topological order of dependsOn; else derive a topological order from dependsOn (else one layer with every task id). Also: if a task's validate uses the \`pnpm … test -- <file>\` form, REWRITE it to \`pnpm --filter <pkg> exec vitest run <path>\` (the \`--\` form makes vitest ignore the positional and run the WHOLE package, not just the file). Return exactly the tasks the file defines. If the file is missing or has no tasks, return an empty tasks[].`

// ── the playbook: ONE pass — (write plan → plan review) OR resume → build → impl review → audit → return ──
// NO automatic recursion. The verified findings are RETURNED as feedback; the skill presents them and
// the user decides whether to run a fix round (a Workflow can't AskUserQuestion mid-run, and an
// autonomous fix-loop is what produced the multi-hour grind). Impl review (step 12) is the
// plan-vs-implementation gate and is the last work the loop used to recurse on — now it just reports.
phase('Plan')                                              // step 3 — write a plan, OR resume from a supplied one
let plan
if (RESUME_PLAN) {
  // RESUME: caller supplied an already-created, already-reviewed DAG plan → skip plan + plan-review.
  plan = EXISTING_PLAN || await rAgent(loadPlanBrief(PLAN_PATH), { label: 'load-plan', phase: 'Plan', schema: PLAN, agentType: 'general-purpose' })
  log(EXISTING_PLAN ? 'resuming from supplied plan object — skipping plan + plan-review' : `resuming from plan at ${PLAN_PATH} — skipping plan + plan-review`)
} else {
  const planAgentType = PLAN_HARNESS === 'codex' ? 'codex:codex-rescue' : 'general-purpose'
  const planPrompt = PLAN_HARNESS === 'kiro'
    ? `Use the Kiro CLI to produce this plan; if it is unavailable, do it yourself.\n${planBrief(PROMPT)}`
    : planBrief(PROMPT)
  // the plan MUST be written — if codex isn't installed here, fall back to general-purpose rather than crash.
  try { plan = await rAgent(planPrompt, { label: `plan:${PLAN_HARNESS}`, phase: 'Plan', schema: PLAN, agentType: planAgentType }) }
  catch (e) {
    if (PLAN_HARNESS === 'codex' && isAgentNotFound(e)) { log('codex not available for planning — falling back to general-purpose'); plan = await rAgent(planBrief(PROMPT), { label: 'plan:fallback', phase: 'Plan', schema: PLAN, agentType: 'general-purpose' }) }
    else throw e
  }
}
const _planError = validatePlan(plan)
if (_planError) {
  await statusStep({ status: 'aborted', phases: { plan: { status: 'failed', detail: _planError } } }, 'plan-failed')
  return { converged: false, ranReal: false, aborted: _planError, goLive: GO_LIVE }
}
// D1 — non-fatal slice-scope warning. The `pnpm … test -- <file>` form does NOT filter to that file:
// vitest treats the post-`--` token as a passthrough positional and runs the WHOLE package, so unrelated
// pre-existing breakage leaks into the slice gate. Not an abort (D3's engineer self-classification + the
// final gate's attribution catch the fallout, and the plan-gen skill is where it's truly prevented) — but
// logged so a mis-scoped plan is visible. Prefer `pnpm --filter <pkg> exec vitest run <path>`.
for (const t of (plan.tasks || [])) {
  if (/(?:^|\s)(?:test|run)\s+--\s+\S/.test(String(t.validate || '')))
    log(`plan WARNING ${t.id}: validate "${t.validate}" uses the \`test -- <file>\` form — vitest ignores the positional after \`--\` and runs the WHOLE package (pre-existing breakage leaks into this slice's gate). Prefer \`pnpm --filter <pkg> exec vitest run <path>\`.`)
}
// Read the CHECKPOINT (prior per-task status) BEFORE writing plan-done — otherwise the plan-done write
// below would clobber every task back to 'pending' and the resume would rebuild everything. On a fresh
// run priorStatus is empty ⇒ all tasks seed to 'pending'.
const priorStatus = await readCheckpoints()
// Populate the live status file with the adopted plan; seed each task's status from the checkpoint so a
// resume PRESERVES what's already done (new/unknown tasks default to 'pending').
await statusStep({
  plan: { name: plan.planName, path: plan.planPath || null, taskCount: plan.tasks.length },
  phases: { plan: { status: RESUME_PLAN ? 'skipped' : 'done' } },
  tasks: Object.fromEntries(plan.tasks.map(t => [t.id, { title: t.title || '', agent: t.agent || '', branch: branchFor(t), status: priorStatus[t.id] || 'pending' }])),
}, 'plan-done')

// Plan review (steps 4–9) — SKIPPED when resuming (the supplied plan is already reviewed). Otherwise
// reviewer per PLAN_REVIEW: 'skip' | 'native' | 'codex' | 'kiro'. Plan-QUALITY gate (scope,
// decomposition, phantom paths). ONE bounded loop; exits on no BLOCK/CONCERN or non-convergence.
let planReviewRan = null   // null = skipped/resume; true = the configured plan reviewer ran; false = it could not run (e.g. kiro CLI absent)
if (!RESUME_PLAN && PLAN_REVIEW !== 'skip') {
  phase('Plan review')
  await statusStep({ status: 'plan_review', phases: { plan_review: { status: 'in_progress' } } }, 'plan-review-start')
  const pr = await planReviewLoop(plan, PLAN_REVIEW)
  planReviewRan = !!(pr && pr.ran)
  // The fix loop edits the plan FILES on disk; the in-memory `plan` is now stale. Reload it so the BUILD
  // walks the FIXED DAG, not the pre-fix one (the build reads plan.tasks directly — it never re-reads the
  // files). Gated on pr.fixed so a clean review (no edits) skips the extra read. If the reloaded plan
  // fails validation, keep the pre-fix in-memory plan rather than build on a plan we can't parse.
  if (pr && pr.fixed) {
    const reloadPath = plan.planPath || PLAN_PATH
    if (reloadPath) {
      const reloaded = await rAgent(loadPlanBrief(reloadPath), { label: 'reload-fixed-plan', phase: 'Plan review', schema: PLAN, agentType: 'general-purpose' })
      const reErr = reloaded ? validatePlan(reloaded) : 'reload returned no plan'
      if (reErr) log(`reloaded plan after fixes failed validation (${reErr}) — keeping the pre-fix in-memory plan`)
      else { plan = reloaded; await statusStep({ plan: { name: plan.planName, path: plan.planPath || null, taskCount: plan.tasks.length }, tasks: Object.fromEntries(plan.tasks.map(t => [t.id, { title: t.title || '', agent: t.agent || '', branch: branchFor(t), status: priorStatus[t.id] || 'pending' }])) }, 'plan-reloaded') }
    }
  }
  await statusStep({ phases: { plan_review: { status: planReviewRan ? 'done' : 'errored' } } }, 'plan-review-done')
} else {
  await statusStep({ phases: { plan_review: { status: 'skipped' } } }, 'plan-review-skip')
}

phase('Build')                                             // steps 10–11
const buildLog = await buildPlan(plan, priorStatus)        // priorStatus (read above) → skip work already done
await statusStep({ phases: { build: { status: 'done' } } }, 'build-done')

// FINAL workspace-validate gate — the OBJECTIVE end-state check, and the only one that is RESUME-SAFE by
// construction: it re-runs VALIDATE_ALL on the final integrated tree regardless of what the checkpoint
// skipped. Slices can each pass their OWN validate yet break the workspace together (a cross-file type
// error), and the per-task/impl reviewers are static (told the integrate already validated) — so this
// command is the one thing that deterministically catches a non-green tree. A non-pass (or a died gate)
// blocks convergence. This is the "run the full suite on the final branch" gate.
await cleanupWorktrees('pre-final-validate')   // clear stale build worktrees so the gate measures ONLY the project tree
const FINAL_VALIDATE_SCHEMA = { type: 'object', additionalProperties: false, required: ['passed'], properties: { passed: { type: 'boolean' }, detail: { type: 'string' }, segments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'passed'], properties: { name: { type: 'string' }, passed: { type: 'boolean' } } } }, preexistingFailures: { type: 'array', items: { type: 'string' } }, introducedFailures: { type: 'array', items: { type: 'string' } } } }
const fv = await rAgent(`Workspace-validate the integrated tree, with PER-STEP granularity and (on red) PRE-EXISTING-vs-INTRODUCED attribution. Do NOT EDIT source files — but changing git state to check out branches/commits IS allowed and required; restore ${WORKING_BRANCH} when done.
1. \`git -C ${ROOT} checkout ${WORKING_BRANCH}\`, then confirm \`git -C ${ROOT} rev-parse --abbrev-ref HEAD\` == ${WORKING_BRANCH} — the tree under test MUST be ${WORKING_BRANCH}, never the repo's incidental HEAD.
2. The validate is a sequence of \`&&\`-joined steps: ${VALIDATE_ALL}. Run EACH step and record segments[] = [{name, passed}] for every step (e.g. typecheck/lint/test/build) — RUN ALL STEPS even after one fails (do NOT let an early \`&&\` failure hide later steps' status), so the report shows exactly which gates pass. Each step must cover ONLY the project at ${ROOT} — never scan \`.claude/worktrees/**\` or sibling agent dirs (\`.factory\`,\`.gemini\`,\`.opencode\`,\`.trae\`,\`.kiro\`,\`.vibe\`); if a command would walk them (e.g. \`eslint .\`/\`tsc\` without excludes) restrict it (\`--ignore-pattern '.claude/**'\`, scope the tsconfig, or scope to changed paths). NEVER relax a lint/type rule to make it pass. passed=true ONLY if EVERY step exits 0 on ${WORKING_BRANCH}; else passed=false with the first concrete errors in detail.
3. ATTRIBUTION — only if passed=false. ${BASE_SHA ? `The pre-run baseline commit is ${BASE_SHA}. For the failing tests/checks, tell which are PRE-EXISTING vs INTRODUCED by this run: \`git -C ${ROOT} checkout ${BASE_SHA}\`, re-run the SAME failing test(s)/check(s) there, then \`git -C ${ROOT} checkout ${WORKING_BRANCH}\` to restore. preexistingFailures[] = failures that ALSO fail at ${BASE_SHA} (this run did NOT cause them — they need a separate owning task); introducedFailures[] = failures that PASS at ${BASE_SHA} but fail on ${WORKING_BRANCH} (this run regressed them — the real blockers). Do NOT edit during the comparison.` : `No pre-run baseline SHA is available — report failing items in detail without pre-existing/introduced attribution (leave those arrays empty).`}
Report passed, segments[], detail, preexistingFailures[], introducedFailures[].`, { label: 'final-validate', phase: 'Build', schema: FINAL_VALIDATE_SCHEMA })
const workspaceValidatePassed = !!(fv && fv.passed === true)   // null (agent died) OR false ⇒ NOT confirmed green
await statusStep({ phases: { build: { status: 'done', workspaceValidate: workspaceValidatePassed ? 'passed' : 'failed' } } }, 'final-validate')

// Impl review (step 12) — reviewer per IMPL_REVIEW: 'skip' | 'native' | 'codex' | 'kiro'. The
// plan-vs-implementation gate — and now the EXPLICIT end-state gate (see implBrief).
let implFindings = []
let implRan = true   // a configured impl reviewer that DIES is not a clean gate
let implBlockingVerdict = false   // ran, returned a blocking verdict, but no itemized BLOCK/CONCERN
if (IMPL_REVIEW !== 'skip') {
  phase('Impl review')
  await statusStep({ status: 'impl_review', phases: { impl_review: { status: 'in_progress' } } }, 'impl-start')
  const r = await reviewOnce(IMPL_REVIEW, 'impl', 'Impl review', implBrief(plan))   // null = agent died
  implRan = r !== null
  implFindings = r ? r.findings : []
  implBlockingVerdict = implRan && BLOCKING_VERDICTS.has(r.verdict) && !implFindings.some(isBlocking)
  await statusStep({ phases: { impl_review: { status: implRan ? 'done' : 'errored', findings: implFindings.length } } }, 'impl-done')
} else {
  await statusStep({ phases: { impl_review: { status: 'skipped' } } }, 'impl-skip')
}

// Verify (step 14): dedup + adversarially verify the REAL findings → this is the feedback.
phase('Verify')
await statusStep({ status: 'verifying', phases: { verify: { status: 'in_progress' } } }, 'verify-start')
const blockedTasks = buildLog.filter(b => b.status === 'blocked')
// Only REAL findings (reviewer findings on blocked tasks + impl findings) go through adversarial refute —
// a code/spec verifier can legitimately check those. A blocked task itself is a build FACT, not a
// refutable code claim (its `file` is a task id, not a path; a dep_blocked task ran NO code), so it must
// NOT be refutable into a clean verdict. We append a marker per blocked task AFTER verification.
const realFindings = [
  ...blockedTasks.flatMap(b => (b.findings || []).map(f => ({ ...f, source: 'native', phase: 'build' }))),
  ...implFindings.map(f => ({ ...f, phase: 'impl' })),
]
let openRegister = await dedupVerify(realFindings, 'Verify')
// non-refutable markers (NOT routed through adversarial verify): blocked tasks + a died impl reviewer +
// a non-green final workspace validate. These are FACTS — a code/spec refuter cannot argue them away.
const markers = blockedTasks.map(b => ({ severity: 'BLOCK', file: b.task, issue: b.reason || `task ${b.task} did not pass after ${b.fixes || 0} fixes`, source: 'native', phase: 'build', blockedTask: true }))
if (!implRan) markers.push({ severity: 'BLOCK', file: 'impl-review', issue: `impl review (${IMPL_REVIEW}) did not produce a verdict — its agent died; the plan-vs-implementation gate was NOT run`, source: 'native', phase: 'impl', blockedTask: true })
else if (implBlockingVerdict) markers.push({ severity: 'BLOCK', file: 'impl-review', issue: `impl review (${IMPL_REVIEW}) returned a BLOCKING verdict but no itemized finding — the end-state gate did not pass; treat as not-clean and inspect the impl review`, source: 'native', phase: 'impl', blockedTask: true })
if (!workspaceValidatePassed) {
  const seg = (fv && Array.isArray(fv.segments) && fv.segments.length) ? ` [steps: ${fv.segments.map(s => `${s.name}=${s.passed ? 'pass' : 'FAIL'}`).join(', ')}]` : ''
  const intro = (fv && Array.isArray(fv.introducedFailures) && fv.introducedFailures.length) ? ` INTRODUCED by this run (real blockers): ${fv.introducedFailures.slice(0, 8).join('; ')}.` : ''
  const pre = (fv && Array.isArray(fv.preexistingFailures) && fv.preexistingFailures.length) ? ` PRE-EXISTING on the base (not caused by this run — need a separate owning task): ${fv.preexistingFailures.slice(0, 8).join('; ')}.` : ''
  markers.push({ severity: 'BLOCK', file: 'workspace-validate', issue: `workspace validate (${VALIDATE_ALL}) did not pass green on ${WORKING_BRANCH}${seg}${fv && fv.detail ? ': ' + fv.detail : ' (gate agent died — not confirmed)'} — the integrated tree is not green.${intro}${pre}`, source: 'native', phase: 'build', blockedTask: true })
}
openRegister = [...openRegister, ...markers]   // blocked tasks / a dead gate / a non-green tree ALWAYS keep the register non-empty → never a false converged
// Whole-codebase SEMANTIC end-state (legacy paths removed, routes wired) is gated ONLY by impl review;
// with impl review skipped it is unverified even if the tree compiles — surfaced as a caveat (config-
// derived ⇒ resume-safe), not a hard block, since the user opted out of that gate.
const endStateUngated = IMPL_REVIEW === 'skip'
// The go-live audit (step 13) is the heaviest phase — run it ONLY when build+impl are verified-clean AND
// no task is blocked. An implementation with open findings/blocked tasks goes straight back as feedback.
await statusStep({ phases: { verify: { status: 'done', findings: openRegister.length } }, openRegister }, 'verify-done')
let auditRan = null   // null = not attempted; true = produced a verdict; false = died/aborted
if (openRegister.length === 0 && GO_LIVE) {                // step 13 — only when build+impl are clean
  phase('Audit')
  await statusStep({ status: 'auditing', phases: { audit: { status: 'in_progress' } } }, 'audit-start')
  // COMPOSE the proven go-live-audit workflow (a thorough multi-agent native audit) when the skill
  // supplied a filled script; otherwise an inline native finder pass. A DIED audit is NOT a clean audit.
  let auditFindings = []
  let auditGateMarkers = []   // failed launch-gate FACTS — appended after dedupVerify, never refuted
  if (AUDIT_SCRIPT_PATH) {
    // guard the heaviest phase: a throw (composed-script error / non-rate-limit sub-agent death) must be
    // treated as a DIED audit (→ the L966 marker), never crash the run after an otherwise-clean build.
    let result = null
    try { result = await withRetry(() => workflow({ scriptPath: AUDIT_SCRIPT_PATH }), 'go-live-audit') }
    catch (e) { log(`go-live audit workflow threw (treating as died): ${String((e && e.message) || e)}`); result = null }
    auditRan = !!(result && !result.aborted && (('findings' in result) || ('gates' in result)))
    auditFindings = auditRan ? ingestGoLiveFindings(result) : []
    auditGateMarkers = auditRan ? ingestGoLiveGateMarkers(result) : []
  } else {
    const r = await reviewOnce('native', 'audit', 'Audit', auditBrief)   // null = agent died
    auditRan = r !== null
    auditFindings = r ? r.findings : []
    // ran with a blocking verdict but no itemized finding → a launch-readiness FACT, not clean
    if (auditRan && BLOCKING_VERDICTS.has(r.verdict) && !auditFindings.some(isBlocking))
      auditGateMarkers = [{ severity: 'BLOCK', file: 'go-live-audit', issue: 'go-live audit returned a BLOCKING verdict but no itemized finding — launch readiness NOT confirmed', source: 'native', phase: 'audit', blockedTask: true }]
  }
  openRegister = await dedupVerify(auditFindings.map(f => ({ ...f, phase: 'audit' })), 'Verify')
  openRegister = [...openRegister, ...auditGateMarkers]   // a failed launch gate can never be refuted into clean
  if (!auditRan) openRegister = [...openRegister, { severity: 'BLOCK', file: 'go-live-audit', issue: 'go-live audit did not produce a verdict (agent/workflow died or aborted) — launch readiness NOT confirmed', source: 'native', phase: 'audit', blockedTask: true }]
  await statusStep({ phases: { audit: { status: auditRan ? 'done' : 'errored', findings: openRegister.length } }, openRegister }, 'audit-done')
} else {
  await statusStep({ phases: { audit: { status: 'skipped', detail: GO_LIVE ? 'findings remain' : 'goLive off' } } }, 'audit-skip')
}

// Remove this run's build worktrees so they don't pollute the next run (or the user's own tooling).
await cleanupWorktrees('final')

// Final overall state in the live status file (done = clean; needs_fix = openRegister non-empty).
const converged = openRegister.length === 0
await statusStep({
  status: converged ? 'done' : 'needs_fix',
  result: {
    converged,
    openRegisterCount: openRegister.length,
    workspaceValidatePassed, endStateUngated,
    build: buildLog.map(b => ({ task: b.task, status: b.status, fixes: b.fixes, ...(b.crossTaskDeferred ? { crossTaskDeferred: b.crossTaskDeferred } : {}), ...(b.preexistingNote ? { preexistingNote: b.preexistingNote } : {}) })),
    reviewConfig: { planHarness: PLAN_HARNESS, planReview: PLAN_REVIEW, buildHarness: BUILD_HARNESS, taskReview: TASK_REVIEW, implReview: IMPL_REVIEW },
    missingAgents: [...missingAgents],
  },
}, 'final')

// LAST STEP: on a CONVERGED (fully clean) run, archive the delivered plan to .ulpi/plans/done/ so the
// active plans dir holds only in-flight work. SKIPPED when needs_fix (a fix round may reuse the plan) and
// when resuming from a supplied external plan that lives outside .ulpi/plans. Non-fatal — a failed archive
// never affects the return.
let planArchived = false
if (converged && plan && plan.planPath) {
  try {
    const ARCHIVE_SCHEMA = { type: 'object', additionalProperties: false, required: ['moved'], properties: { moved: { type: 'array', items: { type: 'string' } }, detail: { type: 'string' } } }
    const a = await rAgent(`Archive the COMPLETED plan in ${ROOT} (it converged clean — fully delivered). The plan path is "${plan.planPath}" (resolve relative to ${ROOT} if not absolute); its markdown sibling is the same path with a .md extension (and the .json is the .json extension). Move BOTH the .json and the .md into ${ROOT}/.ulpi/plans/done/:
1. \`mkdir -p ${ROOT}/.ulpi/plans/done\`
2. For each of the plan's .json and .md files that EXISTS and currently lives under ${ROOT}/.ulpi/plans/ (NOT already in done/, and NOT outside .ulpi/plans — do not move an external/supplied plan): \`git -C ${ROOT} mv <file> .ulpi/plans/done/\` if it's git-tracked, else \`mv <file> ${ROOT}/.ulpi/plans/done/\`. Overwrite if a same-named file is already in done/.
Do NOT touch any other plan or file. Report moved[] (the files you moved) and a short detail.`, { label: 'archive-plan', phase: 'Verify', schema: ARCHIVE_SCHEMA, model: 'haiku', effort: 'low', agentType: 'general-purpose' })
    planArchived = !!(a && Array.isArray(a.moved) && a.moved.length)
    if (planArchived) await statusStep({ plan: { archivedTo: `.ulpi/plans/done/` } }, 'plan-archived')
  } catch (e) { log(`plan archive failed (non-fatal): ${String((e && e.message) || e)}`) }
}

return {
  // converged = real work ran AND no verified findings survived. Otherwise openRegister IS the feedback
  // for the user — they decide whether to run a fix round (this workflow does not loop on its own).
  converged,
  ranReal: true,
  plan: plan.planName,
  planArchived,   // TRUE when a converged run moved the plan to .ulpi/plans/done/
  planSupplied: RESUME_PLAN,    // TRUE when this run RESUMED from a pre-built/pre-reviewed plan (plan + plan-review skipped)
  build: buildLog.map(b => ({ task: b.task, status: b.status, fixes: b.fixes, ...(b.crossTaskDeferred ? { crossTaskDeferred: b.crossTaskDeferred } : {}), ...(b.preexistingNote ? { preexistingNote: b.preexistingNote } : {}) })),
  openRegister,                 // verified findings = the feedback to show the user
  missingAgents: [...missingAgents],   // specialist agent types the plan wanted that aren't installed here → skill notifies the user
  // the review/build roles this run used (so the skill can report them honestly and caveat the verdict)
  reviewConfig: { planHarness: PLAN_HARNESS, planReview: PLAN_REVIEW, buildHarness: BUILD_HARNESS, taskReview: TASK_REVIEW, implReview: IMPL_REVIEW },
  // TRUE when NOTHING checked the build: no per-task reviewer AND no impl review. converged then means
  // "engineer validates passed", not "reviewed clean" — the skill must caveat this.
  noReviewGate: TASK_REVIEW === 'skip' && IMPL_REVIEW === 'skip',
  planReviewRan,                                            // null = skipped/resume; false ⇒ a configured plan reviewer could not run — skill must caveat
  implReviewRan: IMPL_REVIEW === 'skip' ? null : implRan,   // false ⇒ a configured impl reviewer DIED (gate not run) — skill must caveat
  auditRan,                                                 // null = not attempted; false = audit died/aborted (NOT launch-confirmed)
  blockedTaskCount: blockedTasks.length,                    // tasks that did not pass (incl. dep-blocked) — block convergence
  workspaceValidatePassed,                                  // the final VALIDATE_ALL on the integrated tree (false ⇒ tree not green; blocks convergence)
  endStateUngated,                                          // TRUE ⇒ impl review skipped → whole-codebase semantic end-state NOT gated — skill must caveat
  goLive: GO_LIVE,
  workflowId: WORKFLOW_ID,        // the live-status id the skill assigned (null if status tracking off)
  statusFile: TRACK_STATUS ? STATUS_FILE : null,   // the durable .ulpi/workflows/<id>.json the run wrote
}
