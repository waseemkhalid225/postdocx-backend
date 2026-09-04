// lib/mobility.js — Phase 1 · the Global Mobility Profile.
// One structured profile, entered once, reused by discovery, matching, preparation, visa
// and settlement. Every field remembers where it came from (cv | document | user |
// consultant), so the platform can say "verified" only when it is.
const { admin } = require('./supa');

const SECTIONS = {
  identity:     ['given_name', 'family_name', 'date_of_birth', 'gender', 'nationality', 'second_nationality', 'country_of_residence', 'city', 'passport_number', 'passport_expiry', 'cnic'],
  education:    ['highest_level', 'field', 'institution', 'graduation_year', 'grade', 'grade_scale', 'thesis_title'],
  work:         ['occupation', 'occupation_code', 'years_experience', 'current_employer', 'current_title', 'current_salary_pkr', 'licence_body', 'licence_number', 'skills'],
  language:     ['test_name', 'overall_score', 'test_date', 'other_languages'],
  finance:      ['budget_pkr_per_year', 'funding_source', 'sponsor_relation', 'can_show_bank_statement', 'needs_loan'],
  family:       ['marital_status', 'dependants', 'spouse_travelling', 'children_ages'],
  preferences:  ['lane', 'target_countries', 'excluded_countries', 'earliest_start', 'target_level', 'remote_ok', 'min_salary_pkr', 'pr_priority'],
  goals:        ['study_goal', 'job_goal', 'pr_goal', 'career_change'],
  history:      ['visa_refusals', 'previous_visas', 'countries_lived', 'travel_history_consent'],
  risk:         ['study_gap_years', 'employment_gap_months', 'criminal_record_declared', 'medical_conditions_declared']
};
const ALL_FIELDS = Object.values(SECTIONS).flat();
const REQUIRED_FOR_MATCH = ['nationality', 'highest_level', 'field', 'lane', 'target_countries', 'budget_pkr_per_year', 'funding_source'];

function sanitize(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.slice(0, 40).map(x => typeof x === 'string' ? x.slice(0, 120) : x);
  if (typeof v === 'object') return JSON.parse(JSON.stringify(v)).constructor === Object ? v : null;
  if (typeof v === 'string') return v.slice(0, 500);
  return v;
}

async function get(userId) {
  const { data: p } = await admin().from('profiles').select('mobility,mobility_provenance,mobility_updated_at,consent_vault_sensitive,full_name,nationality,field,total_experience_years,date_of_birth,city,passport_number,national_id,license_number,license_authority,profession,mobility_enc').eq('id', userId).maybeSingle();
  const m = Object.assign({}, (p && p.mobility) || {});
  // Day 10: sensitive identifiers live encrypted in mobility_enc; decrypt for the owner's own view.
  try { const C = require('./crypto'); for (const k of C.SENSITIVE_FIELDS) { const enc = p && p.mobility_enc && p.mobility_enc[k]; if (enc) { const v = C.decrypt(enc); if (v != null) m[k] = v; } } } catch (e) {}
  const prov = Object.assign({}, (p && p.mobility_provenance) || {});
  // Seed from what the CV reader already extracted, marked as such; the user's own entry wins.
  const seed = { nationality: p && p.nationality, field: p && p.field, years_experience: p && p.total_experience_years, date_of_birth: p && p.date_of_birth,
    city: p && p.city, passport_number: p && p.passport_number, cnic: p && p.national_id, licence_number: p && p.license_number, licence_body: p && p.license_authority, occupation: p && p.profession };
  for (const [k, v] of Object.entries(seed)) if ((m[k] == null || m[k] === '') && v != null && v !== '') { m[k] = v; prov[k] = prov[k] || 'cv'; }
  const filled = REQUIRED_FOR_MATCH.filter(k => m[k] != null && m[k] !== '' && !(Array.isArray(m[k]) && !m[k].length));
  return { profile: m, provenance: prov, sections: SECTIONS, required_for_match: REQUIRED_FOR_MATCH, missing_for_match: REQUIRED_FOR_MATCH.filter(k => !filled.includes(k)),
    completeness: Math.round(100 * ALL_FIELDS.filter(k => m[k] != null && m[k] !== '' && !(Array.isArray(m[k]) && !m[k].length)).length / ALL_FIELDS.length),
    consent_vault_sensitive: !!(p && p.consent_vault_sensitive), updated_at: p && p.mobility_updated_at };
}

async function update(userId, patch, source) {
  const src = ['user', 'consultant', 'document', 'cv'].includes(source) ? source : 'user';
  const cur = await get(userId);
  const m = Object.assign({}, cur.profile), prov = Object.assign({}, cur.provenance);
  let changed = 0;
  for (const [k, v] of Object.entries(patch || {})) {
    if (!ALL_FIELDS.includes(k)) continue;
    let sv = sanitize(v);
    // Identifier formats by origin: Pakistan CNIC 13 digits (12345-1234567-1), Indian PAN / Aadhaar 12 digits, BD NID 10/13/17 digits.
    if (k === 'cnic' && typeof sv === 'string' && sv) { const d = sv.replace(/[^0-9A-Za-z]/g, ''); if (/^\d{13}$/.test(d)) sv = d.slice(0, 5) + '-' + d.slice(5, 12) + '-' + d.slice(12); else if (!(/^[A-Z]{5}\d{4}[A-Z]$/i.test(d) || /^\d{10}$|^\d{12}$|^\d{17}$/.test(d))) throw new Error('National ID format not recognised (CNIC 13 digits, PAN, Aadhaar 12 digits, or NID).'); }
    if (k === 'passport_number' && typeof sv === 'string' && sv) { sv = sv.toUpperCase().replace(/\s+/g, ''); if (!/^[A-Z0-9]{6,12}$/.test(sv)) throw new Error('Passport number should be 6-12 letters and digits.'); }
    if (JSON.stringify(sv) === JSON.stringify(m[k])) continue;
    m[k] = sv; prov[k] = src; changed++;
  }
  const upd = { mobility: m, mobility_provenance: prov, mobility_updated_at: new Date().toISOString() };
  try { const C = require('./crypto'); if (C.enabled()) { const enc = {}; for (const k of C.SENSITIVE_FIELDS) if (m[k]) { enc[k] = C.encrypt(m[k]); m[k] = C.mask(m[k]); } upd.mobility_enc = enc; upd.mobility = m; } } catch (e) {}
  if (typeof (patch || {}).consent_vault_sensitive === 'boolean') upd.consent_vault_sensitive = patch.consent_vault_sensitive;
  const { error } = await admin().from('profiles').update(upd).eq('id', userId);
  if (error) throw new Error(error.message);
  return { changed, ...(await get(userId)) };
}

module.exports = { SECTIONS, ALL_FIELDS, REQUIRED_FOR_MATCH, get, update };
