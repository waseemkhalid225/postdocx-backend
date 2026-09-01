// lib/access.js - Pakistan Access Intelligence.
//
// WHY THIS EXISTS. When an applicant names no countries, the discovery agent was left to
// choose them itself, and a language model reaches for the destinations it has read most
// about: the United States, the United Kingdom, Germany, Canada, Australia. The other
// forty-nine countries we support were effectively invisible, and several of them are
// markedly EASIER for a Pakistani applicant than the famous five - fully funded, taught in
// English, with a mission in Islamabad and a real post-study work route.
//
// WHAT THIS IS NOT. These are not visa statistics and must never be presented as such.
// They are structural facts about each destination - is the teaching in English, is there
// tuition, is there a mission in Pakistan, are stipends normal, is there a work route
// afterwards, is there an established Pakistani pipeline - scored on a deliberately coarse
// 0-5 scale. A coarse honest heuristic beats a precise invented number.
//
// HOW IT IS USED. Only in two places, and never against the applicant's own choices:
//   1. When NO country filter is set, to plan search coverage across all 54 destinations
//      in accessibility order, instead of letting the model pick its favourites.
//   2. As a tiebreaker between two opportunities of equal match quality.
// A country the applicant explicitly asked for is always searched first and never demoted.

/* Factors, each 0-5:
   lang  - can this be done in English, without a local language for daily life and study
   cost  - affordability: tuition level and living cost against a Pakistani budget
   fund  - how normal it is for a position here to be funded or salaried
   visa  - practicality of the route: mission in Pakistan, documented process, timelines
   work  - post-study or post-contract work rights, and family/dependant routes
   comm  - an established Pakistani pipeline, so the path is proven and help exists   */
const C = (lang, cost, fund, visa, work, comm, note) => ({ lang, cost, fund, visa, work, comm, note });

