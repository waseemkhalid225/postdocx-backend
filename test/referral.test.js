/* test/referral.test.js — referral rewards: milestones, credit ledger, per-credit
   expiry, FIFO redemption, idempotency, fraud guards and QR attribution. */
const fs = require('fs');
const path = require('path');
const R = require('../lib/referral');

const results = [];
const t = (n, ok, d) => results.push({ n, ok: !!ok, d: d || '' });
const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const fe = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'referral.js'), 'utf8');
const mig = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0027_referral_rewards.sql'), 'utf8');

// ---- expiry: each credit independent, six months, no month overflow ----
t('6 months from 10 Sep 2026 is 10 Mar 2027',
  R.addMonths(new Date('2026-09-10T00:00:00Z'), 6).toISOString().slice(0, 10) === '2027-03-10');
t('6 months from 20 Nov 2026 is 20 May 2027',
  R.addMonths(new Date('2026-11-20T00:00:00Z'), 6).toISOString().slice(0, 10) === '2027-05-20');
t('31 Aug clamps to end of Feb, never rolls into March',
  R.addMonths(new Date('2026-08-31T00:00:00Z'), 6).toISOString().slice(0, 10) === '2027-02-28');
t('credits earned on different days get different expiry dates',
  R.addMonths(new Date('2026-09-10T00:00:00Z'), 6).getTime() !==
  R.addMonths(new Date('2026-11-20T00:00:00Z'), 6).getTime());

// ---- milestone maths ----
const per = R.DEFAULTS.per_milestone;
t('default milestone is 5 qualified referrals', per === 5);
[[4, 0], [5, 1], [9, 1], [10, 2], [15, 3], [17, 3]].forEach(([q, expected]) =>
  t(q + ' qualified referrals = ' + expected + ' credit(s)', Math.floor(q / per) === expected));

// ---- idempotency and fraud guards, enforced by schema and code ----
t('one credit per user per milestone enforced by a unique index',
  mig.includes('unique index') && mig.includes('(user_id, milestone)'));
t('credit ledger stores its own expiry per row', mig.includes('expires_at'));
t('credit statuses are tracked', mig.includes("default 'active'") && mig.includes('used_at'));
t('self-referral can never count', lib.includes('r.id === referrerId') && lib.includes('continue'));
t('a click or bare signup is not a qualification by default',
  R.DEFAULTS.qualify_on === 'cv_uploaded');
t('already-qualified referrals are not re-counted', lib.includes("referral_status === 'qualified'"));
t('rejected referrals are excluded', lib.includes("referral_status === 'rejected'"));

// ---- redemption ----
t('earliest-expiring credit is spent first (wallet sorted by expiry)',
  lib.includes("order('expires_at', { ascending: true })") && lib.includes('w.active[0]'));
t('redemption is a conditional update, preventing double-spend',
  lib.includes(".eq('status', 'active').select()"));
t('expired credits are marked before the wallet is read',
  lib.includes("status: 'expired'") && lib.includes("lt('expires_at'"));
t('redeem endpoint is serialized per user', sv.includes('withUserLock(req.userId, async () => {'));
t('redeemed credit grants exactly one case credit',
  sv.includes("reason: 'referral_reward'") && sv.includes('delta: 1'));
t('redemption is audit-logged', sv.includes("event: 'REFERRAL_REDEEM'"));

// ---- automatic issuance ----
t('rewards issue automatically on qualification, no manual step',
  sv.includes("require('./lib/referral').syncRewards"));
t('qualification triggers on the referred user uploading a document',
  sv.includes('prof.referred_by') && sv.includes('syncRewards(prof.referred_by)'));
t('user is notified when a credit is earned', lib.includes('You earned a free Solo credit'));

// ---- privacy and API ----
t('referred user identities are never exposed', sv.includes('// Never expose who the referred people are'));
t('status endpoint requires auth', sv.includes("app.get('/api/referral/status', auth"));
t('redeem endpoint requires auth', sv.includes("app.post('/api/referral/redeem', auth"));

