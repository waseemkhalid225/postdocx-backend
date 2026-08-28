// lib/jobs.js — persistent background jobs: idempotency, retry, timeout, progress survives restarts.
// A slow AI call can never freeze a user session: HTTP responds immediately, work runs here.
const { admin } = require('./supa');
const { errlog } = require('./oblog');

async function runJob(kind, idemKey, userId, fn, { retries = 1, timeoutMs = 240000 } = {}) {
  // Idempotency: same key while running/done => don't run twice.
  const { data: ex } = await admin().from('jobs').select('id,status').eq('idem_key', idemKey).maybeSingle();
  if (ex && ex.status !== 'failed') return { id: ex.id, dedup: true };
  const { data: job } = ex
    ? await admin().from('jobs').update({ status: 'running', attempts: 0, last_error: null, updated_at: new Date().toISOString() }).eq('id', ex.id).select().single()
    : await admin().from('jobs').insert({ kind, idem_key: idemKey, user_id: userId }).select().single();
  (async () => {
    for (let a = 0; a <= retries; a++) {
      try {
        await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('job timeout')), timeoutMs))]);
        await admin().from('jobs').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', job.id);
        return;
      } catch (e) {
        await admin().from('jobs').update({ attempts: a + 1, last_error: String(e.message).slice(0, 300), updated_at: new Date().toISOString() }).eq('id', job.id);
        await errlog('job:' + kind, e, { userId });
        // A timed-out fn() is STILL RUNNING in the background. Retrying now would run a
        // second copy in parallel — double AI cost and racing writes. Never retry timeouts.
        if (String(e.message) === 'job timeout') break;
        if (a < retries) await new Promise(r => setTimeout(r, 3000 * (a + 1)));
      }
    }
    await admin().from('jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', job.id);
  })();
  return { id: job.id, dedup: false };
}
module.exports = { runJob };
