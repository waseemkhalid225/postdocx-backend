// lib/agents.js — the background agent fleet (master spec: separate agents, invisible to users)
const cron = require('node-cron');
const PDFDocument = require('pdfkit');
const { admin } = require('./supa');
const { discoverForUser } = require('./engine');

const log = (agent, detail) => admin().from('audit_log').insert({ event: agent, detail: String(detail).slice(0, 250) }).then(() => {}, () => {});

function textToPdf(title, content) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 54 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Times-Bold').fontSize(14).text(title, { align: 'left' });
    doc.moveDown(0.6);
    doc.font('Times-Roman').fontSize(11).text(content, { lineGap: 2 });
    doc.end();
  });
}

/* ---------- ReadyAgent: mark authorized applications as ready for the Apply Assistant.
   ForiForeign never sends email itself and never presses Send. The user applies from
   their own email via the Apply Assistant. ---------- */
async function sendAgent() {
  const { data: msgs } = await admin().from('messages').select('id,application_id').eq('status', 'approved').eq('direction', 'outbound').limit(20);
  let n = 0;
  for (const m of (msgs || [])) {
    await admin().from('messages').update({ status: 'ready' }).eq('id', m.id);
    await admin().from('applications').update({ stage: 'prepared', next_action: 'Ready to apply. Open the case and press APPLY — it opens in your own email for you to review and send.', updated_at: new Date().toISOString() }).eq('id', m.application_id);
    await log('APPLY_READY', m.id);
    n++;
  }
  return n;
}

/* ---------- IngestAgent: profile-driven discovery for active users ---------- */
async function ingestAgent() {
  const { data: users } = await admin().from('profiles').select('id,headline,mode').neq('headline', '').limit(20);
  let total = 0;
  for (const u of (users || [])) {
    try { total += await discoverForUser(u.id, u.mode === 'work' ? 'work' : undefined); } catch (e) { await log('INGEST_FAIL', u.id + ': ' + e.message); }
  }
  await log('INGEST_AGENT', 'added ' + total);
  return total;
}

/* ---------- VerifyAgent: expire passed deadlines ---------- */
async function verifyAgent() {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin().from('opportunities').select('id,deadline').eq('status', 'verified');
  let expired = 0;
  for (const o of (data || [])) {
    if (o.deadline && o.deadline < today) { await admin().from('opportunities').update({ status: 'expired' }).eq('id', o.id); expired++; }
  }
  if (expired) await log('VERIFY_AGENT', 'expired ' + expired);
  return expired;
}

/* ---------- RetentionAgent: delete documents past retention (rule R5) ---------- */
async function retentionAgent() {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin().from('documents').select('*');
  let removed = 0;
  for (const d of (data || [])) {
    if (d.retention_until && d.retention_until < today) {
      try { await admin().storage.from(require('./docs').BUCKET).remove([d.storage_key]); } catch (e) {}
      await admin().from('documents').delete().eq('id', d.id);
      await admin().from('document_access_log').insert({ document_id: d.id, accessed_by: d.user_id, action: 'delete' });
      removed++;
    }
  }
  if (removed) await log('RETENTION_AGENT', 'deleted ' + removed + ' expired documents');
  return removed;
}

/* ---------- FollowUpAgent: polite nudge after 8 days, max 2 ---------- */
async function followupAgent() {
  const cutoff = new Date(Date.now() - 8 * 86400000).toISOString();
  const { data: msgs } = await admin().from('messages').select('*').eq('status', 'sent').eq('direction', 'outbound').limit(20);
  let queued = 0;
  for (const m of (msgs || [])) {
    if (!m.sent_at || m.sent_at > cutoff || (m.followup_count || 0) >= 2) continue;
    const { data: p } = await admin().from('profiles').select('full_name,send_mode').eq('id', m.user_id).single();
    const body = 'Dear Committee,\n\nI hope this finds you well. I am writing to follow up respectfully on my application sent on ' + m.sent_at.slice(0, 10) + '. I remain very interested and my documents stand ready for your review.\n\nKind regards,\n' + ((p || {}).full_name || '');
    await admin().from('messages').insert({ user_id: m.user_id, application_id: m.application_id, direction: 'outbound', to_emails: m.to_emails, subject: 'Re: ' + m.subject, body, status: (p && p.send_mode === 'autopilot') ? 'approved' : 'pending' });
    await admin().from('messages').update({ followup_count: (m.followup_count || 0) + 1 }).eq('id', m.id);
    queued++;
  }
  if (queued) await log('FOLLOWUP_AGENT', 'queued ' + queued);
  return queued;
}