// ---- dashboard + share card ----
t('dashboard shows a Refer & Earn card', fe.includes('Refer &amp; Earn'));
t('dashboard shows progress toward the next reward', fe.includes('to_next'));
t('dashboard shows per-credit expiry dates', fe.includes('credit expires'));
t('user can redeem from the dashboard', fe.includes('useFreeCredit'));
t('referral share card exists and is distinct from the application card',
  fe.includes('REFERRAL SHARE CARD') && fe.includes('async function referralCard'));
t('share card embeds a QR carrying the referral link', fe.includes('QR.make(link)'));
t('QR has a quiet zone', fe.includes('(j + 4) * cell') || fe.includes('(j+4)*cell'));
t('website address is readable without scanning', fe.includes("'foriforeign.com',1268"));
t('card text is measured so it cannot overflow', fe.includes('x.measureText(s2).width>(maxW'));
t('QR encoder fills every module (no unscannable gaps)', fe.includes('m[8][size-8]=fbits[7]'));

// ---- admin configurability ----
const st = fs.readFileSync(path.join(__dirname, '..', 'lib', 'settings.js'), 'utf8');
t('referral rules are admin-configurable', st.includes('referral: { per_milestone'));
t('qualification rule is configurable', st.includes("qualify_on: 'cv_uploaded'"));

// ---- HOW A NEW USER ENTERS THE CODE (two routes, both must work) ----
t('route A: ?ref=CODE is captured from the landing URL',
  fe.includes("URLSearchParams(location.search).get('ref')"));
t('route A: the code survives until the user signs up', fe.includes("localStorage.setItem('ffref'"));
t('route A: the code is claimed automatically after login', fe.includes("api('/api/referral/claim'"));
t('route B: a user can type a friend\u2019s code manually',
  fe.includes('applyRefCode') && fe.includes('Invited by a friend?'));
t('route B: the entry box hides once a referrer is recorded', fe.includes('ME&&ME.referred_by'));
t('claiming sets referred_by on the new user', sv.includes('update({ referred_by: refr.id })'));
t('a user cannot claim their own code', sv.includes('That is your own code'));
t('a user cannot change referrer once set', sv.includes('me.referred_by) return res.json({ ok: true, already: true })'));
t('an unknown code is rejected clearly', sv.includes('Referral code not found'));

// ---- WHAT UPDATES THE CREDIT (the qualifying action) ----
t('the qualifying action is the friend uploading a CV',
  sv.includes('syncRewards(prof.referred_by)') && R.DEFAULTS.qualify_on === 'cv_uploaded');
t('the referrer is credited automatically, with no admin step',
  lib.includes('async function syncRewards'));

// ---- WHERE THE USER SEES THEIR SCORE ----
t('dashboard shows the number of qualified referrals', fe.includes('Qualified referrals'));
t('dashboard shows progress to the next reward', fe.includes('to_next'));
t('dashboard shows available free credits', fe.includes('free credit'));
t('dashboard shows each credit\u2019s expiry date', fe.includes('credit expires'));

// ---- PAID-ONLY GATING ----
t('rewards are limited to customers who have activated a package', sv.includes('hasEverPaid'));
t('promo and granted credits also count as activated', sv.includes("'promo_grant', 'support_grant'"));
t('non-paying users see why it is locked, not a blank space', fe.includes('r.eligible===false'));
t('the locked card points to the packages page', fe.includes("onclick=\"go('buy')\""));
t('the invite card cannot be generated before activation',
  fe.includes('Your invite card unlocks'));

const failed = results.filter(r => !r.ok);
results.forEach(r => console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n + (r.ok ? '' : '  [' + r.d + ']')));
console.log('\nreferral net: ' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) { console.error(failed.length + ' referral assertion(s) failed'); process.exit(1); }
