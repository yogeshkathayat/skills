// ship-playbook — the runnable Workflow that executes the WHOLE 14-step playbook.
//
// Every step below is a real workflow phase, in order — there is no "core" subset:
//   step 3       → plan          (plan-to-task-list-with-dag methodology; assigns specialist agents)
//   steps 4–6    → plan review   (native founder review → fix → re-review until APPROVE/no issues)
//   steps 7–9    → harness review (selected harness ∥ native founder review → fix → until both clean)
//   steps 10–11  → build         (per task across DAG layers: specialist engineer → in-workflow git
//                                 integrate → matched specialist reviewer → fix loop until it passes)
//   step 12      → impl review   (full implementation review, native ∥ selected harness)
//   step 13      → audit         (go-live audit, native ∥ selected harness, if GO_LIVE)
//   step 14      → recurse       (findings → re-plan + re-run the whole playbook, bounded by MAX_ROUNDS)
//
// Steps 1, 2, 2.1 (the prompt + the two intake questions) are collected by the SKILL at the front
// door — a Workflow cannot AskUserQuestion mid-run — and passed in via `args`. They are still part of
// the playbook; the skill just supplies them as inputs to this script. Everything else runs here.
//
// HOW TO USE: the skill launches this with
//   args = { prompt, harness, goLive, root, workingBranch, validate, hardRules, maxRounds, auditScriptPath }
//   (auditScriptPath is optional — see the comment at its CFG read below.)
// Or fill the FILL: fallbacks and run directly. Keep `meta` a pure literal or the Workflow tool
// rejects it. Build agents have Bash, so the in-workflow integrate agent does the git merges.

export const meta = {
  name: 'ship-playbook',
  description: 'Runs the full 14-step ship playbook: plan → founder-review loops → specialist build across DAG layers → impl review → go-live audit → bounded recursion, into a verified finding register',
  phases: [
    { title: 'Plan', detail: 'plan-DAG methodology; assign specialist agents' },
    { title: 'Plan review', detail: 'native founder review → fix → re-review to APPROVE' },
    { title: 'Harness plan review', detail: 'selected harness ∥ native until both clean' },
    { title: 'Build', detail: 'per task: engineer → git integrate → reviewer → fix' },
    { title: 'Impl review', detail: 'full implementation review, native ∥ harness' },
    { title: 'Audit', detail: 'go-live audit (compose go-live-audit) ∥ harness' },
    { title: 'Recurse', detail: 'dedup + dual-lens verify → re-plan or escalate' },
  ],
}

// ── config (args first, FILL: fallbacks for direct runs) ────────────────────────
const CFG = (typeof args === 'object' && args) ? args : {}
const ROOT = CFG.root || 'FILL: absolute repo path'
const WORKING_BRANCH = CFG.workingBranch || 'FILL: branch to build on (e.g. main or a feature branch)'
const HARNESS = CFG.harness || 'FILL: claude | codex | kiro | none'
const GO_LIVE = CFG.goLive === true
const MAX_ROUNDS = CFG.maxRounds || 3        // step 14 recursion budget
const MAX_REVIEW = 4                          // bounded founder-review review→fix iterations
const MAX_FIX = 3                             // bounded per-task engineer↔reviewer fix iterations
const VALIDATE_ALL = CFG.validate || 'FILL: workspace validate, e.g. pnpm -w exec tsc --noEmit && pnpm lint'
const HARD_RULES = CFG.hardRules || `FILL: load-bearing invariants (import boundaries, Node strip-only,
money is BIGINT/string, RLS fail-closed, append-only ActivityLog, route-barrel wiring, …)`
// step 13: path to a FILLED go-live-audit workflow script (the skill authors it via the go-live-audit
// skill and passes its scriptPath). When set, the Audit phase COMPOSES that proven workflow inline via
// the workflow() hook; when unset, it falls back to an inline finder pass.
const AUDIT_SCRIPT_PATH = CFG.auditScriptPath || null
let PROMPT = CFG.prompt || 'FILL: the feature request'

const harnessAgentType = HARNESS === 'codex' ? 'codex:codex-rescue' : 'general-purpose'
// The harness lane's brief prefix. codex routes via its plugin agentType (codex:codex-rescue); kiro
// has no agentType, so it MUST drive the Kiro CLI through the kiro-review skill — never a silent
// native substitute (harness-routing.md: "say so and fall back ... never silently skip a gate").
const harnessRoute = HARNESS === 'kiro'
  ? `Run this as a KIRO cross-review: use the kiro-review skill (\`/kiro-review\`) to drive the Kiro CLI over the surface below, READ-ONLY — do NOT edit. If the Kiro CLI is unavailable, say so in your output and return an empty findings list; do NOT substitute your own native review.`
  : `READ-ONLY via the ${HARNESS} harness, do NOT edit.`
