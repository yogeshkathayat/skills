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
//            auditScriptPath, availableAgents, allowGeneralFallback }
//   (auditScriptPath is optional — see the comment at its CFG read below.)
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

// Fail LOUD if inputs never reached the script. Without this, the values above stay at their FILL:
// placeholders, the plan agent is handed "FILL: the feature request", returns no tasks, and the run
// reports a fake converged:true. Refuse to start on placeholders rather than emit a false clean.
const _missing = Object.entries({ ROOT, WORKING_BRANCH, VALIDATE_ALL, PROMPT })
  .filter(([, v]) => typeof v !== 'string' || v.startsWith('FILL:')).map(([k]) => k)
if (_missing.length) {
  throw new Error(`ship-playbook: inputs did not reach the script — ${_missing.join(', ')} still at FILL: placeholder (typeof args="${typeof args}"). Pass args as a real JSON object per the skill's Phase 2 contract, NOT a stringified blob, then relaunch as a FRESH run.`)
}

// Route ONE read-only review to whichever executor a role picked: native claude, codex, or kiro.
// codex → the codex plugin agent; kiro → the kiro-review skill driving the Kiro CLI (never a silent
// native substitute). The brief carries the actual review instructions; this just picks the executor.
function routeReview(who, brief, label, phaseTitle) {
  if (who === 'codex')
    return agent(`READ-ONLY review — do NOT edit.\n${brief}`, { label, phase: phaseTitle, schema: FINDINGS, agentType: 'codex:codex-rescue' })
  if (who === 'kiro')
    return agent(`Use the kiro-review skill (\`/kiro-review\`) to drive the Kiro CLI over the surface below, READ-ONLY — do NOT edit. If the Kiro CLI is unavailable, say so and return an empty findings list; do NOT substitute your own native review.\n${brief}`, { label, phase: phaseTitle, schema: FINDINGS, agentType: 'general-purpose' })
  return agent(`${brief}\n(native claude)`, { label, phase: phaseTitle, schema: FINDINGS })   // native
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

// ── briefs ──────────────────────────────────────────────────────────────────────
const branchFor = (t) => `wf/build/${t.id}`
const fixBranchFor = (t, n) => `wf/build/${t.id}-fix${n}`

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
function reviewerBrief(t) {
  return `READ-ONLY review of ${t.id} as it now stands on ${WORKING_BRANCH} in ${ROOT}. Inspect its
files (${(t.writeScope || []).join(', ')}) and the task diff (e.g. git diff ${WORKING_BRANCH}~1...${WORKING_BRANCH}
or git log for ${t.id}). Verify EVERY acceptance criterion is truly met, not just claimed:
${(t.acceptance || []).join(' | ')}. Check the locked rules (${HARD_RULES}),
${t.stackSkill ? `that the ${t.stackSkill} rules were followed, ` : ''}no dead wiring, and that
${t.validate} actually passes. Do NOT edit. verdict 'blocked' if any BLOCK/MAJOR remains, else
'clean'/'concerns'; classify findings BLOCK/CONCERN/OBSERVATION with file:line.`
}
function fixBrief(t, findings, n) {
  return `Fix ${t.id} for these reviewer findings. In THIS isolated worktree, branch off the latest:
  git checkout -B ${fixBranchFor(t, n)} ${WORKING_BRANCH}
Edit ONLY ${(t.writeScope || []).join(', ')}. ${t.stackSkill ? `Use the ${t.stackSkill} skill. ` : ''}Make
${t.validate} pass, then commit. Findings: ${JSON.stringify(findings)}. Report status/validatePassed/filesTouched.`
}
const implBrief = (plan) => `Full implementation review of everything built for ${plan.planName} on
${WORKING_BRANCH} in ${ROOT}, against the plan and the hard rules (${HARD_RULES}). Read the diff +
surrounding context, verify each finding before reporting, do NOT edit. verdict + findings
BLOCK/CONCERN/OBSERVATION with file:line.`
const auditBrief = `READ-ONLY launch-readiness (go-live) audit of ${ROOT}. Check the hard invariants
(${HARD_RULES}), build/test/lint honesty, secrets (redact values), tenancy/security, dead wiring,
placeholder/TODO in shipping code. verdict + findings BLOCK/CONCERN/OBSERVATION with file:line + evidence.`

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
    agent((lens === 'code' ? REFUTE_CODE : REFUTE_SPEC) + desc, { label: `verify:${lens}`, phase: phaseTitle, schema: VERDICT })))).filter(Boolean)
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
    await agent(planFixBrief(plan, r.findings), { label: `plan-fix:${i}`, phase: 'Plan review', schema: FIX_RESULT })   // fix is always native
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
  return agent(`Worktree hygiene in ${ROOT} — remove this workflow's transient build worktrees so they can't pollute later validates. READ git state, then:
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
  if (BUILD_HARNESS === 'codex')
    return spawnSpecialist(`You MAY edit files to implement this task.\n${brief}`, { label, phase: 'Build', schema: TASK_RESULT, agentType: 'codex:codex-rescue', isolation: 'worktree' })
  if (BUILD_HARNESS === 'kiro')
    return spawnSpecialist(`Use the hand-over-to-kiro skill (\`/hand-over-to-kiro\`) to delegate implementing this task to kiro-cli — it builds an injection-safe prompt, runs kiro in this worktree, and verifies the diff. This is UNATTENDED: tell it to run kiro autonomously (\`--trust-all-tools\`), since no human can approve tool calls. If the hand-over-to-kiro skill or kiro-cli is unavailable, say so and implement the task yourself.\n${brief}`, { label, phase: 'Build', schema: TASK_RESULT, agentType: 'general-purpose', isolation: 'worktree' })
  return spawnSpecialist(brief, { label, phase: 'Build', schema: TASK_RESULT, agentType: resolveAgent(t.agent), isolation: 'worktree' })
}
// only called when TASK_REVIEW !== 'skip' (the skip case is handled in buildPlan, no reviewer spawned).
function taskReviewSpawn(t, brief, label) {
  if (TASK_REVIEW === 'codex')
    return spawnSpecialist(`READ-ONLY review — do NOT edit.\n${brief}`, { label, phase: 'Build', schema: FINDINGS, agentType: 'codex:codex-rescue' })
  if (TASK_REVIEW === 'kiro')
    return spawnSpecialist(`Use the kiro-review skill (\`/kiro-review\`) to review this task via the Kiro CLI, READ-ONLY; if the Kiro CLI is unavailable, say so and return empty findings — do not substitute a native review.\n${brief}`, { label, phase: 'Build', schema: FINDINGS, agentType: 'general-purpose' })
  return spawnSpecialist(brief, { label, phase: 'Build', schema: FINDINGS, agentType: resolveAgent(t.reviewer) })   // native
}

