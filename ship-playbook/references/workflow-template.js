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
function routeReview(who, brief, label, phaseTitle) {
  if (who === 'codex')
    return rAgent(`READ-ONLY review — do NOT edit.\n${brief}`, { label, phase: phaseTitle, schema: FINDINGS, agentType: 'codex:codex-rescue' })
  if (who === 'kiro')
    return rAgent(`Use the kiro-review skill (\`/kiro-review\`) to drive the Kiro CLI over the surface below, READ-ONLY — do NOT edit; run kiro with \`--model ${KIRO_MODEL}\` (latest Opus). If the Kiro CLI is unavailable, say so and return an empty findings list; do NOT substitute your own native review.\n${brief}`, { label, phase: phaseTitle, schema: FINDINGS, agentType: 'general-purpose' })
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
  },
}
const FIX_RESULT = { type: 'object', additionalProperties: false, required: ['applied'], properties: { applied: { type: 'boolean' }, notes: { type: 'string' } } }
const TASK_RESULT = {
  type: 'object', additionalProperties: false,
  required: ['taskId', 'status', 'validatePassed'],
  properties: { taskId: { type: 'string' }, status: { type: 'string', enum: ['passed', 'blocked'] }, validatePassed: { type: 'boolean' }, filesTouched: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
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

// ── slice-scoping: a per-task review must judge only the task's OWN slice ─────────
// Match a finding's file against a task's writeScope (exact file, directory boundary, or simple glob
// prefix). Used to (a) keep the fix loop from burning rounds on findings the engineer can't touch, and
// (b) separate in-scope defects from cross-task end-state gaps another task owns. No writeScope ⇒ don't
// over-filter (treat as in scope) so a malformed plan never silently swallows real findings.
function fileInScope(file, writeScope) {
  if (!file) return false
  if (!Array.isArray(writeScope) || !writeScope.length) return true
  const norm = (s) => String(s).replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '')
  const f = norm(file)
  return writeScope.some(w => {
    let p = norm(w)
    const star = p.indexOf('*')
    if (star >= 0) { p = p.slice(0, star); return p ? f.startsWith(p) : false }   // glob → prefix match
    return f === p || f.startsWith(p + '/')                                       // file, or directory boundary
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
criteria (≥1 failure/edge), and a validate command. Write .ulpi/plans/<name>.md + .json (JSON is the
source of truth; render MD from it). Return planName, planPath, tasks[], and layers[][] (the parallel
execution layers, task ids).`
}
function founderBrief(plan, who) {
  const lens = who === 'native' ? 'as native claude' : `via the ${who} harness (READ-ONLY, do NOT edit)`
  return `Founder-review the plan ${plan.planPath || plan.planName} (.md + .json) ${lens}, against the
codebase at ${ROOT}. Verify: every filesToModify path exists; filesToCreate has a creator; markdown↔
JSON task ids/paths/deps agree; reuse claims are real; scope/mode fits; the dependency graph is
acyclic; each task has a failure/edge acceptance criterion; no phantom paths. Hard rules: ${HARD_RULES}.
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
Edit ONLY: ${(t.writeScope || []).join(', ')}. Honor the locked rules: ${HARD_RULES}.
Meet ALL acceptance criteria: ${(t.acceptance || []).join(' | ')}.
Make this pass: ${t.validate}. Then commit:
  git add -A && git commit -m "${t.id}: ${t.title}"
Report taskId, status ('passed' only if ${t.validate} is green), validatePassed, filesTouched.
Implement ONLY this task.`
}
function integrateBrief(branches) {
  return `On ${WORKING_BRANCH} in ${ROOT}, integrate these task branches IN ORDER: ${branches.join(', ')}.
Process them ONE AT A TIME — merge a branch, then IMMEDIATELY remove its worktree, then move to the
next. For each branch:
  1. \`git merge --no-edit <branch>\` (on conflict: \`git merge --abort\`, record it under conflicted[],
     skip to the next branch — never force-resolve).
  2. As soon as it merges, REMOVE its transient build worktree so it can't pollute anything: find the
     path via \`git -C ${ROOT} worktree list --porcelain\`, \`git -C ${ROOT} worktree remove --force <path>\`,
     then \`git -C ${ROOT} branch -D <branch>\`.
Finish with \`git -C ${ROOT} worktree prune\` to clear stale admin entries.

THEN run ${VALIDATE_ALL} once. The validate must cover ONLY the project at ${ROOT} — it must NOT scan
\`.claude/worktrees/**\` or sibling agent dirs (\`.factory\`, \`.gemini\`, \`.opencode\`, \`.trae\`, \`.vibe\`).
If the configured command would walk them (e.g. \`eslint .\` / \`tsc\` without excludes), restrict it to
the project sources (add \`--ignore-pattern '.claude/**'\`, exclude in the tsconfig invocation, or scope
to the changed paths) — leftover/transient worktrees must never fail the gate, and never relax any
other lint/type rule to make it pass.

Report merged[], conflicted[], validatePassed.`
}
function reviewerBrief(t, plan) {
  return `READ-ONLY review of ${t.id} (${t.title || ''}) as it now stands on ${WORKING_BRANCH} in ${ROOT}.
SCOPE — review ONLY this task's OWN slice: its writeScope (${(t.writeScope || []).join(', ')}) and its diff
(e.g. git diff ${WORKING_BRANCH}~1...${WORKING_BRANCH}, or git log for ${t.id}). Judge it against ${t.id}'s
OWN acceptance criteria, verifying each is truly met not just claimed: ${(t.acceptance || []).join(' | ')}.
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
which EPERMs in this sandbox; the integrate step ALREADY ran "${t.validate}" in a writable worktree and it
passed, so review STATICALLY against the diff. A check you cannot run in this sandbox is an OBSERVATION,
NEVER a BLOCK or CONCERN. Do NOT edit. verdict 'blocked' only if a real IN-SCOPE BLOCK remains, else
'clean'/'concerns'; classify findings BLOCK/CONCERN/OBSERVATION with file:line (sandbox/environment limits,
and end-state gaps another task owns = OBSERVATION).`
}
function fixBrief(t, findings, n) {
  return `Fix ${t.id} for these reviewer findings. In THIS isolated worktree, branch off the latest:
  git checkout -B ${fixBranchFor(t, n)} ${WORKING_BRANCH}
Edit ONLY ${(t.writeScope || []).join(', ')}. ${t.stackSkill ? `Use the ${t.stackSkill} skill. ` : ''}Make
${t.validate} pass, then commit. Findings: ${JSON.stringify(findings)}. Report status/validatePassed/filesTouched.`
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

// run a single read-only review by the chosen executor (who ∈ native|codex|kiro), tagging the source.
async function reviewOnce(who, label, phaseTitle, brief) {
  const r = await routeReview(who, brief, `${label}:${who}`, phaseTitle)
  return (r && r.findings) ? r.findings.map(f => ({ ...f, source: who })) : []
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
// confirmed/uncertain/rejected) into the playbook register schema.
function ingestGoLive(result) {
  const sev = { blocker: 'BLOCK', high: 'CONCERN', medium: 'OBSERVATION', low: 'OBSERVATION' }
  const fromFindings = (result && result.findings ? result.findings : [])
    .filter(f => f.status !== 'rejected')
    .map(f => ({ severity: sev[f.severity] || 'OBSERVATION', file: f.file, line: f.line, issue: f.title, evidence: f.evidence, source: 'native', phase: 'audit' }))
  const fromGates = (result && result.gates ? result.gates : [])
    .filter(g => g && g.passed === false)
    .flatMap(g => (g.failures || []).map(x => ({ severity: 'BLOCK', file: x.member, issue: `${g.gate} gate failed: ${x.detail}`, source: 'native', phase: 'audit' })))
  return [...fromFindings, ...fromGates]
}

// ── plan review by the chosen reviewer (native|codex|kiro) — bounded; exits clean OR non-convergence ──
// The reviewer (founder review) is routed per PLAN_REVIEW; the FIX is always native (the orchestrator
// edits the plan files). Cap iterations AND stop the moment a fix round fails to REDUCE the blocking
// count — a strong reviewer keeps surfacing fresh CONCERNs on a plan, so never grind. (OBSERVATIONs
// never block; only BLOCK/CONCERN count toward looping.)
async function planReviewLoop(plan, who) {
  let prev = Infinity
  for (let i = 0; i < MAX_REVIEW; i++) {
    const r = await routeReview(who, founderBrief(plan, who), `plan-review:${who}:${i}`, 'Plan review')
    if (!r) return
    const n = blockingCount(r.findings)
    if (r.verdict === 'approve' || n === 0) return     // clean — OBSERVATIONs never block
    if (n >= prev) return                              // not improving → stop churning, proceed to build
    prev = n
    await rAgent(planFixBrief(plan, r.findings), { label: `plan-fix:${i}`, phase: 'Plan review', schema: FIX_RESULT })   // fix is always native
  }
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
2. For each: \`git -C ${ROOT} worktree remove --force <path>\`; then if its branch is \`wf/build/*\` and fully merged or stale, \`git -C ${ROOT} branch -D <branch>\`.
3. \`git -C ${ROOT} worktree prune\` to clear stale admin entries.
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
    return spawnSpecialist(`READ-ONLY review — do NOT edit.\n${brief}`, { label, phase: 'Build', schema: FINDINGS, agentType: 'codex:codex-rescue' })
  if (TASK_REVIEW === 'kiro')
    return spawnSpecialist(`Use the kiro-review skill (\`/kiro-review\`) to review this task via the Kiro CLI, READ-ONLY, with \`--model ${KIRO_MODEL}\` (latest Opus); if the Kiro CLI is unavailable, say so and return empty findings — do not substitute a native review.\n${brief}`, { label, phase: 'Build', schema: FINDINGS, agentType: 'general-purpose' })
  return spawnSpecialist(brief, { label, phase: 'Build', schema: FINDINGS, agentType: resolveAgent(t.reviewer) })   // native
  })
}

// ── steps 10–11: build across DAG layers, engineer → integrate → reviewer → fix ──
async function buildPlan(plan) {
  const byId = new Map(plan.tasks.map(t => [t.id, t]))
  const layers = (plan.layers && plan.layers.length) ? plan.layers : [plan.tasks.map(t => t.id)]
  const N = layers.length
  const log = []
  // in-scope blockers only: BLOCK/CONCERN whose file the task can actually touch. Findings outside
  // writeScope are end-state gaps another task owns — they must NOT drive ${t}'s fix loop (the engineer
  // can't edit them) and must NOT block the slice. They're deferred to the impl-review end-state gate.
  const inScopeBlockers = (review, t) => (review.findings || []).filter(f => isBlocking(f) && fileInScope(f.file, t.writeScope))
  const crossTaskCount = (review, t) => (review.findings || []).filter(f => isBlocking(f) && !fileInScope(f.file, t.writeScope)).length

  for (let li = 0; li < N; li++) {
    const layer = layers[li].map(id => byId.get(id)).filter(Boolean)
    // mark the whole layer in_progress before the engineers fan out (sequential → race-free)
    await statusStep({ status: 'building', phases: { build: { status: 'in_progress', layer: `${li + 1}/${N}` } },
      tasks: Object.fromEntries(layer.map(t => [t.id, { status: 'in_progress' }])) }, `L${li}-start`)
    // engineers implement in parallel (isolated worktrees, disjoint write scope), each on a task branch
    const built = await parallel(layer.map(t => () =>
      buildSpawn(t, engineerBrief(t), `build:${t.id}`).then(r => ({ t, r }))))
    // in-workflow git integrate: merge passed task branches onto the working branch (one sequential agent)
    const passedBranches = built.filter(b => b && b.r && b.r.status === 'passed').map(b => branchFor(b.t))
    let integ = null
    if (passedBranches.length) integ = await rAgent(integrateBrief(passedBranches), { label: `integrate:L${li}`, phase: 'Build', schema: INTEGRATE_RESULT })
    const mergedBranches = new Set((integ && integ.merged) || [])
    // engineer-failed tasks are blocked outright
    const layerPatch = {}
    for (const b of built.filter(b => b && (!b.r || b.r.status !== 'passed'))) {
      log.push({ task: b.t.id, status: 'blocked', reason: 'engineer validate failed', fixes: 0, findings: [] })
      layerPatch[b.t.id] = { status: 'dev_failed' }
    }
    const passed = built.filter(b => b && b.r && b.r.status === 'passed')
    for (const b of passed) layerPatch[b.t.id] = { status: mergedBranches.has(branchFor(b.t)) ? 'integrated' : 'dev_done' }
    // TASK_REVIEW === 'skip' (#2): no per-task reviewer / fix loop — a task passes on its engineer
    // validate alone. Biggest token saver; the user opted out of per-task review.
    if (TASK_REVIEW === 'skip') {
      for (const b of passed) { log.push({ task: b.t.id, status: 'passed', fixes: 0, findings: [] }); layerPatch[b.t.id] = { status: 'passed' } }
      await statusStep({ tasks: layerPatch }, `L${li}-done`)
      continue
    }
    await statusStep({ tasks: layerPatch }, `L${li}-built`)
    // initial per-task reviews are READ-ONLY → run them in PARALLEL across the layer (slice-scoped:
    // reviewerBrief gets the rest of the plan so end-state gaps are attributed to the owning task)
    const reviewed = await parallel(passed.map(b => () =>
      taskReviewSpawn(b.t, reviewerBrief(b.t, plan), `review:${b.t.id}`)
        .then(r => ({ t: b.t, review: r || { verdict: 'concerns', findings: [] } }))))
    // fix→re-integrate MUST stay SERIAL: each git-merges the shared working branch, so concurrent fix
    // loops would race/conflict on it. The re-review after each integrate sees the updated branch.
    for (const item of reviewed.filter(Boolean)) {
      const t = item.t
      let review = item.review
      let fixes = 0
      let blockers = inScopeBlockers(review, t)           // ONLY findings this task can act on
      let deferred = crossTaskCount(review, t)
      // loop only while there are IN-SCOPE blockers — never burn a fix round on an end-state gap a later
      // task owns (the engineer can't touch it; that's the impl-review gate's job).
      while (blockers.length && fixes < MAX_FIX) {
        fixes++
        await buildSpawn(t, fixBrief(t, blockers, fixes), `fix:${t.id}#${fixes}`)
        await rAgent(integrateBrief([fixBranchFor(t, fixes)]), { label: `reintegrate:${t.id}#${fixes}`, phase: 'Build', schema: INTEGRATE_RESULT })
        review = await taskReviewSpawn(t, reviewerBrief(t, plan), `review:${t.id}#${fixes}`) || { verdict: 'concerns', findings: [] }
        blockers = inScopeBlockers(review, t)
        deferred = crossTaskCount(review, t)
      }
      const status = blockers.length ? 'blocked' : 'passed'
      // record only in-scope findings as the task's own; cross-task end-state gaps are counted + deferred.
      log.push({ task: t.id, status, fixes, findings: (review.findings || []).filter(f => fileInScope(f.file, t.writeScope)), crossTaskDeferred: deferred })
      layerPatch[t.id] = { status, fixes, ...(deferred ? { crossTaskDeferred: deferred } : {}) }
    }
    await statusStep({ tasks: layerPatch }, `L${li}-done`)
  }
  return log
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
const PREFLIGHT_SCHEMA = { type: 'object', additionalProperties: false, required: ['isGitRepo'], properties: { isGitRepo: { type: 'boolean' }, currentBranch: { type: 'string' }, workingBranchExists: { type: 'boolean' }, detail: { type: 'string' } } }
const pre = await rAgent(`Report git readiness for a build that will checkout/commit/merge in ${ROOT} — READ-ONLY, do NOT init/create/modify anything. Run \`git -C ${ROOT} rev-parse --is-inside-work-tree\`: isGitRepo=true only if it prints "true" with exit 0 (false on any error / "not a git repository"). If a repo: report currentBranch (\`git -C ${ROOT} rev-parse --abbrev-ref HEAD\`) and workingBranchExists = whether \`git -C ${ROOT} rev-parse --verify --quiet "${WORKING_BRANCH}^{commit}"\` succeeds (the branch exists AND has a commit to branch from).`, { label: 'preflight:git', phase: 'Plan', schema: PREFLIGHT_SCHEMA })
if (!pre || pre.isGitRepo !== true) {
  return { converged: false, ranReal: false, aborted: `ROOT is not a git repository: ${ROOT}. ship-playbook builds by creating task branches and git-merging them onto ${WORKING_BRANCH}, so it needs a git work tree. Run \`git init\` and commit a baseline (or point root at the actual repo), then relaunch.`, goLive: GO_LIVE }
}
if (pre.workingBranchExists === false) {
  return { converged: false, ranReal: false, aborted: `ROOT is a git repo but WORKING_BRANCH "${WORKING_BRANCH}" has no commit to branch from (current branch: ${pre.currentBranch || 'unknown'}). The build needs a committed base — make a baseline commit on "${WORKING_BRANCH}" (or set workingBranch to an existing committed branch), then relaunch.`, goLive: GO_LIVE }
}
// Clear dangling build worktrees from prior runs BEFORE building, so the integrate validate starts clean.
await cleanupWorktrees('preflight')

// Structural sanity check on a plan (supplied OR freshly written) before the build trusts it.
function validatePlan(p) {
  if (!p || !Array.isArray(p.tasks) || !p.tasks.length) return 'no tasks in the plan — nothing to build (verify the plan/planPath reached the script and the plan has a non-empty tasks[])'
  const ids = new Set(p.tasks.map(t => t && t.id))
  const bad = p.tasks.filter(t => !t || !t.id || !t.agent || !Array.isArray(t.writeScope) || !t.writeScope.length || !t.validate)
  if (bad.length) return `plan has ${bad.length} task(s) missing required build fields (id / agent / writeScope[] / validate) — re-run plan-to-task-list-with-dag or fix the plan json`
  if (Array.isArray(p.layers) && p.layers.length) {
    const unknown = [...new Set(p.layers.flat().filter(id => !ids.has(id)))]
    if (unknown.length) return `plan layers reference unknown task ids: ${unknown.join(', ')}`
  }
  return null
}
// RESUME loader: an agent reads the existing plan file (the sandbox can't), validates it against the
// real repo, normalizes it, and returns the PLAN object — it must NOT re-plan.
const loadPlanBrief = (path) => `Load an EXISTING ship-playbook plan to RESUME from at the build phase — do NOT re-plan or invent tasks.
Read the plan at ${path} in ${ROOT} (if it is a .md, also read its sibling .json — the JSON is the source of truth). Return it as structured output: planName, planPath, tasks[] (each: id, agent, reviewer, title, writeScope[], acceptance[], validate, stackSkill|null) and layers[][] (the parallel execution layers as task-id arrays).
Normalize, don't redesign: if a task has no reviewer, set it to its agent name + '-reviewer'; if layers are absent, derive them from task dependencies (else one layer with every task id). Return exactly the tasks the file defines. If the file is missing or has no tasks, return an empty tasks[].`

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
  plan = await rAgent(planPrompt, { label: `plan:${PLAN_HARNESS}`, phase: 'Plan', schema: PLAN, agentType: planAgentType })
}
const _planError = validatePlan(plan)
if (_planError) {
  await statusStep({ status: 'aborted', phases: { plan: { status: 'failed', detail: _planError } } }, 'plan-failed')
  return { converged: false, ranReal: false, aborted: _planError, goLive: GO_LIVE }
}
// Populate the live status file with the adopted plan and every task as pending (one cheap write).
await statusStep({
  plan: { name: plan.planName, path: plan.planPath || null, taskCount: plan.tasks.length },
  phases: { plan: { status: RESUME_PLAN ? 'skipped' : 'done' } },
  tasks: Object.fromEntries(plan.tasks.map(t => [t.id, { title: t.title || '', agent: t.agent || '', branch: branchFor(t), status: 'pending', fixes: 0 }])),
}, 'plan-done')

// Plan review (steps 4–9) — SKIPPED when resuming (the supplied plan is already reviewed). Otherwise
// reviewer per PLAN_REVIEW: 'skip' | 'native' | 'codex' | 'kiro'. Plan-QUALITY gate (scope,
// decomposition, phantom paths). ONE bounded loop; exits on no BLOCK/CONCERN or non-convergence.
if (!RESUME_PLAN && PLAN_REVIEW !== 'skip') {
  phase('Plan review')
  await statusStep({ status: 'plan_review', phases: { plan_review: { status: 'in_progress' } } }, 'plan-review-start')
  await planReviewLoop(plan, PLAN_REVIEW)
  await statusStep({ phases: { plan_review: { status: 'done' } } }, 'plan-review-done')
} else {
  await statusStep({ phases: { plan_review: { status: 'skipped' } } }, 'plan-review-skip')
}

phase('Build')                                             // steps 10–11
const buildLog = await buildPlan(plan)                      // buildPlan emits per-layer status writes
await statusStep({ phases: { build: { status: 'done' } } }, 'build-done')

// Impl review (step 12) — reviewer per IMPL_REVIEW: 'skip' | 'native' | 'codex' | 'kiro'. The
// plan-vs-implementation gate — and now the EXPLICIT end-state gate (see implBrief).
let implFindings = []
if (IMPL_REVIEW !== 'skip') {
  phase('Impl review')
  await statusStep({ status: 'impl_review', phases: { impl_review: { status: 'in_progress' } } }, 'impl-start')
  implFindings = await reviewOnce(IMPL_REVIEW, 'impl', 'Impl review', implBrief(plan))
  await statusStep({ phases: { impl_review: { status: 'done', findings: implFindings.length } } }, 'impl-done')
} else {
  await statusStep({ phases: { impl_review: { status: 'skipped' } } }, 'impl-skip')
}

// Verify (step 14): dedup + adversarially verify the build+impl findings → this is the feedback.
phase('Verify')
await statusStep({ status: 'verifying', phases: { verify: { status: 'in_progress' } } }, 'verify-start')
const blockedBuild = buildLog.filter(b => b.status === 'blocked').flatMap(b =>
  (b.findings.length ? b.findings : [{ severity: 'BLOCK', file: b.task, issue: `task ${b.task} did not pass after ${b.fixes} fixes` }]).map(f => ({ ...f, source: 'native', phase: 'build' })))
// The go-live audit (step 13) is the heaviest phase — run it ONLY when build+impl are verified-clean.
// An implementation with open findings goes straight back to the user as feedback (no point auditing
// code that still needs fixes).
let openRegister = await dedupVerify([...blockedBuild, ...implFindings.map(f => ({ ...f, phase: 'impl' }))], 'Verify')
await statusStep({ phases: { verify: { status: 'done', findings: openRegister.length } }, openRegister }, 'verify-done')
if (openRegister.length === 0 && GO_LIVE) {                // step 13 — only when build+impl are clean
  phase('Audit')
  await statusStep({ status: 'auditing', phases: { audit: { status: 'in_progress' } } }, 'audit-start')
  // COMPOSE the proven go-live-audit workflow (a thorough multi-agent native audit) when the skill
  // supplied a filled script; otherwise an inline native finder pass.
  const auditFindings = AUDIT_SCRIPT_PATH
    ? ingestGoLive(await workflow({ scriptPath: AUDIT_SCRIPT_PATH }))
    : await reviewOnce('native', 'audit', 'Audit', auditBrief)
  openRegister = await dedupVerify(auditFindings.map(f => ({ ...f, phase: 'audit' })), 'Verify')
  await statusStep({ phases: { audit: { status: 'done', findings: openRegister.length } }, openRegister }, 'audit-done')
} else {
  await statusStep({ phases: { audit: { status: 'skipped', detail: GO_LIVE ? 'findings remain' : 'goLive off' } } }, 'audit-skip')
}

// Remove this run's build worktrees so they don't pollute the next run (or the user's own tooling).
await cleanupWorktrees('final')

// Final overall state in the live status file (done = clean; needs_fix = openRegister non-empty).
await statusStep({
  status: openRegister.length === 0 ? 'done' : 'needs_fix',
  result: {
    converged: openRegister.length === 0,
    openRegisterCount: openRegister.length,
    build: buildLog.map(b => ({ task: b.task, status: b.status, fixes: b.fixes })),
    reviewConfig: { planHarness: PLAN_HARNESS, planReview: PLAN_REVIEW, buildHarness: BUILD_HARNESS, taskReview: TASK_REVIEW, implReview: IMPL_REVIEW },
    missingAgents: [...missingAgents],
  },
}, 'final')

return {
  // converged = real work ran AND no verified findings survived. Otherwise openRegister IS the feedback
  // for the user — they decide whether to run a fix round (this workflow does not loop on its own).
  converged: openRegister.length === 0,
  ranReal: true,
  plan: plan.planName,
  planSupplied: RESUME_PLAN,    // TRUE when this run RESUMED from a pre-built/pre-reviewed plan (plan + plan-review skipped)
  build: buildLog.map(b => ({ task: b.task, status: b.status, fixes: b.fixes })),
  openRegister,                 // verified findings = the feedback to show the user
  missingAgents: [...missingAgents],   // specialist agent types the plan wanted that aren't installed here → skill notifies the user
  // the review/build roles this run used (so the skill can report them honestly and caveat the verdict)
  reviewConfig: { planHarness: PLAN_HARNESS, planReview: PLAN_REVIEW, buildHarness: BUILD_HARNESS, taskReview: TASK_REVIEW, implReview: IMPL_REVIEW },
  // TRUE when NOTHING checked the build: no per-task reviewer AND no impl review. converged then means
  // "engineer validates passed", not "reviewed clean" — the skill must caveat this.
  noReviewGate: TASK_REVIEW === 'skip' && IMPL_REVIEW === 'skip',
  goLive: GO_LIVE,
  workflowId: WORKFLOW_ID,        // the live-status id the skill assigned (null if status tracking off)
  statusFile: TRACK_STATUS ? STATUS_FILE : null,   // the durable .ulpi/workflows/<id>.json the run wrote
}
