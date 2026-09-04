// lib/whatsapp.js — one sender for WhatsApp Business (Meta Cloud API). Used by presence notifications, reminders and the
// outbound queue. Numbers are normalised to E.164 without '+'; returns { sent, reason } and never throws.
async function brandPrefix(userId) { try { const b = await require('./mailer').brandFor(userId); return b && b.name ? b.name : 'ForiForeign'; } catch (e) { return 'ForiForeign'; } }
async function send(to, text) {
  const tok = process.env.WHATSAPP_TOKEN, pid = process.env.WHATSAPP_PHONE_ID; if (!tok || !pid) return { sent: false, reason: 'not configured' };
  const num = String(to || '').replace(/[^0-9]/g, '').replace(/^0+/, ''); if (num.length < 8) return { sent: false, reason: 'bad number' };
  try { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000); const r = await fetch('https://graph.facebook.com/v19.0/' + pid + '/messages', { method: 'POST', signal: ctl.signal, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: num, type: 'text', text: { body: String(text).slice(0, 1000) } }) }); clearTimeout(tm); const d = await r.json().catch(() => ({})); return r.ok ? { sent: true, id: d.messages && d.messages[0] && d.messages[0].id } : { sent: false, reason: (d.error && d.error.message) || ('HTTP ' + r.status) }; } catch (e) { return { sent: false, reason: e.message }; }
}
module.exports = { send, brandPrefix };