const ACCESS = {
  DE: C(4, 5, 5, 4, 5, 5, 'No tuition at public universities, English-taught masters and doctoral positions are normal, and research posts are salaried. The largest proven Pakistani route in Europe.'),
  NO: C(5, 4, 5, 4, 4, 3, 'No tuition for most programmes, English-taught research positions, salaried PhD posts.'),
  FI: C(5, 4, 5, 4, 4, 3, 'Doctoral researchers are employed and paid; English is the working language of research.'),
  SE: C(5, 3, 5, 4, 4, 4, 'PhD positions are salaried employment, taught in English.'),
  DK: C(5, 3, 5, 4, 4, 3, 'PhD is a paid job, English-speaking research environment.'),
  NL: C(5, 3, 5, 4, 5, 4, 'Almost everything at postgraduate level is in English; PhD candidates are employees.'),
  AT: C(4, 4, 4, 4, 4, 3, 'Low fees, English-taught doctoral programmes, salaried research posts.'),
  BE: C(4, 3, 4, 4, 4, 3, 'Funded doctoral and postdoc posts, English-taught at research level.'),
  IE: C(5, 2, 4, 4, 5, 4, 'Fully English-speaking, strong post-study work permission.'),
  GB: C(5, 1, 3, 4, 4, 5, 'Highest fees and living cost of any destination we serve, but the most established Pakistani route and a graduate work route.'),
  PL: C(4, 5, 3, 4, 3, 3, 'Very low cost of living, growing English-taught provision.'),
  CZ: C(4, 5, 3, 4, 3, 3, 'Free tuition in Czech, low-cost English programmes, low living cost.'),
  HU: C(4, 5, 4, 4, 3, 3, 'Stipendium Hungaricum funds Pakistani students every year; low living cost.'),
  EE: C(5, 4, 3, 3, 3, 2, 'English-taught and digital-first, low cost.'),
  LV: C(4, 5, 3, 3, 3, 2, 'Low cost, English-taught programmes.'),
  LT: C(4, 5, 3, 3, 3, 2, 'Low cost, English-taught programmes, growing research funding.'),
  PT: C(4, 4, 3, 3, 3, 2, 'Affordable living, English at postgraduate level.'),
  ES: C(3, 4, 3, 4, 3, 3, 'Affordable, though Spanish is needed for daily life outside the lab.'),
  IT: C(3, 4, 4, 4, 3, 3, 'Low fees and regional scholarships; Italian needed outside research.'),
  FR: C(3, 4, 4, 4, 4, 3, 'Very low public tuition; French needed for daily life.'),
  CH: C(4, 2, 5, 3, 3, 2, 'The highest research salaries in Europe, offset by the highest living cost.'),
  LU: C(4, 3, 5, 3, 3, 1, 'Small, very well funded, English-friendly research posts.'),
  MT: C(5, 3, 2, 3, 3, 2, 'English is an official language.'),
  CY: C(5, 4, 2, 3, 3, 2, 'English-taught, affordable.'),
  GR: C(3, 4, 2, 3, 2, 2, 'Affordable; Greek needed outside the university.'),
  HR: C(3, 4, 2, 3, 2, 1, 'Low cost, limited English-taught provision.'),
  SI: C(3, 4, 3, 3, 2, 1, 'Low cost, some English-taught programmes.'),
  SK: C(3, 5, 2, 3, 2, 1, 'Very low cost of living.'),
  BG: C(3, 5, 2, 3, 2, 2, 'Lowest living cost in the EU.'),
  RO: C(3, 5, 2, 3, 2, 2, 'Low cost, some English-taught medical and technical programmes.'),
  US: C(5, 1, 4, 3, 3, 5, 'Funded doctoral and postdoc positions are excellent, but application fees, tests and visa interviews make it the most expensive route to attempt.'),
  CA: C(5, 2, 4, 3, 5, 5, 'Strong funding and the clearest permanent-residence route, though costs and processing times are high.'),
  AU: C(5, 2, 4, 4, 5, 5, 'Well-funded research training and strong post-study work rights.'),
  NZ: C(5, 2, 3, 4, 4, 3, 'English-speaking with a clear post-study work route.'),
  AE: C(5, 3, 3, 5, 3, 5, 'Fastest and most familiar route of all: English at work, an established Pakistani community, and employment visas processed in weeks rather than months.'),
  SA: C(4, 4, 4, 5, 3, 5, 'Large salaried demand in health and academia, tax-free, with a well-worn Pakistani hiring pipeline.'),
  QA: C(5, 3, 4, 5, 3, 4, 'English-speaking workplaces, strong salaries, quick processing.'),
  OM: C(4, 4, 3, 5, 2, 4, 'Established Pakistani professional presence.'),
  BH: C(5, 4, 3, 5, 2, 4, 'English-speaking, straightforward employment route.'),
  KW: C(4, 4, 3, 4, 2, 4, 'Strong salaries in health sectors.'),
  TR: C(3, 5, 4, 4, 3, 4, 'Turkiye Burslari is a major funded route for Pakistani students; low living cost.'),
  AZ: C(3, 5, 3, 4, 2, 3, 'Low cost, government scholarships, close cultural ties.'),
  GE: C(4, 5, 2, 4, 2, 3, 'Very low cost, English-taught medical programmes, simple visa route.'),
  KZ: C(3, 5, 3, 4, 2, 3, 'Low cost, state scholarships.'),
  UZ: C(3, 5, 2, 4, 2, 3, 'Low cost, growing English-taught provision.'),
  MY: C(5, 5, 3, 5, 3, 5, 'English-taught, very affordable, large Pakistani student population, simple visa.'),
  SG: C(5, 2, 5, 4, 3, 3, 'Outstanding funding and English-speaking, though living cost is high.'),
  JP: C(3, 3, 5, 4, 3, 3, 'MEXT and university scholarships are generous; Japanese needed outside the lab.'),
  KR: C(3, 4, 5, 4, 3, 3, 'Korean government and university scholarships are generous and well documented.'),
  CN: C(3, 5, 5, 5, 2, 5, 'CSC scholarships fund very large numbers of Pakistani students; the most heavily used funded route of all.'),
  HK: C(5, 3, 5, 4, 3, 3, 'English-language universities with well-funded fellowships.'),
  TW: C(4, 5, 5, 4, 2, 3, 'Generous government scholarships, English-taught graduate programmes, low cost.'),
  TH: C(4, 5, 3, 4, 2, 3, 'Affordable, English-taught graduate programmes.'),
  BN: C(5, 4, 3, 4, 2, 2, 'English-speaking, funded government scholarships.'),
  AZE: C(3, 5, 3, 4, 2, 3, 'Alias guard, not a real code.')
};
delete ACCESS.AZE;

