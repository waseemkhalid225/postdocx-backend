// lib/gateway_paddle.js — Paddle Billing as a second merchant-of-record option (accepts sellers in more countries than
// Stripe; pays out by wire). Checkout opens with a client-side token and a price id; the webhook is verified with the
// Paddle-Signature header (ts + ':' + raw body, HMAC-SHA256 with the endpoint secret).
const crypto = require('crypto');
function enabled() { return !!(process.env.PADDLE_API_KEY && process.env.PADDLE_CLIENT_TOKEN); }
async function createTransaction({ priceId, email, usd, name, paymentId, userId, successUrl }) {
  const base = process.env.PADDLE_ENV === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
  const body = { items: [priceId ? { price_id: priceId, quantity: 1 } : { quantity: 1, price: { description: name, name, unit_price: { amount: String(Math.round(usd * 100)), currency_code: 'USD' }, product: { name, tax_category: 'standard' } } }], customer: email ? { email } : undefined, custom_data: { payment_id: paymentId, user_id: userId }, checkout: { url: successUrl } };
  const r = await fetch(base + '/transactions', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.PADDLE_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error('Paddle: ' + JSON.stringify(d.error || d).slice(0, 200));
  return { id: d.data.id, url: (d.data.checkout && d.data.checkout.url) || null, client_token: process.env.PADDLE_CLIENT_TOKEN };
}
function verify(rawBody, sigHeader) { const secret = process.env.PADDLE_WEBHOOK_SECRET; if (!secret) return false; const parts = Object.fromEntries(String(sigHeader || '').split(';').map(p => p.split('='))); if (!parts.ts || !parts.h1) return false; const h = crypto.createHmac('sha256', secret).update(parts.ts + ':' + rawBody).digest('hex'); return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(parts.h1)); }
module.exports = { enabled, createTransaction, verify };
