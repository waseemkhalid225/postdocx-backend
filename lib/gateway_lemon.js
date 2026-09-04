// lib/gateway_lemon.js — Day 18 · Lemon Squeezy adapter (merchant of record; onboards founders in
// Pakistan). Same interface as the Stripe adapter: createCheckout, verifySignature, retrieveOrder.
// Needs LEMON_API_KEY, LEMON_STORE_ID, LEMON_WEBHOOK_SECRET and, per package, a variant id set
// in Admin → Settings (packages.tiers[].lemon_variant_id; agency.tiers[].lemon_variant_id).
const crypto = require('crypto');
const API = 'https://api.lemonsqueezy.com/v1';
function enabled() { return !!(process.env.LEMON_API_KEY && process.env.LEMON_STORE_ID); }
async function createCheckout({ variantId, email, usd, name, paymentId, userId, orgId, successUrl }) {
  if (!variantId) throw new Error('This package has no Lemon Squeezy variant id yet (Admin → Settings).');
  const body = { data: { type: 'checkouts', attributes: { checkout_data: { email: email || undefined, custom: { payment_id: paymentId, user_id: userId, org_id: orgId || '', credits: undefined } }, checkout_options: { embed: false }, product_options: { redirect_url: successUrl, receipt_button_text: 'Back to ForiForeign', name: name || undefined }, custom_price: usd ? Math.round(Number(usd) * 100) : undefined }, relationships: { store: { data: { type: 'stores', id: String(process.env.LEMON_STORE_ID) } }, variant: { data: { type: 'variants', id: String(variantId) } } } } };
  const r = await fetch(API + '/checkouts', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.LEMON_API_KEY, accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error((d.errors && d.errors[0] && d.errors[0].detail) || ('Lemon Squeezy ' + r.status));
  return { id: d.data.id, url: d.data.attributes.url };
}
function verifySignature(rawBody, header, secret) { if (!secret || !header) return false; const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex'); const h = String(header); return h.length === expected.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(expected)); }
/* Normalise a Lemon order into the shape settleCardPayment expects. */
function sessionFromEvent(evt) { const a = (evt.data && evt.data.attributes) || {}; const custom = (evt.meta && evt.meta.custom_data) || {}; return { id: 'lemon_' + (evt.data && evt.data.id), payment_status: (a.status === 'paid') ? 'paid' : a.status, client_reference_id: custom.payment_id, metadata: { payment_id: custom.payment_id, user_id: custom.user_id, org_id: custom.org_id || '', credits: String(custom.credits == null ? '' : custom.credits) } }; }
module.exports = { enabled, createCheckout, verifySignature, sessionFromEvent };
