// lib/journey_engine.js — Gap 2 · ONE next action per person, computed from every module, with an owner and a date.
// Modules emit `recompute(userId)` after they change something; the result is stored on the profile and read by the
// dashboard, the consultant board and notifications. Stage is derived from facts, never typed by hand.
const { admin } = require('./supa');
const ORDER = ['lead', 'discover', 'qualify', 'match', 'decide', 'prepare', 'apply', 'offer', 'visa', 'travel', 'arrive', 'settle', 'pr'];
async function compute(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const [p, apps, offers, visas, docs, mob, jt, portals, appts] = await Promise.all([
    admin().from('profiles').select('id,full_name,arrival_date,mobility').eq('id', userId).maybeSingle().then(r => r.data),
    admin().from('applications').select('id,status,stage,next_action,next_action_owner,next_action_due,updated_at').eq('user_id', userId).then(r => r.data || []),
    admin().from('offers').select('id,status,issuer,decision_deadline,deposit_deadline,conditions').eq('user_id', userId).then(r => r.data || []),
    admin().from('visa_cases').select('id,country_code,status,updated_at').eq('user_id', userId).then(r => r.data || []),
    admin().from('documents').select('id,doc_type,doc_status,expiry_date').eq('user_id', userId).eq('generated', false).then(r => r.data || []),
    require('./mobility').get(userId).catch(() => ({ missing_for_match: [] })),
    admin().from('journey_tasks').select('phase,done,title,due_hint').eq('user_id', userId).then(r => r.data || []),
    admin().from('portal_connections').select('id,portal_name,status,applicant_confirmed,last_error').eq('user_id', userId).then(r => r.data || []),
    admin().from('appointments').select('title,starts_at').eq('user_id', userId).gte('starts_at', new Date().toISOString()).order('starts_at').limit(1).then(r => r.data || [])
  ]);
  const hasCV = docs.some(d => d.doc_type === 'cv'); const expired = docs.filter(d => d.expiry_date && d.expiry_date < today);
  const live = offers.filter(o => o.status === 'received'); const accepted = offers.filter(o => o.status === 'accepted');
  const activeVisa = visas.find(v => ['preparing', 'ready', 'submitted', 'decision_pending'].includes(v.status)); const granted = visas.some(v => v.status === 'granted');
  const arrived = !!(p && p.arrival_date && p.arrival_date <= today);
  const settleDone = jt.filter(t => t.phase === 'settlement').every(t => t.done) && jt.some(t => t.phase === 'settlement');
  let stage = 'discover', action = null;
  const A = (text, owner, due, link, why) => ({ text, owner, due: due || null, link: link || 'home', why: why || null });
  if (arrived) { stage = settleDone ? 'pr' : 'settle'; const open = jt.filter(t => (t.phase === 'arrival' || t.phase === 'settlement') && !t.done)[0]; action = open ? A(open.title, 'you', null, 'profile', 'From your after-visa plan') : A('Review your long-term residence pathway', 'you', null, 'profile'); }
  else if (granted) { stage = 'travel'; const open = jt.filter(t => t.phase === 'pre_departure' && !t.done)[0]; action = open ? A(open.title, 'you', null, 'profile', 'Before you fly') : A('Set your arrival date so your settlement plan starts', 'you', null, 'profile'); }
  else if (activeVisa) { stage = 'visa'; action = activeVisa.status === 'preparing' ? A('Complete the documents your ' + activeVisa.country_code + ' visa route asks for', 'you', null, 'profile') : activeVisa.status === 'ready' ? A('Submit your ' + activeVisa.country_code + ' visa application on the official portal', 'you', null, 'profile') : A('Waiting for the ' + activeVisa.country_code + ' visa decision; keep your portal watch on', 'them', null, 'profile'); }
  else if (accepted.length) { stage = 'visa'; action = A('Open the visa file for ' + (accepted[0].issuer || 'your offer'), 'you', null, 'profile', 'Offer accepted'); }
  else if (live.length) { stage = 'offer'; const o = live.slice().sort((a, b) => String(a.decision_deadline || '9999').localeCompare(String(b.decision_deadline || '9999')))[0]; const cond = (o.conditions || []).filter(c => !c.met); action = cond.length ? A('Meet the condition: ' + cond[0].text, 'you', cond[0].due || o.decision_deadline, 'profile', o.issuer) : A('Decide on the offer from ' + (o.issuer || 'the institution'), 'you', o.decision_deadline, 'profile'); }
  else if (apps.some(a => ['interview'].includes(a.status))) { stage = 'apply'; action = A('Prepare for your interview (your pack is in Offers & interviews)', 'you', null, 'profile'); }
  else if (apps.some(a => a.next_action && a.next_action_owner === 'you')) { stage = 'apply'; const a = apps.filter(x => x.next_action && x.next_action_owner === 'you').sort((x, y) => String(x.next_action_due || '9999').localeCompare(String(y.next_action_due || '9999')))[0]; action = A(a.next_action, 'you', a.next_action_due, 'apps', 'From a reply on your case'); }
  else if (apps.some(a => ['applied', 'submitted', 'submitted_email', 'sent'].includes(a.status) || ['submitted_email', 'submitted', 'sent', 'applied'].includes(a.stage))) { stage = 'apply'; action = A('Waiting for replies; they land in your Mail tab and are read for you', 'them', null, 'mail'); }
  else if (apps.some(a => ['prepared', 'ready', 'draft'].includes(a.status))) { stage = 'prepare'; action = A('Review and send your prepared application', 'you', null, 'apps'); }
  else if (apps.length) { stage = 'prepare'; action = A('Your case is being prepared', 'us', null, 'apps'); }
  else if (!hasCV) { stage = 'discover'; action = A('Upload your CV so the search can start', 'you', null, 'profile'); }
  else if ((mob.missing_for_match || []).length) { stage = 'qualify'; action = A('Complete your profile: ' + mob.missing_for_match.slice(0, 3).join(', '), 'you', null, 'profile'); }
  else { stage = 'match'; action = A('Run a search and choose positions to prepare', 'you', null, 'home'); }
  const flags = [];
  if (expired.length) flags.push('Expired: ' + expired.map(d => d.doc_type).join(', '));
  const pend = portals.filter(x => x.status === 'connected' && !x.applicant_confirmed); if (pend.length) flags.push('Confirm portal access: ' + pend.map(x => x.portal_name).join(', '));
  if (appts[0]) flags.push('Next appointment: ' + appts[0].title + ' ' + String(appts[0].starts_at).slice(0, 16).replace('T', ' '));
  const next = Object.assign(action, { stage, flags, computed_at: new Date().toISOString() });
  await admin().from('profiles').update({ next_action: next, journey_stage: stage }).eq('id', userId).then(() => {}, () => {});
  // Keep the consultant's client card in step, without ever moving it backwards past a manual later stage.
  try { const { data: cl } = await admin().from('clients').select('id,stage').eq('user_id', userId); for (const c of (cl || [])) if (ORDER.indexOf(stage) > ORDER.indexOf(c.stage)) await admin().from('clients').update({ stage, updated_at: new Date().toISOString() }).eq('id', c.id); } catch (e) {}
  return next;
}
async function recompute(userId) { try { const Q = require('./queue'); await Q.enqueue('journey_recompute', { userId }, { userId, maxAttempts: 1 }); } catch (e) {} }
module.exports = { compute, recompute, ORDER };
