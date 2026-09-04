// lib/journey.js — Day 5 · After the visa: pre-departure, arrival, settlement, family, PR.
// A plan is generated once per destination from a checked template plus the destination's
// recorded post-arrival / dependants / PR rules (each with its source). Partner slots mark
// where a service partner (insurance, SIM, housing, pickup, bank, forex) plugs in later.
const { admin } = require('./supa');
const T = (phase, title, detail, due_hint, partner_slot) => ({ phase, title, detail, due_hint, partner_slot: partner_slot || null });
const BASE = {
  pre_departure: [
    T('pre_departure', 'Attest your degree and transcripts', 'ORIGIN_ATTEST', '6-8 weeks before travel', 'attestation'),
    T('pre_departure', 'Book flights only after the visa is in hand', 'Refundable or flexible fare; arrival at least 5 days before the start date.', 'After visa grant', 'flights'),
    T('pre_departure', 'Buy travel and health insurance that the destination accepts', 'Check the visa rule on insurance; carry the policy printout.', '2 weeks before', 'insurance'),
    T('pre_departure', 'Arrange the first month of accommodation', 'University housing or a verified private room; get a written confirmation for the airport and registration.', '3-4 weeks before', 'housing'),
    T('pre_departure', 'Carry foreign currency within the State Bank limit and set up a card that works abroad', 'Confirm your bank has enabled international use; note the daily limit.', '1 week before', 'forex'),
    T('pre_departure', 'Prepare the arrival document folder', 'Passport, visa, offer/CoE/CAS, insurance, accommodation confirmation, funds evidence, vaccination record, 6 photos, all in one folder plus a phone copy.', '3 days before', null),
    T('pre_departure', 'Register your travel with the Pakistani mission at the destination', 'Note the embassy/consulate address and emergency number.', 'Before travel', null),
    T('pre_departure', 'Tell your consultant your flight details', 'So the pickup and the first-week plan can be confirmed.', 'When booked', 'pickup')
  ],
  arrival: [
    T('arrival', 'Airport pickup and first night', 'Confirm the pickup contact the day before; keep the accommodation address written down.', 'Day 0', 'pickup'),
    T('arrival', 'Local SIM and data', 'Buy at the airport or a main provider; you need a local number for everything below.', 'Day 0-1', 'sim'),
    T('arrival', 'Register your address / residence as the destination requires', 'Many countries require registration within days of arrival (see the rule with its source).', 'Days 1-14', null),
    T('arrival', 'Open a bank account', 'Take passport, visa/residence permit, address proof and the enrolment or employment letter.', 'Week 1-2', 'bank'),
    T('arrival', 'Enrol at the university or complete employer onboarding', 'Bring original documents; collect the student/employee ID.', 'Week 1', null),
    T('arrival', 'Collect your residence card / biometric permit', 'Follow the instruction in your visa decision letter.', 'As instructed', null),
    T('arrival', 'Transport card and the route to campus / work', 'Monthly pass is usually cheaper than pay-as-you-go.', 'Week 1', null)
  ],
  settlement: [
    T('settlement', 'Health: register with a doctor / the national health system', 'Some visas include health cover; others require your own insurance.', 'Month 1', 'insurance'),
    T('settlement', 'Tax and social security number', 'Needed for any work, even part-time.', 'Month 1', null),
    T('settlement', 'Know your work-rights limit and record your hours', 'Overstepping the weekly cap can cancel the visa.', 'Ongoing', null),
    T('settlement', 'Long-term housing', 'After the first month, compare rents and contracts; never pay a deposit without a contract.', 'Month 1-2', 'housing'),
    T('settlement', 'Join the Pakistani student / professional community and the university international office list', 'Support, part-time work leads, and emergencies.', 'Month 1', null),
    T('settlement', '30 / 60 / 90 day review with your consultant', 'Study progress or probation, finances, wellbeing, next-step planning.', 'Days 30, 60, 90', null)
  ],
  family: [
    T('family', 'Check the dependants rule for your route before promising family travel', 'Rules changed in several countries in 2024; see the recorded rule and its source.', 'Before applying', null),
    T('family', 'Dependant documents: marriage and birth certificates attested', 'NADRA certificates with MOFA attestation, translated where required.', '8 weeks before their travel', 'attestation'),
    T('family', 'Schooling and childcare', 'Register early; public schooling rules differ by country.', 'Before arrival', null),
    T('family', 'Spouse work rights', 'Depends on the route; record the rule and its source.', 'Before arrival', null)
  ],
  pr: [
    T('pr', 'Record the PR / long-term pathway that applies to your route', 'Points, years of residence, salary thresholds and language levels, each with its source and last-verified date.', 'Year 1', null),
    T('pr', 'Keep a residence and employment log', 'Continuous-residence rules count days abroad; keep tickets and contracts.', 'Ongoing', null),
    T('pr', 'Language certificate at the level the pathway needs', 'Plan the test date; results often have a validity period.', 'Year 1-2', null),
    T('pr', 'Annual pathway review with your consultant', 'Check rule changes, eligibility date and documents.', 'Every 12 months', null)
  ]
};
const ATTEST = { PK: 'HEC attestation first, then MOFA; some destinations also need embassy attestation. Keep two attested sets.', IN: 'University → State HRD → MEA apostille (or embassy attestation for non-Hague destinations). Keep two attested sets.', BD: 'Education Board / UGC → Ministry of Education → MOFA attestation; embassy attestation where required.', AE: 'MOFAIC attestation of degrees issued in the UAE; home-country attestation for degrees issued elsewhere.', SA: 'Saudi Ministry of Education / Cultural attaché attestation for degrees issued in KSA; home-country chain otherwise.', NP: 'University → Ministry of Education → MOFA attestation.', LK: 'University → Ministry of Foreign Affairs authentication.', NG: 'University → Ministry of Education → MFA / apostille.', EG: 'University → Ministry of Higher Education → MFA authentication.' };
async function plan(userId, cc, lane, clientId) {
  const CC = String(cc || '').toUpperCase().slice(0, 2); const ln = lane === 'work' ? 'work' : 'study';
  let origin = 'PK'; try { const { data: pr } = await admin().from('profiles').select('origin_country').eq('id', userId).maybeSingle(); origin = (pr && pr.origin_country) || 'PK'; } catch (e) {}
  const { data: existing } = await admin().from('journey_tasks').select('id').eq('user_id', userId).eq('country_code', CC).limit(1);
  if (existing && existing.length) return { created: 0, existing: true };
  const rows = []; let sort = 0;
  let attestDetail = ATTEST[origin] || ATTEST.PK, attestSrc = null;
  try { const { data: ar } = await admin().from('visa_rules').select('text,source_url,status').eq('country_code', CC).eq('rule_type', 'attestation').eq('route_key', CC.toLowerCase() + '_attest_' + origin.toLowerCase()).neq('status', 'superseded').order('created_at').limit(3); if (ar && ar.length) { attestDetail = ar.map(x => x.text).join(' '); attestSrc = ar[0].source_url; } } catch (e) {}
  for (const phase of Object.keys(BASE)) for (const t of BASE[phase]) rows.push(Object.assign({ user_id: userId, client_id: clientId || null, country_code: CC, lane: ln, sort: sort++ }, t, t.detail === 'ORIGIN_ATTEST' ? { detail: attestDetail, source_url: attestSrc } : {}));
  // Destination-specific items from the rules on record (post_arrival, work_rights, dependants, pr_path), with their sources.
  try {
    const { data: rules } = await admin().from('visa_rules').select('rule_type,text,source_url,source_title,lane').eq('country_code', CC).neq('status', 'superseded').in('rule_type', ['post_arrival', 'work_rights', 'dependants', 'pr_path']);
    for (const r of (rules || [])) {
      if (r.lane !== 'both' && r.lane !== ln) continue;
      const phase = r.rule_type === 'post_arrival' ? 'arrival' : r.rule_type === 'work_rights' ? 'settlement' : r.rule_type === 'dependants' ? 'family' : 'pr';
      rows.push({ user_id: userId, client_id: clientId || null, country_code: CC, lane: ln, phase, title: r.rule_type.replace('_', ' ') + ' rule for ' + CC, detail: r.text, due_hint: 'See source', source_url: r.source_url || null, sort: sort++ });
    }
  } catch (e) {}
  const { error } = await admin().from('journey_tasks').insert(rows);
  if (error) throw new Error(error.message);
  return { created: rows.length };
}
async function list(userId, cc) {
  let q = admin().from('journey_tasks').select('*').eq('user_id', userId).order('sort');
  if (cc) q = q.eq('country_code', String(cc).toUpperCase());
  const { data } = await q; const rows = data || [];
  const phases = {}; for (const r of rows) (phases[r.phase] = phases[r.phase] || []).push(r);
  const prog = Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, { done: v.filter(x => x.done).length, total: v.length }]));
  return { tasks: rows, phases, progress: prog, countries: [...new Set(rows.map(r => r.country_code))] };
}
async function setDone(userId, id, done) {
  const { data, error } = await admin().from('journey_tasks').update({ done: !!done, done_at: done ? new Date().toISOString() : null }).eq('id', id).eq('user_id', userId).select('id,done').single();
  if (error) throw new Error(error.message); return data;
}
module.exports = { plan, list, setDone, BASE };
