// lib/webhooks.js — Day 11 · signed webhooks to an organisation's own systems.
// Every event is recorded first, then delivered by the queue with retries. Each delivery is
// signed (HMAC-SHA256 of the raw body with the hook's secret) so the receiver can verify it.
const crypto = require('crypto');
const { admin } = require('./supa');
const EVENTS = ['client.created', 'client.stage_changed', 'task.created', 'offer.recorded', 'applicant.status_changed', 'commission.accrued', 'visa.case_updated'];
function sign(secret, body) { return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex'); }
async function emit(orgId, event, payload) {
  if (!orgId) return 0;
  try {
    const { data: hooks } = await admin().from('org_webhooks').select('id,events').eq('org_id', orgId).eq('status', 'active');
    const targets = (hooks || []).filter(h => !h.events || h.events.includes('*') || h.events.includes(event));
    if (!targets.length) return 0;
    const rows = targets.map(h => ({ webhook_id: h.id, event, payload: Object.assign({ event, org_id: orgId, at: new Date().toISOString() }, payload || {}) }));
    const { data } = await admin().from('webhook_deliveries').insert(rows).select('id');
    const Q = require('./queue');
    for (const d of (data || [])) await Q.enqueue('webhook_deliver', { deliveryId: d.id }, { orgId, maxAttempts: 5 });
    return rows.length;
  } catch (e) { return 0; }
}
async function deliver(deliveryId) {
  const { data: d } = await admin().from('webhook_deliveries').select('*').eq('id', deliveryId).maybeSingle();
  if (!d || d.status === 'delivered') return { ok: true };
  const { data: h } = await admin().from('org_webhooks').select('url,secret,status').eq('id', d.webhook_id).maybeSingle();
  if (!h || h.status !== 'active') { await admin().from('webhook_deliveries').update({ status: 'failed', last_error: 'hook paused or missing' }).eq('id', d.id); return { ok: false }; }
  const body = JSON.stringify(d.payload);
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ff-event': d.event, 'x-ff-delivery': String(d.id), 'x-ff-signature': sign(h.secret, body) }, body, signal: ctl.signal });
    clearTimeout(tm);
    await admin().from('webhook_deliveries').update({ status: r.ok ? 'delivered' : 'pending', attempts: d.attempts + 1, response_code: r.status, delivered_at: r.ok ? new Date().toISOString() : null, last_error: r.ok ? null : ('HTTP ' + r.status) }).eq('id', d.id);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { ok: true };
  } catch (e) {
    clearTimeout(tm);
    await admin().from('webhook_deliveries').update({ attempts: d.attempts + 1, last_error: String(e.message).slice(0, 200) }).eq('id', d.id);
    throw e;   // the queue retries with backoff; after max attempts it is dead-lettered
  }
}
module.exports = { EVENTS, sign, emit, deliver };
