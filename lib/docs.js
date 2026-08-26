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
  blocks.push({ type: 'text', text: `Read these documents deeply. Extract ONLY facts literally present. Respond ONLY with JSON:
{"headline":"","field":"","methods":"comma separated real skills","education":[{"level":"","degree":"","institution":"","year":"","grade":""}],"publications":["full citation strings"],"experience":[{"role":"","org":"","years":""}],"licenses":[{"name":"","body":"","number":""}],"links":{"orcid":"","scholar":"","linkedin":""},"phone":"","referees":[{"name":"","title":"","institution":"","email":"","relationship":""}]}` });
  const txt = await callAI('doc_extract', blocks, { maxTokens: 2000, userId });
  const m = String(txt).match(/\{[\s\S]*\}/);
  const v = m ? JSON.parse(m[0]) : {};
  const { data: p } = await admin().from('profiles').select('*').eq('id', userId).single();
  const patch = {}; const filled = [];
  for (const k of ['headline', 'field', 'methods', 'phone']) if (v[k] && !(p[k] || '').trim()) { patch[k] = String(v[k]).slice(0, 400); filled.push(k); }
  for (const k of ['education', 'publications', 'experience', 'licenses']) if (Array.isArray(v[k]) && v[k].length && !((p[k] || []).length)) { patch[k] = v[k]; filled.push(k); }
  if (v.links && Object.values(v.links).some(Boolean) && !Object.values(p.links || {}).some(Boolean)) { patch.links = v.links; filled.push('links'); }
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
