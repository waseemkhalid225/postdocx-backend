// lib/casebrain.js — the Case Brain.
// Legal shape: the applicant applies from their own email or the official portal and presses Send
// themselves. ForiForeign never impersonates them and never holds their inbox. What ForiForeign does
// hold is the CASE: every reply the applicant forwards (or pastes) is read, understood and turned into
// the next action, a drafted reply the applicant sends from their own account, a task for the
// consultant, an offer record, a document request, a visa file. That is how the platform stays useful,
// and chargeable, from Send to settled.
const crypto = require('crypto');
const { admin } = require('./supa');
const { callAI } = require('./router');
const DOMAIN = () => process.env.INTAKE_DOMAIN || 'in.foriforeign.com';
async function alias(applicationId, userId) {
  const { data: a } = await admin().from('applications').select('id,intake_alias').eq('id', applicationId).eq('user_id', userId).maybeSingle();
  if (!a) throw new Error('Case not found');
  if (a.intake_alias) return a.intake_alias;
  const al = 'case-' + crypto.randomBytes(5).toString('hex') + '@' + DOMAIN();
  const { error } = await admin().from('applications').update({ intake_alias: al }).eq('id', a.id); if (error) throw new Error(error.message);
  return al;
}
/* THE APPLICATION MAILBOX. One address per person on our own domain (apply.foriforeign.com),
   created by the agent at onboarding with the person's consent. It is the address used on every
   application, so every reply lands with us automatically; the person reads and sends from the
   portal, gets a copy in their personal inbox, and can pause, export or close it at any time.
   No third-party accounts are created in anyone's name; no personal password is ever held. */
