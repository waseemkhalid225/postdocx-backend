// lib/mailer.js — Day 24 · transactional email for notifications, via Resend (RESEND_API_KEY) or any
// SMTP-compatible HTTP relay you configure later. No key: nothing is sent, nothing breaks.
function enabled() { return !!process.env.RESEND_API_KEY; }
async function send(to, subject, html, brand) {
  if (!enabled() || !to) return { sent: false, reason: 'mail off' };
  /* A consultancy's client receives mail in the consultancy's name with the consultancy's own reply-to; the platform's name never appears. */
  const dom = (process.env.APPLY_DOMAIN || 'forimail.com'); const from = brand && brand.name ? (brand.name.replace(/[<>"]/g, '') + ' <no-reply@' + dom + '>') : (process.env.MAIL_FROM || ('ForiForeign <no-reply@' + dom + '>')); const replyTo = brand && brand.reply_to ? brand.reply_to : (process.env.MAIL_REPLY_TO || 'admin@foriforeign.com');
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject: String(subject).slice(0, 200), html }), signal: ctl.signal });
    clearTimeout(tm); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error((d && d.message) || ('Resend ' + r.status)); return { sent: true, id: d.id };
  } catch (e) { clearTimeout(tm); return { sent: false, reason: String(e.message).slice(0, 120) }; }
}
/* Raw send for the application mailbox: from an address on our domain, with attachments, on the user's tap. */
async function sendRaw({ from, to, subject, html, text, replyTo, cc, attachments, headers }) {
  if (!enabled() || !to) return { sent: false, reason: 'mail off' };
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [to], cc: cc ? [cc] : undefined, reply_to: replyTo || undefined, subject: String(subject || '').slice(0, 200), html, text, attachments: attachments && attachments.length ? attachments : undefined, headers: headers || undefined }), signal: ctl.signal });
    clearTimeout(tm); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error((d && d.message) || ('Resend ' + r.status)); return { sent: true, id: d.id };
  } catch (e) { clearTimeout(tm); return { sent: false, reason: String(e.message).slice(0, 120) }; }
}
function wrap(title, body, link, brand) {
  const b = brand || null; const host = b && b.domain ? 'https://' + b.domain : 'https://foriforeign.com'; const url = link ? host + '/app?go=' + encodeURIComponent(link) : host + '/';
  if (b && b.name) return '<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#0E1F42;color:#EAF2FF;padding:24px;border-radius:12px"><div style="font:800 20px Georgia,serif;margin-bottom:12px;color:' + esc(b.color || '#00D4FF') + '">' + esc(b.name) + '</div><h2 style="font:700 18px Inter,Arial;margin:0 0 10px;color:#fff">' + esc(title) + '</h2><div style="font-size:14px;line-height:1.6;color:#D6E9FF;white-space:pre-wrap">' + esc(body) + '</div><p style="margin-top:18px"><a href="' + url + '" style="background:' + esc(b.color || '#F5B841') + ';color:#0E1F42;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Open</a></p><p style="font-size:11px;color:#8FA9CE;margin-top:18px">Sent by ' + esc(b.name) + '. Turn email notifications off under Profile.</p></div>';
  return '<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#0E1F42;color:#EAF2FF;padding:24px;border-radius:12px"><div style="font:800 20px Georgia,serif;margin-bottom:12px">Fori<span style="color:#00D4FF">Foreign</span></div><h2 style="margin:0 0 8px;font-size:17px">' + esc(title) + '</h2><p style="color:#B4CDF0;line-height:1.55">' + esc(body || '') + '</p><a href="' + url + '" style="display:inline-block;margin-top:12px;padding:10px 16px;background:#F5B841;color:#0E1F42;font-weight:800;border-radius:8px;text-decoration:none">Open ForiForeign</a><p style="color:#8FA9CE;font-size:11px;margin-top:20px">You receive this because notifications by email are on in your profile. Turn them off under Profile → Language and data.</p></div>';
}
function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
async function brandFor(userId) { try { const { admin } = require('./supa'); const { data: cl } = await admin().from('clients').select('org_id').eq('user_id', userId).eq('status', 'active').limit(1); if (!cl || !cl[0]) return null; const { data: og } = await admin().from('organisations').select('name,kind,settings').eq('id', cl[0].org_id).maybeSingle(); if (!og || og.kind !== 'agency') return null; const { data: dm } = await admin().from('org_domains').select('domain').eq('org_id', cl[0].org_id).eq('status', 'active').limit(1); return { name: og.name, color: (og.settings || {}).brand_color || null, domain: dm && dm[0] ? dm[0].domain : null, reply_to: (og.settings || {}).contact_email || (og.settings || {}).email || null, phone: (og.settings || {}).phone || (og.settings || {}).whatsapp || null }; } catch (e) { return null; } }
module.exports = { brandFor, enabled, send, sendRaw, wrap };
