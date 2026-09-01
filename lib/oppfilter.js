// lib/oppfilter.js - every filter that cannot be expressed as a plain equality.
//
// WHY THIS EXISTS. The list endpoint stacked up to twelve separate .or() calls onto one
// PostgREST query, producing twelve query parameters all named "or". Whether PostgREST
// combines repeated top-level logical parameters with AND, or honours only one of them,
// is not something the code could rely on - and I could not verify it against the live
// database. A filter that MIGHT be silently dropped is worse than no filter, because the
// applicant is shown results they explicitly excluded and has no way to know.
//
// So none of it is left to chance. The SQL query now carries only plain equality and IN
// conditions, which are unambiguous, and everything conditional is applied here, in
// JavaScript, over the fetched rows. Every function is pure and every one is covered by
// test/oppfilter.test.js, which runs offline against fixtures.
//
// The consistent rule throughout: a STATED value must satisfy the filter; an UNSTATED one
// is not grounds for hiding a position, because most adverts leave most columns empty.

const today = () => new Date().toISOString().slice(0, 10);
const s = v => String(v == null ? '' : v).trim();
const lower = v => s(v).toLowerCase();
const blank = v => s(v) === '';

/* Deadline still open. Rolling positions (no deadline) always stay. */
function isOpen(o, ref) {
  if (blank(o.deadline)) return true;
  return s(o.deadline).slice(0, 10) >= (ref || today());
}

/* Level: a stated level must be one the applicant asked for. An unstated level is
   inferred from the title, and only when it can be established at all is it judged. */
function levelOk(o, wanted, infer) {
  if (!wanted || !wanted.length) return true;
  const lv = lower(o.level);
  if (lv) return wanted.includes(lv);
  const guess = infer ? infer(o.title) : null;
  return guess ? wanted.includes(guess) : true;
}

/* Free-text column matches any of the given terms, or states nothing at all. */
function termsOk(value, terms, alsoValue) {
  if (!terms || !terms.length) return true;
  const v = lower(value), v2 = lower(alsoValue || '');
  /* An UNSTATED field is not a mismatch. The first version of this function demanded that
     the title match whenever the field column was empty, which deleted "Drug Safety
     Associate" from a pharmacy search because the title happens not to contain the word
     pharmacy. Caught by test/oppfilter.test.js before it ever shipped. */
  if (!v) return true;
  return terms.some(t => { const x = lower(t); return v.includes(x) || (v2 && v2.includes(x)); });
}

/* Money is only "stated" when it says something. A stipend column reading "Competitive",
   "Negotiable", "TBD" or "Not specified" told the applicant nothing, and letting those
   through a "must state the pay" filter made the filter a lie. */
const VAGUE = /^(n\/?a|tbd|tba|competitive|negotiable|attractive|market rate|as per (rules|policy)|not (specified|stated|disclosed)|depends|varies|unspecified|-|--)$/i;
function statesMoney(v) {
  const x = s(v);
  if (!x || VAGUE.test(x)) return false;
  // A real figure carries a digit, or names a recognised public pay scale.
  return /\d/.test(x) || /\b(tv-?l|tvo?d|e13|e14|nhs band|band \d|grade \d|scale)\b/i.test(x);
}

