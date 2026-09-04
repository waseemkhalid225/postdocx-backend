// lib/visa.js — Day 4 · Visa Intelligence.
// Rules are records with a source, dates, version and a verification state. A checklist is
// computed from the rules and the vault; a pre-fill is computed from the profile; a refusal is
// analysed against the rules. The platform never states a rule it cannot point to.
const { admin } = require('./supa');
const VAULT = require('./vault');
const MOBILITY = require('./mobility');
const { callAI } = require('./router');

async function seedIfEmpty() {
  const { count } = await admin().from('visa_rules').select('id', { count: 'exact', head: true });
  let seeded = 0;
  if (!count) {
    const { seed } = require('./visa_seed');
    const rows = seed.map(r => Object.assign({ status: 'unverified', confidence: 0.5, version: 1 }, r));
    const { error } = await admin().from('visa_rules').insert(rows);
    if (error) throw new Error(error.message); seeded += rows.length;
  }
  // Route rules from both seed files, inserted only where the route (or, for existing routes, the exact text) is not yet recorded.
  try {
    const { seed: seed2 } = require('./visa_seed2'); const { seed: seed1 } = require('./visa_seed'); const { seed: seed3 } = require('./visa_seed3'); const { seed: seed4 } = require('./visa_seed4'); const { seed: seed5 } = require('./visa_seed5'); const { seed: seed6 } = require('./visa_seed6'); const { data: routesHave } = await admin().from('visa_rules').select('route_key,text');
    const haveR = new Set((routesHave || []).map(r => r.route_key)); const haveT = new Set((routesHave || []).map(r => r.route_key + '|' + r.text));
    const add = seed2.filter(r => !haveR.has(r.route_key)).concat(seed1.filter(r => haveR.has(r.route_key) && !haveT.has(r.route_key + '|' + r.text))).concat(seed3.filter(r => !haveR.has(r.route_key) && !haveT.has(r.route_key + '|' + r.text))).concat(seed4.filter(r => !haveT.has(r.route_key + '|' + r.text))).concat(seed5.filter(r => !haveT.has(r.route_key + '|' + r.text))).concat(seed6.filter(r => !haveT.has(r.route_key + '|' + r.text))).map(r => Object.assign({ status: 'unverified', confidence: 0.5, version: 1 }, r));
    if (add.length) { const { error } = await admin().from('visa_rules').insert(add); if (error) throw new Error(error.message); seeded += add.length; }
  } catch (e) { if (!/visa_seed2/.test(String(e.message))) throw e; }
  // Attestation (origin × destination) and licence (profession × destination) rules, inserted where missing.
  try {
    const { data: haveK } = await admin().from('visa_rules').select('route_key'); const hk = new Set((haveK || []).map(r => r.route_key));
    const AT = require('./attestation'); const PR = require('./professions'); const add = [];
    const dests = Object.keys(require('./visa_portals').PORTALS);
    for (const origin of Object.keys(AT.ORIGIN)) for (const d of dests) for (const r of AT.rulesFor(origin, d)) if (!hk.has(r.route_key)) { add.push(Object.assign({ status: 'unverified', confidence: 0.5, version: 1 }, r)); hk.add(r.route_key + '|' + r.text.slice(0, 20)); }
    for (const r of PR.rules()) if (!hk.has(r.route_key)) add.push(Object.assign({ status: 'unverified', confidence: 0.5, version: 1 }, r));
    for (let i = 0; i < add.length; i += 500) { const { error } = await admin().from('visa_rules').insert(add.slice(i, i + 500)); if (error) throw new Error(error.message); }
    seeded += add.length;
  } catch (e) { if (!/attestation|professions/.test(String(e.message))) throw e; }
  // Every profession × every destination: the recognition entry point and whether the profession is regulated,
  // inserted only where no licence rule for that profession/country exists (named regulators keep priority).
  try {
    const { data: lic } = await admin().from('visa_rules').select('country_code,value').eq('rule_type', 'licence');
    const have = new Set((lic || []).map(r => r.country_code + '|' + ((r.value || {}).profession || '')));
    const add = require('./professions_all').rules().filter(r => !have.has(r.country_code + '|' + r.value.profession)).map(r => Object.assign({ status: 'unverified', confidence: 0.4, version: 1 }, r));
    for (let i = 0; i < add.length; i += 500) { const { error } = await admin().from('visa_rules').insert(add.slice(i, i + 500)); if (error) throw new Error(error.message); }
    seeded += add.length;
  } catch (e) { if (!/professions_all/.test(String(e.message))) throw e; }
  // Institutions: flagship universities per destination as entities.
  try { const rows = require('./universities_seed').rows(); for (let i = 0; i < rows.length; i += 200) await admin().from('institutions').upsert(rows.slice(i, i + 200), { onConflict: 'country_code,name', ignoreDuplicates: true }); } catch (e) {}
  // Day 8: every one of the 54 destinations gets its official entry point, once.
  const { data: have } = await admin().from('visa_rules').select('country_code').eq('rule_type', 'note').like('route_key', '%_entry');
  const got = new Set((have || []).map(r => r.country_code));
  const portals = require('./visa_portals').portalRules().filter(r => !got.has(r.country_code)).map(r => Object.assign({ status: 'unverified', confidence: 0.6, version: 1 }, r));
  if (portals.length) { const { error } = await admin().from('visa_rules').insert(portals); if (error) throw new Error(error.message); seeded += portals.length; }
  return { seeded, existing: count || 0, portals: portals.length };
}
async function routes(cc, lane) {
  let q = admin().from('visa_rules').select('country_code,route_key,route_name,lane,status').eq('country_code', String(cc || '').toUpperCase()).neq('status', 'superseded');
  const { data } = await q;
  const seen = {};
  for (const r of (data || [])) {
    if (lane && lane !== 'both' && r.lane !== 'both' && r.lane !== lane) continue;
    const k = r.route_key; if (!seen[k]) seen[k] = { route_key: k, route_name: r.route_name, lane: r.lane, rules: 0, verified: 0 };
    seen[k].rules++; if (r.status === 'verified') seen[k].verified++;
  }
  return Object.values(seen);
}
async function rulesFor(cc, routeKey) {
  const { data } = await admin().from('visa_rules').select('*').eq('country_code', String(cc || '').toUpperCase()).eq('route_key', routeKey).neq('status', 'superseded').order('rule_type').order('created_at');
  return data || [];
}
async function countries() {
  const { data } = await admin().from('visa_rules').select('country_code').neq('status', 'superseded');
  return [...new Set((data || []).map(r => r.country_code))].sort();
}
/* The visa checklist: document rules mapped onto the vault; eligibility rules checked against
   the mobility profile where the rule is machine-readable; everything else listed with its source. */
