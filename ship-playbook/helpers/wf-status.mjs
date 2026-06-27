#!/usr/bin/env node
// wf-status — legible per-task status for a ship-playbook (or any) Workflow run.
//
// Reads the runtime's per-run journal.jsonl (the agent result-cache the Workflow tool already writes)
// and reconstructs status WITHOUT touching the run — it is READ-ONLY by default. The journal records
// every agent `started` + `result`; ship-playbook's structured outputs make the shapes legible:
//   plan-adoption → {tasks:[{id,…}]}   engineer → {taskId,status}
//   integrate     → {merged[],conflicted[]}   review → {verdict,findings}
// When the run also wrote a durable .ulpi/workflows/<id>.json (ship-playbook's live status file), this
// tool reads it too and shows the overall status + which phase the playbook is in — semantics the
// journal alone can't recover (the journal has no labels, only result payloads).
//
// Usage:
//   node wf-status.mjs                 # newest run for THIS project (cwd), legible summary
//   node wf-status.mjs <runId>         # a specific wf_… run (prefix ok)
//   node wf-status.mjs --list          # every run for this project + one-line state
//   node wf-status.mjs --all           # don't scope to cwd — scan all projects
//   node wf-status.mjs --json [runId]  # machine-readable reconstruction
//   node wf-status.mjs --write [path]  # BACKFILL the durable .ulpi/workflows/<runId>.json from the
//                                      #   journal — for a run that predates v1.5.0 (incl. an in-flight
//                                      #   one) that never wrote its own status file. Recovers plan
//                                      #   name/path, working branch, the full task list + per-task
//                                      #   status, layers and counts. The journal has NO launch args, so
//                                      #   add  --args '{"planReview":"skip","taskReview":"codex",…}'  to
//                                      #   fold in the gate config and complete the resume recipe.
//   node wf-status.mjs --resume [runId]# EMIT the exact Workflow({scriptPath, args}) call to RESUME this
//                                      #   run: reads the durable status file's launchArgs and re-fires
//                                      #   them with planPath + checkpointResume:true + the same statusFile.
//                                      #   Durable, session-independent (no resumeFromRunId). Claude pastes
//                                      #   the emitted JSON into the Workflow tool; the run skips done tasks.
//
// Stop:  ask Claude to TaskStop the run, or use the /workflows panel. Nothing is lost — the status file
//        and journal both persist what's done; resume rebuilds only what's left.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ARGV = process.argv.slice(2);
const has = (f) => ARGV.includes(f);
const positional = ARGV.filter(a => !a.startsWith('--'));

// ── --resume: emit the exact Workflow() call to resume a run from its durable status file ──
// Self-contained: sources `<cwd>/.ulpi/workflows/<id>.json` directly (kept current by the run's statusStep
// writers), needs NO journal. Re-fires the stored launchArgs with planPath (skip re-planning) +
// checkpointResume:true (skip done tasks) + the same statusFile. Durable + session-independent.
if (has('--resume')) {
  const all = findStatusFiles();
  const durable = positional[0]
    ? statusFileForRun(positional[0])
    : all.slice().sort((a, b) => String((b.data && b.data.updatedAt) || '').localeCompare(String((a.data && a.data.updatedAt) || '')))[0];
  if (!durable || !durable.data) {
    console.error(`no .ulpi/workflows/*.json status file found${positional[0] ? ` for ${positional[0]}` : ` in ${process.cwd()}`} — run \`--write [runId]\` to backfill one from the journal first.`);
    process.exit(1);
  }
  const d = durable.data;
  const la = d.launchArgs || {};
  const args = {
    ...(d.config || {}),                                          // harnesses + goLive (fallback)
    prompt: d.prompt, root: d.root, workingBranch: d.workingBranch,
    ...la,                                                        // launchArgs authoritative (validate, hardRules, …)
    planPath: (d.plan && d.plan.path) || la.planPath,            // resume AT BUILD — skip re-planning
    statusFile: durable.path,
    workflowId: d.workflowId || d.runId,
    checkpointResume: true,
  };
  for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k];
  const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'references', 'workflow-template.js');
  // "what's left" from the durable file's OWN per-task statuses (no journal needed)
  const st = Object.values(d.tasks || {}).map(t => t && t.status).filter(Boolean);
  const c = (s) => st.filter(x => x === s).length;
  const done = c('passed');
  const onBr = c('integrated') + c('reviewing') + c('fixing') + c('blocked');
  console.error(`resume ${d.workflowId || d.runId || ''}: ${done} passed (skip) · ${onBr} on-branch (re-review, no rebuild) · ${Math.max(0, st.length - done - onBr)} to (re)build  [${st.length} tasks]`);
  if (!Object.keys(la).length) console.error('  WARNING: no launchArgs in the status file — validate/hardRules may be MISSING; verify the args before launching (runs launched by v1.7.0+ store them).');
  if (!args.planPath) console.error('  WARNING: no plan path recorded — resume will RE-PLAN (the run was interrupted before a plan landed).');
  console.log(JSON.stringify({ scriptPath, args }, null, 2));
  process.exit(0);
}

