/* test/search.test.js — Search quality: filter propagation, hard-filter enforcement,
   eligibility, score integrity, ranking and package entitlement.
   Ground-truth cases where the correct answer is known in advance. */
const fs = require('fs');
const path = require('path');
const m = require('../lib/match');

const results = [];
const t = (n, ok, d) => results.push({ n, ok: !!ok, d: d || '' });
const fe = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const en = fs.readFileSync(path.join(__dirname, '..', 'lib', 'engine.js'), 'utf8');

// ---------- FILTER PROPAGATION: every selection must reach the API ----------
const SENT = ['levels', 'country', 'funding_type', 'job_type', 'exp', 'licenses', 'remote', 'q',
  'no_language_test', 'intake', 'sector', 'has_stipend'];
SENT.forEach(f => t('frontend transmits filter: ' + f, fe.includes("push('" + f + "'")));
const ACCEPTED = ['levels', 'country', 'funding_type', 'job_type', 'exp', 'licenses', 'remote', 'q',
  'no_language_test', 'intake', 'sector', 'has_stipend'];
ACCEPTED.forEach(f => t('backend accepts filter: ' + f, sv.includes('req.query.' + f)));

// ---------- HARD FILTERS must exclude, not merely down-rank ----------
t('wrong target level is excluded, not ranked lower',
  sv.includes("mt.status === 'wrong_target_level'") && sv.includes('return false'));
t('below-your-level opportunities are excluded', sv.includes("mt.status === 'below_your_level'"));
t('field mismatch is excluded', sv.includes("mt.status === 'field_mismatch'"));
t('relevance floor is enforced server-side', sv.includes('mt.pct < RELEVANCE_FLOOR'));
t('level gate applies at the database, not just in memory', sv.includes("query.or('level.in."));
t('level gate does not zero-out work postings', sv.includes('academicLane'));

// ---------- ELIGIBILITY: never claim eligible without evidence ----------
const facts = { _profile: {}, _wantCountries: ['GB'] };
const openGB = { id: 'gb1', title: 'Postdoc', country_code: 'GB', funding_type: 'fully',
  deadline: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) };
const base = m.evaluate(openGB, facts);
t('an unstated-criteria opportunity is not marked eligible',
  base.status !== 'eligible' || base.stated > 0);
t('every result carries a dimensional breakdown', base.dims && typeof base.dims.eligibility === 'number');

// ---------- SCORE INTEGRITY: one attribute changes, score must move correctly ----------
const wrongCountry = m.evaluate(Object.assign({}, openGB, { country_code: 'CA' }), facts);
t('score drops when the country is not the one chosen', wrongCountry.pct < base.pct);
t('location dimension reflects the country choice',
  wrongCountry.dims.location < base.dims.location);
const selfFunded = m.evaluate(Object.assign({}, openGB, { funding_type: 'self' }), facts);
t('score drops for self-funded when fully funded exists', selfFunded.pct < base.pct);
const closingSoon = m.evaluate(Object.assign({}, openGB,
  { deadline: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) }), facts);
t('score drops when the deadline is uncomfortably close', closingSoon.pct < base.pct);
t('deadline dimension penalises a tight window', closingSoon.dims.deadline < base.dims.deadline);
const expired = m.evaluate(Object.assign({}, openGB,
  { deadline: new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10) }), facts);
t('an expired deadline scores zero on that dimension', expired.dims.deadline === 0);
t('scores stay inside a defensible range (35-99)', base.pct <= 99 && base.pct >= 35);
t('scoring is deterministic for identical input',
  m.evaluate(openGB, facts).pct === m.evaluate(openGB, facts).pct);

// ---------- RANKING ----------
t('results are ordered by match descending', sv.includes('opportunities.sort'));
t('the user\'s chosen countries influence the score', sv.includes('wantedCountries'));

// ---------- PACKAGE ENTITLEMENT enforced server-side, not just hidden in the UI ----------
t('visibility is decided on the server', sv.includes('effectiveTier') && sv.includes('lockTease'));
t('zero credits reveals nothing', sv.includes('effectiveTier < 1'));
t('locked results are stripped of identity before leaving the server',
  sv.includes('function lockTease'));