async function assess(userId, cc, routeKey) {
  let rules = await rulesFor(cc, routeKey);
  if (!rules.length) throw new Error('No rules recorded yet for ' + cc + ' / ' + routeKey);
  // Origin-aware attestation and profession-aware licence rules ride along with every route.
  try {
    const { data: pr } = await admin().from('profiles').select('origin_country,profession,field,headline').eq('id', userId).maybeSingle();
    const origin = (pr && pr.origin_country) || 'PK';
    const { data: extra } = await admin().from('visa_rules').select('*').eq('country_code', String(cc).toUpperCase()).in('rule_type', ['attestation', 'licence', 'shortage']).neq('status', 'superseded');
    const prof = require('./occupations').classify([pr && pr.profession, pr && pr.headline, pr && pr.field].filter(Boolean).join(' '));
    for (const r of (extra || [])) {
      if (r.rule_type === 'attestation' && r.value && r.value.origin === origin) rules.push(r);
      if (r.rule_type === 'licence' && (!prof.isco || !r.value || !r.value.isco || String(prof.isco).startsWith(String(r.value.isco).slice(0, 3)) || String(r.value.isco).startsWith(String(prof.isco).slice(0, 3)))) { if (prof.isco && r.value && r.value.isco) rules.push(r); }
      if (r.rule_type === 'shortage') rules.push(r);
    }
  } catch (e) {}
  const docTypes = [...new Set(rules.filter(r => r.rule_type === 'document' && r.value && r.value.doc_type).map(r => r.value.doc_type))];
  const mob = await MOBILITY.get(userId);
  const lane = rules[0].lane === 'work' ? 'visa_work' : 'visa';
  const ck = await VAULT.checklist(userId, lane, docTypes);
  // Only the rules' documents count for the visa: rebuild required from the rule set.
  const byType = Object.fromEntries([...ck.required, ...ck.recommended].map(r => [r.type, r]));
  const required = docTypes.map(t => byType[t] || { type: t, label: VAULT.LABEL[t] || t, state: 'missing' });
  const flags = [];
  const p = mob.profile || {};
  for (const r of rules) {
    if (r.rule_type === 'language' && r.value && r.value.cefr) {
      if (!p.test_name || p.test_name === 'none') flags.push({ level: 'warn', text: 'Language evidence needed: ' + r.text, rule_id: r.id });
    }
    if (r.rule_type === 'financial') {
      if (!p.funding_source) flags.push({ level: 'warn', text: 'Funding source not set in your profile. Rule: ' + r.text, rule_id: r.id });
      else if (p.can_show_bank_statement === false || p.can_show_bank_statement === 'no') flags.push({ level: 'risk', text: 'You indicated you cannot show a bank statement. Rule: ' + r.text, rule_id: r.id });
    }
    if (r.rule_type === 'dependants' && Number(p.dependants) > 0) flags.push({ level: 'info', text: 'You plan to travel with dependants. Rule: ' + r.text, rule_id: r.id });
  }
  if (p.visa_refusals) flags.push({ level: 'risk', text: 'Previous refusal declared (' + String(p.visa_refusals).slice(0, 80) + '). Address it explicitly in the cover letter; prepare the refusal analysis below.' });
  if (p.passport_expiry && p.passport_expiry < new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10)) flags.push({ level: 'risk', text: 'Passport expires within 6 months of today; most routes require validity beyond the stay.' });
  const unverified = rules.filter(r => r.status !== 'verified').length;
  const tracks = { employer: rules.filter(r => r.value && r.value.track === 'employer'), applicant: rules.filter(r => r.value && r.value.track === 'applicant') };
  return { country_code: cc, route_key: routeKey, route_name: rules[0].route_name, lane: rules[0].lane, rules, required, missing: required.filter(r => r.state === 'missing').map(r => r.type), expired: required.filter(r => r.state === 'expired').map(r => r.type), review: required.filter(r => r.state === 'review').map(r => r.type),
    ready: required.every(r => r.state === 'ok') && !flags.some(f => f.level === 'risk'), flags, unverified_rules: unverified, verified_rules: rules.length - unverified, tracks, source_changed: rules.filter(r => r.source_changed).length,
    prefill: prefill(mob, cc) };
}
/* Pre-fill: the fields every visa form asks, from the profile with provenance. Never guessed. */
function prefill(mob, cc) {
  const p = mob.profile || {}, pv = mob.provenance || {};
  const f = (k, label) => ({ field: k, label, value: p[k] == null ? '' : p[k], source: pv[k] || (p[k] != null ? 'profile' : 'missing') });
  return [f('given_name', 'Given name(s)'), f('family_name', 'Family name'), f('date_of_birth', 'Date of birth'), f('gender', 'Gender'), f('nationality', 'Nationality'), f('passport_number', 'Passport number'), f('passport_expiry', 'Passport expiry'), f('cnic', 'National ID'),
    f('country_of_residence', 'Country of residence'), f('city', 'City'), f('marital_status', 'Marital status'), f('dependants', 'Dependants travelling'), f('highest_level', 'Highest qualification'), f('institution', 'Institution'), f('field', 'Field'),
    f('current_employer', 'Current employer'), f('current_title', 'Current job title'), f('years_experience', 'Years of experience'), f('test_name', 'Language test'), f('overall_score', 'Language score'), f('funding_source', 'Funding source'), f('budget_pkr_per_year', 'Funds available per year (PKR)'),
    f('visa_refusals', 'Previous refusals'), f('previous_visas', 'Previous visas'), f('countries_lived', 'Countries lived in'), f('criminal_record_declared', 'Criminal record declaration')];
}
/* Refusal analysis: structured reasons and the concrete route back, grounded in the recorded rules. */
async function analyseRefusal(userId, cc, routeKey, refusalText, extra) {
  let rules = routeKey ? await rulesFor(cc, routeKey) : [];
  if (!rules.length) { const { data } = await admin().from('visa_rules').select('*').eq('country_code', String(cc).toUpperCase()).neq('status', 'superseded').limit(60); rules = data || []; }
  const mob = await MOBILITY.get(userId);
  const prompt = `You are a careful immigration-information analyst (not a lawyer). A refusal letter is quoted below for ${cc} route "${rules[0] ? rules[0].route_name : routeKey}".
Answer ONLY with JSON:
{"reasons":[{"code":"short code e.g. FUNDS, GENUINE_STUDENT, DOCS, CREDIBILITY, ELIGIBILITY, OTHER","quote":"the sentence from the letter","meaning":"plain-language meaning","rule_ref":"the matching rule text from RULES or null"}],
 "fixable":true/false, "reapply_or_appeal":"reapply | appeal | review | seek_licensed_advice", "actions":[{"step":"","evidence":"what document proves it","deadline_hint":""}],
 "cover_letter_points":["3-6 points a new application letter must address"], "caution":"one line: where a licensed adviser is needed"}
RULES (recorded, with sources): ${JSON.stringify(rules.map(r => ({ type: r.rule_type, text: r.text, source: r.source_url }))).slice(0, 5000)}
APPLICANT PROFILE: ${JSON.stringify(mob.profile).slice(0, 3000)}
REFUSAL LETTER: ${String(refusalText || '').slice(0, 6000)}
${extra ? 'CONTEXT: ' + String(extra).slice(0, 1000) : ''}
Rules: quote the letter, never invent a rule that is not in RULES, and say "seek_licensed_advice" for appeals, bans or fraud findings.`;
  const txt = await callAI('high_value', prompt, { maxTokens: 2500, json: true, userId });
  const m = String(txt).match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : { raw: String(txt).slice(0, 3000) };
}
async function verifyRule(adminId, id, patch) {
  const upd = { status: 'verified', last_verified_at: new Date().toISOString(), verified_by: adminId, updated_at: new Date().toISOString() };
  if (patch.text) upd.text = String(patch.text).slice(0, 1000);
  if (patch.value && typeof patch.value === 'object') upd.value = patch.value;
  if (patch.source_url) upd.source_url = String(patch.source_url).slice(0, 500);
  if (patch.effective_date) upd.effective_date = patch.effective_date;
  if (patch.published_date) upd.published_date = patch.published_date;
  if (patch.confidence != null) upd.confidence = Math.max(0, Math.min(1, Number(patch.confidence)));
  if (patch.status === 'disputed') upd.status = 'disputed';
  // A change of text supersedes the old version rather than overwriting history.
  if (patch.text) {
    const { data: old } = await admin().from('visa_rules').select('*').eq('id', id).maybeSingle();
    if (old && old.text !== patch.text) {
      await admin().from('visa_rules').update({ status: 'superseded', updated_at: upd.updated_at }).eq('id', id);
      const copy = Object.assign({}, old, upd, { id: undefined, version: (old.version || 1) + 1, created_at: undefined }); delete copy.id; delete copy.created_at;
      const { data: nu, error } = await admin().from('visa_rules').insert(copy).select('*').single(); if (error) throw new Error(error.message); return nu;
    }
  }
  const { data, error } = await admin().from('visa_rules').update(upd).eq('id', id).select('*').single();
  if (error) throw new Error(error.message); return data;
}
module.exports = { seedIfEmpty, routes, rulesFor, countries, assess, prefill, analyseRefusal, verifyRule };
