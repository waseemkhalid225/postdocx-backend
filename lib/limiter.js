// lib/limiter.js — counters shared across instances when REDIS_URL is set (ioredis), in-memory otherwise. Same API
// either way, so a second Railway instance does not weaken rate limits, API-key quotas or search fair use.
let redis = null; try { if (process.env.REDIS_URL) { const IORedis = require('ioredis'); redis = new IORedis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false }); redis.connect().catch(() => { redis = null; }); redis.on('error', () => {}); } } catch (e) { redis = null; }
const mem = new Map();
async function hit(key, windowSec) { const k = key + ':' + Math.floor(Date.now() / (windowSec * 1000)); if (redis) { try { const n = await redis.incr(k); if (n === 1) await redis.expire(k, windowSec + 5); return n; } catch (e) {} } const n = (mem.get(k) || 0) + 1; mem.set(k, n); if (mem.size > 50000) mem.clear(); return n; }
async function get(key, windowSec) { const k = key + ':' + Math.floor(Date.now() / (windowSec * 1000)); if (redis) { try { return Number(await redis.get(k)) || 0; } catch (e) {} } return mem.get(k) || 0; }
function backend() { return redis ? 'redis' : 'memory'; }
module.exports = { hit, get, backend };