// ── locate workflow runs under ~/.claude/projects/<slug>/<session>/subagents/workflows ──
const projectsRoot = join(homedir(), '.claude', 'projects');
// Claude slugifies the project path by replacing every non-alphanumeric char with '-' (so '/', '_' and
// '.' all become '-', e.g. /Users/x/work_cip/ulpi-v6 → -Users-x-work-cip-ulpi-v6). Scope to the current
// project unless --all: a run's <slug> segment and the cwd slug should contain one another (handles
// subdir launches).
const cwdSlug = process.cwd().replace(/[^a-zA-Z0-9]/g, '-');
const inThisProject = (slug) => cwdSlug.startsWith(slug) || slug.startsWith(cwdSlug);

function findWorkflowDirs({ all = false } = {}) {
  const out = [];
  if (!existsSync(projectsRoot)) return out;
  for (const slug of safeReaddir(projectsRoot)) {
    if (!all && !inThisProject(slug)) continue;
    const projPath = join(projectsRoot, slug);
    for (const s of safeReaddir(projPath)) {
      const wfRoot = join(projPath, s, 'subagents', 'workflows');
      if (!existsSync(wfRoot)) continue;
      for (const run of safeReaddir(wfRoot)) {
        if (!run.startsWith('wf_')) continue;
        const journal = join(wfRoot, run, 'journal.jsonl');
        if (existsSync(journal)) out.push({ run, slug, dir: join(wfRoot, run), journal, mtime: statSync(journal).mtimeMs });
      }
    }
  }
  // a run id can appear under several session dirs (each resume opens a new session) — keep the newest.
  const byRun = new Map();
  for (const r of out) { const prev = byRun.get(r.run); if (!prev || r.mtime > prev.mtime) byRun.set(r.run, r); }
  return [...byRun.values()].sort((a, b) => b.mtime - a.mtime);
}
function safeReaddir(p) { try { return readdirSync(p); } catch { return []; } }

