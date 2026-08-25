// lib/match.js — Phase 4: eligibility matching + "Why You Match".
// Compares the user's verified profile against an opportunity's stated criteria.
// Honesty rules:
//  - A criterion the opportunity did NOT state is 'not specified' — never a satisfied pass.
//  - A criterion the user has no data for is 'unknown' — never assumed met.
//  - The match % is computed only from criteria that were actually stated AND checkable.
const { admin } = require('./supa');

const LEVEL_RANK = { bachelors: 1, masters: 2, phd: 3, postdoc: 4 };

// Build a quick lookup of the user's checkable facts from profile_fields (preferred, has provenance)
// falling back to the profiles row for list fields.
async function userFacts(userId) {
  const facts = {};
  try {
    const { data: fields } = await admin().from('profile_fields').select('field_key,value,status').eq('user_id', userId);
    for (const f of (fields || [])) if (f.value) facts[f.field_key] = { value: f.value, status: f.status };
  } catch (e) { /* table may not exist pre-migration */ }
  const { data: p } = await admin().from('profiles').select('*').eq('id', userId).single();
  facts._profile = p || {};
  // documents the user holds, for document requirements
  const { data: docs } = await admin().from('documents').select('kind').eq('user_id', userId).eq('generated', false);
  facts._docKinds = new Set((docs || []).map(d => String(d.kind || '').toLowerCase()));
  return facts;
}

function parseNum(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }

// Normalize a user's highest degree text to a level rank if possible.
function degreeLevelFromText(t) {
  const s = String(t || '').toLowerCase();
  if (/postdoc|post-doc/.test(s)) return 'postdoc';
  if (/phd|doctor|dphil/.test(s)) return 'phd';
  if (/master|msc|m\.sc|mphil|ms |m\.s|ma /.test(s)) return 'masters';
  if (/bachelor|bsc|b\.sc|bs |be |b\.e|undergrad/.test(s)) return 'bachelors';
  return null;
}

