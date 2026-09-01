// test/oppfilter.test.js - runs offline, no database, no network, no AI.
// Every filter the finder can apply is exercised against fixtures here, so a filter that
// silently stops working fails a test instead of quietly showing a customer the wrong
// positions.
const assert = require('assert');
const F = require('../lib/oppfilter');

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const TODAY = '2026-09-01';

const row = o => Object.assign({
  id: 'x', title: 'Postdoctoral Researcher', level: null, deadline: null, funding_type: null,
  req_field: null, req_language: null, stipend: null, salary_note: null, tuition: null,
  application_fee: null, job_type: null, experience_level: null, description: ''
}, o);

/* ---- expiry ---- */
t('closed position is removed', () => {
  const r = F.applyFilters([row({ deadline: '2026-08-01' })], { today: TODAY });
  assert.strictEqual(r.rows.length, 0);
  assert.strictEqual(r.report.expired, 1);
});
t('deadline today still counts as open', () => {
  assert.strictEqual(F.applyFilters([row({ deadline: TODAY })], { today: TODAY }).rows.length, 1);
});
t('rolling position survives', () => {
  assert.strictEqual(F.applyFilters([row({ deadline: null })], { today: TODAY }).rows.length, 1);
});

/* ---- level ---- */
t('wrong stated level is removed', () => {
  const r = F.applyFilters([row({ level: 'phd' })], { levels: ['postdoc'], today: TODAY });
  assert.strictEqual(r.rows.length, 0);
});
t('unstated level is inferred from the title', () => {
  const infer = ti => /post.?doc/i.test(ti) ? 'postdoc' : /phd/i.test(ti) ? 'phd' : null;
  const kept = F.applyFilters([row({ title: 'PhD position in chemistry' })],
    { levels: ['postdoc'], today: TODAY }, { inferLevel: infer });
  assert.strictEqual(kept.rows.length, 0, 'a PhD advert must not survive a postdoc search');
});
t('unclassifiable level survives rather than vanishing', () => {
  const infer = () => null;
  assert.strictEqual(F.applyFilters([row({ title: 'Research opening' })],
    { levels: ['postdoc'], today: TODAY }, { inferLevel: infer }).rows.length, 1);
});

/* ---- money ---- */
t('vague pay does not satisfy "must state the pay"', () => {
  ['Competitive', 'Negotiable', 'TBD', 'Not specified', 'N/A', '-'].forEach(v => {
    assert.strictEqual(F.statesMoney(v), false, v + ' must not count as stated');
  });
});
t('real pay figures are accepted', () => {
  ['EUR 2,300 per month', 'GBP 37,338 to 44,962', 'TV-L E13', 'NHS Band 6'].forEach(v => {
    assert.strictEqual(F.statesMoney(v), true, v + ' must count as stated');
  });
});
t('stipend filter reads salary_note as well', () => {
  assert.strictEqual(F.applyFilters([row({ salary_note: 'SAR 18,000 monthly' })],
    { hasStipend: true, today: TODAY }).rows.length, 1);
});

/* ---- language menu ---- */
t('two language choices widen rather than constrain to nothing', () => {
  const rows = [row({ req_language: null }), row({ req_language: 'IELTS 6.5' }),
    row({ req_language: 'German B2' })];
  const r = F.applyFilters(rows, { langs: ['none', 'cert_before'], today: TODAY });
  assert.strictEqual(r.rows.length, 2, 'no-certificate and English-test routes qualify, German-only does not');
  const r2 = F.applyFilters(rows, { langs: ['local_lang'], today: TODAY });
  assert.strictEqual(r2.rows.length, 1, 'local-language route selects the German position');
});
t('no-certificate only keeps the no-certificate routes', () => {
  const rows = [row({ req_language: null }), row({ req_language: 'TOEFL' })];
  assert.strictEqual(F.applyFilters(rows, { noLanguageTest: true, today: TODAY }).rows.length, 1);
});