// ── reconstruct status from the journal's result payloads ──
function parseJournal(journalPath) {
  const lines = readFileSync(journalPath, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const started = lines.filter(l => l.type === 'started').length;
  const results = lines.filter(l => l.type === 'result');
  let planTasks = [];
  let plan = null;                // the full plan-adoption result {planName, planPath, tasks[], layers[][]}
  let preflight = null;           // the git-readiness result {isGitRepo, currentBranch, workingBranchExists}
  const engineer = {};            // taskId -> latest engineer status ('passed' | 'blocked')
  const mergedSet = new Set();    // taskIds confirmed merged onto the working branch
  let reviews = 0, integrates = 0; const conflicts = [];
  for (const e of results) {
    const r = e.result;
    if (!r || typeof r !== 'object') continue;
    if (Array.isArray(r.tasks) && r.tasks.length && r.tasks[0] && r.tasks[0].id) { planTasks = r.tasks.map(t => t.id); plan = r; }
    else if (r.taskId && r.status) engineer[r.taskId] = r.status;
    else if ('isGitRepo' in r) preflight = r;
    else if ('merged' in r) {
      integrates++;
      for (const b of (r.merged || [])) { const m = (String(b).match(/TASK-\d+/) || [])[0]; if (m) mergedSet.add(m); }
      for (const b of (r.conflicted || [])) conflicts.push(b);
    } else if ('verdict' in r) reviews++;
  }
  return { started, resultCount: results.length, inFlight: started - results.length,
           planTasks, plan, preflight, engineer, mergedSet, reviews, integrates, conflicts };
}

// buckets derived from the reconstruction
function buckets(p) {
  const total = p.planTasks.length;
  const merged = [...p.mergedSet].filter(t => !total || p.planTasks.includes(t)).sort();
  const engineered = Object.keys(p.engineer).sort();
  const queued = engineered.filter(t => p.engineer[t] === 'passed' && !p.mergedSet.has(t));
  const reviewFix = engineered.filter(t => p.engineer[t] !== 'passed' && !p.mergedSet.has(t));
  const touched = new Set([...merged, ...engineered]);
  const notStarted = p.planTasks.filter(t => !touched.has(t));
  return { total, merged, queued, reviewFix, notStarted };
}

// ── DEEP reconstruction: join each agent's PROMPT (role + task id, in agent-<id>.jsonl) with its RESULT
// (journal, keyed by agentId) + whether it has finished. The journal alone can't attribute a review/fix
// to a task (those results carry no task id) — but the agent's prompt names the task, so this recovers
// TRUE per-task status incl. review-pending and fix-in-progress. ──
function firstLine(path) {
  // read only enough to capture the first record (the prompt) — agent transcripts can be hundreds of KB
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.allocUnsafe(262144);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const s = buf.toString('utf8', 0, n);
    const nl = s.indexOf('\n');
    return nl >= 0 ? s.slice(0, nl) : s;
  } catch { return ''; } finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}
