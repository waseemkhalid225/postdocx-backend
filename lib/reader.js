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
{"full_name":"","phone":"","headline":"e.g. PhD Pharmacology or Registered Nurse","field":"","methods":"comma separated core skills/techniques","education":[{"degree":"","institution":"","year":"","grade":""}],"publications":["full citation strings"],"experience":[{"role":"","org":"","years":""}],"referees":[{"name":"","title":"","institution":"","email":"","phone":""}]}
Only facts literally present in the documents. Empty string/array where absent.` });
  const txt = await callAI('search_verify', blocks, { maxTokens: 1800, userId });
  const v = parseJSON(txt) || {};
  const { data: p } = await admin().from('profiles').select('*').eq('id', userId).single();
  const patch = {}; const filled = [];
  for (const k of ['full_name', 'phone', 'headline', 'field', 'methods']) {
    if (v[k] && (!p[k] || p[k].length < 3)) { patch[k] = String(v[k]).slice(0, 300); filled.push(k); }
  }
  for (const k of ['education', 'publications', 'experience']) {
    if (Array.isArray(v[k]) && v[k].length && (!Array.isArray(p[k]) || !p[k].length)) { patch[k] = v[k].slice(0, 25); filled.push(k); }
  }
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
