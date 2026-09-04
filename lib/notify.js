// lib/notify.js — Day 16 · one notification hub: in-app always, email when the person opted in,
// WhatsApp as a tap-to-chat link (never automated messages from a personal number).
const { admin } = require('./supa');
async function push(userId, kind, title, body, link, orgId) {
  try {
    const { data } = await admin().from('notifications').insert({ user_id: userId, org_id: orgId || null, kind, title: String(title).slice(0, 200), body: body ? String(body).slice(0, 1000) : null, link: link || null }).select('id').single();
    // Day 24 · email copy when the person has it switched on (default on) and mail is configured.
    try { const M = require('./mailer'); if (M.enabled()) { const { data: p } = await admin().from('profiles').select('email,notify_email').eq('id', userId).maybeSingle(); if (p && p.email && p.notify_email !== false) { const r = await M.send(p.email, title, M.wrap(title, body, link, await M.brandFor(userId)), await M.brandFor(userId)); if (r.sent && data) await admin().from('notifications').update({ emailed_at: new Date().toISOString() }).eq('id', data.id); } } } catch (e) {}
    return data && data.id;
  } catch (e) { return null; }
}
async function list(userId, limit) { const { data } = await admin().from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(Math.min(100, limit || 30)); const rows = data || []; return { notifications: rows, unread: rows.filter(r => !r.read_at).length }; }
async function markRead(userId, ids) { let q = admin().from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null); if (Array.isArray(ids) && ids.length) q = q.in('id', ids); await q; return { ok: true }; }
/* Daily sweep (cron): what is due tomorrow or overdue becomes a notification, once per item per day. */
async function dailySweep() {
  const today = new Date().toISOString().slice(0, 10); const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10); let n = 0;
  const dedupe = async (userId, kind, key) => { const { data } = await admin().from('notifications').select('id').eq('user_id', userId).eq('kind', kind).eq('link', key).gte('created_at', today).limit(1); return !(data && data.length); };
  try { const { data: tasks } = await admin().from('client_tasks').select('id,client_id,title,due_date,assignee_user_id,org_id').eq('status', 'open').lte('due_date', soon);
    for (const t of (tasks || [])) { if (!t.assignee_user_id) continue; const key = 'task:' + t.id; if (await dedupe(t.assignee_user_id, 'task_due', key)) { await push(t.assignee_user_id, 'task_due', (t.due_date < today ? 'Overdue: ' : 'Due soon: ') + t.title, 'Due ' + t.due_date, key, t.org_id); n++; } } } catch (e) {}
  try { const { data: offers } = await admin().from('offers').select('id,user_id,issuer,title,decision_deadline,deposit_deadline,status').eq('status', 'received');
    for (const o of (offers || [])) { for (const [f, label] of [['decision_deadline', 'Decision deadline'], ['deposit_deadline', 'Deposit deadline']]) { if (o[f] && o[f] <= soon) { const key = 'offer:' + o.id + ':' + f; if (await dedupe(o.user_id, 'offer_deadline', key)) { await push(o.user_id, 'offer_deadline', label + ' ' + o[f] + ': ' + (o.issuer || o.title || 'offer'), null, key); n++; } } } } } catch (e) {}
  try { const { data: docs } = await admin().from('documents').select('id,user_id,doc_type,expiry_date').eq('generated', false).not('expiry_date', 'is', null).lte('expiry_date', new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10));
    for (const d of (docs || [])) { const key = 'doc:' + d.id; if (await dedupe(d.user_id, 'document_expiry', key)) { await push(d.user_id, 'document_expiry', (d.expiry_date < today ? 'Expired: ' : 'Expiring soon: ') + String(d.doc_type || 'document').replace(/_/g, ' '), 'Valid to ' + d.expiry_date + '. Upload a renewed copy to keep your checklists green.', key); n++; } } } catch (e) {}
  return { created: n };
}
module.exports = { push, list, markRead, dailySweep };
