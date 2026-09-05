// lib/vault.js — Phase 1 · Document Intelligence.
// Every upload is read: classified into a document type, its facts extracted, its dates
// found, its expiry judged, and its facts compared with the profile and the other documents.
// Then the vault can answer the only questions that matter: what is required, what exists,
// what is missing, what is expired, what does not match, what needs a human.
const { admin } = require('./supa');
const { callAI } = require('./router');
const { BUCKET } = require('./docs');

const DOC_TYPES = ['admission_letter', 'fee_receipt', 'passport', 'cnic', 'cv', 'degree', 'transcript', 'certificate', 'experience_letter', 'salary_slip', 'bank_statement', 'tax_document',
  'language_test', 'offer_letter', 'admission_letter', 'sop', 'lor', 'police_certificate', 'insurance', 'visa', 'contract', 'licence', 'publication', 'photo', 'marriage_certificate', 'birth_certificate', 'other'];
const SENSITIVE = new Set(['bank_statement', 'salary_slip', 'tax_document', 'visa', 'passport', 'cnic', 'police_certificate']);
// Validity rules that do not depend on any single country's page: conservative and stated.
const VALIDITY_MONTHS = { language_test: 24, police_certificate: 6, bank_statement: 3, salary_slip: 3, insurance: 12 };

/* What a lane or a visa route needs. Study/work lists are the platform-wide minimums;
   per-country visa lists are seeded conservatively and refined by the Visa Intelligence
   registry in Phase 3 (each entry there carries a source and a date). */
/* WHY and WHO for every document, so the applicant is never handed a list without a reason. */
const WHY = { cv: ['Your CV is how we match and prepare everything', 'ForiForeign'], passport: ['Identity for the visa and the institution', 'visa office / institution'], degree: ['Proof of the qualification the case is based on', 'institution / employer'], transcript: ['Grades and modules the institution assesses', 'institution'], experience_letter: ['Proof of the experience the role asks for', 'employer / visa office'], language_test: ['The route or programme sets a language level', 'institution / visa office'], lor: ['Referees the programme asks for', 'institution'], sop: ['The programme asks for a statement', 'institution'], publication: ['Strengthens research applications', 'institution'], licence: ['Regulated profession: registration is checked', 'regulator / employer'], certificate: ['Professional training the role names', 'employer'], photo: ['Visa application photo standard', 'visa office'], bank_statement: ['Proof of funds for the visa', 'visa office'], admission_letter: ['Closes the case and starts the visa', 'visa office'], police_certificate: ['Character requirement of the route', 'visa office'], insurance: ['Health cover the route requires', 'visa office'], tax_document: ['Income proof some routes require', 'visa office'] };
const CHECKLISTS = {
  discover: { required: ['cv'], recommended: [] },
  study:  { required: ['cv', 'passport', 'degree', 'transcript'], recommended: ['language_test', 'lor', 'sop', 'experience_letter', 'publication'] },
  work:   { required: ['cv', 'passport', 'degree', 'experience_letter'], recommended: ['licence', 'language_test', 'certificate', 'lor'] },
  visa:   { required: ['passport', 'photo', 'bank_statement', 'admission_letter'], recommended: ['police_certificate', 'insurance', 'language_test', 'tax_document'] },
  visa_work: { required: ['passport', 'photo', 'offer_letter', 'contract', 'degree'], recommended: ['police_certificate', 'experience_letter', 'language_test', 'insurance'] },
  family: { required: ['marriage_certificate', 'birth_certificate', 'passport'], recommended: ['bank_statement', 'insurance', 'photo'] }
};
const LABEL = { admission_letter: 'Admission / offer letter', fee_receipt: 'Tuition or deposit receipt', cv: 'CV', passport: 'Passport', cnic: 'CNIC / national ID', degree: 'Degree certificate', transcript: 'Transcript', certificate: 'Certificate', experience_letter: 'Experience letter',
  salary_slip: 'Salary slip', bank_statement: 'Bank statement', tax_document: 'Tax document', language_test: 'Language test result', offer_letter: 'Job offer letter', admission_letter: 'Admission / offer letter',
  sop: 'Statement of purpose', lor: 'Recommendation letter', police_certificate: 'Police character certificate', insurance: 'Insurance', visa: 'Visa', contract: 'Employment contract', licence: 'Professional licence', publication: 'Publication', photo: 'Passport-size photo', marriage_certificate: 'Marriage certificate (attested)', birth_certificate: 'Birth certificate (attested)', other: 'Other' };

