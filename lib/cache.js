// lib/cache.js — Day 9 · tiny in-process TTL cache for read-heavy org screens; invalidated on writes.
const store = new Map();
function get(k) { const e = store.get(k); if (!e) return null; if (Date.now() > e.exp) { store.delete(k); return null; } return e.v; }
function set(k, v, ttlMs) { store.set(k, { v, exp: Date.now() + (ttlMs || 10000) }); return v; }
function bust(prefix) { for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k); }
module.exports = { get, set, bust };
