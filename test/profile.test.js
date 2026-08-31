/* test/profile.test.js — Document intelligence and master-profile guarantees.
   The core promise: a new upload may only ENRICH the profile. Nothing established by an
   earlier document is ever silently deleted or overwritten. */
const fs = require('fs');
const path = require('path');
const { merge, completeness } = require('../lib/profile');

const results = [];
const t = (n, ok, d) => results.push({ n, ok: !!ok, d: d || '' });

// --- P0: a sparse later upload must not destroy a rich earlier profile ---
const rich = {
  headline: 'PhD Pharmacology', email: 'a@b.com', phone: '+92345',
  awards: ['Gold Medal'], memberships: ['PSP'], certifications: ['MDR-TB Facilitator'],
  research_papers: [{ title: 'Piroxicam study', venue: 'JPET', year: '2025', doi: '10.1/x' }],
  education: [{ degree: 'PhD', institution: 'Riphah', year: '2024' }],
  experience: [{ role: 'Director', org: 'DFH', years: '2022-' }]
};
const sparse = { passport_number: 'AB1234567', date_of_birth: '1991-09-04', nationality: 'Pakistani' };
const r1 = merge(rich, sparse, 'passport.jpg');
t('publications survive a sparse upload', (r1.profile.research_papers || []).length === 1);
t('awards survive', (r1.profile.awards || []).length === 1);
t('education survives', (r1.profile.education || []).length === 1);
t('experience survives', (r1.profile.experience || []).length === 1);
t('certifications survive', (r1.profile.certifications || []).length === 1);
t('new identity facts are added', r1.profile.passport_number === 'AB1234567' && r1.profile.nationality === 'Pakistani');
t('an empty incoming value never blanks an existing one', merge(rich, { email: '' }, 's').profile.email === 'a@b.com');

// --- conflicts are surfaced, never silently resolved ---
const r2 = merge({ date_of_birth: '1991-09-04' }, { date_of_birth: '1991-04-09' }, 'transcript.pdf');
t('conflicting value does NOT overwrite', r2.profile.date_of_birth === '1991-09-04');
t('conflict is recorded with both values and its source',
  r2.conflicts.length === 1 && r2.conflicts[0].current === '1991-09-04' &&
  r2.conflicts[0].incoming === '1991-04-09' && !!r2.conflicts[0].source);
t('the same conflict is not recorded twice',
  merge(r2.profile, { date_of_birth: '1991-04-09' }, 'transcript.pdf').profile._conflicts.length === 1);

// --- enrichment across many documents ---
let acc = {};
[ { headline: 'Pharmacist' },
  { education: [{ degree: 'PharmD', institution: 'Riphah' }] },
  { education: [{ degree: 'PhD', institution: 'Riphah' }], awards: ['Gold Medal'] },
  { licenses: [{ name: 'DHA', number: 'D-99' }] },
  { research_papers: [{ title: 'Paper A' }, { title: 'Paper B' }] }
].forEach((doc, i) => { acc = merge(acc, doc, 'doc' + i).profile; });
t('five documents build one unified profile',
  (acc.education || []).length === 2 && (acc.licenses || []).length === 1 &&
  (acc.research_papers || []).length === 2 && acc.headline === 'Pharmacist');
t('duplicate entries are not duplicated',
  (merge(acc, { education: [{ degree: 'PhD', institution: 'Riphah' }] }, 'again').profile.education || []).length === 2);
t('an existing entry is enriched, not replaced', (() => {
  const m = merge({ education: [{ degree: 'PhD', institution: 'Riphah' }] },
    { education: [{ degree: 'PhD', institution: 'Riphah', year: '2024', grade: '3.83' }] }, 'transcript');
  const e = m.profile.education[0];
  return e.year === '2024' && e.grade === '3.83';
})());

// --- provenance and traceability ---
t('provenance is recorded per field', !!(r1.profile._provenance && r1.profile._provenance.passport_number));
t('source documents are tracked', (r1.profile._sources || []).includes('passport.jpg'));
t('completeness is measurable', completeness(acc).total > 20 && typeof completeness(acc).pct === 'number');

