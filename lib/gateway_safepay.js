// lib/gateway_safepay.js — Pakistan-local card and wallet payments in PKR (Safepay: Visa/Mastercard issued in
// Pakistan, plus JazzCash/Easypaisa wallets). A Pakistani debit card that is blocked for international USD
// payments (the common case) still works here. Same interface as the other adapters: create a checkout, verify
// the webhook signature, settle idempotently through settleCardPayment. Test in sandbox first (SAFEPAY_ENV=sandbox).
const crypto = require('crypto');
function enabled() { return !!(process.env.SAFEPAY_API_KEY && process.env.SAFEPAY_SECRET); }
function base() { return process.env.SAFEPAY_ENV === 'sandbox' ? 'https://sandbox.api.getsafepay.com' : 'https://api.getsafepay.com'; }
function checkoutBase() { return process.env.SAFEPAY_ENV === 'sandbox' ? 'https://sandbox.api.getsafepay.com/components' : 'https://getsafepay.com/components'; }
async function createCheckout({ amountPkr, paymentId, successUrl, cancelUrl }) {
  const r = await fetch(base() + '/order/v1/init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client: process.env.SAFEPAY_API_KEY, amount: Math.round(Number(amountPkr)), currency: 'PKR', environment: process.env.SAFEPAY_ENV === 'sandbox' ? 'sandbox' : 'production' }) });
  const d = await r.json().catch(() => ({})); const token = d && d.data && d.data.token; if (!r.ok || !token) throw new Error((d && d.status && d.status.message) || ('Safepay ' + r.status));
  const url = checkoutBase() + '?env=' + (process.env.SAFEPAY_ENV === 'sandbox' ? 'sandbox' : 'production') + '&beacon=' + encodeURIComponent(token) + '&source=custom&order_id=' + encodeURIComponent(paymentId) + '&redirect_url=' + encodeURIComponent(successUrl) + '&cancel_url=' + encodeURIComponent(cancelUrl);
  return { id: token, url };
}
/* Safepay signs the webhook body with HMAC-SHA256 of the tracker token using the merchant secret (x-sfpy-signature). */
function verifySignature(rawBody, header, secret) {
  if (!secret || !header) return false;
  try { const b = JSON.parse(rawBody); const tracker = (b.data && (b.data.tracker || (b.data.notification && b.data.notification.tracker))) || b.tracker || ''; const expected = crypto.createHmac('sha256', secret).update(String(tracker)).digest('hex'); const h = String(header); return h.length === expected.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(expected)); } catch (e) { return false; }
}
function sessionFromEvent(evt) { const d = (evt && evt.data) || {}; const n = d.notification || d; const state = String(n.state || n.status || '').toUpperCase(); return { id: 'safepay_' + (n.tracker || d.tracker || ''), payment_status: /PAID|SUCCESS|COMPLETED/.test(state) ? 'paid' : state.toLowerCase(), client_reference_id: n.order_id || d.order_id || n.reference || '', metadata: { payment_id: n.order_id || d.order_id || n.reference || '', credits: '' } }; }
module.exports = { enabled, createCheckout, verifySignature, sessionFromEvent };