/* ---------- scheduler ---------- */
function startAgents() {
  cron.schedule('*/2 * * * *', () => sendAgent().catch(e => log('SEND_AGENT_ERR', e.message)), { timezone: 'Asia/Karachi' });
  cron.schedule('0 6,18 * * *', () => ingestAgent().catch(e => log('INGEST_ERR', e.message)), { timezone: 'Asia/Karachi' });
  // Fix pass: rule-source change detection nightly, structured sources every 6 hours, retention purge weekly, alerts hourly.
  cron.schedule('50 2 * * *', () => require('./policywatch').sweepPR().then(r => log('PRWATCH', JSON.stringify(r))).catch(e => log('PRWATCH_ERR', e.message)), { timezone: 'Asia/Karachi' });
  cron.schedule('40 2 * * *', () => require('./policywatch').sweep(300).then(r => log('POLICYWATCH', JSON.stringify(r))).catch(e => log('POLICYWATCH_ERR', e.message)), { timezone: 'Asia/Karachi' });
  // Acquisition engine: every source every 6 hours, entity verification nightly, employer verification hourly.
  cron.schedule('45 */6 * * *', async () => { try { const { data } = await admin().from('sources').select('id').eq('enabled', true); const Q = require('./queue'); for (const s of (data || [])) await Q.enqueue('acq_run', { sourceId: s.id }, { maxAttempts: 1 }); log('ACQ_SWEEP', String((data || []).length)); } catch (e) { log('ACQ_ERR', e.message); } }, { timezone: 'Asia/Karachi' });
  cron.schedule('10 4 * * *', () => require('./queue').enqueue('acq_verify_institutions', { limit: 300 }, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('25 * * * *', () => require('./queue').enqueue('acq_verify_employers', { limit: 300 }, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('15 */6 * * *', () => require('./sources').sweep().then(r => log('SOURCES', JSON.stringify(r))).catch(e => log('SOURCES_ERR', e.message)), { timezone: 'Asia/Karachi' });
  // Browser Agent: re-queue every connected portal whose watch interval has elapsed (always-on status watch).
  cron.schedule('*/30 * * * *', () => require('./browserbot').sweep().then(r => { if (r.queued) log('PORTAL_SWEEP', JSON.stringify(r)); }).catch(e => log('PORTAL_ERR', e.message)), { timezone: 'Asia/Karachi' });
  // Prospecting autopilot 09:30 (when enabled in Settings), FAQ learning weekly.
  cron.schedule('30 9 * * *', async () => { try { const { data: a } = await admin().from('profiles').select('id').in('role', ['super_admin', 'admin']).limit(1); await require('./queue').enqueue('prospect_autopilot', { adminId: a && a[0] && a[0].id }, { maxAttempts: 1 }); } catch (e) { log('AUTOPILOT_ERR', e.message); } }, { timezone: 'Asia/Karachi' });
  cron.schedule('0 7 * * 1', () => require('./queue').enqueue('faq_learn', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  // Freshness: opportunities not checked for 14 days are re-fetched nightly (closed pages close, changed pages re-verify).
  cron.schedule('20 3 * * *', async () => { try { const cut = new Date(Date.now() - 14 * 86400000).toISOString(); const { data } = await admin().from('opportunities').select('id,url,title').eq('status', 'verified').or('verified_at.is.null,verified_at.lt.' + cut).limit(150); let closed = 0, ok = 0; for (const o of (data || [])) { try { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000); const r = await fetch(o.url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'ForiForeign freshness' } }); clearTimeout(tm); const t = r.ok ? (await r.text()).slice(0, 200000) : ''; const gone = !r.ok || r.status === 404 || /no longer (available|accepting)|position (has been )?filled|this (job|vacancy|posting) (is )?(closed|expired)|applications (are )?closed/i.test(t); if (gone) { await admin().from('opportunities').update({ status: 'closed', closed: true, updated_at: new Date().toISOString() }).eq('id', o.id); closed++; } else { await admin().from('opportunities').update({ verified_at: new Date().toISOString() }).eq('id', o.id); ok++; } } catch (e) {} } log('FRESHNESS', 'rechecked ' + ok + ', closed ' + closed); } catch (e) { log('FRESHNESS_ERR', e.message); } }, { timezone: 'Asia/Karachi' });
  // Audit chain sealed and verified nightly; country briefs rebuilt on the 1st of each month.
  cron.schedule('5 1 * * *', () => require('./queue').enqueue('audit_seal', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('0 2 1 * *', async () => { try { const Q = require('./queue'); for (const cc of Object.keys(require('./visa_portals').PORTALS)) for (const lane of ['study', 'work']) await Q.enqueue('country_brief', { cc, lane }, { maxAttempts: 1 }); } catch (e) { log('BRIEFS_ERR', e.message); } }, { timezone: 'Asia/Karachi' });
  // Visa check-ins: the "any news?" prompts at 09:00 local platform time.
  cron.schedule('0 9 * * *', () => require('./queue').enqueue('checkin_sweep', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  // PARTNER SYSTEM autopilot: pipeline per country daily (rotating through the 54, within the outreach cap), receivables weekly, liaison monthly.
  cron.schedule('30 6 * * *', async () => { try { const S = require('./settings'); const cfg = await S.getConfig(); const pp = cfg.partners || {}; if (!pp.auto) return; const ccs = Object.keys(require('./visa_portals').PORTALS); const day = Math.floor(Date.now() / 86400000); const cc = ccs[day % ccs.length]; await require('./queue').enqueue('partner_pipeline', { cc, cap: Number(pp.daily_cap) || 5 }, { maxAttempts: 1 }); } catch (e) { log('PARTNER_PIPELINE_ERR', e.message); } }, { timezone: 'Asia/Karachi' });
  cron.schedule('0 10 * * 1', () => require('./queue').enqueue('partner_receivables', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('15 9 * * *', () => require('./queue').enqueue('subscription_sweep', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('45 9 * * *', () => require('./queue').enqueue('lead_followups', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('30 6 * * 1', () => require('./queue').enqueue('pathway_sweep_members', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });   // members: weekly reassessment
  cron.schedule('0 7 1 * *', () => require('./queue').enqueue('pathway_sweep_free', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });      // everyone else: monthly pulse
  cron.schedule('*/10 * * * *', () => require('./queue').enqueue('outbox_flush', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });   // DISC-006: retry queued mail
  cron.schedule('30 4 * * *', () => require('./queue').enqueue('payments_abandon_sweep', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('10 3 * * *', () => require('./queue').enqueue('verify_pending', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('20 3 * * *', () => require('./queue').enqueue('success_calibrate', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('0 11 * * *', () => require('./queue').enqueue('visa_status_sweep', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });   // acts only on files whose check date has come, once each
  cron.schedule('15 10 * * 1', () => require('./queue').enqueue('partner_overdue', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('30 10 * * 1', () => require('./queue').enqueue('partner_renewals', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('0 9 2 * *', () => require('./queue').enqueue('partner_liaison', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  // Daily brief 08:30, self-heal hourly, prospect follow-ups daily 10:00.
  cron.schedule('30 8 * * *', () => require('./queue').enqueue('daily_brief', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('50 * * * *', () => require('./queue').enqueue('selfheal', {}, { maxAttempts: 1 }), { timezone: 'Asia/Karachi' });
  cron.schedule('0 10 * * *', () => require('./prospecting').followups().then(r => log('PROSPECT_FOLLOWUPS', JSON.stringify(r))).catch(e => log('PROSPECT_ERR', e.message)), { timezone: 'Asia/Karachi' });
  // Day 16 · notification sweep: due tasks, offer deadlines, expiring documents.
  cron.schedule('0 8 * * *', () => require('./notify').dailySweep().then(r => log('NOTIFY_SWEEP', JSON.stringify(r))).catch(e => log('NOTIFY_ERR', e.message)), { timezone: 'Asia/Karachi' });
  // Day 6 · outcome learning: rebuild the destination/field outcome table nightly.
  cron.schedule('20 3 * * *', () => require('./learning').rebuild().then(r => log('LEARNING_REBUILT', JSON.stringify(r))).catch(e => log('LEARNING_ERR', e.message)), { timezone: 'Asia/Karachi' });
  cron.schedule('45 4 * * *', () => expireAgent().catch(e => log('EXPIRE_ERR', e.message)), { timezone: 'Asia/Karachi' });
  cron.schedule('15 5 * * *', () => verifyAgent().catch(e => log('VERIFY_ERR', e.message)), { timezone: 'Asia/Karachi' });
  cron.schedule('0 7 * * *', () => followupAgent().catch(e => log('FOLLOWUP_ERR', e.message)), { timezone: 'Asia/Karachi' });
  cron.schedule('30 4 * * *', () => retentionAgent().catch(e => log('RETENTION_ERR', e.message)), { timezone: 'Asia/Karachi' });
  console.log('[agents] Send(2min) Ingest(6,18h) Verify(5:15) Retention(4:30) running');
}

async function expireAgent() {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin().from('opportunities').update({ status: 'expired' }).lt('deadline', today).eq('status', 'verified').select('id');
  const n = (data || []).length; if (n) await log('EXPIRED', n + ' past-deadline opportunities'); return n;
}
module.exports = { expireAgent, startAgents, sendAgent, ingestAgent, verifyAgent, retentionAgent, followupAgent, textToPdf };
