// lib/docs.js — private document storage (Supabase Storage) + AI profile extraction
const { admin } = require('./supa');
const { callAI } = require('./router');

const BUCKET = 'userdocs';
let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  try {
    const { data } = await admin().storage.getBucket(BUCKET);
    if (!data) await admin().storage.createBucket(BUCKET, { public: false, fileSizeLimit: 10 * 1024 * 1024 });
  } catch (e) { try { await admin().storage.createBucket(BUCKET, { public: false, fileSizeLimit: 10 * 1024 * 1024 }); } catch (_) {} }
  bucketReady = true;
}

function classify(name, mime) {
  const n = (name || '').toLowerCase();
  if (/cv|resume/.test(n)) return 'CV';
  if (/transcript|marksheet|dmc/.test(n)) return 'Transcript';
  if (/degree|sanad/.test(n)) return 'Degree';
  if (/cert/.test(n)) return 'Certificate';
  if (/ielts|toefl|pte|duolingo/.test(n)) return 'English test';
  if (/passport/.test(n)) return 'Passport';
  if (/license|pmc|pmdc|pharmacy council|nursing/.test(n)) return 'License';
  if (/paper|publication|article/.test(n)) return 'Publication';
  if (/reference|recommendation/.test(n)) return 'Reference letter';
  return 'Document';
}

