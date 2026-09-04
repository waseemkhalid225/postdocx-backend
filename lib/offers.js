// lib/offers.js — Day 3 · Offers, conditions and interview preparation.
// An offer is the middle of the journey, not the end: every condition is a task with a due
// date and evidence, the deposit and decision deadlines are watched, and the interview
// preparation is written from the actual posting and the applicant's own profile.
const { admin } = require('./supa');
const { callAI } = require('./router');

const OFFER_FIELDS = ['application_id', 'opportunity_id', 'kind', 'offer_type', 'issuer', 'title', 'country_code', 'received_on', 'decision_deadline', 'deposit_usd', 'deposit_deadline', 'salary_or_funding', 'conditions', 'status', 'notes', 'document_id'];
const iso = s => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s))) ? String(s) : null;

function clean(body) {
  const out = {};
  for (const k of OFFER_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  for (const k of ['received_on', 'decision_deadline', 'deposit_deadline']) if (out[k] !== undefined) out[k] = iso(out[k]);
  if (out.deposit_usd !== undefined) out.deposit_usd = out.deposit_usd === null || out.deposit_usd === '' ? null : Number(out.deposit_usd) || 0;
  if (out.conditions !== undefined) out.conditions = Array.isArray(out.conditions) ? out.conditions.slice(0, 40).map(c => ({ text: String(c.text || '').slice(0, 300), met: !!c.met, due: iso(c.due), evidence_document_id: c.evidence_document_id || null })) : [];
  for (const k of ['issuer', 'title', 'salary_or_funding', 'notes']) if (out[k] !== undefined) out[k] = String(out[k] || '').slice(0, k === 'notes' ? 4000 : 300) || null;
  if (out.country_code !== undefined) out.country_code = String(out.country_code || '').toUpperCase().slice(0, 2) || null;
  return out;
}

async function create(userId, body, ctx = {}) {
  const row = Object.assign({ user_id: userId, client_id: ctx.clientId || null, org_id: ctx.orgId || null }, clean(body || {}));
  if (!row.issuer && !row.title) throw new Error('Who made the offer, or for what?');
  // Auto-fill from the case if one is linked.
  if (row.application_id && !row.title) {
    try { const { data: a } = await admin().from('applications').select('opportunity_id').eq('id', row.application_id).maybeSingle(); if (a) row.opportunity_id = row.opportunity_id || a.opportunity_id; } catch (e) {}
  }
  if (row.opportunity_id && (!row.title || !row.issuer)) {
    try { const { data: o } = await admin().from('opportunities').select('title,institution,country_code,kind').eq('id', row.opportunity_id).maybeSingle(); if (o) { row.title = row.title || o.title; row.issuer = row.issuer || o.institution; row.country_code = row.country_code || o.country_code; if (!body.kind) row.kind = o.kind === 'work' ? 'job' : 'admission'; } } catch (e) {}
  }
  const { data, error } = await admin().from('offers').insert(row).select('*').single();
  if (error) throw new Error(error.message);
  // The application, if linked, moves to "offer".
  if (row.application_id) admin().from('applications').update({ status: 'offer' }).eq('id', row.application_id).eq('user_id', userId).then(() => {}, () => {});
  return data;
}
async function update(userId, id, body) {
  const patch = clean(body || {}); patch.updated_at = new Date().toISOString();
  const { data, error } = await admin().from('offers').update(patch).eq('id', id).eq('user_id', userId).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}
function enrich(o) {
  const today = new Date().toISOString().slice(0, 10);
  const conds = Array.isArray(o.conditions) ? o.conditions : [];
  const open = conds.filter(c => !c.met);
  const days = d => d ? Math.ceil((new Date(d) - new Date(today)) / 86400000) : null;
  const alerts = [];
  if (o.status === 'received' && o.decision_deadline && days(o.decision_deadline) != null && days(o.decision_deadline) <= 7) alerts.push((days(o.decision_deadline) < 0 ? 'Decision deadline passed ' : 'Decide within ') + Math.abs(days(o.decision_deadline)) + ' day(s)');
  if (o.deposit_usd && o.deposit_deadline && days(o.deposit_deadline) != null && days(o.deposit_deadline) <= 10) alerts.push('Deposit $' + o.deposit_usd + ' due in ' + days(o.deposit_deadline) + ' day(s)');
  for (const c of open) if (c.due && days(c.due) != null && days(c.due) <= 14) alerts.push('Condition due ' + c.due + ': ' + c.text.slice(0, 60));
  return { ...o, conditions_open: open.length, conditions_total: conds.length, all_conditions_met: conds.length > 0 && open.length === 0, days_to_decide: days(o.decision_deadline), alerts };
}
async function list(userId) {
  const { data } = await admin().from('offers').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
  return (data || []).map(enrich);
}

/* Interview preparation: written from the posting and the applicant, never generic. */
async function prepareInterview(userId, { application_id, opportunity_id, offer_id, role_title, extra }) {
  let opp = null, prof = null, mob = null, off = null;
  try { if (offer_id) { const { data } = await admin().from('offers').select('*').eq('id', offer_id).eq('user_id', userId).maybeSingle(); off = data; opportunity_id = opportunity_id || (off && off.opportunity_id); } } catch (e) {}
  try { if (application_id && !opportunity_id) { const { data } = await admin().from('applications').select('opportunity_id').eq('id', application_id).eq('user_id', userId).maybeSingle(); opportunity_id = data && data.opportunity_id; } } catch (e) {}
  try { if (opportunity_id) { const { data } = await admin().from('opportunities').select('title,institution,country_code,kind,level,description,requirements,req_field,salary_note,stipend,funding,contract_type,req_language').eq('id', opportunity_id).maybeSingle(); opp = data; } } catch (e) {}
  try { const { data } = await admin().from('profiles').select('full_name,headline,field,profession,methods,total_experience_years,education,experience,publications,licenses,mobility').eq('id', userId).maybeSingle(); prof = data; mob = data && data.mobility; } catch (e) {}
  const role = role_title || (off && off.title) || (opp && opp.title) || 'the position';
  const issuer = (off && off.issuer) || (opp && opp.institution) || '';
  const prompt = `You are an interview coach for international study and work applicants from Pakistan, India and Bangladesh.
Prepare a focused interview pack for THIS applicant and THIS position. Answer ONLY with JSON:
{"role":"", "format_expectation":"one paragraph: what this kind of interview usually looks like for this country/role (panel, online, length, language)",
 "likely_questions":[{"q":"","why_asked":"","strong_answer_outline":"3-5 bullet points drawn from the applicant's actual CV facts","pitfall":""}],   // 10-14 questions, position-specific first, then visa/motivation/relocation
 "questions_to_ask":["5 sharp questions the applicant should ask"],
 "salary_or_funding_brief":"what to say when money is discussed; use the posting's stated figures if present, otherwise say what to check; never invent numbers",
 "documents_to_have_open":["..."],
 "red_flags_to_avoid":["..."],
 "48_hour_plan":["day-before and day-of checklist"]}
POSITION: ${JSON.stringify({ role, issuer, country: opp && opp.country_code, kind: opp && opp.kind, level: opp && opp.level, requirements: opp && (opp.requirements || opp.description), field: opp && opp.req_field, pay: opp && (opp.salary_note || opp.stipend || opp.funding), contract: opp && opp.contract_type, language: opp && opp.req_language }).slice(0, 4000)}
APPLICANT: ${JSON.stringify({ name: prof && prof.full_name, headline: prof && prof.headline, field: prof && prof.field, profession: prof && prof.profession, years: prof && prof.total_experience_years, education: prof && prof.education, experience: prof && prof.experience, publications: (prof && prof.publications || []).slice(0, 6), licences: prof && prof.licenses, goals: mob && { study: mob.study_goal, job: mob.job_goal, pr: mob.pr_goal }, family: mob && { dependants: mob.dependants, marital: mob.marital_status } }).slice(0, 5000)}
${extra ? 'EXTRA CONTEXT FROM APPLICANT: ' + String(extra).slice(0, 1500) : ''}
Rules: every strong-answer outline must cite a concrete fact from the applicant (a degree, a project, a number). No generic advice. If a fact is missing, say what the applicant must prepare instead of inventing it.`;
  const txt = await callAI('case_writing', prompt, { maxTokens: 3500, json: true, userId });
  const m = String(txt).match(/\{[\s\S]*\}/); const content = m ? JSON.parse(m[0]) : { raw: String(txt).slice(0, 4000) };
  const { data, error } = await admin().from('interview_preps').insert({ user_id: userId, application_id: application_id || null, opportunity_id: opportunity_id || null, offer_id: offer_id || null, role_title: String(role).slice(0, 200), content }).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}
async function listPreps(userId) { const { data } = await admin().from('interview_preps').select('id,role_title,created_at,application_id,opportunity_id,offer_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(20); return data || []; }
async function getPrep(userId, id) { const { data } = await admin().from('interview_preps').select('*').eq('id', id).eq('user_id', userId).maybeSingle(); return data; }

module.exports = { create, update, list, enrich, prepareInterview, listPreps, getPrep, OFFER_FIELDS };
