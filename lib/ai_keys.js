// lib/ai_keys.js — BRING YOUR OWN AI ACCOUNT, per consultancy. FF keeps the models, prompts and routing; the consultancy brings the
// credentials and pays its provider directly. A request runs inside a tenant key context (AsyncLocalStorage); provider modules ask
// keyFor(provider) — inside a tenant context ONLY the tenant's own keys are returned (never the platform's, never another tenant's).
// Outside a tenant context (direct applicants, platform staff) the platform's environment keys are used as before.
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
const { admin } = require('./supa');
const C = require('./crypto');
const _cache = new Map();   // orgId → { keys, at }
function keyFor(provider) { const ctx = als.getStore(); if (ctx && ctx.tenant) return ctx.keys[provider] || null; return process.env[{ gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' }[provider]] || null; }
function tenant() { const ctx = als.getStore(); return ctx && ctx.tenant ? ctx.tenant : null; }
async function loadKeys(orgId) { const hit = _cache.get(orgId); if (hit && Date.now() - hit.at < 60000) return hit.keys; const { data } = await admin().from('org_ai_connections').select('gemini_key_enc,anthropic_key_enc,openai_key_enc,status').eq('org_id', orgId).maybeSingle(); const keys = {}; if (data && data.status !== 'disconnected') { for (const [p, col] of [['gemini', 'gemini_key_enc'], ['anthropic', 'anthropic_key_enc'], ['openai', 'openai_key_enc']]) { try { if (data[col]) keys[p] = C.decrypt(data[col]); } catch (e) {} } } _cache.set(orgId, { keys, at: Date.now() }); return keys; }
function forget(orgId) { _cache.delete(orgId); }
/* Which consultancy does this user belong to (as a client or as staff)? Personal workspaces are not consultancies. */
const _orgOf = new Map();
async function tenantOfUser(userId) { if (!userId) return null; const hit = _orgOf.get(userId); if (hit && Date.now() - hit.at < 60000) return hit.org; let org = null; try { const { data: cl } = await admin().from('clients').select('org_id').eq('user_id', userId).limit(3); for (const c of (cl || [])) { const { data: o } = await admin().from('organisations').select('id,kind').eq('id', c.org_id).maybeSingle(); if (o && o.kind !== 'personal') { org = o.id; break; } } if (!org) { const { data: mem } = await admin().from('org_members').select('org_id').eq('user_id', userId).eq('status', 'active').limit(3); for (const m of (mem || [])) { const { data: o } = await admin().from('organisations').select('id,kind').eq('id', m.org_id).maybeSingle(); if (o && o.kind !== 'personal') { org = o.id; break; } } } } catch (e) {} _orgOf.set(userId, { org, at: Date.now() }); return org; }
/* Run fn inside the tenant's key context. Throws AI_NOT_CONNECTED when the consultancy has no usable key for the provider FF needs. */
async function runAs(orgId, fn) { const keys = await loadKeys(orgId); return als.run({ tenant: orgId, keys }, fn); }
class NotConnected extends Error { constructor(orgId, provider) { super('AI account not connected for this consultancy' + (provider ? ' (' + provider + ')' : '') + '. The consultancy admin can connect it under Team & setup → AI connection.'); this.code = 'AI_NOT_CONNECTED'; this.status = 402; this.orgId = orgId; this.provider = provider; } }
/* Health from a provider error, recorded on the connection (no secrets ever). */
function classify(err) { const s = Number(err && (err.status || err.statusCode)) || 0; const m = String(err && err.message || '').toLowerCase(); if (s === 401 || s === 403 || /api key not valid|invalid api key|unauthorized|authentication/.test(m)) return 'auth_failed'; if (s === 402 || /insufficient|quota|billing|credit|exceeded your current/.test(m)) return 'billing'; if (s === 429 || /rate limit|too many|resource exhausted/.test(m)) return 'rate_limited'; if (s >= 500 || /unavailable|overloaded|timeout|fetch failed|econn/.test(m)) return 'provider_unavailable'; return null; }
async function recordHealth(orgId, state, note) { try { await admin().from('org_ai_connections').update({ health: state, health_note: String(note || '').slice(0, 200), [state === 'healthy' ? 'last_ok_at' : 'last_error_at']: new Date().toISOString() }).eq('org_id', orgId); } catch (e) {} }
module.exports = { keyFor, tenant, loadKeys, forget, tenantOfUser, runAs, NotConnected, classify, recordHealth };