const APPLY_DOMAIN = () => process.env.APPLY_DOMAIN || 'forimail.com';
async function provisionApplyEmail(userId) {
  const { data: p } = await admin().from('profiles').select('id,full_name,apply_email,email').eq('id', userId).maybeSingle(); if (!p) throw new Error('Profile not found');
  if (p.apply_email) return { email: p.apply_email, existing: true };
  const parts = String(p.full_name || (p.email || '').split('@')[0] || 'applicant').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || 'applicant', last = parts.length > 1 ? parts[parts.length - 1] : '', mid = parts.length > 2 ? parts[1][0] : '';
  let by = ''; try { const { data: m } = await admin().from('profiles').select('mobility,date_of_birth').eq('id', userId).maybeSingle(); const d = (m && (m.date_of_birth || (m.mobility && m.mobility.date_of_birth))) || ''; by = String(d).slice(0, 4); } catch (e) {}
  const cands = [[first, last].filter(Boolean).join('.'), mid ? [first, mid, last].filter(Boolean).join('.') : null, by && /^\d{4}$/.test(by) ? [first, last, by].filter(Boolean).join('.') : null].filter(Boolean);
  for (let i = 0; i < 24; i++) {
    const cand = (cands[i] || (cands[0] + String(10 + Math.floor(Math.random() * 90)))) + '@' + APPLY_DOMAIN();
    const { error } = await admin().from('profiles').update({ apply_email: cand, apply_email_consent_at: new Date().toISOString() }).eq('id', userId);
    if (!error) return { email: cand, existing: false };
    if (!/unique|duplicate/i.test(error.message)) throw new Error(error.message);
  }
  throw new Error('Could not allocate an address');
}
async function byApplyEmail(to) {
  const m = String(to || '').toLowerCase().match(/[a-z0-9._-]+@[a-z0-9.-]+/g) || []; const mine = m.find(x => x.endsWith('@' + APPLY_DOMAIN())); if (!mine) return null;
  const { data } = await admin().from('profiles').select('id,apply_email,apply_email_paused,apply_email_forward,email').eq('apply_email', mine).maybeSingle(); return data;
}
/* Route an inbound mail addressed to the person's apply address to the right case. */
async function routeForUser(user, from, subject) {
  const dom = String(from || '').toLowerCase().split('@')[1] || '';
  const { data: apps } = await admin().from('applications').select('id,opportunity_id,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(40);
  if (!apps || !apps.length) return { application_id: null, assigned_by: 'unassigned' };
  const ids = apps.map(a => a.opportunity_id).filter(Boolean);
  const { data: opps } = ids.length ? await admin().from('opportunities').select('id,institution,url,contact_emails').in('id', ids) : { data: [] };
  const subj = String(subject || '').toLowerCase();
  for (const o of (opps || [])) {
    const host = (() => { try { return new URL(o.url || '').hostname.replace(/^www\./, ''); } catch (e) { return ''; } })();
    const emails = (o.contact_emails || []).map(e => String(e).toLowerCase());
    const instTok = String(o.institution || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 4);
    if ((host && dom && (dom.endsWith(host) || host.endsWith(dom))) || emails.some(e => e.split('@')[1] === dom) || (instTok.length && instTok.some(t => subj.includes(t) || dom.includes(t)))) { const a = apps.find(x => x.opportunity_id === o.id); if (a) return { application_id: a.id, assigned_by: 'sender_match' }; }
  }
  return { application_id: apps[0].id, assigned_by: 'latest_case' };
}
async function byAlias(to) {
  const m = String(to || '').toLowerCase().match(/case-[0-9a-f]{10}@[a-z0-9.-]+/); if (!m) return null;
  const { data } = await admin().from('applications').select('id,user_id,opportunity_id,stage,status').eq('intake_alias', m[0]).maybeSingle(); return data;
}
async function ingest({ applicationId, userId, channel, from, subject, body, receivedAt, assignedBy, paused }) {
  const { data: msg, error } = await admin().from('case_messages').insert({ application_id: applicationId || null, user_id: userId, direction: 'in', channel: channel || 'email', from_addr: String(from || '').slice(0, 200), subject: String(subject || '').slice(0, 300), body: String(body || '').slice(0, 20000), received_at: receivedAt || new Date().toISOString(), assigned_by: assignedBy || (applicationId ? 'alias' : 'unassigned') }).select('id').single();
  if (error) throw new Error(error.message);
  if (applicationId) await admin().from('applications').update({ last_inbound_at: new Date().toISOString() }).eq('id', applicationId);
  const Q = require('./queue');
  if (!paused) await Q.enqueue('mail_triage', { messageId: msg.id, userId, applicationId: applicationId || null }, { userId, maxAttempts: 2 });
  return msg.id;
}
/* TRIAGE runs on every message. Fast, cheap, no AI for the obvious cases: verification codes are
   surfaced instantly, newsletters and spam are shelved, application mail goes to the Case Brain,
   general institution mail is linked to a case when the sender or subject makes that clear. */
const OTP_RE = /\b(?:code|otp|verification|passcode|pin)\b[^0-9]{0,40}(\d{4,8})\b|\b(\d{6})\b(?=[^0-9]{0,40}\b(?:code|otp|verify|verification)\b)/i;
async function triage(messageId) {
  const { data: m } = await admin().from('case_messages').select('*').eq('id', messageId).maybeSingle(); if (!m) return null;
  const text = ((m.subject || '') + '\n' + (m.body || '')).slice(0, 6000); const lower = text.toLowerCase(); const from = String(m.from_addr || '').toLowerCase();
  const N = require('./notify'); let t = 'other', otp = null;
  const otpM = text.match(OTP_RE); if (otpM && /verif|code|otp|passcode|confirm/.test(lower)) { t = 'verification_code'; otp = otpM[1] || otpM[2]; }
  else if (/unsubscribe|newsletter|no-reply@.*(news|promo|marketing)|view in browser/.test(lower) && !/interview|offer|application|admission|decision|shortlist/.test(lower)) t = 'newsletter';
  else if (/lottery|bitcoin|casino|loan approved|urgent transfer|prince/.test(lower)) t = 'spam';
  else if (/application|admission|interview|offer|shortlist|decision|position|vacancy|scholarship|visa|cas\b|i-20|enrol|deposit|document/.test(lower) || m.application_id) t = 'application';
  else if (/(\.edu|\.ac\.|university|college|institute|hospital|recruit|hr@|careers@|jobs@)/.test(from)) t = 'institution_general';
  // Visa decisions arriving by mail (grant / refusal / request for more documents) update the visa desk file.
  if (/\bvisa\b|residence permit|entry clearance|study permit|work permit/.test(lower) && /(granted|approved|issued|refused|rejected|decision|further documents|additional documents)/.test(lower)) {
    try { const { data: vc } = await admin().from('visa_cases').select('id,country_code,status').eq('user_id', m.user_id).in('status', ['ready', 'submitted', 'decision_pending', 'preparing']).order('updated_at', { ascending: false }).limit(1); const v = vc && vc[0];
      if (v) { const granted = /(granted|approved|issued)/.test(lower) && !/not (granted|approved)|refus|reject/.test(lower); const refused = /(refused|rejected)/.test(lower); const patch2 = { updated_at: new Date().toISOString(), decision_text: String(m.body || '').slice(0, 4000), decision_source: 'email' }; if (granted) { patch2.status = 'granted'; patch2.decision_on = new Date().toISOString().slice(0, 10); } else if (refused) { patch2.status = 'refused'; patch2.decision_on = new Date().toISOString().slice(0, 10); } else patch2.status = 'decision_pending';
        await admin().from('visa_cases').update(patch2).eq('id', v.id); t = 'application'; await N.push(m.user_id, 'visa', granted ? 'Visa granted: ' + v.country_code : refused ? 'Visa decision: refused (' + v.country_code + ')' : 'Visa update for ' + v.country_code, String(m.subject || '').slice(0, 120), 'profile'); if (refused) { const Q2 = require('./queue'); await Q2.enqueue('visa_refusal', { caseId: v.id, userId: m.user_id, cc: v.country_code, route: '', text: String(m.body || '').slice(0, 6000), extra: '' }, { userId: m.user_id, maxAttempts: 2 }).catch(() => {}); } } } catch (e) {}
  }
  const patch = { triage: t, otp_code: otp };
  // Late linking: an unassigned application mail may still match one of the user's cases.
  if (t === 'application' && !m.application_id) { try { const r = await routeForUser({ id: m.user_id }, m.from_addr, m.subject); if (r.application_id && r.assigned_by !== 'latest_case') patch.application_id = r.application_id, patch.assigned_by = r.assigned_by; } catch (e) {} }
  await admin().from('case_messages').update(patch).eq('id', m.id);
  const Q = require('./queue');
  if (t === 'verification_code') await N.push(m.user_id, 'code', 'Your code: ' + otp, 'From ' + (m.from_addr || 'a portal') + ' — ' + String(m.subject || '').slice(0, 80), 'mail');
  else if (t === 'application' && (patch.application_id || m.application_id)) await Q.enqueue('case_understand', { messageId: m.id, applicationId: patch.application_id || m.application_id, userId: m.user_id }, { userId: m.user_id, maxAttempts: 2 });
  else if (t === 'application' || t === 'institution_general') await N.push(m.user_id, 'mail', String(m.subject || 'New mail').slice(0, 120), 'From ' + (m.from_addr || '') + '. Open your inbox to link it to a case and get the next step.', 'mail');
  return { triage: t };
}
async function message(userId, id) {
  const { data: m } = await admin().from('case_messages').select('*').eq('id', id).eq('user_id', userId).maybeSingle(); if (!m) throw new Error('Message not found');
  if (!m.read_at) await admin().from('case_messages').update({ read_at: new Date().toISOString() }).eq('id', id);
  return m;
}
async function linkToCase(userId, id, applicationId) {
  const { data: a } = await admin().from('applications').select('id').eq('id', applicationId).eq('user_id', userId).maybeSingle(); if (!a) throw new Error('Case not found');
  await admin().from('case_messages').update({ application_id: applicationId, assigned_by: 'user', triage: 'application' }).eq('id', id).eq('user_id', userId);
  const Q = require('./queue'); await Q.enqueue('case_understand', { messageId: id, applicationId, userId }, { userId, maxAttempts: 2 }); return { ok: true };
}
/* Send from the person's ForiForeign address, only when they tap Send in the portal. */
async function sendFromApplyEmail(userId, { applicationId, to, subject, body, attachDocIds }) {
  const M = require('./mailer'); if (!M.enabled()) throw new Error('Sending is not configured yet (mail provider key). Copy the reply and send it from your own email for now.');
  const { data: p } = await admin().from('profiles').select('full_name,apply_email,email').eq('id', userId).maybeSingle(); if (!p || !p.apply_email) throw new Error('Create your ForiForeign mailbox first');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || ''))) throw new Error('Recipient address required');
  const attachments = [];
  if (Array.isArray(attachDocIds) && attachDocIds.length) {
    const { BUCKET } = require('./docs'); const { data: docs } = await admin().from('documents').select('id,name,storage_key,mime,size_bytes').eq('user_id', userId).in('id', attachDocIds.slice(0, 6));
    for (const d of (docs || [])) { if ((d.size_bytes || 0) > 8 * 1024 * 1024) continue; const { data: f } = await admin().storage.from(BUCKET).download(d.storage_key); if (f) attachments.push({ filename: d.name, content: Buffer.from(await f.arrayBuffer()).toString('base64') }); }
  }
  /* CHANNEL IDENTITY: every application says, in one quiet line, who prepared it. A direct applicant: "prepared on ForiForeign".
     A consultancy's client: "prepared with <Consultancy> on ForiForeign". Universities and employers can always tell which
     channel a file came from, and the MOU commission is credited to that channel. The line is also carried in a header. */
  let channel = { kind: 'direct', name: 'ForiForeign' }; try { const { data: cl } = await admin().from('clients').select('org_id').eq('user_id', userId).eq('status', 'active').limit(1); if (cl && cl[0]) { const { data: og } = await admin().from('organisations').select('name,kind').eq('id', cl[0].org_id).maybeSingle(); if (og && og.kind === 'agency') channel = { kind: 'agency', name: og.name, org_id: cl[0].org_id }; } } catch (e) {}
  /* Agency channel: the consultancy's name only; the platform is invisible to the institution. Direct channel: the platform's name. */
  const signOff = channel.kind === 'agency' ? '\n\n' + (p.full_name || '') + '\nSubmitted with the support of ' + channel.name + '. Replies to this address reach me directly.' : '\n\n' + (p.full_name || '') + '\nApplication prepared on ForiForeign (foriforeign.com). Replies to this address reach me directly.';
  const bodyOut = String(body || '') + signOff;
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;white-space:pre-wrap">' + bodyOut.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</div>';
  const r = await M.sendRaw({ from: (p.full_name ? p.full_name + ' <' + p.apply_email + '>' : p.apply_email), to, subject, html, text: bodyOut, replyTo: p.apply_email, cc: undefined, attachments, headers: { 'X-Case-Channel': channel.kind === 'agency' ? 'c:' + String(channel.org_id).slice(0, 8) : 'd' } });
  try { if (applicationId) await admin().from('applications').update({ channel_kind: channel.kind, channel_org_id: channel.org_id || null }).eq('id', applicationId); } catch (e) {}
  try { if (applicationId) require('./queue').enqueue('partner_referral_record', { applicationId }, { userId, maxAttempts: 2 }).catch(() => {}); } catch (e) {}
  if (!r.sent) throw new Error('Could not send: ' + (r.reason || 'mail error'));
  await admin().from('case_messages').insert({ application_id: applicationId || null, user_id: userId, direction: 'out', channel: 'email', from_addr: p.apply_email, to_addr: String(to).slice(0, 200), subject: String(subject || '').slice(0, 300), body: String(body || '').slice(0, 20000), assigned_by: 'sent', read_at: new Date().toISOString(), triage: 'application' }).then(() => {}, () => {});
  if (applicationId) await admin().from('applications').update({ next_action: 'Wait for their reply', next_action_owner: 'them', next_action_due: null }).eq('id', applicationId).eq('user_id', userId).then(() => {}, () => {});
  return { sent: true, id: r.id };
}
async function mailbox(userId) {
  const { data: p } = await admin().from('profiles').select('apply_email,apply_email_forward,apply_email_paused,apply_email_consent_at,email').eq('id', userId).maybeSingle();
  const { data: msgs } = await admin().from('case_messages').select('id,application_id,direction,from_addr,to_addr,subject,classification,triage,otp_code,received_at,assigned_by,read_at').eq('user_id', userId).order('received_at', { ascending: false }).limit(200);
  const rows = msgs || [];
  return { apply_email: p && p.apply_email, forward: !!(p && p.apply_email_forward === true), paused: !!(p && p.apply_email_paused), consent_at: p && p.apply_email_consent_at, personal_email: p && p.email, domain: APPLY_DOMAIN(), messages: rows, unread: rows.filter(r => r.direction === 'in' && !r.read_at).length, sending: require('./mailer').enabled() };
}
/* Understand one message in the context of the case, decide the next action, draft the reply. */
async function understand(messageId) {
  const { data: m } = await admin().from('case_messages').select('*').eq('id', messageId).maybeSingle(); if (!m) return null;
  const { data: a } = await admin().from('applications').select('id,user_id,opportunity_id,stage,status,brain').eq('id', m.application_id).maybeSingle();
  let opp = null, prof = null;
  try { if (a && a.opportunity_id) { const { data } = await admin().from('opportunities').select('title,institution,country_code,kind,deadline,url,contact_emails').eq('id', a.opportunity_id).maybeSingle(); opp = data; } } catch (e) {}
  try { const { data } = await admin().from('profiles').select('full_name,headline,field').eq('id', m.user_id).maybeSingle(); prof = data; } catch (e) {}
  const { data: hist } = await admin().from('case_messages').select('direction,subject,classification,received_at').eq('application_id', m.application_id).order('received_at', { ascending: false }).limit(8);
  const prompt = `You are the case brain of an international study/work application platform. The applicant applied themselves and forwarded this reply. Read it and answer ONLY with JSON:
{"classification":"interview_invite|offer|conditional_offer|rejection|documents_requested|info_request|acknowledgement|scheduling|other",
 "confidence": 0.0-1.0,
 "summary":"one plain sentence for the applicant",
 "extracted":{"dates":[{"what":"","date":"YYYY-MM-DD or null","time":""}],"documents_requested":[""],"questions_asked":[""],"deadline":"YYYY-MM-DD or null","links":[""],"conditions":[""]},
 "next_action":{"text":"the ONE thing to do now, imperative, specific","owner":"you|us|them","due":"YYYY-MM-DD or null"},
 "risks":["short flags: e.g. deadline in 2 days, missing document, ambiguous request"],
 "suggested_reply":"a complete, polite reply in the applicant's voice, ready to paste and send from their own email; leave [brackets] only where a fact is unknown",
 "stage":"applied|responded|interview|offer|rejected|documents"}
CASE: ${JSON.stringify({ position: opp && opp.title, institution: opp && opp.institution, country: opp && opp.country_code, kind: opp && opp.kind, deadline: opp && opp.deadline, applicant: prof && prof.full_name, field: prof && prof.field, stage: a && a.stage, history: hist })}
MESSAGE FROM: ${m.from_addr || ''}
SUBJECT: ${m.subject || ''}
BODY: ${String(m.body || '').slice(0, 8000)}
Rules: never invent a date; if the message asks for documents, list them exactly; if it is an interview, the next action is to confirm and prepare; if rejection, next action is to record it and look at the next-best option; the reply must be sendable as-is.`;
  let v = {};
  try { const txt = await callAI('high_value', prompt, { maxTokens: 1800, json: true, userId: m.user_id }); const mm = String(txt).match(/\{[\s\S]*\}/); v = mm ? JSON.parse(mm[0]) : {}; } catch (e) { v = { classification: 'other', summary: 'Reply received; could not be read automatically.', next_action: { text: 'Read the reply and update the case', owner: 'you', due: null } }; }
  const confirmedAlready = m.confidence === 1 && !m.needs_confirmation && m.classification;
  const cls = confirmedAlready ? m.classification : (v.classification || 'other'); const conf = confirmedAlready ? 1 : Math.max(0, Math.min(1, Number(v.confidence) || 0));
  // Gap 5 · below 0.8 the brain proposes and the person confirms: no stage change, no offer record, no interview pack.
  const sure = conf >= 0.8;
  await admin().from('case_messages').update({ classification: cls, confidence: conf, needs_confirmation: !sure, extracted: v.extracted || {}, suggested_reply: v.suggested_reply || null }).eq('id', m.id);
  try { if (m.application_id && sure) { const st = /offer|admission|acceptance/.test(cls) ? 'offer' : /reject|refus|unsuccessful/.test(cls) ? 'rejected' : /interview/.test(cls) ? 'reply' : null; if (st) require('./partners_engine').updateReferralStage(m.application_id, st).catch(() => {}); } } catch (e) {}
  if (!sure) { try { await require('./notify').push(m.user_id, 'confirm', 'Please confirm: is this a ' + cls.replace(/_/g, ' ') + '?', (v.summary || '') + ' Open the message in Mail and confirm so your case moves.', 'mail'); } catch (e) {} await admin().from('applications').update({ next_action: 'Confirm what the reply from ' + (opp && opp.institution || 'the institution') + ' means (Mail tab)', next_action_owner: 'you', next_action_due: null }).eq('id', m.application_id).then(() => {}, () => {}); return { classification: cls, confidence: conf, needs_confirmation: true }; }
  const na = v.next_action || {}; const patch = { next_action: String(na.text || '').slice(0, 300) || null, next_action_owner: ['you', 'us', 'them'].includes(na.owner) ? na.owner : 'you', next_action_due: /^\d{4}-\d{2}-\d{2}$/.test(String(na.due || '')) ? na.due : null, brain: Object.assign({}, (a && a.brain) || {}, { summary: v.summary, risks: v.risks || [], last: cls, at: new Date().toISOString() }) };
  const stageMap = { interview_invite: 'interview', scheduling: 'interview', offer: 'offer', conditional_offer: 'offer', rejection: 'rejected', documents_requested: 'documents' };
  if (stageMap[cls]) patch.status = stageMap[cls];
  await admin().from('applications').update(patch).eq('id', m.application_id).then(() => {}, async () => { delete patch.status; await admin().from('applications').update(patch).eq('id', m.application_id); });
  // Side effects that keep the platform in the loop: offer record, document tasks, interview pack, notifications.
  try {
    const N = require('./notify');
    if (cls === 'offer' || cls === 'conditional_offer') {
      const O = require('./offers'); await O.create(m.user_id, { application_id: m.application_id, offer_type: cls === 'conditional_offer' ? 'conditional' : 'unconditional', conditions: ((v.extracted || {}).conditions || []).map(t => ({ text: t, met: false })), decision_deadline: (v.extracted || {}).deadline || null, notes: 'Created from the reply received ' + new Date().toISOString().slice(0, 10) }).catch(() => {});
      await N.push(m.user_id, 'offer', 'Offer received: ' + (opp && opp.institution || 'your application'), v.summary, 'apps');
    } else if (cls === 'interview_invite' || cls === 'scheduling') {
      const Q = require('./queue'); await Q.enqueue('interview_prep', { userId: m.user_id, application_id: m.application_id }, { userId: m.user_id, maxAttempts: 2 }).catch(() => {});
      await N.push(m.user_id, 'interview', 'Interview: ' + (opp && opp.institution || 'your application'), (v.summary || '') + ' Your interview pack is being prepared.', 'apps');
    } else if (cls === 'documents_requested') {
      await N.push(m.user_id, 'documents', 'Documents requested by ' + (opp && opp.institution || 'the institution'), ((v.extracted || {}).documents_requested || []).join(', '), 'profile');
    } else if (cls === 'rejection') {
      await N.push(m.user_id, 'rejection', 'Decision from ' + (opp && opp.institution || 'the institution'), (v.summary || '') + ' Your next-best matches are ready on the dashboard.', 'home');
    } else await N.push(m.user_id, 'reply', 'Reply on your application', v.summary || '', 'apps');
    // Consultant task when the applicant is somebody's client.
    const { data: cl } = await admin().from('clients').select('id,org_id,owner_user_id').eq('user_id', m.user_id).eq('status', 'active').limit(1);
    if (cl && cl[0] && patch.next_action) await admin().from('client_tasks').insert({ org_id: cl[0].org_id, client_id: cl[0].id, assignee_user_id: cl[0].owner_user_id, title: patch.next_action, owner: patch.next_action_owner === 'us' ? 'us' : 'client', due_date: patch.next_action_due, created_by: null }).then(() => {}, () => {});
  } catch (e) {}
  return { classification: cls, next_action: patch.next_action };
}
async function inbox(applicationId, userId) {
  const { data: a } = await admin().from('applications').select('id,stage,status,intake_alias,last_inbound_at,next_action,next_action_owner,next_action_due,brain').eq('id', applicationId).eq('user_id', userId).maybeSingle(); if (!a) throw new Error('Case not found');
  const { data: msgs } = await admin().from('case_messages').select('id,direction,channel,from_addr,subject,classification,extracted,suggested_reply,received_at').eq('application_id', applicationId).order('received_at', { ascending: false }).limit(30);
  return { case: a, alias: a.intake_alias, messages: msgs || [], domain: DOMAIN() };
}
async function confirmClassification(userId, id, classification) {
  const { data: m } = await admin().from('case_messages').select('*').eq('id', id).eq('user_id', userId).maybeSingle(); if (!m) throw new Error('Message not found');
  await admin().from('case_messages').update({ classification, confidence: 1, needs_confirmation: false }).eq('id', id);
  const Q = require('./queue'); if (m.application_id) await Q.enqueue('case_understand', { messageId: id, applicationId: m.application_id, userId }, { userId, maxAttempts: 1 }); return { ok: true };
}
module.exports = { alias, byAlias, ingest, understand, inbox, provisionApplyEmail, byApplyEmail, routeForUser, sendFromApplyEmail, mailbox, triage, message, linkToCase, confirmClassification, APPLY_DOMAIN };
