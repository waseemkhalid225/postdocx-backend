// lib/consent.js — every consent the platform relies on is written to a ledger with the exact wording shown, its hash,
// the legal version, the person's IP, user agent and locale, and the evidence ids. Retrievable by the person, producible
// by the platform admin as a signed PDF. Nothing is hidden from the person: they can read every entry any time.
const crypto = require('crypto'); const { admin } = require('./supa');
const WORDING = {
  terms: 'I have read and accept the ForiForeign Terms of Service and Privacy Policy (version {v}). ForiForeign provides information, preparation and coordination; it is not a law firm or immigration adviser. I apply in my own name.',
  mailbox: 'I ask ForiForeign to create and operate an email address for me on its domain, to receive, store and read mail sent to it in order to run my applications, and to show it to me in the app. I can pause reading, copy mail to my own address, export or close the mailbox at any time.',
  portal_watch: 'I own the account on {portal} and I authorise ForiForeign to sign in as me on a schedule to read my status within the scope "{scope}" and nothing beyond it. I can disconnect at any time, which deletes the stored password.',
  consultant_acting: 'I authorise {consultant} of {org} to act for me on the ForiForeign platform within the scope "{scope}", to see my documents and correspondence for my cases, and to submit on my behalf only where they hold a verified registered-agent licence.',
  share_with_partner: 'I consent to {org} seeing my name, contact details and the file I submitted for this application. I can withdraw this consent, after which they see only an anonymised record.',
  package_purchase: 'I am buying the {name} package for USD {amount}: preparation and sending of {credits} cases, including the first offer pack, visa desk file, interview pack and arrival pack. Unused cases are refundable within 14 days; prepared cases are not.',
  addon_purchase: 'I am buying the {name} add-on for USD {amount}. It is delivered digitally and immediately; it is refundable only if not yet used.',
  agency_plan: 'On behalf of {org} I am subscribing to the {name} agency plan for USD {amount} per month, renewed monthly by card until cancelled, with {cases} prepared cases per month.',
  refund_policy: 'I understand the refund policy: unused case credits are refundable within 14 days; add-ons and prepared cases are not; card refunds return by the original method.',
  data_export: 'I requested a full export of my data.',
  account_deletion: 'I requested deletion of my account and data; deletion completes within 30 days unless a legal retention applies.',
  mou_countersign: 'I confirm that the MOU with {org} was countersigned by an authorised signatory and is in force from {from}.'
};
function render(kind, vars) { let w = WORDING[kind] || kind; for (const [k, v] of Object.entries(vars || {})) w = w.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v)); return w; }
async function record(req, userId, kind, vars, evidence) {
  try { const cfg = await require('./settings').getConfig(); const version = String(((cfg.legal || {}).versions || {})[kind] || (cfg.legal || {}).version || '2026-09-05'); const wording = render(kind, Object.assign({ v: version }, vars || {})); const hash = crypto.createHash('sha256').update(wording).digest('hex');
    const ip = req ? String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() : null; const ua = req ? String(req.headers['user-agent'] || '').slice(0, 300) : null; const locale = req ? String(req.headers['accept-language'] || '').slice(0, 40) : null;
    const { data } = await admin().from('consent_ledger').insert({ user_id: userId, kind, version, text_hash: hash, wording, evidence: evidence || {}, ip, user_agent: ua, locale }).select('id').single(); return data && data.id; } catch (e) { return null; }
}
async function list(userId) { const { data } = await admin().from('consent_ledger').select('id,kind,version,text_hash,wording,evidence,recorded_at,ip').eq('user_id', userId).order('recorded_at', { ascending: false }).limit(500); return data || []; }
async function producePdf(userId, adminName) {
  const PDFDocument = require('pdfkit'); const rows = await list(userId); const { data: p } = await admin().from('profiles').select('full_name,email,apply_email').eq('id', userId).maybeSingle();
  return new Promise((resolve, reject) => { const doc = new PDFDocument({ margin: 50 }); const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.fontSize(14).text('ForiForeign — Consent record'); doc.fontSize(9).fillColor('#444').text('Person: ' + ((p && p.full_name) || userId) + ' · ' + ((p && p.email) || '') + ' · ' + ((p && p.apply_email) || '')); doc.text('Produced ' + new Date().toISOString() + (adminName ? ' by ' + adminName : '') + ' · ' + rows.length + ' entries · each entry carries the exact wording shown, its SHA-256, version, IP and user agent at the time.'); doc.moveDown();
    for (const r of rows) { doc.fillColor('#000').fontSize(10).text(String(r.recorded_at).slice(0, 19).replace('T', ' ') + ' UTC · ' + r.kind + ' · v' + r.version); doc.fontSize(9).fillColor('#222').text(r.wording); doc.fillColor('#666').fontSize(7.5).text('sha256 ' + r.text_hash + ' · ip ' + (r.ip || '-') + ' · evidence ' + JSON.stringify(r.evidence || {}).slice(0, 200)); doc.moveDown(0.6); }
    const all = crypto.createHash('sha256').update(rows.map(r => r.text_hash).join('|')).digest('hex'); doc.moveDown(); doc.fillColor('#000').fontSize(8).text('Record hash: ' + all + ' · Verify against the ledger at any time.'); doc.end(); });
}
module.exports = { WORDING, render, record, list, producePdf };
