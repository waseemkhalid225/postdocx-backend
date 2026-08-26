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
  cron.schedule('15 5 * * *', () => verifyAgent().catch(e => log('VERIFY_ERR', e.message)), { timezone: 'Asia/Karachi' });
  cron.schedule('0 7 * * *', () => followupAgent().catch(e => log('FOLLOWUP_ERR', e.message)), { timezone: 'Asia/Karachi' });
  cron.schedule('30 4 * * *', () => retentionAgent().catch(e => log('RETENTION_ERR', e.message)), { timezone: 'Asia/Karachi' });
  console.log('[agents] Send(2min) Ingest(6,18h) Verify(5:15) Retention(4:30) running');
}

module.exports = { startAgents, sendAgent, ingestAgent, verifyAgent, retentionAgent, followupAgent, textToPdf };