/* ---- sparse columns ---- */
t('unstated job type is not treated as a mismatch', () => {
  assert.strictEqual(F.applyFilters([row({ job_type: null })],
    { jobTypes: ['full_time'], today: TODAY }).rows.length, 1);
});
t('stated wrong job type is removed', () => {
  assert.strictEqual(F.applyFilters([row({ job_type: 'internship' })],
    { jobTypes: ['full_time'], today: TODAY }).rows.length, 0);
});

/* ---- profession ---- */
t('profession matches on the title when the field column is empty', () => {
  assert.strictEqual(F.applyFilters([row({ title: 'Drug Safety Associate', req_field: null })],
    { fieldTerms: ['pharmacy', 'pharmacovigilance'], today: TODAY }).rows.length, 1);
});
t('profession mismatch on a stated field is removed', () => {
  assert.strictEqual(F.applyFilters([row({ title: 'Site Engineer', req_field: 'civil engineering' })],
    { fieldTerms: ['pharmacy', 'pharmacist'], today: TODAY }).rows.length, 0);
});

/* ---- windows ---- */
t('deadline window keeps rolling positions', () => {
  assert.strictEqual(F.applyFilters([row({ deadline: null })],
    { deadlineDays: 30, today: TODAY }).rows.length, 1);
});
t('deadline window excludes a distant deadline', () => {
  assert.strictEqual(F.applyFilters([row({ deadline: '2027-06-01' })],
    { deadlineDays: 30, today: TODAY }).rows.length, 0);
});
t('intake year window accepts the year before the intake', () => {
  assert.strictEqual(F.applyFilters([row({ deadline: '2026-11-30' })],
    { intakeYear: 2027, today: TODAY }).rows.length, 1);
});

/* ---- tuition and fees ---- */
t('tuition-free accepts fully funded and unstated tuition', () => {
  const rows = [row({ funding_type: 'fully', tuition: 'EUR 12,000' }), row({ tuition: null }), row({ tuition: 'EUR 12,000' })];
  assert.strictEqual(F.applyFilters(rows, { tuitionFree: true, today: TODAY }).rows.length, 2);
});
t('no application fee excludes a stated fee', () => {
  assert.strictEqual(F.applyFilters([row({ application_fee: 'USD 90' })],
    { noAppFee: true, today: TODAY }).rows.length, 0);
});

/* ---- combinations ---- */
t('every filter composes without cancelling the others', () => {
  const rows = [
    row({ title: 'Postdoctoral Fellow in Pharmacology', level: 'postdoc', deadline: '2026-12-01',
      funding_type: 'fully', req_field: 'pharmacology', stipend: 'EUR 3,100 per month', job_type: null }),
    row({ title: 'PhD position', level: 'phd', deadline: '2026-12-01', funding_type: 'fully' }),
    row({ title: 'Postdoc, unfunded', level: 'postdoc', deadline: '2026-12-01', funding_type: 'self' }),
    row({ title: 'Postdoc, closed', level: 'postdoc', deadline: '2026-01-01', funding_type: 'fully' })
  ];
  const r = F.applyFilters(rows, {
    levels: ['postdoc'], fundingTypes: ['fully'], hasStipend: true,
    fieldTerms: ['pharmacology', 'pharmacy'], today: TODAY
  });
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].title, 'Postdoctoral Fellow in Pharmacology');
});
t('the report explains an empty screen', () => {
  const r = F.applyFilters([row({ deadline: '2026-01-01' }), row({ level: 'phd' })],
    { levels: ['postdoc'], today: TODAY });
  assert.strictEqual(r.rows.length, 0);
  assert.ok(r.report.expired === 1 && r.report.level === 1, JSON.stringify(r.report));
});

console.log('oppfilter: ' + passed + ' assertions passed' + (process.exitCode ? ' WITH FAILURES' : ''));