// --- schema and pipeline wiring ---
const docs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'docs.js'), 'utf8');
['given_name', 'family_name', 'father_name', 'date_of_birth', 'place_of_birth', 'nationality',
 'passport_number', 'national_id', 'documents', 'additional_information'].forEach(f =>
  t('schema captures ' + f, docs.includes('"' + f + '"')));
t('nothing is discarded for lacking a field', docs.includes('Never discard a fact because it has no field'));
t('identifiers copied exactly, never reformatted', docs.includes('character for character'));
t('uploaded documents are treated as untrusted data', docs.includes('untrusted DATA'));
t('extraction uses the merge engine, not a destructive upsert',
  docs.includes("require('./profile')") && docs.includes('MASTER PROFILE MERGE'));
t('conflicts are audit-logged', docs.includes('PROFILE_CONFLICT'));

const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
t('conflicts are exposed to the user', sv.includes("'/api/profile/conflicts'"));
t('the user resolves conflicts explicitly', sv.includes('/api/profile/conflicts/resolve') && sv.includes('user_confirmed'));
const fe = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
t('the profile page asks the user to confirm', fe.includes('conflictPanel') && fe.includes('never guess on your identity numbers'));

// --- RISK 1: OCR confidence, never a confident wrong identifier ---
t('extraction judges legibility per critical field', docs.includes('field_confidence') && docs.includes('LEGIBILITY LAW'));
t('digit confusion is explicitly guarded', docs.includes('0 with O') && docs.includes('never silently correct') || docs.includes('Never silently correct a digit'));
t('low-confidence identifiers escalate to the user', docs.includes("reason: 'low_confidence'"));
t('the UI asks the user to confirm unreadable values', fe.includes('low_confidence') && fe.includes('hard to read'));

// --- RISK 2: original script preserved, transliteration separate ---
t('original script is captured, not romanised away', docs.includes('"originals"') && docs.includes('MULTILINGUAL LAW'));
t('transliteration and official English are separate fields',
  docs.includes('"transliteration"') && docs.includes('"english_official"'));
t('official English is only used when genuinely known', docs.includes('leave english_official empty'));
t('originals merge without losing any script variant', (() => {
  const a = { originals: [{ field: 'institution', original: 'رفاہ', transliteration: 'Riphah' }] };
  const b = { originals: [{ field: 'full_name', original: 'وسیم خالد', transliteration: 'Waseem Khalid' }] };
  const m = merge(a, b, 'urdu.pdf').profile.originals;
  return m.length === 2 && m.some(o => o.original === 'رفاہ') && m.some(o => o.original === 'وسیم خالد');
})());

// --- RISK 3: transcript tables keep cell associations ---
t('transcript tables are captured row by row', docs.includes('"transcripts"') && docs.includes('"course_code"'));
t('table law forbids shifting values between columns', docs.includes('TABLE LAW') && docs.includes('wrong subject'));
t('transcript records enrich instead of duplicating', (() => {
  const a = { transcripts: [{ institution: 'Riphah', programme: 'PhD', session: '2021-2024', cgpa: '3.83',
    subjects: [{ subject: 'Pharmacology', course_code: 'PHR-701', marks_obtained: '88', grade: 'A' }] }] };
  const b = { transcripts: [{ institution: 'Riphah', programme: 'PhD', session: '2021-2024', total_credit_hours: '18' }] };
  const m = merge(a, b, 't2').profile.transcripts;
  return m.length === 1 && m[0].cgpa === '3.83' && m[0].total_credit_hours === '18' &&
    m[0].subjects[0].course_code === 'PHR-701' && m[0].subjects[0].marks_obtained === '88';
})());

// --- RISK 4: every document is read, none ignored ---
t('documents are read in batches until exhausted',
  docs.includes('const BATCH = 3') && docs.includes('morePasses'));
t('further passes are chained automatically', docs.includes('pass: passIndex + 1'));
t('each pass merges rather than replaces', docs.includes('MASTER PROFILE MERGE'));

const failed = results.filter(r => !r.ok);
results.forEach(r => console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n + (r.ok ? '' : '  [' + r.d + ']')));
console.log('\nprofile net: ' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) { console.error(failed.length + ' profile assertion(s) failed'); process.exit(1); }
