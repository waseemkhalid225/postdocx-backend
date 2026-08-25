// lib/provenance.js — Phase 2: per-field extraction with source tracking,
// then cross-document merge that marks fields verified / conflicting.
// Never invents: every stored value traces to a document it was literally read from.
const { admin } = require('./supa');
const { callAI } = require('./router');
const { BUCKET } = require('./docs');

// Canonical fields we track with provenance. Scalar fields only here; list fields
// (education, publications) keep living in profiles as before.
const TRACKED = [
  { key: 'full_name', group: 'personal' },
  { key: 'date_of_birth', group: 'personal' },
  { key: 'phone', group: 'personal' },
  { key: 'nationality', group: 'personal' },
  { key: 'headline', group: 'general' },
  { key: 'field', group: 'general' },
  { key: 'highest_degree', group: 'education' },
  { key: 'highest_institution', group: 'education' },
  { key: 'graduation_year', group: 'education' },
  { key: 'cgpa', group: 'education' },
  { key: 'english_test', group: 'language' },
  { key: 'english_score', group: 'language' },
  { key: 'passport_number', group: 'identity' },
  { key: 'passport_expiry', group: 'identity' }
];
const TRACKED_KEYS = TRACKED.map(t => t.key);

function norm(v) {
  return String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
}
// loose equality so "3.72" == "3.72/4.00" and "MSc Physics" == "M.Sc. Physics" don't false-conflict
function sameish(a, b) {
  const clean = s => norm(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const na = clean(a), nb = clean(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // numeric leading match (cgpa/year): compare the first number, dots preserved for decimals
  const num = s => (norm(s).match(/[0-9]+(\.[0-9]+)?/) || [])[0];
  const fa = num(a), fb = num(b);
  if (fa && fb && fa === fb) return true;
  // containment for names/degrees
  return na.includes(nb) || nb.includes(na);
}

// Extract tracked fields from ONE document, returning {key:value} of only what's present.
async function extractOneDoc(doc) {
  const { data: f, error } = await admin().storage.from(BUCKET).download(doc.storage_key);
  if (error || !f) return {};
  const buf = Buffer.from(await f.arrayBuffer());
  if (buf.length > 4 * 1024 * 1024) return {}; // stay within model limits
  const block = doc.mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
    : /^image\//.test(doc.mime)
      ? { type: 'image', source: { type: 'base64', media_type: doc.mime, data: buf.toString('base64') } }
      : null;
  if (!block) return {};
  const prompt = [block, { type: 'text', text:
`Read this single document (type: ${doc.kind}). Extract ONLY the fields literally present. Do NOT guess or infer. Use empty string for anything not shown. Normalize dates to YYYY-MM-DD where possible. Respond ONLY with JSON:
{"full_name":"","date_of_birth":"","phone":"","nationality":"","headline":"","field":"","highest_degree":"","highest_institution":"","graduation_year":"","cgpa":"","english_test":"","english_score":"","passport_number":"","passport_expiry":""}` }];
  let out = {};
  try {
    const txt = await callAI('doc_extract', prompt, { maxTokens: 900, userId: doc.user_id });
    const m = String(txt).match(/\{[\s\S]*\}/);
    const v = m ? JSON.parse(m[0]) : {};
    for (const k of TRACKED_KEYS) if (norm(v[k])) out[k] = norm(v[k]);
  } catch (e) { /* skip unreadable doc */ }
  return out;
}

// Rebuild provenance for a user across all their documents.
// For each tracked field, collect the value each document reported, then decide status.
async function rebuildProvenance(userId) {
  const { data: docs } = await admin().from('documents')
    .select('*').eq('user_id', userId).eq('generated', false)
    .order('created_at', { ascending: false }).limit(8);
  if (!docs || !docs.length) return { fields: 0, note: 'No documents to read yet.' };

  // Parallel extraction: all documents are read simultaneously instead of one by one,
  // cutting total processing to roughly the slowest single document (~15-25s).
  const extractions = await Promise.all(docs.map(d => extractOneDoc(d).then(got => ({ d, got })).catch(() => ({ d, got: {} }))));
  // per-field: list of {document_id, name, value}
  const collected = {}; // key -> [{document_id,name,value}]
  for (const { d, got } of extractions) {
    for (const [k, val] of Object.entries(got)) {
      (collected[k] = collected[k] || []).push({ document_id: d.id, name: d.name, value: val });
    }
  }

  let written = 0, conflicts = 0;
  for (const t of TRACKED) {
    const hits = collected[t.key];
    if (!hits || !hits.length) continue;
    // group hits by value-equivalence
    const groups = [];
    for (const h of hits) {
      const g = groups.find(gr => sameish(gr.value, h.value));
      if (g) g.sources.push(h); else groups.push({ value: h.value, sources: [h] });
    }
    // pick the group with the most sources as the primary value
    groups.sort((a, b) => b.sources.length - a.sources.length);
    const primary = groups[0];
    let status, confidence;
    if (groups.length > 1) {
      status = 'conflicting'; confidence = 'low'; conflicts++;
    } else if (primary.sources.length >= 2) {
      status = 'verified'; confidence = 'high';
    } else {
      status = 'extracted'; confidence = 'medium';
    }
    // sources payload keeps every distinct value so the UI can show the discrepancy
    const sources = groups.flatMap(g => g.sources.map(s => ({ document_id: s.document_id, name: s.name, value: s.value })));
    await admin().from('profile_fields').upsert({
      user_id: userId, field_key: t.key, field_group: t.group,
      value: primary.value, status, confidence, sources,
      resolved: false, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,field_key' });
    written++;
  }
  await admin().from('audit_log').insert({ actor: userId, event: 'PROVENANCE_REBUILD', detail: written + ' fields, ' + conflicts + ' conflicts' }).then(() => {}, () => {});
  return { fields: written, conflicts };
}

async function listFields(userId) {
  const { data } = await admin().from('profile_fields').select('*').eq('user_id', userId).order('field_group');
  return data || [];
}

// User resolves a conflict by choosing one value (or typing their own).
async function resolveField(userId, fieldKey, chosenValue) {
  const val = norm(chosenValue);
  if (!val) throw new Error('Choose a value to resolve this field.');
  await admin().from('profile_fields').update({
    value: val, status: 'provided', confidence: 'high', resolved: true, updated_at: new Date().toISOString()
  }).eq('user_id', userId).eq('field_key', fieldKey);
  await admin().from('audit_log').insert({ actor: userId, event: 'FIELD_RESOLVED', detail: fieldKey + '=' + val.slice(0, 60) }).then(() => {}, () => {});
  return { ok: true };
}

module.exports = { rebuildProvenance, listFields, resolveField, TRACKED, TRACKED_KEYS, sameish };