function tuitionFree(o) {
  if (lower(o.funding_type) === 'fully') return true;
  const t = lower(o.tuition);
  if (!t) return true;                       // unstated: most funded places print nothing
  /* The alternative "0\b" matched "EUR 12,000", so a twelve-thousand-euro tuition passed
     a tuition-free filter. Caught by the tests. */
  return /free|waive|no tuition|\bnil\b|^0$|zero/.test(t);
}
function noAppFee(o) {
  const f = lower(o.application_fee);
  if (!f) return true;
  return /free|no fee|waive|nil|^0/.test(f);
}
function withinDays(o, days, ref) {
  if (blank(o.deadline)) return true;        // rolling stays
  if (!isFinite(days) || days <= 0) return true;
  const d = s(o.deadline).slice(0, 10);
  const from = ref || today();
  const to = new Date(new Date(from + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10);
  return d >= from && d <= to;
}
function intakeOk(o, year) {
  if (!year) return true;
  if (blank(o.deadline)) return true;
  const d = s(o.deadline).slice(0, 10);
  return d >= (year - 1) + '-01-01' && d <= year + '-12-31';
}
function noLanguageTest(o) {
  const r = lower(o.req_language);
  return !r || r === 'none';
}
/* Language rules are a MENU, and every option the applicant ticks widens what they will
   accept. The old code fired only when "no certificate" was the single selection, so
   ticking two boxes silently constrained nothing at all. */
function languageOk(o, picks) {
  if (!picks || !picks.length) return true;
  const r = lower(o.req_language);
  const blob = lower([o.title, o.req_language, o.description].join(' '));
  return picks.some(p => {
    if (p === 'none') return !r || r === 'none';
    if (p === 'cert_before') return /ielts|toefl|oet|pte|duolingo|cambridge|english/.test(r + ' ' + blob);
    if (p === 'course_after') return /language course|preparatory|foundation year|pre-?sessional/.test(blob);
    if (p === 'local_lang') return /german|french|spanish|italian|dutch|polish|turkish|chinese|mandarin|japanese|korean|arabic|swedish|norwegian|danish|finnish|local language/.test(r + ' ' + blob);
    return true;
  });
}
function inSet(value, allowed) {
  if (!allowed || !allowed.length) return true;
  const v = lower(value);
  if (!v) return true;                       // unstated is not a mismatch
  return allowed.includes(v);
}

/* The whole set, in one place, in a fixed order. Returns the surviving rows and a report
   of how many each filter removed - which is what makes an empty screen explainable
   instead of mysterious. */
function applyFilters(rows, f, helpers) {
  const report = {};
  let out = Array.isArray(rows) ? rows.slice() : [];
  const step = (name, fn) => {
    const before = out.length;
    out = out.filter(fn);
    if (before !== out.length) report[name] = before - out.length;
  };
  const ref = f.today || today();
  step('expired', o => isOpen(o, ref));
  if (f.levels && f.levels.length) step('level', o => levelOk(o, f.levels, helpers && helpers.inferLevel));
  if (f.fundingTypes && f.fundingTypes.length) step('funding', o => f.fundingTypes.includes(lower(o.funding_type)));
  if (f.noLanguageTest) step('language', noLanguageTest);
  else if (f.langs && f.langs.length) step('language', o => languageOk(o, f.langs));
  if (f.fieldTerms && f.fieldTerms.length) step('profession', o => termsOk(o.req_field, f.fieldTerms, o.title));
  if (f.sectorTerms && f.sectorTerms.length) step('sector', o => termsOk(o.req_field, f.sectorTerms));
  if (f.hasStipend) step('stipend', o => statesMoney(o.stipend) || statesMoney(o.salary_note));
  if (f.tuitionFree) step('tuition', tuitionFree);
  if (f.noAppFee) step('appfee', noAppFee);
  if (f.rollingOnly) step('rolling', o => blank(o.deadline));
  if (f.hasDeadline) step('hasdeadline', o => !blank(o.deadline));
  if (isFinite(f.deadlineDays) && f.deadlineDays > 0) step('deadlinewindow', o => withinDays(o, f.deadlineDays, ref));
  if (f.intakeYear) step('intake', o => intakeOk(o, f.intakeYear));
  if (f.jobTypes && f.jobTypes.length) step('jobtype', o => inSet(o.job_type, f.jobTypes));
  if (f.expLevels && f.expLevels.length) step('experience', o => inSet(o.experience_level, f.expLevels));
  return { rows: out, report };
}

module.exports = { applyFilters, isOpen, levelOk, termsOk, statesMoney, tuitionFree, noAppFee, withinDays, intakeOk, languageOk, noLanguageTest, inSet, VAGUE };