// ── steps 10–11: build across DAG layers, engineer → integrate → reviewer → fix ──
async function buildPlan(plan) {
  const byId = new Map(plan.tasks.map(t => [t.id, t]))
  const layers = (plan.layers && plan.layers.length) ? plan.layers : [plan.tasks.map(t => t.id)]
  const log = []
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li].map(id => byId.get(id)).filter(Boolean)
    // engineers implement in parallel (isolated worktrees, disjoint write scope), each on a task branch
    const built = await parallel(layer.map(t => () =>
      buildSpawn(t, engineerBrief(t), `build:${t.id}`).then(r => ({ t, r }))))
    // in-workflow git integrate: merge passed task branches onto the working branch (one sequential agent)
    const passedBranches = built.filter(b => b && b.r && b.r.status === 'passed').map(b => branchFor(b.t))
    if (passedBranches.length) await agent(integrateBrief(passedBranches), { label: `integrate:L${li}`, phase: 'Build', schema: INTEGRATE_RESULT })
    // engineer-failed tasks are blocked outright
    for (const b of built.filter(b => b && (!b.r || b.r.status !== 'passed')))
      log.push({ task: b.t.id, status: 'blocked', reason: 'engineer validate failed', fixes: 0, findings: [] })
    const passed = built.filter(b => b && b.r && b.r.status === 'passed')
    // TASK_REVIEW === 'skip' (#2): no per-task reviewer / fix loop — a task passes on its engineer
    // validate alone. Biggest token saver; the user opted out of per-task review.
    if (TASK_REVIEW === 'skip') {
      for (const b of passed) log.push({ task: b.t.id, status: 'passed', fixes: 0, findings: [] })
      continue
    }
    // initial per-task reviews are READ-ONLY → run them in PARALLEL across the layer
    const reviewed = await parallel(passed.map(b => () =>
      taskReviewSpawn(b.t, reviewerBrief(b.t), `review:${b.t.id}`)
        .then(r => ({ t: b.t, review: r || { verdict: 'concerns', findings: [] } }))))
    // fix→re-integrate MUST stay SERIAL: each git-merges the shared working branch, so concurrent fix
    // loops would race/conflict on it. The re-review after each integrate sees the updated branch.
    for (const item of reviewed.filter(Boolean)) {
      const t = item.t
      let review = item.review
      let fixes = 0
      while (review.verdict === 'blocked' && fixes < MAX_FIX) {
        fixes++
        await buildSpawn(t, fixBrief(t, review.findings, fixes), `fix:${t.id}#${fixes}`)
        await agent(integrateBrief([fixBranchFor(t, fixes)]), { label: `reintegrate:${t.id}#${fixes}`, phase: 'Build', schema: INTEGRATE_RESULT })
        review = await taskReviewSpawn(t, reviewerBrief(t), `review:${t.id}#${fixes}`) || { verdict: 'concerns', findings: [] }
      }
      log.push({ task: t.id, status: review.verdict === 'blocked' ? 'blocked' : 'passed', fixes, findings: review.findings || [] })
    }
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
const pre = await agent(`Report git readiness for a build that will checkout/commit/merge in ${ROOT} — READ-ONLY, do NOT init/create/modify anything. Run \`git -C ${ROOT} rev-parse --is-inside-work-tree\`: isGitRepo=true only if it prints "true" with exit 0 (false on any error / "not a git repository"). If a repo: report currentBranch (\`git -C ${ROOT} rev-parse --abbrev-ref HEAD\`) and workingBranchExists = whether \`git -C ${ROOT} rev-parse --verify --quiet "${WORKING_BRANCH}^{commit}"\` succeeds (the branch exists AND has a commit to branch from).`, { label: 'preflight:git', phase: 'Plan', schema: PREFLIGHT_SCHEMA })
if (!pre || pre.isGitRepo !== true) {
  return { converged: false, ranReal: false, aborted: `ROOT is not a git repository: ${ROOT}. ship-playbook builds by creating task branches and git-merging them onto ${WORKING_BRANCH}, so it needs a git work tree. Run \`git init\` and commit a baseline (or point root at the actual repo), then relaunch.`, goLive: GO_LIVE }
}
if (pre.workingBranchExists === false) {
  return { converged: false, ranReal: false, aborted: `ROOT is a git repo but WORKING_BRANCH "${WORKING_BRANCH}" has no commit to branch from (current branch: ${pre.currentBranch || 'unknown'}). The build needs a committed base — make a baseline commit on "${WORKING_BRANCH}" (or set workingBranch to an existing committed branch), then relaunch.`, goLive: GO_LIVE }
}
// Clear dangling build worktrees from prior runs BEFORE building, so the integrate validate starts clean.
await cleanupWorktrees('preflight')

