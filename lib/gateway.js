// lib/gateway.js — international card payments, USD-first, for every user in every country.
// Provider: Stripe Checkout (Visa, Mastercard, Apple/Google Pay, and local methods Stripe
// enables per market). No SDK: two HTTPS calls and one HMAC. The bank-transfer screenshot
// flow stays as the fallback so nobody is locked out where cards fail.
const crypto = require('crypto');
const { admin } = require('./supa');

const STRIPE = 'https://api.stripe.com/v1';
function enabled() { return !!process.env.STRIPE_SECRET_KEY; }
function form(obj, prefix) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) out.push(form(v, key));
    else if (Array.isArray(v)) v.forEach((x, i) => out.push(typeof x === 'object' ? form(x, key + '[' + i + ']') : encodeURIComponent(key + '[' + i + ']') + '=' + encodeURIComponent(x)));
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return out.filter(Boolean).join('&');
}
async function stripe(path, body) {
  const r = await fetch(STRIPE + path, { method: 'POST', headers: { authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: form(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || ('Stripe ' + r.status));
  return d;
}

/* Create a Checkout session for a package. `usd` is the exact amount the quote showed. */
async function createCheckout({ userId, email, credits, usd, name, successUrl, cancelUrl, paymentId, orgId }) {
  const cents = Math.round(Number(usd) * 100);
  if (!(cents > 0)) throw new Error('Amount must be positive');
  return stripe('/checkout/sessions', {
    mode: 'payment',
    success_url: successUrl, cancel_url: cancelUrl,
    customer_email: email || undefined,
    client_reference_id: paymentId,
    metadata: { user_id: userId, payment_id: paymentId, credits: String(credits), org_id: orgId || '' },
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: 'ForiForeign ' + (name || 'package') + ' - ' + credits + ' case' + (credits === 1 ? '' : 's') } } }],
    payment_intent_data: { metadata: { user_id: userId, payment_id: paymentId } }
  });
}

/* Verify Stripe-Signature (t=..., v1=...) against the raw body. Tolerance 5 minutes. */
function verifySignature(rawBody, header, secret) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map(p => p.split('=')).map(([k, v]) => [k, v]));
  const t = parts.t, sigs = String(header).split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
  return sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

/* Confirm a session server-side (return page or webhook) and hand back the payment id. */
async function retrieveSession(id) {
  const r = await fetch(STRIPE + '/checkout/sessions/' + encodeURIComponent(id), { headers: { authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || ('Stripe ' + r.status));
  return d;
}

module.exports = { enabled, createCheckout, verifySignature, retrieveSession };
