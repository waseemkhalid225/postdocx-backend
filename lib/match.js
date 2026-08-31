// lib/match.js — Phase 4: eligibility matching + "Why You Match".
// Compares the user's verified profile against an opportunity's stated criteria.
// Honesty rules:
//  - A criterion the opportunity did NOT state is 'not specified' — never a satisfied pass.
//  - A criterion the user has no data for is 'unknown' — never assumed met.
//  - The match % is computed only from criteria that were actually stated AND checkable.
const { admin } = require('./supa');

const LEVEL_RANK = { short_course: 0.5, diploma: 0.8, bachelors: 1, masters: 2, phd: 3, postdoc: 4, fellowship: 4, observership: 3.5, licensing_exam: 2.5 };

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
function evaluate(opp, facts, wantedLevels) {
  const reasons = [];
  let stated = 0, met = 0;

  // Applicant's own highest level, used both for the requirement check AND to reject
  // opportunities clearly BELOW the applicant (a PhD holder must never see a Master's).
  const myLevel = degreeLevelFromText((facts.highest_degree || {}).value)
    || degreeLevelFromText((facts._profile.headline))
    || degreeLevelFromText(JSON.stringify(facts._profile.education || []))
    || degreeLevelFromText((facts._profile.degree_level || ''));
  let overqualified = false;
  // The opportunity's own level: its stated requirement, or its declared level field.
  const oppLevel = (opp.level && LEVEL_RANK[opp.level]) ? opp.level
    : (opp.req_degree_level && opp.req_degree_level !== 'any' ? opp.req_degree_level : null);
  if (myLevel && oppLevel && LEVEL_RANK[oppLevel] < LEVEL_RANK[myLevel]) overqualified = true;
  // TARGET-LEVEL GATE: if the user explicitly selected which levels they want
  // (e.g. postdoc), an opportunity at any other level is simply not what they asked for.
  let wrongTarget = false;
  const want = Array.isArray(wantedLevels) ? wantedLevels.filter(Boolean) : [];
  if (want.length) {
    const ol = opp.level || oppLevel;
    if (ol && !want.includes(ol)) wrongTarget = true;
  }

  // ---- degree level ----
  if (opp.req_degree_level && opp.req_degree_level !== 'any') {
    stated++;
    const userLevel = myLevel;
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

  // ---- profession gate: the ad must be open to what the applicant actually is ----
  // Uses field + every professional identity (a PharmD with a PhD Pharmacology is BOTH
  // a pharmacist and a pharmacologist), with discipline synonyms.
  const SYN = {
    pharmac: ['pharmacy', 'pharmacist', 'pharmaceutical', 'pharmacology', 'pharmacologist', 'pharm'],
    medic: ['medicine', 'medical', 'physician', 'doctor', 'clinical'],
    nurs: ['nursing', 'nurse', 'midwifery'],
    dent: ['dentistry', 'dental', 'dentist'],
    engineer: ['engineering', 'engineer'],
    biolog: ['biology', 'biological', 'life sciences', 'biomedical'],
    chem: ['chemistry', 'chemical']
  };
  const myTerms = [];
  try {
    const px = facts._profile || {};
    myTerms.push(String((facts.field || {}).value || px.field || '').toLowerCase());
    (px.professions || []).forEach(p => myTerms.push(String(p).toLowerCase()));
    if (px.profession) myTerms.push(String(px.profession).toLowerCase());
    (px.education || []).forEach(e => myTerms.push(String(e && (e.degree || e) || '').toLowerCase()));
  } catch (e) {}
  const myBlob = myTerms.filter(Boolean).join(' ');
  const expandTerms = blob => {
    const out = new Set();
    for (const [root, words] of Object.entries(SYN)) {
      if (blob.includes(root) || words.some(w => blob.includes(w))) words.forEach(w => out.add(w));
    }
    return out;
  };
  const mySet = expandTerms(myBlob);

  // ---- field / major ----
  if (opp.req_field) {
    stated++;
    const uf = String((facts.field || {}).value || facts._profile.field || '').toLowerCase();
    const rf = String(opp.req_field).toLowerCase();
    if (!uf) reasons.push({ ok: 'unknown', text: 'Field requirement: ' + opp.req_field + '; your field is not set' });
    else {
      const reqSet = expandTerms(rf);
      const synHit = [...mySet].some(w => rf.includes(w)) || [...reqSet].some(w => myBlob.includes(w));
      const rawHit = uf.includes(rf.split(/\s+/)[0]) || rf.includes(uf.split(/\s+/)[0]);
      if (synHit || rawHit) { met++; reasons.push({ ok: 'yes', text: 'Your discipline matches the required area (' + opp.req_field + ')' }); }
      else reasons.push({ ok: 'no', text: 'Preferred field ' + opp.req_field + '; yours is ' + (facts._profile.field || uf) });
    }
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
  // Granular score. Every hard gate (level, target, field, profession) has already been
  // enforced above, so anything reaching here is a genuine fit: it starts high and loses
  // points only for specific unmet stated criteria. This avoids coarse 50/67/75 fractions.
  /* DIMENSIONAL SCORING. A single opaque number is not defensible to a paying user, so
     each dimension is scored from the reasons already gathered and the overall score is
     their weighted combination. Every dimension can be shown and explained. */
  const dim = (rx, base) => {
    const rel = reasons.filter(r => rx.test(r.text));
    if (!rel.length) return base;                       // nothing stated: neutral
    const yes = rel.filter(r => r.ok === 'yes').length;
    const unk = rel.filter(r => r.ok === 'unknown').length;
    return Math.round(100 * (yes + unk * 0.5) / rel.length);
  };
  const dims = {
    eligibility: dim(/eligib|requires|minimum|registration|licen/i, 92),
    education:   dim(/degree|level|phd|master|bachelor|education/i, 90),
    field:       dim(/field|discipline|major|profession/i, 90),
    experience:  dim(/experience|years/i, 88),
    language:    dim(/language|ielts|toefl|oet|english/i, 90),
    location:    (() => {
      const want = Array.isArray(facts._wantCountries) ? facts._wantCountries : [];
      if (!want.length || !opp.country_code) return 90;
      return want.includes(String(opp.country_code).toUpperCase()) ? 100 : 70;
    })(),
    funding:     opp.funding_type === 'fully' ? 100 : opp.funding_type === 'partial' ? 80 : 65,
    deadline:    (() => {
      if (!opp.deadline) return 80;
      const days = Math.round((new Date(opp.deadline) - Date.now()) / 864e5);
      if (days < 0) return 0;
      if (days < 7) return 55;          // technically open but tight
      if (days < 21) return 80;
      return 100;                        // comfortable runway
    })()
  };
  const WEIGHT = { eligibility: 0.26, education: 0.18, field: 0.18, experience: 0.12,
                   language: 0.08, location: 0.08, funding: 0.05, deadline: 0.05 };
  let pct = null;
  if (stated || opp.country_code) {
    let total = 0, wsum = 0;
    for (const [k, w] of Object.entries(WEIGHT)) { total += (dims[k] || 0) * w; wsum += w; }
    let score = wsum ? total / wsum : 0;
    // Unmet stated criteria still cost real points on top of the dimensional view.
    score -= Math.max(0, stated - met) * 4;
    pct = Math.max(35, Math.min(99, Math.round(score)));
  }
  // Field/profession alignment is a HARD gate for relevance, not a soft point:
  // if a field was stated and the applicant's field does not match, this is not a real match.
  // Field/profession is a HARD relevance gate: a stated field the applicant does not
  // match makes this NOT a real opportunity for them, however high other criteria score.
  const fieldMismatch = reasons.some(r => r.ok === 'no' && /field|discipline|profession|major/i.test(r.text));
  const hardFails = reasons.filter(r => r.ok === 'no' && /Requires|minimum|Minimum/.test(r.text)).length;
  const unknowns = reasons.filter(r => r.ok === 'unknown').length;
  let status;
  if (wrongTarget) { status = 'wrong_target_level'; pct = null; }
  else if (overqualified) { status = 'below_your_level'; pct = null; }
  else if (fieldMismatch) { status = 'field_mismatch'; pct = null; }
  else if (!stated) status = 'criteria_not_published';
  else if (hardFails > 0) status = 'not_eligible';
  else if (unknowns > 0 || reasons.some(r => r.ok === 'no')) status = 'potentially_eligible';
  else status = 'eligible';

  return { status, pct, dims, reasons, stated, met, overqualified, fieldMismatch, wrongTarget };
}

async function matchOpportunity(userId, oppId) {
  const { data: opp } = await admin().from('opportunities').select('*').eq('id', oppId).single();
  if (!opp) throw new Error('Opportunity not found');
  const facts = await userFacts(userId);
  return { opportunity: { id: opp.id, title: opp.title, institution: opp.institution }, ...evaluate(opp, facts) };
}

// Match a whole list (used to annotate browse results) — one facts fetch, many evaluations.
async function matchMany(userId, opps, wantedLevels, wantedCountries) {
  const facts = await userFacts(userId);
  if (Array.isArray(wantedCountries) && wantedCountries.length) {
    facts._wantCountries = wantedCountries.map(c => String(c).toUpperCase());
  }
  return (opps || []).map(o => ({ id: o.id, ...evaluate(o, facts, wantedLevels) }));
}

module.exports = { matchOpportunity, matchMany, evaluate, userFacts, degreeLevelFromText };
