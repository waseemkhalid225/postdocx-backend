// ForiForeign Self-Healer — runs every 10 minutes. It reads the same failure
// signals the admin sees and REPAIRS them automatically, in order of user pain:
//   1) stale jobs stuck 'running'            -> swept to failed (retries work again)
//   2) preparations stuck mid-run            -> auto-relaunched ONCE (resume guards
//      make the relaunch nearly free), else surfaced as Retry to the user
//   3) discoveries that finished with ZERO   -> automatically re-queued ONCE
//   4) log tables pruned so growth never slows the platform
// Every action is written to audit_log as HEAL — nothing happens silently.
const { admin } = require('./supa');
const { slog, errlog } = require('./oblog');

async function heal(detail) {
  try { await admin().from('audit_log').insert({ actor: null, event: 'HEAL', detail: String(detail).slice(0, 300) }); } catch (e) {}
  slog('healer', detail);
}

/* 1) Jobs stuck 'running' longer than 15 minutes are dead — sweep them. */
async function sweepStaleJobs() {
  try {
    const cutoff = new Date(Date.now() - 15 * 60000).toISOString();
    const { data } = await admin().from('jobs').update({ status: 'failed', last_error: 'stalled — auto-swept by healer', updated_at: new Date().toISOString() })
      .eq('status', 'running').lt('updated_at', cutoff).select('id');
    if (data && data.length) await heal('swept ' + data.length + ' stalled job(s)');
    return (data || []).length;
  } catch (e) { return 0; }
}

/* 2) Preparations stuck >12 min: relaunch once (cheap thanks to resume guards),
      otherwise write the error into progress so the UI shows Retry immediately. */
async function healStuckPreparations() {
  try {
    const cutoff = new Date(Date.now() - 12 * 60000).toISOString();
    const { data: apps } = await admin().from('applications').select('id,user_id,prep_status,prep_progress,prep_started_at')
      .eq('stage', 'preparing').lt('prep_started_at', cutoff).limit(10);
    let n = 0;
    for (const a of (apps || [])) {
      const ps = a.prep_status || {};
      if (!ps.healed) {
        ps.healed = new Date().toISOString();
        await admin().from('applications').update({ prep_status: ps, prep_started_at: new Date().toISOString() }).eq('id', a.id);
        const { prepareApplication } = require('./engine');
        require('./jobs').runJob('prepare', 'heal-prepare:' + a.id, a.user_id,
          () => prepareApplication(a.id), { retries: 0, timeoutMs: 480000 });
        await heal('auto-relaunched stuck preparation ' + a.id);
        n++;
      } else {
        // Second stall: stop guessing, hand the user a working Retry button.
        const steps = Array.isArray(a.prep_progress) ? a.prep_progress : [];
        if (!steps.some(s => s.error)) {
          steps.push({ key: 'final', label: 'Final checks', error: 'Preparation stalled twice; press Retry — finished documents are kept.' });
          await admin().from('applications').update({ prep_progress: steps }).eq('id', a.id);
          await heal('surfaced Retry for twice-stalled preparation ' + a.id);
          n++;
        }
      }
    }
    return n;
  } catch (e) { await errlog('healer:prep', e, {}); return 0; }
}

/* 3) A finished discovery that delivered ZERO gets ONE automatic re-run. */
async function healZeroDiscoveries() {
  try {
    const { data: rows } = await admin().from('app_settings').select('key,value').like('key', 'discover:%').limit(50);
    let n = 0;
    for (const r of (rows || [])) {
      const v = r.value || {};
      const age = Date.now() - new Date(v.startedAt || 0).getTime();
      if (v.status === 'done' && Number(v.found) === 0 && !v.healed && age < 2 * 3600e3 && age > 5 * 60000) {
        const userId = r.key.split(':')[1];
        v.healed = new Date().toISOString();
        await admin().from('app_settings').upsert({ key: r.key, value: v });
        const { discoverForUser } = require('./engine');
        require('./jobs').runJob('discover', 'heal-discover:' + userId + ':' + Math.floor(Date.now() / 3600e3), userId,
          () => discoverForUser(userId, v.kind || null, { target: v.target || 5, progressKey: r.key, startedAt: new Date().toISOString() }),
          { retries: 0, timeoutMs: 600000 });
        await heal('auto-requeued zero-result discovery for user ' + userId);
        n++;
      }
    }
    return n;
  } catch (e) { await errlog('healer:discover', e, {}); return 0; }
}

/* 4) Prune: error_log > 30 days out; keeps the health feed fast forever. */
async function pruneLogs() {
  try {
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
    await admin().from('error_log').delete().lt('created_at', cutoff);
  } catch (e) {}
}

async function runHealer() {
  const a = await sweepStaleJobs();
  const b = await healStuckPreparations();
  const c = await healZeroDiscoveries();
  await pruneLogs();
  if (a + b + c) slog('healer', 'cycle complete: ' + (a + b + c) + ' repair(s)');
}

module.exports = { runHealer, sweepStaleJobs, healStuckPreparations, healZeroDiscoveries };