/* TWO FACTORS THE STRUCTURAL TABLE ABOVE CANNOT CARRY.
   pay    - what a funded position here is actually worth once local living cost is paid.
            A Swiss postdoc and a Hungarian stipend are both "funded" and are not
            remotely the same offer, and an applicant asking for "any country" is
            usually asking, in effect, for the best-paid one they can realistically get.
   aspire - honest demand. Pakistani applicants overwhelmingly want the United States,
            the United Kingdom, Canada, Australia and western Europe, and a ranking that
            buries them under technically-easier destinations is a ranking people will
            not trust, however defensible it is. Ignoring that preference is not
            neutrality, it is being wrong about what the user wants.
   Both 0-5, default 3 for anything unlisted. */
const PAY = { CH: 5, LU: 5, DK: 5, NO: 5, US: 5, SG: 5, NL: 4, SE: 4, FI: 4, DE: 4, AT: 4, IE: 4, AU: 4, CA: 4, HK: 4, QA: 4, AE: 4, SA: 4, KW: 4, BE: 4, GB: 3, JP: 3, KR: 3, NZ: 3, FR: 3, IT: 3, ES: 3, TW: 3, BH: 3, OM: 3, CN: 3, MY: 2, PL: 2, CZ: 2, HU: 2, PT: 2, EE: 2, LV: 2, LT: 2, SI: 2, SK: 2, HR: 2, GR: 2, RO: 2, BG: 2, TR: 2, TH: 2, BN: 3, MT: 2, CY: 2, GE: 1, AZ: 1, KZ: 1, UZ: 1 };
const ASPIRE = { US: 5, GB: 5, CA: 5, AU: 5, DE: 5, IT: 4, FR: 4, NL: 4, SE: 4, IE: 4, NZ: 4, NO: 4, DK: 4, FI: 4, CH: 4, AT: 4, BE: 4, ES: 4, SA: 4, AE: 4, QA: 4, JP: 3, KR: 3, SG: 3, CN: 3, TR: 3, MY: 3, PT: 3, PL: 3, HU: 3, CZ: 3, KW: 3, BH: 3, OM: 3, HK: 3, TW: 2, TH: 2, GR: 2, RO: 2, BG: 2, SK: 2, SI: 2, HR: 2, EE: 2, LV: 2, LT: 2, LU: 3, MT: 2, CY: 2, BN: 2, GE: 2, AZ: 2, KZ: 2, UZ: 1 };

const W = { lang: 1.15, cost: 1.0, fund: 1.15, visa: 1.1, work: 0.85, comm: 0.75, pay: 1.2, aspire: 1.1 };

/* 0-100. Deliberately blunt: the purpose is ordering, not precision. */
function accessScore(cc) {
  const u = String(cc || '').toUpperCase();
  const a = ACCESS[u];
  if (!a) return 50;
  const full = Object.assign({}, a, { pay: PAY[u] || 3, aspire: ASPIRE[u] || 3 });
  let sum = 0, max = 0;
  for (const k of Object.keys(W)) { sum += (full[k] || 0) * W[k]; max += 5 * W[k]; }
  return Math.round((sum / max) * 100);
}
/* Ordering WITHIN a set the applicant chose themselves. They picked these countries, so
   nothing is added or removed - we only decide which to search first and which to list
   first among equals. Previously a chosen set was searched in whatever order the user
   happened to tap the flags in. */
function orderChosen(codes) {
  return (codes || []).slice().sort((x, y) => accessScore(y) - accessScore(x));
}
function accessNote(cc) {
  const a = ACCESS[String(cc || '').toUpperCase()];
  return a ? a.note : '';
}
/* Countries in accessibility order, optionally restricted to a supported set. */
function ranked(limitTo) {
  const set = (limitTo && limitTo.length) ? new Set(limitTo.map(x => String(x).toUpperCase())) : null;
  return Object.keys(ACCESS)
    .filter(cc => !set || set.has(cc))
    .sort((x, y) => accessScore(y) - accessScore(x));
}
/* Three coverage bands. Every supported destination lands in exactly one, so a search
   with no country filter still sweeps all of them across its passes instead of returning
   to the same five names every time. */
function tiers(limitTo) {
  const r = ranked(limitTo);
  const n = Math.ceil(r.length / 3);
  return [r.slice(0, n), r.slice(n, n * 2), r.slice(n * 2)];
}
module.exports = { ACCESS, PAY, ASPIRE, accessScore, accessNote, ranked, tiers, orderChosen };