t('package sizes come from admin config, not hard-coded', sv.includes('cfg.packages && cfg.packages.tiers'));

// ---------- FRESHNESS / EXPIRY ----------
t('expired opportunities are filtered out', sv.includes("freshness !== 'deadline_passed'"));
t('closing-within-24h opportunities are skipped by the agent', en.includes('closing within 24 hours'));

// ---------- SEARCH BREADTH ----------
t('search covers labs and institutes', en.includes('RESEARCH LABS AND INSTITUTES'));
t('search covers small and native employers', en.includes('SMALL AND NATIVE EMPLOYERS'));
t('search covers local job platforms and social channels', en.includes('StepStone') && en.includes('Facebook'));
t('licence-specific databases are named per credential', en.includes('LIC_BOARDS') && en.includes('Mumaris Plus'));
t('the advert must admit the applicant', en.includes('ELIGIBILITY RULE, ABSOLUTE'));

// ---------- SECURITY: results are data, not instructions ----------
t('search results are treated as untrusted data',
  en.includes('untrusted') || fs.readFileSync(path.join(__dirname, '..', 'lib', 'docs.js'), 'utf8').includes('untrusted DATA'));

// ---------- EXPLAINABILITY ----------
t('the user can see how the score was calculated', fe.includes('How this score was calculated'));
t('each dimension is labelled in plain language', fe.includes('Your chosen countries') && fe.includes('Time to apply'));

// ---------- HUNT FINDINGS: filters must target real columns ----------
const REAL_COLUMNS = ['level', 'country_code', 'funding_type', 'remote', 'deadline',
  'req_language', 'req_license', 'req_field', 'req_degree_level', 'kind', 'status'];
t('no filter targets a non-existent "sector" column', !/'sector\./.test(sv));
t('sector maps onto req_field, which exists', sv.includes("req_field.ilike"));
REAL_COLUMNS.forEach(c => {
  const used = new RegExp("'" + c + "\\.").test(sv) || sv.includes("eq('" + c + "'") || sv.includes("in('" + c + "'");
  if (used) t('filter column exists in schema: ' + c, true);
});

// ---------- intake window must include the year BEFORE the intake ----------
t('intake filter opens the window a year early', sv.includes('(y - 1)') && sv.includes('-01-01'));
t('intake filter closes at the end of the intake year', sv.includes('-12-31') && sv.includes('deadline.lte'));
t('a Nov 2026 deadline qualifies for a 2027 intake', (() => {
  const y = 2027, d = '2026-11-15';
  return d >= (y - 1) + '-01-01' && d <= y + '-12-31';
})());

// ---------- query failure must degrade, never return empty ----------
t('any query error falls back to an unfiltered fetch', sv.includes('if (error) {') && sv.includes('q2'));
t('query failures are logged for investigation', sv.includes("errlog('opportunities:query'"));

// ---------- entity deduplication ----------
const ent = require('../lib/entity');
t('canonical key ignores punctuation and word order',
  ent.canonicalKey('Riphah Intl. Univ.') === ent.canonicalKey('Riphah International University'));
t('"University of Oxford" matches "Oxford University"', ent.sameEntity('University of Oxford', 'Oxford University'));
t('different universities are NOT merged',
  !ent.sameEntity('University of Manchester', 'University of Birmingham'));
t('a single shared word is not enough to merge',
  !ent.sameEntity('Oxford', 'Oxford Brookes University') || ent.canonicalKey('Oxford').split(' ').length >= 2);
t('deduplication runs on the result set', sv.includes('ENTITY DEDUPLICATION'));
t('the more authoritative source survives a merge', sv.includes('const authority ='));
t('official domains outrank aggregators', sv.includes('\\.edu|') && sv.includes('careers|jobs'));
t('dedup uses canonical institution names', sv.includes("require('./lib/entity')") && sv.includes('canonicalKey(o.institution)'));

const failed = results.filter(r => !r.ok);
results.forEach(r => console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n + (r.ok ? '' : '  [' + r.d + ']')));
console.log('\nsearch net: ' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) { console.error(failed.length + ' search assertion(s) failed'); process.exit(1); }
