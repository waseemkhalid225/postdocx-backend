// lib/queue.js — Phase 0: a Postgres-backed job queue. No new infrastructure, no lost work.
// Long tasks (discovery, case preparation, document reading) are enqueued and processed by
// an in-process worker with retries and backoff, so a request never waits on a minute of AI.
const { admin } = require('./supa');
const os = require('os');
const WORKER = os.hostname() + ':' + process.pid;
const handlers = {};

function register(kind, fn) { handlers[kind] = fn; }

async function enqueue(kind, payload, opts = {}) {
  const { data, error } = await admin().from('job_queue').insert({
    kind, payload: payload || {}, org_id: opts.orgId || null, user_id: opts.userId || null,
    max_attempts: opts.maxAttempts || 3, run_after: opts.runAfter || new Date().toISOString()
  }).select('id').single();
  if (error) throw new Error('queue: ' + error.message);
  return data.id;
}

/* BULKHEAD. Every organisation (and the platform's own direct work, org_id null) is an isolated lane:
   - a per-lane circuit breaker: 8 failures inside 15 minutes trips the lane; its jobs wait (status stays queued, run_after
     pushed 30 minutes) while every other lane keeps running; the breaker resets itself and the admin is told;
   - fair claiming: the worker rotates across lanes instead of draining whichever lane enqueued most;
   - a per-lane concurrency cap so one branch's bulk action cannot occupy all workers.
   Same infrastructure, logical isolation: economical and safe. */
const LANE = { fails: new Map(), tripped: new Map(), running: new Map() }; const LANE_MAX_RUNNING = Number(process.env.FF_LANE_MAX_RUNNING || 3); const LANE_TRIP_FAILS = 8; const LANE_TRIP_WINDOW = 15 * 60000; const LANE_COOL = 30 * 60000;
function laneKey(job) { return job && job.org_id ? String(job.org_id) : 'platform'; }
function laneTripped(key) { const t = LANE.tripped.get(key); if (!t) return false; if (Date.now() > t) { LANE.tripped.delete(key); LANE.fails.delete(key); persistLanes(); return false; } return true; }
/* Replicas share the breaker state through app_settings so a lane paused on one worker is paused on all. */
async function persistLanes() { try { await admin().from('app_settings').upsert({ key: 'lanes_tripped', value: Object.fromEntries(LANE.tripped) }); } catch (e) {} }
async function loadLanes() { try { const { data } = await admin().from('app_settings').select('value').eq('key', 'lanes_tripped').maybeSingle(); const v = (data && data.value) || {}; for (const [k, until] of Object.entries(v)) if (Number(until) > Date.now()) LANE.tripped.set(k, Number(until)); } catch (e) {} }
const _laneTimer = setInterval(loadLanes, 60000); if (_laneTimer.unref) _laneTimer.unref();
function laneNoteFailure(key) { const now = Date.now(); const arr = (LANE.fails.get(key) || []).filter(x => now - x < LANE_TRIP_WINDOW); arr.push(now); LANE.fails.set(key, arr); if (arr.length >= LANE_TRIP_FAILS && !LANE.tripped.has(key)) { LANE.tripped.set(key, now + LANE_COOL); persistLanes(); try { require('./oblog').log('LANE_TRIPPED', { lane: key, fails: arr.length }); } catch (e) {} try { (async () => { const { data: admins } = await admin().from('profiles').select('id').in('role', ['admin', 'super_admin']); for (const a of (admins || [])) await require('./notify').push(a.id, 'alert', 'Work lane paused: ' + (key === 'platform' ? 'platform jobs' : 'organisation ' + key.slice(0, 8)), arr.length + ' failures in 15 minutes; its jobs wait 30 minutes while every other organisation keeps running. See Self-heal.', 'adminx'); })().catch(() => {}); } catch (e) {} return true; } return false; }
function laneStatus() { return { tripped: [...LANE.tripped.entries()].map(([k, until]) => ({ lane: k, until: new Date(until).toISOString() })), running: Object.fromEntries(LANE.running), max_running: LANE_MAX_RUNNING }; }
function laneResume(key) { LANE.tripped.delete(key); LANE.fails.delete(key); persistLanes(); }
let _rr = 0;
async function claimOne() {
  const now = new Date().toISOString();
  /* Fast path when no lane is tripped and no lane is at its cap: the atomic SQL claim (FOR UPDATE SKIP LOCKED) keeps several worker
     instances from taking the same job. When a lane is tripped or busy, the lane-aware selection below runs instead. */
  if (!LANE.tripped.size && ![...LANE.running.values()].some(v => v >= LANE_MAX_RUNNING)) { try { const { data, error } = await admin().rpc('claim_job', { worker: WORKER }); if (!error) { const j = (data && data[0]) || null; if (j) { const k = laneKey(j); LANE.running.set(k, (LANE.running.get(k) || 0) + 1); } return j; } } catch (e) {} }
  // Fair, isolated claim: look at the oldest queued job of up to 24 lanes and pick round-robin among the lanes that are open.
  const { data: rows } = await admin().from('job_queue').select('id,kind,payload,attempts,max_attempts,org_id,user_id')
    .eq('status', 'queued').lte('run_after', now).order('id', { ascending: true }).limit(60);
  if (!rows || !rows.length) return null;
  const byLane = new Map(); for (const r of rows) { const k = laneKey(r); if (!byLane.has(k)) byLane.set(k, r); }
  const open = [...byLane.entries()].filter(([k]) => !laneTripped(k) && (LANE.running.get(k) || 0) < LANE_MAX_RUNNING);
  if (!open.length) { for (const [k, r] of byLane) if (laneTripped(k)) await admin().from('job_queue').update({ run_after: new Date(Date.now() + 5 * 60000).toISOString() }).eq('id', r.id).eq('status', 'queued'); return null; }
  const [, job] = open[(_rr++) % open.length];
  const { data: got } = await admin().from('job_queue')
    .update({ status: 'running', locked_at: now, locked_by: WORKER, attempts: job.attempts + 1, updated_at: now })
    .eq('id', job.id).eq('status', 'queued').select('id');
  if (got && got.length) { const k = laneKey(job); LANE.running.set(k, (LANE.running.get(k) || 0) + 1); return job; }
  return null;   // lost the race: another worker took it
}

