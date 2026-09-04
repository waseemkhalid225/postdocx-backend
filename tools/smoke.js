// tools/smoke.js — Day 26 · post-deploy smoke test. Usage: node tools/smoke.js https://foriforeign.com [BEARER_TOKEN]
const base = process.argv[2] || 'https://foriforeign.com'; const token = process.argv[3] || '';
const checks = [['GET', '/api/health'], ['GET', '/api/health/full'], ['GET', '/api/site-config'], ['GET', '/api/i18n'], ['GET', '/api/whitelabel'], ['GET', '/pricing.html'], ['GET', '/partners.html'], ['GET', '/api-docs.html'], ['GET', '/manifest.json'], ['GET', '/sw.js']];
const authed = [['GET', '/api/me'], ['GET', '/api/home'], ['GET', '/api/org'], ['GET', '/api/vault'], ['GET', '/api/vault/checklist?for=study'], ['GET', '/api/me/mobility'], ['GET', '/api/offers'], ['GET', '/api/visa/countries'], ['GET', '/api/journey'], ['GET', '/api/notifications'], ['GET', '/api/me/family'], ['GET', '/api/pay/quote?credits=2']];
(async () => {
  let fail = 0;
  for (const [m, p] of checks.concat(token ? authed : [])) {
    const t0 = Date.now();
    try { const r = await fetch(base + p, { method: m, headers: token && authed.some(a => a[1] === p) ? { authorization: 'Bearer ' + token } : {} }); const ms = Date.now() - t0; const ok = r.status < 400; if (!ok) fail++; console.log((ok ? 'PASS' : 'FAIL'), m, p, r.status, ms + 'ms', r.headers.get('x-ff-ms') ? 'server ' + r.headers.get('x-ff-ms') + 'ms' : ''); }
    catch (e) { fail++; console.log('FAIL', m, p, e.message); }
  }
  console.log(fail ? fail + ' failure(s)' : 'all smoke checks passed'); process.exit(fail ? 1 : 0);
})();