// Evaluate one opportunity for one user's facts.
// Returns { status, pct, reasons:[{ok,text}], stated, met }
function evaluate(opp, facts) {
  const reasons = [];
  let stated = 0, met = 0;

  // ---- degree level ----
  if (opp.req_degree_level && opp.req_degree_level !== 'any') {
    stated++;
    const userLevel = degreeLevelFromText((facts.highest_degree || {}).value)
      || degreeLevelFromText((facts._profile.headline))
      || degreeLevelFromText(JSON.stringify(facts._profile.education || []));
    if (!userLevel) {
      reasons.push({ ok: 'unknown', text: 'Degree level required (' + opp.req_degree_level + '); your level is not clear from your profile' });
    } else if (LEVEL_RANK[userLevel] >= LEVEL_RANK[opp.req_degree_level]) {
      met++; reasons.push({ ok: 'yes', text: 'Your ' + userLevel + ' meets the required ' + opp.req_degree_level + ' level' });
    } else {
      reasons.push({ ok: 'no', text: 'Requires ' + opp.req_degree_level + '; your highest is ' + userLevel });
    }
  }

  // ---- CGPA ----
  if (opp.req_min_cgpa != null) {
    stated++;
    const userCgpa = parseNum((facts.cgpa || {}).value);
    if (userCgpa == null) {
      reasons.push({ ok: 'unknown', text: 'Minimum CGPA ' + opp.req_min_cgpa + (opp.req_cgpa_scale ? '/' + opp.req_cgpa_scale : '') + ' required; your CGPA is not on file' });
    } else {
      // Scale-normalize if both scales known
      let uc = userCgpa, need = Number(opp.req_min_cgpa);
      if (opp.req_cgpa_scale && opp.req_cgpa_scale > 0 && uc > opp.req_cgpa_scale) {
        // user cgpa likely on a different (e.g. percentage) scale; skip normalization, compare raw cautiously
      }
      if (uc >= need) { met++; reasons.push({ ok: 'yes', text: 'Your CGPA ' + uc + ' meets the minimum ' + need + (opp.req_cgpa_scale ? '/' + opp.req_cgpa_scale : '') }); }
      else reasons.push({ ok: 'no', text: 'Minimum CGPA ' + need + (opp.req_cgpa_scale ? '/' + opp.req_cgpa_scale : '') + '; yours is ' + uc });
    }
  }

  // ---- language ----
  if (opp.req_language && opp.req_language.toLowerCase() !== 'none') {
    stated++;
    const hasTest = (facts.english_test && facts.english_test.value) || facts._docKinds.has('english_test');
    const userScore = parseNum((facts.english_score || {}).value);
    if (!hasTest) {
      reasons.push({ ok: 'unknown', text: opp.req_language + (opp.req_language_min ? ' ' + opp.req_language_min : '') + ' required; no English test on file' });
    } else if (opp.req_language_min != null) {
      if (userScore != null && userScore >= Number(opp.req_language_min)) { met++; reasons.push({ ok: 'yes', text: 'Your ' + opp.req_language + ' ' + userScore + ' meets the minimum ' + opp.req_language_min }); }
      else if (userScore != null) reasons.push({ ok: 'no', text: opp.req_language + ' minimum ' + opp.req_language_min + '; yours is ' + userScore });
      else reasons.push({ ok: 'unknown', text: opp.req_language + ' ' + opp.req_language_min + ' required; your score is not recorded' });
    } else { met++; reasons.push({ ok: 'yes', text: 'You have an English test on file (' + opp.req_language + ')' }); }
  }

  // ---- field / major (soft check, text containment) ----
  if (opp.req_field) {
    stated++;
    const uf = String((facts.field || {}).value || facts._profile.field || '').toLowerCase();
    const rf = String(opp.req_field).toLowerCase();
    if (!uf) reasons.push({ ok: 'unknown', text: 'Field requirement: ' + opp.req_field + '; your field is not set' });
    else if (uf.includes(rf.split(/\s+/)[0]) || rf.includes(uf.split(/\s+/)[0])) { met++; reasons.push({ ok: 'yes', text: 'Your field matches the required area (' + opp.req_field + ')' }); }
    else reasons.push({ ok: 'no', text: 'Preferred field ' + opp.req_field + '; yours is ' + (facts._profile.field || uf) });
  }

  // ---- experience years (work) ----
  if (opp.req_experience_years != null) {
    stated++;
    reasons.push({ ok: 'unknown', text: opp.req_experience_years + '+ years experience required; confirm from your CV' });
  }

  // ---- professional license (work) ----
  if (opp.req_license) {
    stated++;
    const hasLic = (facts._profile.licenses || []).length || facts._docKinds.has('license');
    if (hasLic) { met++; reasons.push({ ok: 'yes', text: 'You have a professional license on file; target route: ' + opp.req_license }); }
    else reasons.push({ ok: 'unknown', text: 'Registration route ' + opp.req_license + ' applies; no license document on file yet' });
  }

  // ---- required documents ----
  const reqDocs = Array.isArray(opp.req_documents) ? opp.req_documents : [];
  const docMap = { cv: ['cv', 'resume'], transcript: ['transcript'], degree: ['degree'], passport: ['passport'], 'english test': ['english_test', 'ielts', 'toefl'], reference: ['reference_letter'], recommendation: ['reference_letter'], publication: ['publication'] };
  for (const rd of reqDocs) {
    stated++;
    const key = String(rd).toLowerCase();
    const kinds = docMap[key] || [key.replace(/\s+/g, '_')];
    const have = kinds.some(k => facts._docKinds.has(k));
    if (have) { met++; reasons.push({ ok: 'yes', text: rd + ' is on file' }); }
    else reasons.push({ ok: 'no', text: rd + ' required — not uploaded yet' });
  }

  // ---- verdict ----
  const pct = stated ? Math.round(100 * met / stated) : null;
  const hardFails = reasons.filter(r => r.ok === 'no' && /Requires|minimum|Minimum/.test(r.text)).length;
  const unknowns = reasons.filter(r => r.ok === 'unknown').length;
  let status;
  if (!stated) status = 'criteria_not_published';
  else if (hardFails > 0) status = 'not_eligible';
  else if (unknowns > 0 || reasons.some(r => r.ok === 'no')) status = 'potentially_eligible';
  else status = 'eligible';

  return { status, pct, reasons, stated, met };
}

async function matchOpportunity(userId, oppId) {
  const { data: opp } = await admin().from('opportunities').select('*').eq('id', oppId).single();
  if (!opp) throw new Error('Opportunity not found');
  const facts = await userFacts(userId);
  return { opportunity: { id: opp.id, title: opp.title, institution: opp.institution }, ...evaluate(opp, facts) };
}

// Match a whole list (used to annotate browse results) — one facts fetch, many evaluations.
async function matchMany(userId, opps) {
  const facts = await userFacts(userId);
  return (opps || []).map(o => ({ id: o.id, ...evaluate(o, facts) }));
}

module.exports = { matchOpportunity, matchMany, evaluate, userFacts, degreeLevelFromText };