async function saveUpload(userId, file, kindOverride) {
  await ensureBucket();
  // Compress large images before storing (faster upload/download, no meaningful quality loss for documents).
  if (/^image\//.test(file.mimetype || '') && file.size > 400 * 1024) {
    try {
      const sharp = require('sharp');
      const out = await sharp(file.buffer).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
      if (out && out.length < file.buffer.length) {
        file.buffer = out; file.mimetype = 'image/jpeg';
        file.originalname = (file.originalname || 'image').replace(/\.[^.]+$/, '') + '.jpg';
        file.size = out.length;
      }
    } catch (e) { /* sharp unavailable — store original */ }
  }
  const key = userId + '/' + Date.now() + '_' + (file.originalname || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
  const { error } = await admin().storage.from(BUCKET).upload(key, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw new Error('Storage: ' + error.message);
  const kind = kindOverride || classify(file.originalname, file.mimetype).toLowerCase().replace(/\s+/g, '_');
  const retention = new Date(); retention.setDate(retention.getDate() + 365); // default 1y, lifecycle engine later
  // Fingerprint the file so identical CVs across different accounts can be flagged for admin review.
  const contentHash = require('crypto').createHash('sha256').update(file.buffer).digest('hex');
  const row = {
    user_id: userId, kind: kind, name: file.originalname,
    storage_key: key, mime: file.mimetype, size_bytes: file.size,
    is_original: true, generated: false, retention_until: retention.toISOString().slice(0, 10),
    content_hash: contentHash
  };
  let { data, error: e2 } = await admin().from('documents').insert(row).select().single();
  if (e2 && /content_hash|column/.test(e2.message || '')) {
    delete row.content_hash; // migration 0010 not run yet: degrade gracefully
    ({ data, error: e2 } = await admin().from('documents').insert(row).select().single());
  }
  if (e2) throw new Error(e2.message);
  // Duplicate-CV check (best-effort, non-blocking): same hash under a DIFFERENT account
  // that already used its free case -> open an admin flag. Never auto-block the user.
  if (row.content_hash && /cv/.test(row.kind)) {
    (async () => {
      try {
        const { data: dups } = await admin().from('documents')
          .select('user_id').eq('content_hash', contentHash).neq('user_id', userId).limit(3);
        if (!dups || !dups.length) return;
        for (const dup of dups) {
          const { data: p } = await admin().from('profiles').select('free_case_used').eq('id', dup.user_id).single();
          if (p && p.free_case_used) {
            await admin().from('abuse_flags').insert({
              user_id: userId, matched_user_id: dup.user_id,
              reason: 'duplicate_cv', detail: 'Identical CV file hash to an account that used its free case.'
            });
            break;
          }
        }
      } catch (e) { /* flagging is advisory only */ }
    })();
  }
  return data;
}

async function signedUrl(storageKey, seconds = 300) {
  await ensureBucket();
  const { data, error } = await admin().storage.from(BUCKET).createSignedUrl(storageKey, seconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/* ---------- AI extraction: read stored documents, fill the profile truthfully ---------- */
async function extractProfile(userId, opts = {}) {
  const dry = !!opts.dry;
  const { data: docs } = await admin().from('documents').select('*').eq('user_id', userId).eq('generated', false).order('created_at', { ascending: false }).limit(6);
  if (!docs || !docs.length) throw new Error('Upload your CV first, then the agent reads it.');
  const order = k => /cv/.test(k) ? 0 : /transcript|degree/.test(k) ? 1 : 2;
  const picked = docs.sort((a, b) => order(a.kind) - order(b.kind)).slice(0, 3);
  const blocks = [];
  let budget = 6 * 1024 * 1024;
  for (const d of picked) {
    try {
      const { data: f, error } = await admin().storage.from(BUCKET).download(d.storage_key);
      if (error) continue;
      const buf = Buffer.from(await f.arrayBuffer());
      if (buf.length > 4 * 1024 * 1024 || buf.length > budget) continue;
      budget -= buf.length;
      if (d.mime === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
      else if (/^image\//.test(d.mime)) blocks.push({ type: 'image', source: { type: 'base64', media_type: d.mime, data: buf.toString('base64') } });
    } catch (e) {}
  }
  if (!blocks.length) throw new Error('Documents could not be read, upload a PDF CV.');
  blocks.push({ type: 'text', text: `Read these documents deeply and COMPLETELY: capture 100 percent of the CV, every education entry, position, publication with DOI if printed, certificate, training, workshop, license, skill, technique, award, membership, language and referee; do not summarize away detail. Extract ONLY facts literally present. Respond ONLY with JSON:
{"headline":"","field":"","profession":"broad profession e.g. Pharmacy, Medicine, Engineering","professions":["ALL professional identities from ALL degrees, e.g. a PharmD with PhD Pharmacology is BOTH Pharmacist and Pharmacologist; a BSN nurse with MPH is Nurse and Public Health Professional"],"methods":"comma separated real skills","total_experience_years":"","age":"","achievements":["awards, medals, distinctions"],"research_papers":[{"title":"","venue":"","year":"","doi":"","principal_investigator":"","funding_agency":""}],"awards":["awards, honours, distinctions verbatim"],"memberships":["professional bodies"],"skills_verbatim":["every skill and technique exactly as written"],"city":"","address":"","email":"","education":[{"level":"","degree":"","institution":"","city":"","year":"","grade":""}],"publications":["full citation strings"],"experience":[{"role":"","org":"","city":"","years":""}],"certifications":["named certifications"],"trainings":["named trainings, workshops, short courses"],"licenses":[{"name":"","body":"","number":""}],"links":{"orcid":"","scholar":"","linkedin":""},"phone":"","referees":[{"name":"","title":"","institution":"","email":"","relationship":""}]}` });
  const txt = await callAI('doc_extract', blocks, { maxTokens: 2000, json: true, userId });
  const m = String(txt).match(/\{[\s\S]*\}/);
  const v = m ? JSON.parse(m[0]) : {};
  const { data: p } = await admin().from('profiles').select('*').eq('id', userId).single();
  const patch = {}; const filled = [];
  for (const k of ['headline', 'field', 'methods', 'phone']) if (v[k] && !(p[k] || '').trim()) { patch[k] = String(v[k]).slice(0, 400); filled.push(k); }
  for (const k of ['education', 'publications', 'experience', 'licenses']) if (Array.isArray(v[k]) && v[k].length && !((p[k] || []).length)) { patch[k] = v[k]; filled.push(k); }
  if (v.links && Object.values(v.links).some(Boolean) && !Object.values(p.links || {}).some(Boolean)) { patch.links = v.links; filled.push('links'); }
  // STAGE 2 (premium): Claude Sonnet performs final deep normalization and
  // cross-document fact validation over the fast Flash extraction. Any failure
  // silently keeps the Flash result; the pipeline never depends on it.
  try {
    const { callAI } = require('./router');
    const normTxt = await callAI('profile_normalize',
      'You are validating an extracted applicant profile against source documents. EXTRACTED JSON:\n' + JSON.stringify(v).slice(0, 6000) +
      '\n\nDOCUMENTS PROVIDED: ' + picked.map(d => d.filename || d.kind).join('; ') +
      '\n\nTasks: fix casing and spelling of names/institutions; deduplicate; validate facts across documents and drop anything contradicted; compute total_experience_years and age when derivable; complete achievements and research_papers (title, venue, year) from the source; NEVER invent. Respond ONLY with the corrected JSON object, same schema.',
      { maxTokens: 2500, userId });
    const nv = JSON.parse(String(normTxt).replace(/```json|```/g, '').match(/\{[\s\S]*\}/)[0]);
    if (nv && typeof nv === 'object' && nv.headline !== undefined) Object.assign(v, nv);
  } catch (e) {}
  // Deep profile memory: the FULL extraction (every field, every document) is kept
  // per user and refreshed on every upload; the discovery agent reads it to match
  // by real qualifications, experience and stage.
  try { await admin().from('app_settings').upsert({ key: 'profilex:' + userId, value: { at: new Date().toISOString(), x: { profession: v.profession || '', professions: (v.professions || []).slice(0, 5), total_experience_years: v.total_experience_years || '', age: v.age || '', achievements: (v.achievements || []).slice(0, 12), research_papers: (v.research_papers || []).slice(0, 20), awards: (v.awards || []).slice(0, 15), memberships: (v.memberships || []).slice(0, 15), skills_verbatim: (v.skills_verbatim || []).slice(0, 40), city: v.city || '', address: v.address || '', email: v.email || '', certifications: (v.certifications || []).slice(0, 20), trainings: (v.trainings || []).slice(0, 20), education: (v.education || []).slice(0, 10), experience: (v.experience || []).slice(0, 12) } } }); } catch (e) {}
  // 12c: enrich papers with abstract + PI/funder from Crossref so the writer truly
  // understands the research. Network-guarded: silent on failure, pipeline unaffected
  // (runs in production; harmlessly skipped where outbound DNS is restricted).
  try {
    const papers = (v.research_papers || []).slice(0, 6);
    for (const pp of papers) {
      if (!pp || !pp.title || pp.abstract) continue;
      const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 6000);
      try {
        const r = await fetch('https://api.crossref.org/works?rows=1&query.bibliographic=' + encodeURIComponent(String(pp.title).slice(0, 200)),
          { headers: { 'User-Agent': 'ForiForeign/1.0 (mailto:admin@foriforeign.com)' }, signal: ctrl.signal });
        if (r.ok) {
          const d = await r.json();
          const it = d && d.message && d.message.items && d.message.items[0];
          if (it) {
            if (it.abstract) pp.abstract = String(it.abstract).replace(/<[^>]+>/g, '').slice(0, 700);
            if (!pp.doi && it.DOI) pp.doi = it.DOI;
            if (!pp.funding_agency && Array.isArray(it.funder) && it.funder.length) pp.funding_agency = it.funder.map(f => f.name).filter(Boolean).slice(0, 3).join('; ');
          }
        }
      } catch (e) {} finally { clearTimeout(tm); }
    }
  } catch (e) {}
  const proposedReferees = (v.referees || []).slice(0, 6).filter(r => r && r.name);
  // Preview mode (item 13): return the proposal for user review, commit nothing.
  if (dry) {
    return { preview: true, patch, filled, referees: proposedReferees, sources: (docs || []).map(d => ({ id: d.id, kind: d.kind, name: d.name })) };
  }
  if (Object.keys(patch).length) { patch.updated_at = new Date().toISOString(); await admin().from('profiles').update(patch).eq('id', userId); }
  let refsAdded = 0;
  for (const r of proposedReferees) {
    const { data: ex } = await admin().from('referees').select('id').eq('user_id', userId).eq('name', r.name).limit(1);
    if (ex && ex.length) continue;
    await admin().from('referees').insert({ user_id: userId, name: r.name, title: r.title || '', institution: r.institution || '', email: (r.email || '').toLowerCase(), relationship: r.relationship || '' });
    refsAdded++;
  }
  await admin().from('audit_log').insert({ actor: userId, event: 'AUTOFILL', detail: filled.join(',') + (refsAdded ? ' +' + refsAdded + ' referees' : '') });
  return { filled, refsAdded };
}

module.exports = { saveUpload, signedUrl, extractProfile, BUCKET };
