// Static regression net for the money paths. Runs with no DB: it asserts the
// critical paywall and race guards still exist in server.js source. If any of
// these assertions fail, a paying-customer bug has been reintroduced.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../server.js', 'utf8');
const checks = [
  ['case creation blocks zero-credit users', /bal < 1\)\s*\{\s*return res\.status\(402\)/.test(src)],
  ['credit consume ledger write', src.includes("delta: -1, reason: 'consume'")],
  ['post-insert credit race rollback', src.includes('balNow < 1')],
  ['payment confirm is atomic (pending flip)', /\.eq\('status', 'pending'\)\.select\('id'\)/.test(src)],
  // Every plan is a case plan: entitlement is paid credits or staff, nothing else.
  ['entitlement is paid-or-staff only', src.includes('return (await balance(userId)) >= 1')],
  ['nothing sells extra searches', !src.includes('searchpass') && !src.includes('search_only')],
  ['report endpoint is sealed by entitlement (sim-aware)', src.includes('await entitled(req.userId, simUser(req))')],
  ['no free-case grants remain', !src.includes("reason: 'free_case'")],
  ['payment confirmation notifies the user', src.includes('Payment confirmed')],
  // There is no cooldown to be exempt from; admin exemption now means an uncapped
  // delivery target and no daily search gate.
  ['no cooldown exists and staff bypass the daily gate',
    !src.includes('searchCooldown') && src.includes('There is no cooldown between searches') &&
    src.includes("['admin', 'super_admin', 'staff'].includes(req.userRole)) return next();") &&
    src.includes('isAdminRun')]
];
let fail = 0;
for (const [name, ok] of checks) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) fail++;
}
if (fail) { console.error(fail + ' paywall assertion(s) failed'); process.exit(1); }
console.log('paywall net: all assertions hold');
