// lib/targeting.js - what this person could actually be hired or admitted as.
//
// THE GAP THIS CLOSES. The discovery agent used to receive one sentence about the
// applicant: profession, years, five certifications. Everything else the CV contained -
// the programme they ran, the software they use, the regulator they dealt with, the
// papers they wrote - was extracted, stored, and then never shown to the thing doing the
// searching. So the agent searched for the applicant's CURRENT JOB TITLE and nothing
// else, while a person reading the same CV would immediately see six or seven role
// families the applicant is qualified for.
//
// This module reads the deep profile once, decides what to search FOR, and caches it.
// It never decides what to ACCEPT - the eligibility gates in match.js still rule.

const { admin } = require('./supa');

const KEY = uid => 'targeting:' + uid;

/* A compact, faithful digest of the CV for the discovery prompt. Not a summary of the
   person - a summary of the EVIDENCE, in the applicant's own words wherever possible,
   because paraphrase is where the useful specifics disappear. */
function cvDigest(px, p) {
  const L = [];
  const take = (arr, n) => (Array.isArray(arr) ? arr : []).slice(0, n);
  const s = v => String(v == null ? '' : v).trim();
  if (px && px.headline) L.push('HEADLINE: ' + s(px.headline));
  else if (p && p.headline) L.push('HEADLINE: ' + s(p.headline));
  const edu = take((px && px.education) || (p && p.education), 6)
    .map(e => [s(e.degree), s(e.institution), s(e.year), s(e.grade) && ('grade ' + s(e.grade))].filter(Boolean).join(', '));
  if (edu.length) L.push('EDUCATION: ' + edu.join(' | '));
  const exp = take((px && px.experience) || (p && p.experience), 8)
    .map(e => [s(e.role), s(e.org), s(e.years)].filter(Boolean).join(', '));
  if (exp.length) L.push('EXPERIENCE: ' + exp.join(' | '));
  if (px && px.total_experience_years) L.push('TOTAL EXPERIENCE: ' + s(px.total_experience_years) + ' years');
  const skills = take((px && px.skills_verbatim), 30);
  if (skills.length) L.push('SKILLS AS WRITTEN: ' + skills.map(s).join('; '));
  else if ((px && px.methods) || (p && p.methods)) L.push('SKILLS: ' + s((px && px.methods) || p.methods));
  const pubs = take((px && px.research_papers), 8)
    .map(x => [s(x.title), s(x.venue), s(x.year)].filter(Boolean).join(', '))
    .concat(take((px && px.publications) || (p && p.publications), 8).map(x => typeof x === 'string' ? s(x) : s(x.title)));
  if (pubs.length) L.push('PUBLICATIONS: ' + [...new Set(pubs)].slice(0, 8).join(' | '));
  const certs = take((px && px.certifications), 10); if (certs.length) L.push('CERTIFICATIONS: ' + certs.map(s).join('; '));
  const tr = take((px && px.trainings), 8); if (tr.length) L.push('TRAININGS: ' + tr.map(s).join('; '));
  const lic = take((px && px.licenses) || (p && p.licenses), 4)
    .map(x => [s(x.name), s(x.body)].filter(Boolean).join(' - ')); if (lic.length) L.push('LICENCES: ' + lic.join('; '));
  const aw = take((px && px.awards) || (px && px.achievements), 6); if (aw.length) L.push('AWARDS: ' + aw.map(s).join('; '));
  const mem = take((px && px.memberships), 5); if (mem.length) L.push('MEMBERSHIPS: ' + mem.map(s).join('; '));
  return L.join('\n').slice(0, 4000);
}

/* Role families to search for. One AI call per profile change, cached, so it costs
   nothing per search. Adjacent roles are kept SEPARATE from direct ones: a pharmacist is
   qualified for pharmacovigilance and regulatory affairs, and is not a physician, and the
   difference has to survive into the results rather than being blurred away. */
async function buildTargeting(userId, px, p, force) {
  try {
    if (!force) {
      const { data } = await admin().from('app_settings').select('value').eq('key', KEY(userId)).single();
      if (data && data.value && data.value.roles && data.value.roles.length) return data.value;
    }
  } catch (e) {}
  const digest = cvDigest(px, p);
  if (!digest || digest.length < 40) return null;
  let out = null;
  try {
    const { callAI } = require('./router');
    const txt = await callAI('main',
      'Read this CV evidence and decide what this person could realistically be hired or admitted as. ' +
      'Think like an experienced recruiter who reads the whole CV, not like a keyword filter on the current job title.\n\n' + digest +
      '\n\nRespond ONLY with JSON:\n' +
      '{"direct_roles":["6 to 10 exact job or position titles this person is a straightforward fit for, as those titles are actually advertised"],' +
      '"adjacent_roles":["4 to 8 titles their stated skills genuinely cover although the title differs from their current one. Judge by whether the skills in the CV meet what the role asks for, in WHATEVER field this person works in - engineering, computing, law, finance, teaching, agriculture, design, media, health, the sciences or business. NEVER include a role requiring a licence or degree they do not hold: a pharmacist is not a physician, a paralegal is not a solicitor, a draughtsman is not a licensed architect, a bookkeeper is not a chartered accountant"],' +
      '"skill_roles":["3 to 6 roles that follow from a specific technical skill in the CV, naming the skill. The skill decides the role, whatever the field: Python and pandas to data analyst, AutoCAD and structural detailing to design engineer, IFRS and audit files to financial reporting analyst, curriculum design to instructional designer, GIS to spatial analyst, molecular docking to computational chemistry postdoc"],' +
      '"employer_types":["6 to 10 kinds of organisation that genuinely hire THIS person field, chosen for them: for example software houses, consultancies, banks, engineering contractors, construction firms, law firms, school groups, universities, research institutes, national regulators, UN agencies, INGOs, hospital groups, manufacturers, government departments"],' +
      '"research_themes":["3 to 6 research areas from their own publications and methods, for matching supervisors"],' +
      '"seniority":"entry, mid or senior, judged from real years and responsibility, not from a job title",' +
      '"blocked_roles":["roles they must NOT be shown because a licence or degree they lack is mandatory"]}',
      { maxTokens: 900, json: true, userId });
    const m = String(txt).replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    out = m ? JSON.parse(m[0]) : null;
  } catch (e) { return null; }
  if (!out) return null;
  const arr = (v, n) => (Array.isArray(v) ? v : []).map(x => String(x).slice(0, 90)).filter(Boolean).slice(0, n);
  const val = {
    direct_roles: arr(out.direct_roles, 10),
    adjacent_roles: arr(out.adjacent_roles, 8),
    skill_roles: arr(out.skill_roles, 6),
    employer_types: arr(out.employer_types, 10),
    research_themes: arr(out.research_themes, 6),
    blocked_roles: arr(out.blocked_roles, 8),
    seniority: ['entry', 'mid', 'senior'].includes(String(out.seniority || '').toLowerCase()) ? String(out.seniority).toLowerCase() : '',
    built_at: new Date().toISOString()
  };
  try { await admin().from('app_settings').upsert({ key: KEY(userId), value: val }); } catch (e) {}
  return val;
}
async function getTargeting(userId) {
  try {
    const { data } = await admin().from('app_settings').select('value').eq('key', KEY(userId)).single();
    return (data && data.value) || null;
  } catch (e) { return null; }
}
async function clearTargeting(userId) {
  try { await admin().from('app_settings').delete().eq('key', KEY(userId)); } catch (e) {}
}
module.exports = { cvDigest, buildTargeting, getTargeting, clearTargeting, KEY };