// ── the playbook: ONE pass — plan → plan review → build → impl review → audit → return findings ──
// NO automatic recursion. The verified findings are RETURNED as feedback; the skill presents them and
// the user decides whether to run a fix round (a Workflow can't AskUserQuestion mid-run, and an
// autonomous fix-loop is what produced the multi-hour grind). Impl review (step 12) is the
// plan-vs-implementation gate and is the last work the loop used to recurse on — now it just reports.
phase('Plan')                                              // step 3 — writer per PLAN_HARNESS
const planAgentType = PLAN_HARNESS === 'codex' ? 'codex:codex-rescue' : 'general-purpose'
const planPrompt = PLAN_HARNESS === 'kiro'
  ? `Use the Kiro CLI to produce this plan; if it is unavailable, do it yourself.\n${planBrief(PROMPT)}`
  : planBrief(PROMPT)
const plan = await agent(planPrompt, { label: `plan:${PLAN_HARNESS}`, phase: 'Plan', schema: PLAN, agentType: planAgentType })
if (!plan || !plan.tasks || !plan.tasks.length) {
  return { converged: false, ranReal: false, aborted: 'no tasks were planned — aborted before any build (verify args/PROMPT reached the script)', goLive: GO_LIVE }
}

// Plan review (steps 4–9) — reviewer per PLAN_REVIEW: 'skip' | 'native' | 'codex' | 'kiro'. Plan-QUALITY
// gate (scope, decomposition, phantom paths). ONE bounded loop; exits on no BLOCK/CONCERN or non-convergence.
if (PLAN_REVIEW !== 'skip') {
  phase('Plan review')
  await planReviewLoop(plan, PLAN_REVIEW)
}