async function runOne() {
  const job = await claimOne();
  const _lane = job ? laneKey(job) : null; const _release = () => { if (_lane) LANE.running.set(_lane, Math.max(0, (LANE.running.get(_lane) || 1) - 1)); };
  if (!job) return false;
  const fn = handlers[job.kind];
  try {
    if (!fn) throw new Error('no handler for ' + job.kind);
    const result = await fn(job.payload || {}, job);
    await admin().from('job_queue').update({ status: 'done', result: result == null ? null : result, updated_at: new Date().toISOString() }).eq('id', job.id);
  } catch (e) {
    try { laneNoteFailure(laneKey(job)); } catch (x) {}
    const dead = (job.attempts + 1) >= (job.max_attempts || 3);
    const backoffMin = Math.min(60, Math.pow(2, job.attempts + 1));
    await admin().from('job_queue').update({
      status: dead ? 'dead' : 'queued', last_error: String(e && e.message || e).slice(0, 500),
      run_after: new Date(Date.now() + backoffMin * 60000).toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString()
    }).eq('id', job.id);
    try { require('./oblog').errlog('queue:' + job.kind, e, { jobId: job.id, attempts: job.attempts + 1 }); } catch (x) {}
  } finally { _release(); }
  return true;
}

let timer = null, busy = false;
function start(intervalMs = 5000, concurrency = 2) {
  if (timer) return;
  timer = setInterval(async () => {
    if (busy) return; busy = true;
    try { for (let i = 0; i < concurrency; i++) { if (!(await runOne())) break; } }
    catch (e) {} finally { busy = false; }
  }, intervalMs);
  // Jobs stuck "running" for over 20 minutes (a crashed worker) go back to the queue.
  setInterval(async () => {
    try { await admin().from('job_queue').update({ status: 'queued', locked_at: null, locked_by: null })
      .eq('status', 'running').lt('locked_at', new Date(Date.now() - 20 * 60000).toISOString()); } catch (e) {}
  }, 5 * 60000);
}

async function status() {
  const out = {};
  for (const s of ['queued', 'running', 'done', 'failed', 'dead']) {
    try { const { count } = await admin().from('job_queue').select('id', { count: 'exact', head: true }).eq('status', s); out[s] = count || 0; } catch (e) { out[s] = null; }
  }
  return out;
}

module.exports = { laneStatus, laneResume, laneKey, register, enqueue, runOne, start, status, WORKER };