const rank = { BLOCK: 3, CONCERN: 2, OBSERVATION: 1 }
const hasBlocking = (fs) => (fs || []).some(f => f.severity === 'BLOCK' || f.severity === 'CONCERN')

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

function planBrief(prompt, round) {
  const mode = round === 1 ? 'pick the mode that fits the request (EXPANSION/HOLD/REDUCTION)'
    : 'use a HOLD/REDUCTION mode — this is a tight fix-plan for findings from the prior round'
  return `Follow the plan-to-task-list-with-dag methodology for this request, UNATTENDED (do NOT ask
the user anything — ${mode}). Request:\n${prompt}\n
Ground every path in the real repo at ${ROOT}; never invent files. Decompose into atomic tasks (≤3
files each). For EVERY task assign a specialist engineer \`agent\` (never general-purpose) and set
\`reviewer\` = that agent name + '-reviewer'; set \`stackSkill\` to the slash-skill to enforce for the
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
${t.stackSkill ? `You MUST use the ${t.stackSkill} skill and honor its rules.` : ''}
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
For each: \`git merge --no-edit <branch>\`. If one conflicts: \`git merge --abort\`, record it under
conflicted[], continue with the rest. After merging, run ${VALIDATE_ALL} once. Report merged[],
conflicted[], validatePassed. Never force-resolve a conflict.`
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

// run native ∥ selected-harness for a read-only review surface; tag each finding's source
async function reviewBoth(label, phaseTitle, brief) {
  const lanes = [{ source: 'native', run: () => agent(`${brief}\n(native claude)`, { label: `${label}:native`, phase: phaseTitle, schema: FINDINGS }) }]
  if (HARNESS !== 'none') {
    lanes.push({ source: HARNESS, run: () => agent(`${harnessRoute}\n${brief}`, { label: `${label}:${HARNESS}`, phase: phaseTitle, schema: FINDINGS, agentType: harnessAgentType }) })
  }
  const out = await parallel(lanes.map(l => l.run))
  return out.flatMap((r, i) => (r && r.findings ? r.findings.map(f => ({ ...f, source: lanes[i].source })) : []))
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

// ── steps 4–6: native founder-review loop until APPROVE / no blocking ───────────
async function nativeReviewLoop(plan, round) {
  for (let i = 0; i < MAX_REVIEW; i++) {
    const r = await agent(founderBrief(plan, 'native'), { label: `plan-review:native:r${round}.${i}`, phase: 'Plan review', schema: FINDINGS })
    if (!r || r.verdict === 'approve' || !hasBlocking(r.findings)) return r
    await agent(planFixBrief(plan, r.findings), { label: `plan-fix:r${round}.${i}`, phase: 'Plan review', schema: FIX_RESULT })
  }
}

// ── steps 7–9: selected harness ∥ native founder review until both clean ────────
async function harnessReviewLoop(plan, round) {
  for (let i = 0; i < MAX_REVIEW; i++) {
    const both = await parallel([
      () => agent(founderBrief(plan, 'native'), { label: `plan-review2:native:r${round}.${i}`, phase: 'Harness plan review', schema: FINDINGS }),
      () => agent(`${harnessRoute}\n${founderBrief(plan, HARNESS)}`, { label: `plan-review2:${HARNESS}:r${round}.${i}`, phase: 'Harness plan review', schema: FINDINGS, agentType: harnessAgentType }),
    ])
    const findings = both.flatMap(r => (r && r.findings) ? r.findings : [])
    if (!hasBlocking(findings)) return
    await agent(planFixBrief(plan, findings), { label: `plan-fix2:r${round}.${i}`, phase: 'Harness plan review', schema: FIX_RESULT })
  }
}

// ── steps 10–11: build across DAG layers, engineer → integrate → reviewer → fix ──
async function buildPlan(plan, round) {
  const byId = new Map(plan.tasks.map(t => [t.id, t]))
  const layers = (plan.layers && plan.layers.length) ? plan.layers : [plan.tasks.map(t => t.id)]
  const log = []
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li].map(id => byId.get(id)).filter(Boolean)
    // engineers implement in parallel (isolated worktrees, disjoint write scope), each on a task branch
    const built = await parallel(layer.map(t => () =>
      agent(engineerBrief(t), { label: `build:${t.id}`, phase: 'Build', schema: TASK_RESULT, agentType: t.agent, isolation: 'worktree' }).then(r => ({ t, r }))))
    // in-workflow git integrate: merge passed task branches onto the working branch (one sequential agent)
    const passedBranches = built.filter(b => b && b.r && b.r.status === 'passed').map(b => branchFor(b.t))
    if (passedBranches.length) await agent(integrateBrief(passedBranches), { label: `integrate:L${li}r${round}`, phase: 'Build', schema: INTEGRATE_RESULT })
    // per-task review + bounded fix loop
    for (const b of built.filter(Boolean)) {
      const t = b.t
      if (!b.r || b.r.status !== 'passed') { log.push({ task: t.id, status: 'blocked', reason: 'engineer validate failed', fixes: 0, findings: [] }); continue }
      let review = await agent(reviewerBrief(t), { label: `review:${t.id}`, phase: 'Build', schema: FINDINGS, agentType: t.reviewer }) || { verdict: 'concerns', findings: [] }
      let fixes = 0
      while (review.verdict === 'blocked' && fixes < MAX_FIX) {
        fixes++
        await agent(fixBrief(t, review.findings, fixes), { label: `fix:${t.id}#${fixes}`, phase: 'Build', schema: TASK_RESULT, agentType: t.agent, isolation: 'worktree' })
        await agent(integrateBrief([fixBranchFor(t, fixes)]), { label: `reintegrate:${t.id}#${fixes}`, phase: 'Build', schema: INTEGRATE_RESULT })
        review = await agent(reviewerBrief(t), { label: `review:${t.id}#${fixes}`, phase: 'Build', schema: FINDINGS, agentType: t.reviewer }) || { verdict: 'concerns', findings: [] }
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

// ── the playbook: steps 3 → 14, recursing until clean or MAX_ROUNDS ─────────────
const history = []
let openRegister = []
for (let round = 1; round <= MAX_ROUNDS; round++) {
  log(`Round ${round}/${MAX_ROUNDS}`)
  phase('Plan')
  const plan = await agent(planBrief(PROMPT, round), { label: `plan:r${round}`, phase: 'Plan', schema: PLAN })
  if (!plan || !plan.tasks || !plan.tasks.length) { history.push({ round, error: 'planning produced no tasks' }); break }

  phase('Plan review')
  await nativeReviewLoop(plan, round)                       // steps 4–6
  if (HARNESS !== 'none') { phase('Harness plan review'); await harnessReviewLoop(plan, round) } // steps 7–9

  phase('Build')
  const buildLog = await buildPlan(plan, round)            // steps 10–11

  phase('Impl review')
  const implFindings = await reviewBoth('impl', 'Impl review', implBrief(plan)) // step 12

  // step 13 — go-live audit: COMPOSE the proven go-live-audit workflow (when the skill supplied a
  // filled script) ∥ a selected-harness audit lane. Falls back to an inline finder pass if no script.
  let auditFindings = []
  if (GO_LIVE) {
    phase('Audit')
    const lanes = []
    if (AUDIT_SCRIPT_PATH) {
      lanes.push(async () => ingestGoLive(await workflow({ scriptPath: AUDIT_SCRIPT_PATH }))) // go-live-audit as a sub-workflow
    } else {
      lanes.push(async () => await reviewBoth('audit', 'Audit', auditBrief))                  // fallback
    }
    if (HARNESS !== 'none') {
      lanes.push(async () => {
        const r = await agent(`${harnessRoute}\n${auditBrief}`, { label: `audit:${HARNESS}`, phase: 'Audit', schema: FINDINGS, agentType: harnessAgentType })
        return (r && r.findings ? r.findings : []).map(f => ({ ...f, source: HARNESS, phase: 'audit' }))
      })
    }
    auditFindings = (await parallel(lanes)).filter(Boolean).flat()
  }

  phase('Recurse')                                          // step 14
  const blockedBuild = buildLog.filter(b => b.status === 'blocked').flatMap(b =>
    (b.findings.length ? b.findings : [{ severity: 'BLOCK', file: b.task, issue: `task ${b.task} did not pass after ${b.fixes} fixes` }]).map(f => ({ ...f, source: 'native', phase: 'build' })))
  const open = await dedupVerify([...blockedBuild, ...implFindings.map(f => ({ ...f, phase: 'impl' })), ...auditFindings.map(f => ({ ...f, phase: 'audit' }))], 'Recurse')
  history.push({ round, plan: plan.planName, build: buildLog.map(b => ({ task: b.task, status: b.status, fixes: b.fixes })), openFindings: open.length })
  openRegister = open
  if (open.length === 0) break                              // converged
  if (round === MAX_ROUNDS) break                           // escalate (do not loop further)
  PROMPT = `Fix these confirmed findings from round ${round} of "${plan.planName}":\n` +
    open.map(f => `- [${f.severity}] ${f.file}${f.line ? ':' + f.line : ''} — ${f.issue}${f.suggestedFix ? ` (fix: ${f.suggestedFix})` : ''}`).join('\n')
}

return {
  converged: openRegister.length === 0,
  roundsRun: history.length,
  history,
  openRegister,                 // empty = clean; non-empty after MAX_ROUNDS = escalate to the user
  harness: HARNESS,
  goLive: GO_LIVE,
}
