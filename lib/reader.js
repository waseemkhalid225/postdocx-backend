// lib/reader.js — document reading: CV/degrees -> structured profile (autofill, referees)
const { admin } = require('./supa');
const { callAI } = require('./router');
const { parseJSON } = require('./engine');

async function ensureBucket() {
  try { await admin().storage.createBucket('documents', { public: false, fileSizeLimit: 10485760 }); } catch (e) {}
}

async function extractProfileFromDocs(userId) {
  const { data: docs } = await admin().from('documents').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(6);
  const pdfs = (docs || []).filter(d => /pdf/i.test(d.mime) && d.size_bytes <= 4 * 1024 * 1024).slice(0, 2);
  if (!pdfs.length) return { filled: [], note: 'No readable PDF under 4MB found' };
  const blocks = [];
  for (const d of pdfs) {
    const { data: file } = await admin().storage.from('documents').download(d.storage_key);
    if (!file) continue;
    const buf = Buffer.from(await file.arrayBuffer());
    blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
  }
  if (!blocks.length) return { filled: [], note: 'Could not read stored files' };
  blocks.push({ type: 'text', text: `Read these documents deeply. Extract the applicant's real details. Respond ONLY with JSON:
{"full_name":"","phone":"","whatsapp":"","date_of_birth":"YYYY-MM-DD","nationality":"","city":"","address":"","passport_number":"","national_id":"","marital_status":"","gender":"","linkedin":"","headline":"e.g. PhD Pharmacology or Registered Nurse","profession":"","field":"","degree_level":"matric|intermediate|diploma|bachelors|masters|mphil|phd|postdoc","highest_degree":"","highest_degree_year":"","last_institution":"","cgpa":"","methods":"comma separated core skills/techniques","skills":["..."],"languages":[{"language":"","level":"native|fluent|intermediate|basic"}],"language_tests":[{"test":"IELTS|TOEFL|PTE|OET|Duolingo|TOPIK|JLPT|Goethe","score":"","year":""}],"education":[{"degree":"","institution":"","country":"","start_year":"","year":"","grade":"","major":""}],"experience":[{"role":"","org":"","country":"","start":"YYYY-MM","end":"YYYY-MM or present","years":"","duties":""}],"total_experience_years":0,"certifications":[{"name":"","issuer":"","year":""}],"licenses":[{"name":"","authority":"","number":"","valid_to":""}],"publications":["full citation strings"],"awards":["..."],"memberships":["..."],"projects":["..."],"volunteering":["..."],"driving_licence":"","current_salary":"","current_employer":"","notice_period":"","target_countries":["ISO2"],"summary":"two-line professional summary in the applicant's own words","referees":[{"name":"","title":"","institution":"","email":"","phone":""}]}
Only facts literally present in the documents. Empty string/array/0 where absent. Do not invent years. Never use the email address in the CV for anything; ignore it.` });
  const txt = await callAI('doc_extract', blocks, { maxTokens: 1800, json: true, userId });
  const v = parseJSON(txt) || {};
  const { data: p } = await admin().from('profiles').select('*').eq('id', userId).single();
  const patch = {}; const filled = [];
  for (const k of ['full_name', 'phone', 'whatsapp', 'headline', 'profession', 'field', 'methods', 'nationality', 'city', 'address', 'linkedin', 'cgpa', 'last_institution', 'degree_level', 'national_id', 'passport_number']) {
    if (v[k] && (!p[k] || String(p[k]).length < 3)) { patch[k] = String(v[k]).slice(0, 300); filled.push(k); }
  }
  if (v.date_of_birth && /^\d{4}-\d{2}-\d{2}$/.test(v.date_of_birth) && !p.date_of_birth) { patch.date_of_birth = v.date_of_birth; filled.push('date_of_birth'); }
  for (const k of ['education', 'publications', 'experience', 'licenses', 'skills', 'certifications', 'language_tests', 'awards', 'memberships', 'projects', 'volunteering']) {
    if (Array.isArray(v[k]) && v[k].length && (!Array.isArray(p[k]) || !p[k].length)) { patch[k] = v[k].slice(0, 40); filled.push(k); }
  }
  /* Totals computed, not trusted: years of experience from the dated roles; the highest degree and its year from the education list. */
  try { const yrs = (v.experience || []).reduce((a, e) => { const s0 = parseInt(String(e.start || '').slice(0, 4)), e0 = /present|current|now/i.test(String(e.end || '')) ? new Date().getFullYear() : parseInt(String(e.end || '').slice(0, 4)); if (s0 && e0 && e0 >= s0) return a + (e0 - s0) + (String(e.end || '').length >= 7 && String(e.start || '').length >= 7 ? (parseInt(String(e.end).slice(5, 7)) - parseInt(String(e.start).slice(5, 7))) / 12 : 0); const y = parseFloat(e.years); return a + (isFinite(y) ? y : 0); }, 0); const total = Math.round(Math.max(yrs, Number(v.total_experience_years) || 0) * 10) / 10; if (total > 0 && !(Number(p.experience_years) > 0)) { patch.experience_years = total; patch.total_experience_years = total; filled.push('experience_years'); } } catch (e) {}
  try { const order = ['postdoc', 'phd', 'mphil', 'masters', 'bachelors', 'diploma', 'intermediate', 'matric']; const lvl = d => { const t = String(d.degree || '').toLowerCase(); return /post-?doc/.test(t) ? 'postdoc' : /ph\.?d|doctor/.test(t) ? 'phd' : /m\.?phil/.test(t) ? 'mphil' : /master|msc|ma\b|mba|m\.?s\b|pharm-?d|md\b|mbbs/.test(t) ? 'masters' : /bachelor|bsc|ba\b|bs\b|b\.?e\b|b\.?tech|llb|bds/.test(t) ? 'bachelors' : /diploma|dae|associate/.test(t) ? 'diploma' : /intermediate|hssc|a-?level|fsc|fa\b/.test(t) ? 'intermediate' : /matric|ssc|o-?level/.test(t) ? 'matric' : ''; }; const ed = (v.education || []).map(d => ({ d, l: lvl(d) })).filter(x => x.l).sort((a, b) => order.indexOf(a.l) - order.indexOf(b.l)); if (ed.length) { const top = ed[0]; if (!p.degree_level || !order.includes(String(p.degree_level))) { patch.degree_level = top.l; filled.push('degree_level'); } if (!p.degree && top.d.degree) { patch.degree = String(top.d.degree).slice(0, 120); filled.push('degree'); } if (top.d.year && !p.highest_degree_year) { patch.highest_degree_year = String(top.d.year).slice(0, 4); filled.push('highest_degree_year'); } } } catch (e) {}
  if (Object.keys(patch).length) await admin().from('profiles').update(patch).eq('id', userId);
  let refsAdded = 0;
  for (const r of (v.referees || []).slice(0, 5)) {
    if (!r.name) continue;
    const { data: ex } = await admin().from('referees').select('id').eq('user_id', userId).eq('name', r.name).limit(1);
    if (ex && ex.length) continue;
    await admin().from('referees').insert({ user_id: userId, name: r.name, title: r.title || '', institution: r.institution || '', email: (r.email || '').toLowerCase(), phone: r.phone || '' });
    refsAdded++;
  }
  await admin().from('audit_log').insert({ actor: userId, event: 'AUTOFILL', detail: filled.join(',') + (refsAdded ? ' +' + refsAdded + ' referees' : '') });
  return { filled, refsAdded };
}
module.exports = { extractProfileFromDocs, ensureBucket };
