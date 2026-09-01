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
  /* The opportunity's own level. Most adverts never fill the level column, and when it
     was null every level gate below silently passed - which is how a PhD admission kept
     appearing in a postdoc search. The title says it plainly, so we read the title. */
  const levelFromText = t => {
    const x = String(t || '').toLowerCase();
    if (/post[\s-]?doc|postdoctoral/.test(x)) return 'postdoc';
    if (/\bphd\b|ph\.d|doctoral (position|student|programme|program)|doctorate|promotion student/.test(x)) return 'phd';
    if (/\bmaster|\bmsc\b|\bm\.sc|mphil|\bma\b programme/.test(x)) return 'masters';
    if (/bachelor|\bbsc\b|undergraduate/.test(x)) return 'bachelors';
    if (/fellowship/.test(x)) return 'fellowship';
    return null;
  };
  const oppLevel = (opp.level && LEVEL_RANK[opp.level]) ? opp.level
    : (opp.req_degree_level && opp.req_degree_level !== 'any' ? opp.req_degree_level
    : levelFromText([opp.title, opp.programme, opp.description].join(' ')));
  if (myLevel && oppLevel && LEVEL_RANK[oppLevel] < LEVEL_RANK[myLevel]) overqualified = true;
  /* Equal rank is also wrong when the opportunity is an ADMISSION. Someone who already
     holds a PhD does not apply for a PhD place; the old strict less-than let every PhD
     admission through to a PhD holder. Employment (postdoc, fellowship, work) is exempt,
     because a postdoc holder may of course take another postdoc. */
  const ADMISSION = ['bachelors', 'masters', 'phd', 'diploma', 'short_course'];
  if (myLevel && oppLevel && opp.kind !== 'work' && ADMISSION.includes(oppLevel)
      && LEVEL_RANK[oppLevel] <= LEVEL_RANK[myLevel]) overqualified = true;
  // TARGET-LEVEL GATE: if the user explicitly selected which levels they want
  // (e.g. postdoc), an opportunity at any other level is simply not what they asked for.
  let wrongTarget = false, levelUnknown = false, adjacentRole = false, adjacentEvidence = [];
  const want = Array.isArray(wantedLevels) ? wantedLevels.filter(Boolean) : [];
  if (want.length) {
    const ol = opp.level || oppLevel;
    if (ol && !want.includes(ol)) wrongTarget = true;
    /* A row whose level cannot be established is not the same thing as a row at the
       WRONG level, and treating them alike was dangerous: wrong-level is never relaxed
       by the caller, so on a database where most rows carry no level column a levelled
       search could reject every single row and show an empty screen. It is reported
       separately, and the caller drops these only while better matches remain. */
    if (!ol) levelUnknown = true;
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
  /* This map used to hold seven entries, four of them clinical. A software engineer, a
     lawyer, an accountant, a teacher, an architect, an economist and an agronomist all
     matched NOTHING here, so the profession gate never ran for them at all and they were
     shown whatever the scorer happened to like. The families now live in lib/domains.js
     and cover every field this platform serves. */
  const DOMAINS = require('./domains');
  const SYN = Object.fromEntries(Object.entries(DOMAINS.FAMILIES).map(([k, v]) => [k, v.syn]));
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

  /* PROFESSION GATE FOR JOBS. The field check below only fires when the advert filled in
     req_field, and most job postings do not. A pharmacist was therefore shown physician
     and nursing vacancies, because nothing in the pipeline ever compared the ROLE in the
     title against what the applicant actually is. Job titles name the profession plainly,
     so we read the title. Deliberately narrow: it fires only when the title names a
     different clinical profession, so "Pharmacist" still matches every branch of pharmacy
     (clinical, hospital, industrial, regulatory, pharmacology) exactly as it should. */
  if (opp.kind === 'work' && mySet.size) {
    /* Title-based family check, now across every field rather than four clinical ones.
       A title that names no recognised profession stays unjudged: unknown is not a
       mismatch, and treating it as one is how a legitimate posting disappears. */
    const titleFam = DOMAINS.familyOfTitle(opp.title);
    if (titleFam) {
      const mineFams = DOMAINS.familiesFor(myTerms);
      /* Related families are not mismatches. A sciences background genuinely covers
         many pharmacy and allied-health research posts, and an engineer covers much
         software work; the honest boundary is a LICENSED profession the applicant does
         not hold, which is what the check below protects. */
      const RELATED = {
        pharmacy: ['sciences'], sciences: ['pharmacy', 'agriculture', 'allied_health'],
        software: ['engineering'], engineering: ['software', 'architecture'],
        business: ['finance', 'media'], finance: ['business'], media: ['business'],
        social: ['education', 'sciences'], education: ['social', 'sciences'],
        allied_health: ['sciences'], agriculture: ['sciences']
      };
      const ok = mineFams.includes(titleFam)
        || mineFams.some(f => (RELATED[f] || []).includes(titleFam));
      /* THE CAPABILITY TEST. A different job title is not automatically a different job.
         Before rejecting, the applicant's own stated skills are compared with what the
         posting actually asks for: when several specific technical terms overlap, their
         skills genuinely cover the role and it is offered as ADJACENT - a step sideways,
         labelled as such - rather than thrown away. The one boundary that never moves is a
         LICENSED profession the applicant does not hold: a pharmacist's skills may overlap
         a physician post on paper, and it is still not a post they can be hired into. */
      /* The boundary is the licensed PRACTITIONER title, not the whole family. A
         "Compliance Officer" falls in the law family but needs no bar admission, and a
         pharmacist with audit and regulatory skills is a real candidate for it. A
         "Solicitor" is a different matter. */
      const LICENSED_TITLE = /\b(physician|doctor|surgeon|medical officer|registrar|consultant (physician|surgeon)|general practitioner|nurse|midwife|dentist|pharmacist|veterinar|solicitor|barrister|attorney|advocate|pilot|first officer|master mariner|deck officer|architect\b(?! technolog))/i;
      let coveredByskills = false;
      if (!ok && !LICENSED_TITLE.test(String(opp.title || ''))) {
        const px = facts._profile || {};
        const mySkills = new Set(
          [].concat(px.skills_verbatim || [], String(px.methods || '').split(/[,;]/), px.certifications || [])
            .map(s => String(s || '').toLowerCase().trim()).filter(s => s.length >= 4));
        const askBlob = [opp.title, opp.description, opp.req_field, (opp.req_documents || []).join(' ')].join(' ').toLowerCase();
        const GENERIC = /^(experience|communication|team|management|research|analysis|work|skills|degree|english|reporting|leadership|planning|development|support|knowledge|ability|strong|good|excellent)$/;
        let hits = 0; const hitTerms = [];
        for (const s of mySkills) {
          if (GENERIC.test(s)) continue;
          if (askBlob.includes(s)) { hits++; hitTerms.push(s); if (hits >= 6) break; }
        }
        if (hits >= 3) { coveredByskills = true; adjacentEvidence = hitTerms.slice(0, 4); }
      }
      if (!ok && !coveredByskills) {
        stated++;
        reasons.push({ ok: 'no', text: 'This is a ' + titleFam.replace(/_/g, ' ') + ' post; your profession is ' + (facts._profile.field || myTerms.filter(Boolean)[0] || 'a different field') });
      } else if (!ok && coveredByskills) {
        adjacentRole = true;
        reasons.push({ ok: 'yes', text: 'A different title from your usual role, but your stated skills cover what it asks for: ' + adjacentEvidence.join(', ') });
      }
    }
  }

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
  /* Weighting. Level, field and eligibility are already HARD gates, so everything that
     reaches scoring has passed them and scores almost identically on those dimensions.
     That left location, funding and deadline carrying only 18% between them, which made
     a perfect match and a wrong-country match look nearly the same. The discriminating
     factors now carry real weight, so the top result is genuinely the best one. */
  const WEIGHT = { eligibility: 0.20, education: 0.15, field: 0.15, experience: 0.10,
                   language: 0.07, location: 0.16, funding: 0.09, deadline: 0.08 };
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

  return { status, pct, dims, reasons, stated, met, overqualified, fieldMismatch, wrongTarget, levelUnknown, adjacentRole, adjacentEvidence };
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