function classifyPrompt(p) {
  p = String(p || '');
  let m;
  if ((m = p.match(/READ-ONLY review of (TASK-\d+)/))) return { role: 'review', task: m[1] };
  if ((m = p.match(/Fix (TASK-\d+) for these reviewer findings/))) { const it = p.match(/wf\/build\/TASK-\d+-fix(\d+)/); return { role: 'fix', task: m[1], fix: it ? +it[1] : 1 }; }
  if ((m = p.match(/specialist engineer[^]*?for (TASK-\d+)/))) return { role: 'build', task: m[1] };
  if (/integrate these task branches/.test(p)) return { role: 'integrate', tasks: [...new Set([...p.matchAll(/wf\/build\/(TASK-\d+)/g)].map(x => x[1]))] };
  if (/Full implementation review of everything built/.test(p)) return { role: 'impl-review' };
  if (/Founder-review the plan/.test(p)) return { role: 'plan-review' };
  if (/plan-to-task-list-with-dag/.test(p)) return { role: 'plan' };
  return { role: 'other' };
}
function reconstruct(dir, journalPath) {
  const lines = readFileSync(journalPath, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const resultById = new Map(); const started = new Set();
  let plan = null, planTasks = [];
  for (const l of lines) {
    if (l.type === 'started') started.add(l.agentId);
    else if (l.type === 'result') {
      resultById.set(l.agentId, l.result);
      const r = l.result; if (r && Array.isArray(r.tasks) && r.tasks[0] && r.tasks[0].id) { plan = r; planTasks = r.tasks.map(t => t.id); }
    }
  }
  const agents = [];
  for (const f of safeReaddir(dir)) {
    if (!/^agent-.*\.jsonl$/.test(f)) continue;
    let rec; try { rec = JSON.parse(firstLine(join(dir, f))); } catch { continue; }
    if (!rec || !rec.agentId) continue;
    const c = rec.message && rec.message.content;
    const prompt = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x && x.text) || '').join(' ') : '';
    agents.push({ id: rec.agentId, ts: Date.parse(rec.timestamp) || 0, ...classifyPrompt(prompt), result: resultById.get(rec.agentId) || null, running: started.has(rec.agentId) && !resultById.has(rec.agentId) });
  }
  agents.sort((a, b) => a.ts - b.ts);
  const T = {};
  const ensure = id => (T[id] = T[id] || { id, build: null, integrated: false, review: null, fixes: 0, building: false, reviewing: false, fixing: false });
  for (const a of agents) {
    if (a.role === 'build' && a.task) { const t = ensure(a.task); if (a.running) t.building = true; else if (a.result) { t.building = false; t.build = a.result.status; } }
    else if (a.role === 'integrate' && a.tasks) { for (const id of a.tasks) if (a.result && (a.result.merged || []).some(b => String(b).includes(id))) ensure(id).integrated = true; }
    else if (a.role === 'review' && a.task) { const t = ensure(a.task); if (a.running) { t.reviewing = true; t.review = 'pending'; } else if (a.result) { t.reviewing = false; t.review = a.result.verdict === 'blocked' ? 'blocked' : 'clean'; } }
    else if (a.role === 'fix' && a.task) { const t = ensure(a.task); t.fixes = Math.max(t.fixes, a.fix || 1); t.fixing = !!a.running; }
  }
  for (const id of planTasks) ensure(id);
  for (const id of Object.keys(T)) {
    const t = T[id]; let s;
    if (t.integrated) s = t.reviewing ? 'reviewing' : t.fixing ? 'fixing' : t.review === 'blocked' ? 'blocked' : t.review === 'clean' ? 'passed' : 'integrated';
    else if (t.building) s = 'building';
    else if (t.build === 'passed') s = t.reviewing ? 'reviewing' : t.fixing ? 'fixing' : 'dev_done';
    else if (t.build === 'blocked') s = 'dev_failed';
    else if (t.reviewing) s = 'reviewing';
    else if (t.fixing) s = 'fixing';
    else s = 'pending';
    t.status = s;
  }
  const running = agents.filter(a => a.running).map(a => ({ role: a.role, task: a.task || (a.tasks && a.tasks.join('+')) || null, fix: a.fix || null }));
  return { tasks: T, planTasks, planMeta: plan ? { name: plan.planName, path: plan.planPath, taskCount: planTasks.length, layers: (plan.layers || []).length } : null, agentCount: agents.length, running };
}
// "review:TASK-032", "fix:TASK-032#2", "integrate:TASK-007+TASK-009", or just the role for plan/etc.
const runLabel = (a) => a.task ? `${a.role}:${a.task}${a.fix ? '#' + a.fix : ''}` : a.role;
// partition the deep per-task map into DISJOINT buckets by status (each task has exactly one status), plus
// `onBranch` = everything merged onto the working branch (integrated/reviewing/fixing/passed/blocked).
function deepBuckets(d) {
  const by = {};
  for (const t of Object.values(d.tasks)) (by[t.status] = by[t.status] || []).push(t.id);
  for (const k in by) by[k].sort();
  const get = k => by[k] || [];
  return {
    total: d.planTasks.length || Object.keys(d.tasks).length,
    passed: get('passed'), blocked: get('blocked'), reviewing: get('reviewing'), fixing: get('fixing'),
    integrated: get('integrated'),     // merged onto the branch, review not yet started
    devDone: get('dev_done'), devFailed: get('dev_failed'), building: get('building'), notStarted: get('pending'),
    onBranch: ['integrated', 'reviewing', 'fixing', 'passed', 'blocked'].flatMap(get).sort(),
  };
}

// ── durable .ulpi/workflows/<id>.json (ship-playbook's live status file), if present in cwd ──
function findStatusFiles() {
  const dir = join(process.cwd(), '.ulpi', 'workflows');
  if (!existsSync(dir)) return [];
  return safeReaddir(dir).filter(f => f.endsWith('.json'))
    .map(f => join(dir, f))
    .map(path => { try { return { path, data: JSON.parse(readFileSync(path, 'utf8')) }; } catch { return null; } })
    .filter(Boolean);
}
function statusFileForRun(run) {
  const files = findStatusFiles();
  return files.find(f => f.data && f.data.runId === run)
      || files.find(f => f.data && typeof f.data.runId === 'string' && run.startsWith(f.data.runId))
      || null;
}