function mapKind(kind) {
  const k = String(kind || '').toLowerCase();
  if (/cv|resume/.test(k)) return 'cv'; if (/transcript/.test(k)) return 'transcript'; if (/degree/.test(k)) return 'degree';
  if (/english|ielts|language/.test(k)) return 'language_test'; if (/passport/.test(k)) return 'passport'; if (/licen/.test(k)) return 'licence';
  if (/publication/.test(k)) return 'publication'; if (/reference|recommend/.test(k)) return 'lor'; if (/cert/.test(k)) return 'certificate';
  return null;
}

async function readDocument(docId, userId) {
  const { data: d } = await admin().from('documents').select('*').eq('id', docId).eq('user_id', userId).maybeSingle();
  if (!d) throw new Error('Document not found');
  await admin().from('documents').update({ doc_status: 'reading' }).eq('id', d.id);
  const { data: f, error } = await admin().storage.from(BUCKET).download(d.storage_key);
  if (error) { await admin().from('documents').update({ doc_status: 'failed', issues: [{ code: 'download', text: error.message }] }).eq('id', d.id); throw new Error(error.message); }
  const buf = Buffer.from(await f.arrayBuffer());
  const blocks = [];
  if (d.mime === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
  else if (/^image\//.test(d.mime || '')) blocks.push({ type: 'image', source: { type: 'base64', media_type: d.mime, data: buf.toString('base64') } });
  else { await admin().from('documents').update({ doc_status: 'needs_review', issues: [{ code: 'format', text: 'Only PDF and image files can be read automatically.' }] }).eq('id', d.id); return { ok: false, needs_review: true }; }
  blocks.push({ type: 'text', text: `You are a document-intelligence reader for an international study and work application platform.
Read the attached document and answer ONLY with JSON, no prose:
{"doc_type": one of ${JSON.stringify(DOC_TYPES)},
 "confidence": 0-1,
 "issue_date": "YYYY-MM-DD or null", "expiry_date": "YYYY-MM-DD or null", "attestation_status": "apostille|legalised|notarised|certified_copy|plain|unknown (look for stamps, seals, apostille certificates, notary or embassy marks)", "language": "ISO code of the document language",
 "fields": {"full_name": "", "date_of_birth": "YYYY-MM-DD or null", "nationality": "", "document_number": "", "issuing_authority": "",
            "institution": "", "degree": "", "field": "", "grade_or_cgpa": "", "graduation_date": "", "employer": "", "job_title": "", "from": "", "to": "",
            "test_name": "", "overall_score": "", "amount": "", "currency": "", "other": {}},
 "language": "en|ur|other", "legible": true, "notes": "one line: anything a human reviewer must know, e.g. stamp missing, page cut off"}
Rules: never invent a value; empty string or null when not visible. Dates in ISO. If the document is a CV, doc_type is "cv".` });
  let v = {};
  try {
    const txt = await callAI('doc_extract', blocks, { maxTokens: 1200, json: true, userId });
    const m = String(txt).match(/\{[\s\S]*\}/); v = m ? JSON.parse(m[0]) : {};
  } catch (e) {
    await admin().from('documents').update({ doc_status: 'needs_review', issues: [{ code: 'read', text: 'Could not be read automatically: ' + String(e.message).slice(0, 120) }] }).eq('id', d.id);
    return { ok: false, needs_review: true };
  }
  const doc_type = DOC_TYPES.includes(v.doc_type) ? v.doc_type : (mapKind(d.kind) || 'other');
  const issues = [];
  const iso = s => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s))) ? String(s) : null;
  let expiry = iso(v.expiry_date), issue = iso(v.issue_date);
  if (!expiry && issue && VALIDITY_MONTHS[doc_type]) { const dt = new Date(issue); dt.setMonth(dt.getMonth() + VALIDITY_MONTHS[doc_type]); expiry = dt.toISOString().slice(0, 10); issues.push({ code: 'expiry_inferred', text: 'Validity assumed ' + VALIDITY_MONTHS[doc_type] + ' months from issue; confirm with the destination\'s rule.' }); }
  const today = new Date().toISOString().slice(0, 10);
  let status = 'read';
  if (expiry && expiry < today) { status = 'expired'; issues.push({ code: 'expired', text: LABEL[doc_type] + ' expired on ' + expiry + '.' }); }
  else if (doc_type === 'passport' && expiry) { const six = new Date(); six.setMonth(six.getMonth() + 6); if (expiry < six.toISOString().slice(0, 10)) issues.push({ code: 'passport_short', text: 'Passport has under six months left; most visas require six months beyond travel.' }); }
  if (v.legible === false) { status = 'needs_review'; issues.push({ code: 'illegible', text: 'The scan is hard to read. Upload a clearer copy.' }); }
  if ((Number(v.confidence) || 0) < 0.5) { status = status === 'expired' ? status : 'needs_review'; issues.push({ code: 'low_confidence', text: 'The reader was not sure what this document is.' }); }
  if (v.notes) issues.push({ code: 'note', text: String(v.notes).slice(0, 200) });
  // Cross-check the name and date of birth against the profile and the passport.
  try {
    const { data: p } = await admin().from('profiles').select('full_name,date_of_birth').eq('id', userId).maybeSingle();
    const fn = String((v.fields || {}).full_name || '').trim().toLowerCase();
    const pn = String((p && p.full_name) || '').trim().toLowerCase();
    if (fn && pn && doc_type !== 'other') {
      const tok = s => new Set(s.replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 2));
      const a = tok(fn), b = tok(pn); const inter = [...a].filter(x => b.has(x)).length;
      if (inter === 0) issues.push({ code: 'name_mismatch', text: 'Name on this document ("' + (v.fields.full_name || '').slice(0, 60) + '") does not match the profile name.' });
    }
    const dob = iso((v.fields || {}).date_of_birth);
    if (dob && p && p.date_of_birth && String(p.date_of_birth).slice(0, 10) !== dob) issues.push({ code: 'dob_mismatch', text: 'Date of birth differs from the profile (' + dob + ' vs ' + String(p.date_of_birth).slice(0, 10) + ').' });
    if (dob && p && !p.date_of_birth && doc_type === 'passport') await admin().from('profiles').update({ date_of_birth: dob }).eq('id', userId).then(() => {}, () => {});
  } catch (e) {}
  if (issues.some(i => /mismatch/.test(i.code)) && status === 'read') status = 'needs_review';
  const patch = { attestation_status: ['apostille', 'legalised', 'notarised', 'certified_copy', 'plain', 'unknown'].includes(v.attestation_status) ? v.attestation_status : 'unknown', doc_type, extracted: Object.assign({}, v.fields || {}, v.language ? { language: v.language } : {}), expiry_date: expiry, issue_date: issue, doc_status: status, issues, confidence: Number(v.confidence) || null, read_at: new Date().toISOString(), sensitive: SENSITIVE.has(doc_type) };
  let { error: ue } = await admin().from('documents').update(patch).eq('id', d.id);
  if (ue) { delete patch.sensitive; delete patch.issue_date; await admin().from('documents').update(patch).eq('id', d.id); }
  try { if (['admission_letter', 'fee_receipt'].includes(doc_type)) require('./queue').enqueue('admission_evidence', { docId: d.id }, { userId, maxAttempts: 2 }).catch(() => {}); } catch (e) {}
  // Duplicate of the same type: keep the newest, mark the older one.
  try {
    const { data: same } = await admin().from('documents').select('id,created_at').eq('user_id', userId).eq('doc_type', doc_type).eq('generated', false).order('created_at', { ascending: false });
    if (same && same.length > 1 && ['passport', 'cnic', 'cv', 'language_test'].includes(doc_type)) {
      for (const s of same.slice(1)) await admin().from('documents').update({ issues: [{ code: 'superseded', text: 'A newer ' + LABEL[doc_type] + ' exists; this copy is kept for history.' }] }).eq('id', s.id);
    }
  } catch (e) {}
  return { ok: true, doc_type, status, expiry, issues };
}

