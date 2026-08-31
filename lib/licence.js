/* ForiForeign - licence resolver.
 *
 * SCOPE NOTE, read this before changing anything here.
 * ForiForeign does NOT help anyone obtain a licence. Licensing applications require
 * uploading originals to a regulator portal in a slow, sensitive, personal process that
 * no third party should touch, so we neither prepare those documents nor apply on
 * anyone's behalf, and nothing in the product may claim otherwise.
 *
 * This module exists for the opposite reason: when an applicant ALREADY HOLDS a licence
 * or registration, we take what they typed, correct the spelling, identify what it
 * actually is, and use it to find jobs they are genuinely eligible for. The applicant
 * types freely; they are never shown a list to pick from.
 */

// Lazy require: the offline matcher must work without a database connection.
const admin = () => require('./supa').admin();

/* A seed of widely-held credentials across professions and destinations. This is not a
   menu and is never rendered to the user: it is the fast, offline path so a common entry
   resolves without an AI call. Anything not here goes to the resolver below, which can
   identify a credential from any profession in any of our destination countries. */
const ATLAS = [
  // Medicine
  { code: 'GMC', name: 'GMC registration (UK)', authority: 'General Medical Council', profession: 'Medicine', cc: ['GB'], alias: ['gmc', 'gmc registration', 'plab passed', 'plab', 'ukmla', 'uk medical licence'] },
  { code: 'ECFMG', name: 'ECFMG certification (USA)', authority: 'ECFMG', profession: 'Medicine', cc: ['US'], alias: ['ecfmg', 'usmle', 'usmle step 1', 'usmle step 2', 'us medical licence'] },
  { code: 'MCC', name: 'Medical Council of Canada registration', authority: 'Medical Council of Canada', profession: 'Medicine', cc: ['CA'], alias: ['mccqe', 'mcc', 'lmcc', 'canada medical licence'] },
  { code: 'AHPRA_MED', name: 'AHPRA medical registration (Australia)', authority: 'AHPRA / Medical Board of Australia', profession: 'Medicine', cc: ['AU'], alias: ['ahpra', 'amc', 'amc mcq', 'australian medical registration'] },
  { code: 'MCNZ', name: 'MCNZ registration (New Zealand)', authority: 'Medical Council of New Zealand', profession: 'Medicine', cc: ['NZ'], alias: ['mcnz', 'nzrex'] },
  { code: 'DHA', name: 'DHA licence (Dubai)', authority: 'Dubai Health Authority', profession: 'Health professions', cc: ['AE'], alias: ['dha', 'dha licence', 'dha license', 'sheryan', 'dubai health authority'] },
  { code: 'DOH_AD', name: 'DOH licence (Abu Dhabi)', authority: 'Department of Health Abu Dhabi', profession: 'Health professions', cc: ['AE'], alias: ['doh', 'haad', 'doh abu dhabi', 'abu dhabi licence'] },
  { code: 'MOHAP', name: 'MOHAP licence (UAE)', authority: 'Ministry of Health and Prevention, UAE', profession: 'Health professions', cc: ['AE'], alias: ['mohap', 'moh uae'] },
  { code: 'SCFHS', name: 'SCFHS classification / registration (Saudi Arabia)', authority: 'Saudi Commission for Health Specialties', profession: 'Health professions', cc: ['SA'], alias: ['scfhs', 'mumaris', 'mumaris plus', 'saudi commission', 'saudi classification'] },
  { code: 'QCHP', name: 'QCHP licence (Qatar)', authority: 'Qatar Council for Healthcare Practitioners', profession: 'Health professions', cc: ['QA'], alias: ['qchp', 'dhp qatar', 'qatar licence'] },
  { code: 'OMSB', name: 'Oman MOH / OMSB licence', authority: 'Oman Medical Specialty Board', profession: 'Health professions', cc: ['OM'], alias: ['omsb', 'oman moh licence'] },
  { code: 'NHRA', name: 'NHRA licence (Bahrain)', authority: 'National Health Regulatory Authority', profession: 'Health professions', cc: ['BH'], alias: ['nhra', 'bahrain licence'] },
  { code: 'MOH_KW', name: 'Kuwait MOH licence', authority: 'Ministry of Health, Kuwait', profession: 'Health professions', cc: ['KW'], alias: ['kuwait moh', 'moh kuwait'] },
  // Nursing
  { code: 'NMC', name: 'NMC registration (UK nursing)', authority: 'Nursing and Midwifery Council', profession: 'Nursing', cc: ['GB'], alias: ['nmc', 'nmc pin', 'cbt osce', 'uk nursing registration'] },
  { code: 'NCLEX', name: 'NCLEX-RN licensure (USA nursing)', authority: 'State Board of Nursing', profession: 'Nursing', cc: ['US'], alias: ['nclex', 'nclex rn', 'rn licence usa'] },
  { code: 'CGFNS', name: 'CGFNS certificate / VisaScreen', authority: 'CGFNS International', profession: 'Nursing', cc: ['US'], alias: ['cgfns', 'visascreen'] },
  { code: 'AHPRA_NUR', name: 'AHPRA nursing registration (Australia)', authority: 'AHPRA / NMBA', profession: 'Nursing', cc: ['AU'], alias: ['nmba', 'australian nursing registration'] },
  // Pharmacy
  { code: 'GPHC', name: 'GPhC registration (UK pharmacy)', authority: 'General Pharmaceutical Council', profession: 'Pharmacy', cc: ['GB'], alias: ['gphc', 'ospap', 'uk pharmacist registration'] },
  { code: 'PEBC', name: 'PEBC certification (Canada pharmacy)', authority: 'Pharmacy Examining Board of Canada', profession: 'Pharmacy', cc: ['CA'], alias: ['pebc', 'canada pharmacy licence'] },
  { code: 'NABP', name: 'FPGEC / NAPLEX licensure (USA pharmacy)', authority: 'NABP and state Board of Pharmacy', profession: 'Pharmacy', cc: ['US'], alias: ['fpgee', 'fpgec', 'naplex', 'mpje', 'nabp'] },
  { code: 'APC', name: 'Pharmacy Board of Australia registration', authority: 'Australian Pharmacy Council / AHPRA', profession: 'Pharmacy', cc: ['AU'], alias: ['kaps', 'apc', 'australian pharmacy registration'] },
  { code: 'PCP', name: 'Pharmacy Council of Pakistan registration', authority: 'Pharmacy Council of Pakistan', profession: 'Pharmacy', cc: ['PK'], alias: ['pcp', 'pharmacy council of pakistan', 'category a pharmacist', 'pakistan pharmacist registration'] },
  // Dentistry, allied health
  { code: 'GDC', name: 'GDC registration (UK dentistry)', authority: 'General Dental Council', profession: 'Dentistry', cc: ['GB'], alias: ['gdc', 'ore'] },
  { code: 'NDEB', name: 'NDEB certification (Canada dentistry)', authority: 'National Dental Examining Board of Canada', profession: 'Dentistry', cc: ['CA'], alias: ['ndeb'] },
  { code: 'ADC', name: 'Dental Board of Australia registration', authority: 'Australian Dental Council / AHPRA', profession: 'Dentistry', cc: ['AU'], alias: ['adc'] },
  { code: 'JCNDE', name: 'INBDE (USA dentistry)', authority: 'Joint Commission on National Dental Examinations', profession: 'Dentistry', cc: ['US'], alias: ['inbde', 'nbde'] },
  { code: 'HCPC', name: 'HCPC registration (UK allied health)', authority: 'Health and Care Professions Council', profession: 'Allied health', cc: ['GB'], alias: ['hcpc'] },
  { code: 'FSBPT', name: 'NPTE licensure (USA physiotherapy)', authority: 'FSBPT and state PT board', profession: 'Physiotherapy', cc: ['US'], alias: ['npte', 'fsbpt', 'us physio licence'] },
  { code: 'ASCPI', name: 'ASCPi certification (laboratory)', authority: 'ASCP Board of Certification International', profession: 'Laboratory sciences', cc: ['US', 'AE', 'SA', 'QA'], alias: ['ascp', 'ascpi'] },
  // Engineering
  { code: 'PEC', name: 'Pakistan Engineering Council registration', authority: 'Pakistan Engineering Council', profession: 'Engineering', cc: ['PK'], alias: ['pec', 'pakistan engineering council'] },
  { code: 'NCEES', name: 'PE licensure (USA engineering)', authority: 'NCEES and state engineering board', profession: 'Engineering', cc: ['US'], alias: ['pe licence', 'fe exam', 'ncees', 'professional engineer usa'] },
  { code: 'CENG', name: 'CEng, Engineering Council (UK)', authority: 'Engineering Council', profession: 'Engineering', cc: ['GB'], alias: ['ceng', 'ieng', 'chartered engineer'] },
  { code: 'PENG', name: 'P.Eng registration (Canada)', authority: 'Provincial engineering regulator', profession: 'Engineering', cc: ['CA'], alias: ['peng', 'p.eng', 'apega', 'peo'] },
  { code: 'SCE', name: 'Saudi Council of Engineers membership', authority: 'Saudi Council of Engineers', profession: 'Engineering', cc: ['SA'], alias: ['sce', 'saudi council of engineers'] },
  { code: 'UPDA', name: 'UPDA / MMUP grade (Qatar)', authority: 'MMUP, Qatar', profession: 'Engineering', cc: ['QA'], alias: ['upda', 'mmup'] },
  { code: 'SOE', name: 'Society of Engineers UAE membership', authority: 'Society of Engineers, UAE', profession: 'Engineering', cc: ['AE'], alias: ['soe uae', 'uae engineer registration'] },
  // Finance, law, teaching, IT
  { code: 'ACCA', name: 'ACCA membership', authority: 'Association of Chartered Certified Accountants', profession: 'Accounting and finance', cc: ['GB'], alias: ['acca'] },
  { code: 'CPA', name: 'CPA licence', authority: 'State Board of Accountancy', profession: 'Accounting and finance', cc: ['US'], alias: ['cpa', 'us cpa'] },
  { code: 'ICAP', name: 'ICAP chartered accountant', authority: 'Institute of Chartered Accountants of Pakistan', profession: 'Accounting and finance', cc: ['PK'], alias: ['icap', 'ca pakistan'] },
  { code: 'CFA', name: 'CFA charter', authority: 'CFA Institute', profession: 'Finance', cc: ['US'], alias: ['cfa', 'cfa charterholder'] },
  { code: 'QTS', name: 'Qualified Teacher Status (UK)', authority: 'Department for Education', profession: 'Teaching', cc: ['GB'], alias: ['qts', 'uk teaching licence'] },
  { code: 'PMP', name: 'PMP certification', authority: 'Project Management Institute', profession: 'Project management', cc: ['US'], alias: ['pmp', 'pmi'] },
  { code: 'CISSP', name: 'CISSP certification', authority: 'ISC2', profession: 'Information security', cc: ['US'], alias: ['cissp'] },
  { code: 'ARB', name: 'ARB architect registration (UK)', authority: 'Architects Registration Board', profession: 'Architecture', cc: ['GB'], alias: ['arb', 'riba registration'] },
  // Language and verification credentials people commonly type in this box
  { code: 'OET', name: 'OET (healthcare English)', authority: 'OET', profession: 'Language credential', cc: [], alias: ['oet'] },
  { code: 'IELTS', name: 'IELTS', authority: 'IELTS Partners', profession: 'Language credential', cc: [], alias: ['ielts', 'ielts academic', 'ielts ukvi'] },
  { code: 'DATAFLOW', name: 'DataFlow primary-source verification completed', authority: 'DataFlow Group', profession: 'Verification', cc: ['AE', 'SA', 'QA', 'OM', 'BH', 'KW'], alias: ['dataflow', 'psv', 'primary source verification'] }
];

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/* Small edit distance, capped: enough to forgive "scfsh", "nclx", "p eng". */
function dist(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Offline match. Returns an ATLAS entry or null. */
function matchAtlas(text) {
  const q = norm(text);
  if (!q) return null;
  for (const e of ATLAS) for (const a of e.alias) if (a === q) return e;
  // Spacing and punctuation are not meaning: "P.Eng", "p eng" and "peng" are one thing.
  const flat = q.replace(/ /g, '');
  for (const e of ATLAS) for (const a of e.alias) if (a.replace(/ /g, '') === flat) return e;
  // Contained as a whole word, longest alias wins so "pebc canada" beats a stray "ca".
  let best = null, bestLen = 0;
  for (const e of ATLAS) for (const a of e.alias) {
    if (a.length >= 3 && new RegExp('(^| )' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(q) && a.length > bestLen) { best = e; bestLen = a.length; }
  }
  if (best) return best;
  // Spelling tolerance on the first token, which is where people type the acronym.
  const head = flat.length <= 12 ? flat : q.split(' ')[0];
  if (head.length >= 3) {
    let win = null, winD = 3;
    for (const e of ATLAS) for (const a of e.alias) {
      if (Math.abs(a.length - head.length) > 2) continue;
      const d = dist(head, a.replace(/ /g, ''));
      if (d < winD) { winD = d; win = e; }
    }
    if (win) return win;
  }
  return null;
}

/**
 * Resolve whatever the applicant typed into a real, named credential.
 * Never invents: if it cannot identify the credential it says so and the raw text is
 * still carried through, because the applicant's own words are better than nothing.
 */
async function resolveLicence(rawText, countries) {
  const raw = String(rawText || '').trim().slice(0, 120);
  if (!raw) return null;
  const hit = matchAtlas(raw);
  if (hit) {
    return { input: raw, code: hit.code, name: hit.name, authority: hit.authority,
      profession: hit.profession, countries: hit.cc, source: 'atlas', confident: true };
  }
  // Cache by normalised text: the same typo resolves once for everyone.
  const key = 'licq:' + norm(raw).slice(0, 60);
  try {
    const { data: row } = await admin().from('app_settings').select('value').eq('key', key).single();
    if (row && row.value && row.value.r) return Object.assign({}, row.value.r, { input: raw });
  } catch (e) {}
  const prompt = 'A Pakistani professional typed this into a field asking which professional licence or registration they ALREADY hold: "' + raw + '". '
    + 'It may be misspelled, abbreviated, or written informally, and it may belong to ANY profession (health, engineering, teaching, law, finance, IT, trades, aviation, agriculture, and so on). '
    + 'Identify it and return STRICT JSON only: {"name":"the correct full name of the credential","code":"short uppercase identifier","authority":"the regulator or awarding body","profession":"the profession it belongs to","countries":["ISO2 codes where this credential is issued or recognised"],"confident":true|false}. '
    + (Array.isArray(countries) && countries.length ? 'The applicant is targeting these countries, prefer a reading consistent with them: ' + countries.join(', ') + '. ' : '')
    + 'If you cannot identify it from a real regulator, set confident to false and put the applicant\'s own words in name. Never invent a regulator.';
  let out = null;
  try {
    const { geminiCall } = require('./gemini');
    const r = await geminiCall(prompt, { maxTokens: 400, json: true, search: true });
    out = typeof r === 'string' ? JSON.parse(String(r).replace(/```json|```/g, '').trim()) : r;
  } catch (e) { out = null; }
  if (!out || !out.name) return { input: raw, name: raw, code: '', authority: '', profession: '', countries: [], source: 'raw', confident: false };
  const res = { code: String(out.code || '').slice(0, 16), name: String(out.name).slice(0, 90),
    authority: String(out.authority || '').slice(0, 90), profession: String(out.profession || '').slice(0, 60),
    countries: Array.isArray(out.countries) ? out.countries.filter(c => /^[A-Za-z]{2}$/.test(String(c))).map(c => String(c).toUpperCase()).slice(0, 10) : [],
    source: 'resolved', confident: out.confident !== false };
  try { await admin().from('app_settings').upsert({ key, value: { at: new Date().toISOString(), r: res } }); } catch (e) {}
  return Object.assign({}, res, { input: raw });
}

module.exports = { resolveLicence, matchAtlas, ATLAS };