// ── render ──
function render(run, p, durable, deep) {
  const db = deepBuckets(deep);
  const n = (a) => a.map(t => t.replace('TASK-', '')).join(' ') || '—';
  const line = '  ' + '─'.repeat(58);
  console.log(`\n  ship-playbook run ${run}`);
  if (durable && durable.data) {
    const d = durable.data;
    const ph = d.phases ? Object.entries(d.phases).map(([k, v]) => `${k}:${(v && v.status) || '?'}`).join('  ') : '';
    console.log(line);
    console.log(`  overall    : ${d.status || '?'}${d.plan && d.plan.name ? `   plan: ${d.plan.name}` : ''}`);
    if (ph) console.log(`  phases     : ${ph}`);
  }
  console.log(line);
  console.log(`  plan tasks          ${db.total || '?'}   ·   on branch: ${db.onBranch.length}`);
  console.log(`  ✓ passed            ${db.passed.length}   (integrated + review clean)`);
  console.log(`  ✗ blocked           ${db.blocked.length}   (integrated, review BLOCKED)`);
  console.log(`  ⟳ reviewing         ${db.reviewing.length}   (integrated, review IN PROGRESS)`);
  console.log(`  ✎ fixing            ${db.fixing.length}   (review found issues, fix running)`);
  console.log(`  ▸ integrated        ${db.integrated.length}   (merged, review not yet started)`);
  console.log(`  ~ built, not merged ${db.devDone.length}   (engineer passed, awaiting integrate)`);
  console.log(`  ⏺ building          ${db.building.length}   (engineer running now)`);
  console.log(`  ⚠ dev failed        ${db.devFailed.length}   (engineer could not validate)`);
  console.log(`  ○ not started       ${db.notStarted.length}`);
  console.log(line);
  console.log(`  agents: ${p.started} started · ${p.resultCount} done · ${p.inFlight} running NOW` + (deep.running && deep.running.length ? `  →  ${deep.running.map(runLabel).join(', ')}` : ''));
  console.log(`  reviews: ${p.reviews} · integrates: ${p.integrates}` + (p.conflicts.length ? ` · CONFLICTS: ${p.conflicts.join(', ')}` : ''));
  console.log(line);
  console.log(`  passed     : ${n(db.passed)}`);
  if (db.blocked.length) console.log(`  blocked    : ${n(db.blocked)}`);
  if (db.reviewing.length) console.log(`  reviewing  : ${n(db.reviewing)}`);
  if (db.fixing.length) console.log(`  fixing     : ${n(db.fixing)}`);
  if (db.integrated.length) console.log(`  integrated : ${n(db.integrated)}`);
  if (db.devDone.length) console.log(`  not merged : ${n(db.devDone)}`);
  if (db.building.length) console.log(`  building   : ${n(db.building)}`);
  if (db.devFailed.length) console.log(`  dev failed : ${n(db.devFailed)}`);
  console.log(`  not started: ${n(db.notStarted)}`);
  if (durable && durable.data && durable.data.openRegister && durable.data.openRegister.length)
    console.log(`\n  open findings: ${durable.data.openRegister.length} (see ${durable.path})`);
  console.log('');
}

// ── main ──
const runs = findWorkflowDirs({ all: has('--all') });
if (!runs.length) {
  console.error(`no workflow runs found for this project under ${projectsRoot} (try --all to scan every project)`);
  process.exit(1);
}

if (has('--list')) {
  console.log('\n  workflow runs (newest first):');
  for (const r of runs) {
    const p = parseJournal(r.journal);
    const b = buckets(p);
    const d = statusFileForRun(r.run);
    const overall = d && d.data && d.data.status ? `${d.data.status} · ` : '';
    console.log(`  ${r.run}  —  ${overall}${b.merged.length}/${b.total || '?'} integrated · ${p.inFlight} running · ${new Date(r.mtime).toLocaleString()}`);
  }
  console.log('');
  process.exit(0);
}

const target = positional[0] ? runs.find(r => r.run === positional[0] || r.run.includes(positional[0])) : runs[0];
if (!target) { console.error('run not found: ' + positional[0]); process.exit(1); }
const parsed = parseJournal(target.journal);
// DEEP per-task status (joins agent prompts → role+task with their results). This is the accurate one —
// it sees review-pending / fixing per task; the journal-shape buckets can't attribute reviews to tasks.
const deep = reconstruct(target.dir, target.journal);

