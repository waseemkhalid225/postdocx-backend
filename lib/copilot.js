// lib/copilot.js — the Admin Copilot: the built-in model with READ access to the platform's own state (queue, logs,
// tickets, payments, prospects, rules, usage, errors) and a small set of SAFE actions it may propose and, on your
// confirmation, execute: requeue a job, release a lock, pause or resume a source, verify a rule, refund a payment,
// approve a FAQ candidate, add guidance for the agents. It never runs arbitrary SQL, never edits code, never touches
// anyone's documents. Every question and every action is logged.
const { admin } = require('./supa'); const { callAI } = require('./router');
async function snapshot() {
  const since = new Date(Date.now() - 86400000).toISOString(); const g = async (fn) => { try { return await fn(); } catch (e) { return { error: String(e.message).slice(0, 120) }; } };
  const [queue, dead, tickets, payments, prospects, rulesToVerify, changed, errors, selfheal, usage, sources] = await Promise.all([
    g(async () => { const { data } = await admin().from('job_queue').select('status'); const c = {}; for (const r of (data || [])) c[r.status] = (c[r.status] || 0) + 1; return c; }),
    g(async () => (await admin().from('job_queue').select('id,type,last_error,attempts').in('status', ['dead', 'failed']).order('updated_at', { ascending: false }).limit(15)).data),
    g(async () => (await admin().from('support_tickets').select('id,subject,category,priority,status,auto_replied,created_at').in('status', ['open', 'new']).order('created_at', { ascending: false }).limit(20)).data),
    g(async () => (await admin().from('payments').select('id,credits,status,provider,addon_key,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(20)).data),
    g(async () => (await admin().from('prospects').select('name,stage,country_code,last_contact_at').order('updated_at', { ascending: false }).limit(15)).data),
    g(async () => { const { count } = await admin().from('visa_rules').select('id', { count: 'exact', head: true }).neq('status', 'verified').neq('status', 'superseded'); return count; }),
    g(async () => (await admin().from('policy_updates').select('country_code,severity,summary').eq('status', 'new').limit(10)).data),
    g(async () => (await admin().from('audit_log').select('event,detail,created_at').or('event.ilike.%ERR%,event.ilike.%FAIL%').gte('created_at', since).order('created_at', { ascending: false }).limit(20)).data),
    g(async () => (await admin().from('selfheal_log').select('kind,detail,action,outcome,created_at').order('created_at', { ascending: false }).limit(15)).data),
    g(async () => { const { data } = await admin().from('usage_meter').select('capability').gte('created_at', since); const c = {}; for (const r of (data || [])) c[r.capability] = (c[r.capability] || 0) + 1; return c; }),
    g(async () => (await admin().from('sources').select('kind,key,enabled,last_error,last_count').limit(30)).data)
  ]);
  return { at: new Date().toISOString(), queue, dead_or_failed: dead, open_tickets: tickets, payments_24h: payments, prospects, rules_to_verify: rulesToVerify, policy_changes_new: changed, errors_24h: errors, selfheal: selfheal, usage_24h: usage, sources };
}
const ACTIONS = {
  requeue_job: async (a) => { await admin().from('job_queue').update({ status: 'queued', attempts: 0, last_error: null, run_after: new Date().toISOString() }).eq('id', a.job_id); return 'job ' + a.job_id + ' requeued'; },
  release_locks: async () => { const cut = new Date(Date.now() - 20 * 60000).toISOString(); const { data } = await admin().from('job_queue').select('id').eq('status', 'running').lt('locked_at', cut); if (data && data.length) await admin().from('job_queue').update({ status: 'queued', locked_at: null, locked_by: null }).in('id', data.map(x => x.id)); return (data || []).length + ' locks released'; },
  pause_source: async (a) => { await admin().from('sources').update({ enabled: false }).eq('id', a.source_id); return 'source paused'; },
  resume_source: async (a) => { await admin().from('sources').update({ enabled: true, last_error: null }).eq('id', a.source_id); return 'source resumed'; },
  verify_rule: async (a, adminId) => { await require('./visa').verifyRule(adminId, a.rule_id, {}); return 'rule verified'; },
  dismiss_policy: async (a, adminId) => { await admin().from('policy_updates').update({ status: 'reviewed', reviewed_by: adminId, reviewed_at: new Date().toISOString() }).eq('id', a.policy_id); return 'policy update marked reviewed'; },
  approve_faq: async (a) => { const { data: c } = await admin().from('faq_candidates').select('*').eq('id', a.candidate_id).maybeSingle(); if (!c || !c.answer) return 'candidate has no answer'; await admin().from('faqs').insert({ question: c.question, answer: c.answer, audience: c.audience || 'all', source: 'copilot' }); await admin().from('faq_candidates').update({ status: 'approved' }).eq('id', c.id); return 'FAQ added'; },
  add_guidance: async (a, adminId) => { await admin().from('admin_guidance').insert({ text: String(a.text || '').slice(0, 1500), applies_to: Array.isArray(a.applies_to) ? a.applies_to : ['all'], created_by: adminId, expires_at: a.days ? new Date(Date.now() + Number(a.days) * 86400000).toISOString() : null }); return 'guidance added'; },
  answer_ticket: async (a, adminId) => { await admin().from('support_tickets').update({ reply: String(a.reply || '').slice(0, 4000), status: 'answered', handled_by: adminId }).eq('id', a.ticket_id); return 'ticket answered'; }
};
async function ask(adminId, question, confirmActions) {
  const snap = await snapshot(); const { data: guid } = await admin().from('admin_guidance').select('text,applies_to').eq('active', true).or('expires_at.is.null,expires_at.gte.' + new Date().toISOString()).limit(20);
  const prompt = `You are the ForiForeign Admin Copilot with read access to the platform state below. Answer the admin's question precisely from the data (name ids, counts, times). If an action from this list would resolve something, propose it as JSON in the "actions" array: ${Object.keys(ACTIONS).join(', ')} with the parameters (job_id, source_id, rule_id, policy_id, candidate_id, ticket_id+reply, text+applies_to+days). Never propose anything outside the list. Answer ONLY JSON: {"answer":"plain English, no long dashes, no stock phrases; say clearly when a code or schema change by a person is needed","actions":[{"type":"","params":{},"why":""}]}\nSTANDING GUIDANCE: ${JSON.stringify(guid || [])}\nSTATE: ${JSON.stringify(snap).slice(0, 14000)}\nQUESTION: ${String(question).slice(0, 2000)}`;
  let v = { answer: 'Could not reach the model.', actions: [] }; try { const txt = await callAI('high_value', prompt, { maxTokens: 1200, json: true }); const m = String(txt).match(/\{[\s\S]*\}/); if (m) v = Object.assign(v, JSON.parse(m[0])); } catch (e) {}
  v.answer = require('./partnerships').humanize(v.answer); const executed = [];
  if (confirmActions && Array.isArray(v.actions)) for (const a of v.actions.slice(0, 5)) { const fn = ACTIONS[a.type]; if (!fn) continue; try { executed.push({ type: a.type, result: await fn(a.params || {}, adminId) }); } catch (e) { executed.push({ type: a.type, result: 'failed: ' + e.message }); } }
  await admin().from('copilot_log').insert({ admin_id: adminId, question: String(question).slice(0, 2000), answer: v.answer, actions: confirmActions ? executed : (v.actions || []) }).then(() => {}, () => {});
  return { answer: v.answer, proposed_actions: v.actions || [], executed };
}
/* FAQ learning: repeated questions become candidates with the responder's best answer, for approval. */
async function learnFaqs() { const since = new Date(Date.now() - 7 * 86400000).toISOString(); const { data } = await admin().from('support_tickets').select('subject,message,reply,suggested_reply,category').gte('created_at', since).limit(200); const groups = {}; for (const t of (data || [])) { const k = String(t.subject || t.message || '').toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(w => w.length > 3).slice(0, 5).join(' '); if (!k) continue; (groups[k] = groups[k] || []).push(t); } let n = 0; for (const [k, ts] of Object.entries(groups)) { if (ts.length < 2) continue; const best = ts.find(t => t.reply) || ts.find(t => t.suggested_reply); const { data: ex } = await admin().from('faq_candidates').select('id,seen').ilike('question', ts[0].subject.slice(0, 80) + '%').maybeSingle(); if (ex) await admin().from('faq_candidates').update({ seen: ts.length }).eq('id', ex.id); else { await admin().from('faq_candidates').insert({ question: ts[0].subject.slice(0, 300), answer: best ? (best.reply || best.suggested_reply) : null, seen: ts.length, audience: ts[0].category === 'partnership' ? 'partner' : 'applicant' }); n++; } } return { candidates_added: n }; }
module.exports = { snapshot, ask, ACTIONS, learnFaqs };