phase('Build')                                             // steps 10–11
const buildLog = await buildPlan(plan)

// Impl review (step 12) — reviewer per IMPL_REVIEW: 'skip' | 'native' | 'codex' | 'kiro'. The
// plan-vs-implementation gate.
let implFindings = []
if (IMPL_REVIEW !== 'skip') {
  phase('Impl review')
  implFindings = await reviewOnce(IMPL_REVIEW, 'impl', 'Impl review', implBrief(plan))
}

// Verify (step 14): dedup + adversarially verify the build+impl findings → this is the feedback.
phase('Verify')
const blockedBuild = buildLog.filter(b => b.status === 'blocked').flatMap(b =>
  (b.findings.length ? b.findings : [{ severity: 'BLOCK', file: b.task, issue: `task ${b.task} did not pass after ${b.fixes} fixes` }]).map(f => ({ ...f, source: 'native', phase: 'build' })))
// The go-live audit (step 13) is the heaviest phase — run it ONLY when build+impl are verified-clean.
// An implementation with open findings goes straight back to the user as feedback (no point auditing
// code that still needs fixes).
let openRegister = await dedupVerify([...blockedBuild, ...implFindings.map(f => ({ ...f, phase: 'impl' }))], 'Verify')
if (openRegister.length === 0 && GO_LIVE) {                // step 13 — only when build+impl are clean
  phase('Audit')
  // COMPOSE the proven go-live-audit workflow (a thorough multi-agent native audit) when the skill
  // supplied a filled script; otherwise an inline native finder pass.
  const auditFindings = AUDIT_SCRIPT_PATH
    ? ingestGoLive(await workflow({ scriptPath: AUDIT_SCRIPT_PATH }))
    : await reviewOnce('native', 'audit', 'Audit', auditBrief)
  openRegister = await dedupVerify(auditFindings.map(f => ({ ...f, phase: 'audit' })), 'Verify')
}

// Remove this run's build worktrees so they don't pollute the next run (or the user's own tooling).
await cleanupWorktrees('final')

return {
  // converged = real work ran AND no verified findings survived. Otherwise openRegister IS the feedback
  // for the user — they decide whether to run a fix round (this workflow does not loop on its own).
  converged: openRegister.length === 0,
  ranReal: true,
  plan: plan.planName,
  build: buildLog.map(b => ({ task: b.task, status: b.status, fixes: b.fixes })),
  openRegister,                 // verified findings = the feedback to show the user
  missingAgents: [...missingAgents],   // specialist agent types the plan wanted that aren't installed here → skill notifies the user
  // the review/build roles this run used (so the skill can report them honestly and caveat the verdict)
  reviewConfig: { planHarness: PLAN_HARNESS, planReview: PLAN_REVIEW, buildHarness: BUILD_HARNESS, taskReview: TASK_REVIEW, implReview: IMPL_REVIEW },
  // TRUE when NOTHING checked the build: no per-task reviewer AND no impl review. converged then means
  // "engineer validates passed", not "reviewed clean" — the skill must caveat this.
  noReviewGate: TASK_REVIEW === 'skip' && IMPL_REVIEW === 'skip',
  goLive: GO_LIVE,
}