if (has('--write')) {
  // BACKFILL: build/refresh a durable .ulpi/workflows/<run>.json from the journal — for a run that
  // predates v1.5.0 (incl. an in-flight one) and never wrote its own status file. Recovers everything the
  // journal holds (plan name/path, working branch, the full task list + per-task status, layers, counts)
  // and merges it over any existing file without clobbering skill-written fields. What the journal does
  // NOT hold — the LAUNCH ARGS (gate config, hardRules, validate, the original prompt) were inputs to the
  // script, not agent results — so those can't be recovered here; pass them with --args '<json>' to
  // complete the resume recipe (the session that launched the run knows them).
  const db = deepBuckets(deep);
  // per-task status from the DEEP reconstruction (true: pending/building/dev_done/integrated/reviewing/
  // fixing/passed/blocked), plus fix count — then layer task metadata (title/agent/branch) from the plan.
  const taskMeta = {};
  for (const t of (parsed.plan && parsed.plan.tasks) || [])
    taskMeta[t.id] = { title: t.title || '', agent: t.agent || '', branch: `wf/build/${t.id}` };
  const tasksOut = {};
  for (const id of new Set([...Object.keys(taskMeta), ...Object.keys(deep.tasks)])) {
    const dt = deep.tasks[id];
    tasksOut[id] = { ...(taskMeta[id] || {}), status: dt ? dt.status : 'pending', ...(dt && dt.fixes ? { fixes: dt.fixes } : {}) };
  }

  // optional --args '<json>' = the original launch args (gate config etc.) to complete the recipe
  let argsOverride = null;
  const ai = ARGV.indexOf('--args');
  if (ai >= 0 && ARGV[ai + 1]) { try { argsOverride = JSON.parse(ARGV[ai + 1]); } catch { console.error('--args: not valid JSON, ignoring'); } }

  const allDone = db.total > 0 && db.passed.length === db.total;
  const planName = (deep.planMeta && deep.planMeta.name) || (parsed.plan && parsed.plan.planName);
  const planPath = (deep.planMeta && deep.planMeta.path) || (parsed.plan && parsed.plan.planPath);
  const branch = (parsed.preflight && parsed.preflight.currentBranch) || (argsOverride && argsOverride.workingBranch) || null;
  const phases = {
    plan: { status: deep.planMeta ? 'done' : 'unknown' },
    plan_review: { status: 'unknown' },
    build: (parsed.integrates || db.onBranch.length || db.building.length)
      ? { status: allDone ? 'done' : 'in_progress', onBranch: db.onBranch.length, passed: db.passed.length, blocked: db.blocked.length, reviewing: db.reviewing.length, fixing: db.fixing.length, total: db.total }
      : { status: 'unknown' },
    impl_review: { status: 'unknown' },
    verify: { status: 'unknown' },
    audit: { status: 'unknown' },
  };
  // a planPath-based resume needs the fewest inputs (the plan already exists on disk → no re-plan)
  const resumeArgs = { ...(argsOverride || {}), ...(planPath ? { planPath } : {}), ...(branch ? { workingBranch: branch } : {}), root: process.cwd() };
  const resume = `Workflow({ scriptPath: "<path-to>/ship-playbook/references/workflow-template.js", resumeFromRunId: "${target.run}", args: ${JSON.stringify(resumeArgs)} })`;

  const explicit = positional.find(a => a !== target.run && /[\/.]/.test(a));
  const outPath = explicit || join(process.cwd(), '.ulpi', 'workflows', `${target.run}.json`);
  let base = {};
  if (existsSync(outPath)) { try { base = JSON.parse(readFileSync(outPath, 'utf8')); } catch { base = {}; } }
  const merged = {
    schemaVersion: 1,
    workflowId: base.workflowId || target.run,
    runId: target.run,
    reconstructedFromJournal: true,
    partial: true,                // phases/overall + launch args are partly inferred — see `note`
    note: 'Backfilled from the run journal. The journal has no launch args, so gate config / hardRules / validate / prompt are NOT recovered — pass them via --args to complete the resume recipe.',
    status: base.status || (parsed.inFlight > 0 ? 'running' : 'inactive'),
    root: base.root || process.cwd(),
    workingBranch: base.workingBranch || branch || null,
    config: { ...(base.config || {}), ...((argsOverride && pickConfig(argsOverride)) || {}) },
    plan: base.plan || (planName ? { name: planName, path: planPath || null, taskCount: db.total, layers: (deep.planMeta && deep.planMeta.layers) || 0 } : null),
    counts: { onBranch: db.onBranch.length, passed: db.passed.length, blocked: db.blocked.length, reviewing: db.reviewing.length, fixing: db.fixing.length, devFailed: db.devFailed.length, notStarted: db.notStarted.length },
    phases: { ...phases, ...(base.phases || {}) },
    resume: (argsOverride || !base.resume) ? resume : base.resume,   // regenerate when args are supplied
    tasks: { ...(base.tasks || {}), ...mergeTaskStatus(base.tasks || {}, tasksOut) },
    journal: { started: parsed.started, done: parsed.resultCount, running: parsed.inFlight, reviews: parsed.reviews, integrates: parsed.integrates, conflicts: parsed.conflicts },
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
  console.error(`wrote ${outPath}`);
  console.error(`  plan: ${planName || '(unknown)'} · branch: ${branch || '(unknown)'} · ${db.onBranch.length}/${db.total || '?'} on-branch (${db.passed.length} passed, ${db.blocked.length} blocked, ${db.reviewing.length} reviewing, ${db.fixing.length} fixing) · ${db.notStarted.length} not started`);
  if (!argsOverride) console.error('  note: launch args (gate config/hardRules/validate/prompt) NOT in the journal — add --args \'{…}\' for a complete resume recipe.');
  process.exit(0);
}

if (has('--json')) {
  const db = deepBuckets(deep);
  const durable = statusFileForRun(target.run);
  console.log(JSON.stringify({
    run: target.run,
    overall: durable && durable.data ? durable.data.status : null,
    phases: durable && durable.data ? durable.data.phases : null,
    counts: { planTasks: db.total, onBranch: db.onBranch.length, passed: db.passed.length, blocked: db.blocked.length, reviewing: db.reviewing.length, fixing: db.fixing.length, integrated: db.integrated.length, devDone: db.devDone.length, devFailed: db.devFailed.length, building: db.building.length, notStarted: db.notStarted.length },
    agents: { started: parsed.started, done: parsed.resultCount, running: parsed.inFlight },
    runningNow: deep.running.map(runLabel),
    reviews: parsed.reviews, integrates: parsed.integrates, conflicts: parsed.conflicts,
    perTask: Object.fromEntries(Object.values(deep.tasks).map(t => [t.id, { status: t.status, fixes: t.fixes, review: t.review }])),
    tasks: { passed: db.passed, blocked: db.blocked, reviewing: db.reviewing, fixing: db.fixing, integrated: db.integrated, devDone: db.devDone, devFailed: db.devFailed, building: db.building, notStarted: db.notStarted },
  }, null, 2));
  process.exit(0);
}

render(target.run, parsed, statusFileForRun(target.run), deep);

// the gate-config subset of a launch-args object (for the durable file's `config`)
function pickConfig(a) {
  const out = {};
  for (const k of ['planHarness', 'planReview', 'buildHarness', 'taskReview', 'implReview', 'goLive'])
    if (a[k] !== undefined) out[k] = a[k];
  return out;
}

// keep a skill-written richer status (e.g. 'passed'/'blocked' with fixes) when the journal only knows a
// coarser bucket — don't downgrade a known-good task back to 'reviewing'.
function mergeTaskStatus(existing, fromJournal) {
  const out = {};
  const FINAL = new Set(['passed', 'blocked', 'integrated']);
  for (const [id, v] of Object.entries(fromJournal)) {
    const prev = existing[id];
    if (prev && prev.status && FINAL.has(prev.status) && !FINAL.has(v.status)) out[id] = prev;   // keep richer
    else out[id] = { ...(prev || {}), ...v };
  }
  return out;
}