async function vaultFor(userId) {
  const { data } = await admin().from('documents').select('id,name,kind,doc_type,doc_status,expiry_date,issue_date,issues,confidence,extracted,sensitive,attestation_status,compressed,created_at,read_at').eq('user_id', userId).is('superseded_at', null).eq('generated', false).order('created_at', { ascending: false });
  return (data || []).map(d => ({ ...d, doc_type: d.doc_type || mapKind(d.kind) || 'other', label: LABEL[d.doc_type || mapKind(d.kind) || 'other'] || 'Document' }));
}

/* The checklist engine: for a purpose (study | work | visa | visa_work) and optionally a
   position's own requirement list, what exists, what is missing, what is expired, what needs
   a human. Purely computed; never a guess. */
/* Which documents a specific posting asks for, read from its requirement text; conditional ones are labelled as such. */
function docsFromRequirements(text) { const t = String(text || '').toLowerCase(); const out = []; if (/ielts|toefl|pte|oet|duolingo|english (level|test)|b1|b2|c1|topik|jlpt|goethe|delf/.test(t)) out.push('language_test'); if (/reference|referee|recommendation/.test(t)) out.push('lor'); if (/statement of purpose|personal statement|motivation letter|cover letter|sop/.test(t)) out.push('sop'); if (/experience letter|years? of experience|work experience/.test(t)) out.push('experience_letter'); if (/registration|licen[cs]e|regulator|gmc|nmc|ahpra|dha|pmdc|hcpc/.test(t)) out.push('licence'); if (/transcript|marksheet|grade/.test(t)) out.push('transcript'); if (/portfolio/.test(t)) out.push('portfolio'); if (/publication|research output/.test(t)) out.push('publication'); if (/certificate|certification|training/.test(t)) out.push('certificate'); return [...new Set(out)].filter(k => DOC_TYPES.includes(k)); }
async function checklist(userId, purpose, extraRequired, ctx) {
  ctx = ctx || {}; if (ctx.requirements_text) extraRequired = [...(extraRequired || []), ...docsFromRequirements(ctx.requirements_text)];
  const docs = await vaultFor(userId);
  const base = CHECKLISTS[purpose] || CHECKLISTS.study;
  const required = [...new Set([...(base.required || []), ...((extraRequired || []).filter(k => DOC_TYPES.includes(k)))])];
  const today = new Date().toISOString().slice(0, 10);
  const byType = {};
  for (const d of docs) { if (!byType[d.doc_type] || (d.created_at > byType[d.doc_type].created_at)) byType[d.doc_type] = d; }
  const row = t => {
    const d = byType[t];
    if (!d) return { type: t, label: LABEL[t] || t, state: 'missing' };
    if (d.doc_status === 'expired' || (d.expiry_date && d.expiry_date < today)) return { type: t, label: LABEL[t] || t, state: 'expired', document_id: d.id, expiry_date: d.expiry_date };
    if (d.doc_status === 'needs_review' || d.doc_status === 'failed') return { type: t, label: LABEL[t] || t, state: 'review', document_id: d.id, issues: d.issues };
    if (!d.doc_status || d.doc_status === 'uploaded' || d.doc_status === 'reading') return { type: t, label: LABEL[t] || t, state: 'reading', document_id: d.id };   /* Phase 6 BUG-010: unread = awaiting verification, never 'verified' */
    return { type: t, label: LABEL[t] || t, state: 'ok', document_id: d.id, expiry_date: d.expiry_date };
  };
  const req = required.map(row).map(r => Object.assign(r, { why: (WHY[r.type] || [])[0] || null, who: (WHY[r.type] || [])[1] || null, requirement: 'required' })), rec = (base.recommended || []).map(row).map(r => Object.assign(r, { why: (WHY[r.type] || [])[0] || null, who: (WHY[r.type] || [])[1] || null, requirement: 'recommended' }));
  const ready = req.every(r => r.state === 'ok');
  return { purpose, ready, required: req, recommended: rec, missing: req.filter(r => r.state === 'missing').map(r => r.type), expired: req.filter(r => r.state === 'expired').map(r => r.type), review: req.filter(r => r.state === 'review').map(r => r.type) };
}

module.exports = { DOC_TYPES, LABEL, CHECKLISTS, SENSITIVE, WHY, docsFromRequirements, readDocument, vaultFor, checklist, mapKind };
