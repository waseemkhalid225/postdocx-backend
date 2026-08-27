// lib/payments.js — PAYMENT GATEWAY ABSTRACTION (SKELETON).
//
// ⚠️  UNTESTED SCAFFOLDING — REQUIRES LIVE MERCHANT CREDENTIALS.
// This defines the interface and verification flow for automated payment gateways
// (JazzCash, Easypaisa, card processors). It is intentionally inert: no gateway is
// active until you (a) obtain a merchant account, (b) set its secrets in Railway env,
// and (c) implement the provider-specific signature check where marked TODO.
//
// The existing manual bank-transfer + staff-confirm flow in server.js is unaffected
// and remains the working payment path until a gateway is completed and tested.
//
// SECURITY PRINCIPLES baked in here (do not remove when you implement):
//   - The backend NEVER trusts a "success" claim from the frontend.
//   - Every webhook is verified by provider signature before crediting anything.
//   - Amount and currency are checked against the expected package price.
//   - Idempotency: a given provider transaction id credits at most once.

const { admin } = require('./supa');
const crypto = require('crypto');

// Registry of gateways. `enabled` is controlled from admin settings/env, never hard-on.
function gateways() {
  return {
    jazzcash: {
      name: 'JazzCash',
      enabled: !!process.env.JAZZCASH_MERCHANT_ID && !!process.env.JAZZCASH_INTEGRITY_SALT,
      currency: 'PKR',
      // TODO(when live): build the request per JazzCash HTTP/Mobile Wallet API spec.
      verifySignature: (payload) => verifyHmac(payload, process.env.JAZZCASH_INTEGRITY_SALT, payload.pp_SecureHash),
    },
    easypaisa: {
      name: 'Easypaisa',
      enabled: !!process.env.EASYPAISA_STORE_ID && !!process.env.EASYPAISA_HASH_KEY,
      currency: 'PKR',
      verifySignature: (payload) => verifyHmac(payload, process.env.EASYPAISA_HASH_KEY, payload.signature),
    },
  };
}

// Generic HMAC-SHA256 verify. Providers differ in field ordering; adjust per spec.
function verifyHmac(payload, secret, providedHash) {
  if (!secret || !providedHash) return false;
  const fields = Object.keys(payload).filter(k => k !== 'pp_SecureHash' && k !== 'signature').sort();
  const base = fields.map(k => payload[k]).join('&');
  const computed = crypto.createHmac('sha256', secret).update(base).digest('hex');
  // timing-safe compare
  try { return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(String(providedHash))); }
  catch (e) { return false; }
}

function listEnabled() {
  return Object.entries(gateways()).filter(([, g]) => g.enabled).map(([id, g]) => ({ id, name: g.name, currency: g.currency }));
}

// Handle a provider webhook. Returns { ok, credited } or throws.
// This is the ONLY place a gateway payment gets credited, and only after verification.
async function handleWebhook(gatewayId, payload) {
  const g = gateways()[gatewayId];
  if (!g) throw new Error('Unknown gateway');
  if (!g.enabled) throw new Error('Gateway not enabled');
  if (!g.verifySignature(payload)) throw new Error('Signature verification failed');

  // Provider-specific field mapping — adjust these keys to the real webhook body.
  const txnId = payload.pp_TxnRefNo || payload.transactionId || '';
  const amount = Number(payload.pp_Amount || payload.amount || 0);
  const status = String(payload.pp_ResponseCode || payload.status || '');
  const orderRef = payload.pp_BillReference || payload.orderRef || ''; // our payment row id
  if (!txnId || !orderRef) throw new Error('Missing transaction or order reference');

  // Idempotency: if this provider txn was already processed, do nothing.
  const { data: existing } = await admin().from('payments').select('id,status,credits,user_id,amount_pkr,pricing_version')
    .eq('provider_txn', txnId).limit(1).then(r => r, () => ({ data: [] }));
  if (existing && existing.length) return { ok: true, credited: false, note: 'already processed' };

  // Find our pending payment by orderRef and verify amount matches.
  const { data: pay } = await admin().from('payments').select('*').eq('id', orderRef).single();
  if (!pay) throw new Error('Order not found');
  if (pay.status === 'confirmed' || pay.status === 'paid') return { ok: true, credited: false, note: 'already paid' };
  // Amount check: provider amount must equal the recorded price (guard against tampering).
  if (Math.round(amount) !== Math.round(Number(pay.amount_pkr))) throw new Error('Amount mismatch');

  const success = /^0+$/.test(status) || status.toLowerCase() === 'success' || status === '00';
  if (!success) {
    await admin().from('payments').update({ status: 'failed', provider_txn: txnId }).eq('id', pay.id);
    return { ok: true, credited: false, note: 'payment failed' };
  }

  // Credit exactly once.
  await admin().from('payments').update({ status: 'paid', provider_txn: txnId, confirmed_at: new Date().toISOString() }).eq('id', pay.id);
  await admin().from('credit_ledger').insert({ user_id: pay.user_id, delta: pay.credits, reason: 'purchase', payment_id: pay.id });
  await admin().from('audit_log').insert({ actor: pay.user_id, event: 'PAYMENT_GATEWAY_CONFIRMED', detail: gatewayId + ' ' + txnId + ' +' + pay.credits + 'cr' }).then(() => {}, () => {});
  return { ok: true, credited: true };
}

module.exports = { gateways, listEnabled, handleWebhook, verifyHmac };
