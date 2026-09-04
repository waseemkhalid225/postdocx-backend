// tools/loadtest.js — Day 28 · a simple concurrency run against read endpoints (no AI calls).
// Usage: node tools/loadtest.js https://foriforeign.com 500 30   (concurrency, seconds) [BEARER_TOKEN]
const base = process.argv[2] || 'https://foriforeign.com'; const conc = Number(process.argv[3] || 100); const secs = Number(process.argv[4] || 20); const token = process.argv[5] || '';
const paths = token ? ['/api/site-config', '/api/home', '/api/vault/checklist?for=study', '/api/notifications', '/api/org'] : ['/api/site-config', '/api/i18n', '/api/health', '/pricing.html'];
(async () => {
  const stop = Date.now() + secs * 1000; const lat = []; let ok = 0, err = 0;
  async function worker(i) { while (Date.now() < stop) { const p = paths[(i + ok + err) % paths.length]; const t0 = Date.now(); try { const r = await fetch(base + p, { headers: token && p.startsWith('/api/') && !/site-config|i18n|health/.test(p) ? { authorization: 'Bearer ' + token } : {} }); lat.push(Date.now() - t0); r.status < 500 ? ok++ : err++; } catch (e) { err++; } } }
  await Promise.all(Array.from({ length: conc }, (_, i) => worker(i)));
  lat.sort((a, b) => a - b); const pct = q => lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] || 0;
  console.log(JSON.stringify({ concurrency: conc, seconds: secs, requests: ok + err, ok, errors: err, rps: Math.round((ok + err) / secs), p50_ms: pct(0.5), p95_ms: pct(0.95), p99_ms: pct(0.99), max_ms: lat[lat.length - 1] || 0 }, null, 2));
  console.log(err / Math.max(1, ok + err) > 0.01 ? 'VERDICT: error rate above 1% - investigate' : (pct(0.95) > 2000 ? 'VERDICT: p95 above 2 s - add capacity or cache' : 'VERDICT: healthy'));
})();
