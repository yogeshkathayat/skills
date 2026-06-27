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
//   node wf-status.mjs --write [path]  # materialize/refresh a durable snapshot (default
//                                      #   ./.ulpi/workflows/<runId>.json), merging journal-derived
//                                      #   task status over any skill-written fields. Use when a run
//                                      #   had status tracking off, or to refresh on demand.
//
// Stop / resume are NOT scriptable (they go through the Workflow tool / the /workflows UI):
//   stop   → ask Claude to TaskStop the run, or use the /workflows panel
//   resume → ask Claude to Workflow({scriptPath, resumeFromRunId:"<runId>", args:{…}}) — cached
//            agents return instantly; only unfinished/edited tasks re-run. The durable status file
//            stores the exact resume command under `.resume`.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const ARGV = process.argv.slice(2);
const has = (f) => ARGV.includes(f);
const positional = ARGV.filter(a => !a.startsWith('--'));

// ── locate workflow runs under ~/.claude/projects/<slug>/<session>/subagents/workflows ──
const projectsRoot = join(homedir(), '.claude', 'projects');
// Claude slugifies the project path by replacing '/' with '-'. Scope to the current project unless
// --all: a run's <slug> segment and the cwd slug should contain one another (handles subdir launches).
const cwdSlug = process.cwd().replace(/\//g, '-');
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
        if (existsSync(journal)) out.push({ run, slug, journal, mtime: statSync(journal).mtimeMs });
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
  const engineer = {};            // taskId -> latest engineer status ('passed' | 'blocked')
  const mergedSet = new Set();    // taskIds confirmed merged onto the working branch
  let reviews = 0, integrates = 0; const conflicts = [];
  for (const e of results) {
    const r = e.result;
    if (!r || typeof r !== 'object') continue;
    if (Array.isArray(r.tasks) && r.tasks.length && r.tasks[0] && r.tasks[0].id) planTasks = r.tasks.map(t => t.id);
    else if (r.taskId && r.status) engineer[r.taskId] = r.status;
    else if ('merged' in r) {
      integrates++;
      for (const b of (r.merged || [])) { const m = (String(b).match(/TASK-\d+/) || [])[0]; if (m) mergedSet.add(m); }
      for (const b of (r.conflicted || [])) conflicts.push(b);
    } else if ('verdict' in r) reviews++;
  }
  return { started, resultCount: results.length, inFlight: started - results.length,
           planTasks, engineer, mergedSet, reviews, integrates, conflicts };
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
function render(run, p, durable) {
  const b = buckets(p);
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
  console.log(`  plan tasks        ${b.total || '?'}`);
  console.log(`  ✓ integrated      ${b.merged.length}   (merged onto the working branch)`);
  console.log(`  ~ built, queued   ${b.queued.length}   (engineer passed, not yet integrated)`);
  console.log(`  ⟳ in review/fix   ${b.reviewFix.length}   (latest attempt not green)`);
  console.log(`  ○ not started     ${b.notStarted.length}`);
  console.log(line);
  console.log(`  agents: ${p.started} started · ${p.resultCount} done · ${p.inFlight} running NOW`);
  console.log(`  reviews: ${p.reviews} · integrates: ${p.integrates}` + (p.conflicts.length ? ` · CONFLICTS: ${p.conflicts.join(', ')}` : ''));
  console.log(line);
  console.log(`  integrated : ${n(b.merged)}`);
  console.log(`  queued     : ${n(b.queued)}`);
  console.log(`  review/fix : ${n(b.reviewFix)}`);
  console.log(`  not started: ${n(b.notStarted)}`);
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

if (has('--write')) {
  // materialize/refresh a durable snapshot from the journal, merging over any skill-written fields.
  const b = buckets(parsed);
  const statusByTask = {};
  for (const t of b.merged) statusByTask[t] = { status: 'integrated' };
  for (const t of b.queued) statusByTask[t] = { status: 'dev_done' };
  for (const t of b.reviewFix) statusByTask[t] = { status: 'reviewing' };
  for (const t of b.notStarted) statusByTask[t] = { status: 'pending' };
  // explicit path = first positional that isn't the runId, else the conventional durable path
  const explicit = positional.find(a => a !== target.run && /[\/.]/.test(a));
  const outPath = explicit || join(process.cwd(), '.ulpi', 'workflows', `${target.run}.json`);
  let base = {};
  if (existsSync(outPath)) { try { base = JSON.parse(readFileSync(outPath, 'utf8')); } catch { base = {}; } }
  const merged = {
    ...base,
    runId: target.run,
    reconstructedFromJournal: true,
    tasks: { ...(base.tasks || {}), ...mergeTaskStatus(base.tasks || {}, statusByTask) },
    journal: { started: parsed.started, done: parsed.resultCount, running: parsed.inFlight, reviews: parsed.reviews, integrates: parsed.integrates, conflicts: parsed.conflicts },
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
  console.error(`wrote ${outPath} (${b.merged.length}/${b.total || '?'} integrated)`);
  process.exit(0);
}

if (has('--json')) {
  const b = buckets(parsed);
  const durable = statusFileForRun(target.run);
  console.log(JSON.stringify({
    run: target.run,
    overall: durable && durable.data ? durable.data.status : null,
    phases: durable && durable.data ? durable.data.phases : null,
    counts: { planTasks: b.total, integrated: b.merged.length, queued: b.queued.length, reviewFix: b.reviewFix.length, notStarted: b.notStarted.length },
    agents: { started: parsed.started, done: parsed.resultCount, running: parsed.inFlight },
    reviews: parsed.reviews, integrates: parsed.integrates, conflicts: parsed.conflicts,
    tasks: { integrated: b.merged, queued: b.queued, reviewFix: b.reviewFix, notStarted: b.notStarted },
  }, null, 2));
  process.exit(0);
}

render(target.run, parsed, statusFileForRun(target.run));

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
