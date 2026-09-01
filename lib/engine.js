// lib/engine.js — ForiForeign pipeline: discover -> verify -> prepare -> draft
// Ported from the battle-tested PostDocX rules: evidence-only, no invented emails,
// truthful documents, no AI-smell, guaranteed drafts, human authorization (R4).
const { admin } = require('./supa');
const { callAI } = require('./router');

const STYLE = `You are a senior professional writer preparing documents that carry a real person's professional identity. Write as a thoughtful human expert would, never as a machine.

STRICT OUTPUT RULES: never use the words tailored, customized, leverage, synergy, AI, Claude, GPT, Gemini, generated, or template. Never leave placeholder brackets like [name] or blank fields; omit unknowns and write around them. No em dashes or en dashes anywhere.

FORMAT LAW: never output markdown symbols such as **, ##, backticks or asterisk bullets. Structure with SECTION HEADINGS IN CAPITALS on their own line, hyphen (-) lists where a list is natural, and clean spacing. Finish every sentence; never stop mid-thought.

HUMAN VOICE, this is what separates a professional document from an obvious machine draft:
- Vary sentence length deliberately. Follow a long, detailed sentence with a short, firm one.
- Never begin consecutive sentences or bullets with the same word or construction.
- Never repeat a sentence or a phrase anywhere in the document.
- Prefer concrete specifics over abstract praise: name the programme, the standard, the system, the number, the journal, the regulator. A specific fact is always stronger than an adjective.
- Use plain, confident professional English. No breathless adjectives, no filler like "in today's competitive landscape", no throat-clearing openings.
- Write with quiet authority. State what the applicant did and what resulted, and let the facts carry the weight.
- Never write that something is unavailable, not stated or not found. If a detail is unknown, write around it naturally so the reader never notices a gap.

FACTUAL LAW: use ONLY facts present in the applicant profile. Never invent an employer, a date, a qualification, a publication or a number. Every claim must be traceable to the profile. Completeness matters as much as accuracy: include every relevant real detail, never summarise away substance.

Respond with the final document text only.`;

function parseJSON(t) {
  if (!t) return null;
  const s2 = String(t).replace(/```json|```/g, '');
  // Normalizer: whatever shape the model returns, callers ALWAYS get an array.
  // {"results":[...]} -> inner array; single object -> [object]. This one line of
  // shape drift ("items.map is not a function") silently zeroed every discovery.
  const norm = v => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const inner = Object.values(v).find(Array.isArray);
      return inner || [v];
    }
    return null;
  };
  // Fast path: outermost array/object by regex.
  try { const m = s2.match(/\[[\s\S]*\]|\{[\s\S]*\}/); if (m) { const r = norm(JSON.parse(m[0])); if (r) return r; } } catch (e) {}
  // Robust path: true bracket matching (string-aware) from the first '[' — citations,
  // preambles or trailing prose can never sink a good result again.
  // Walk EVERY candidate '[': prefer the first array of OBJECTS (real data), so a
  // stray citation marker like [1] earlier in the text can never win.
  let primitiveFallback = null;
  let start = s2.indexOf('[');
  while (start >= 0) {
    let depth = 0, inStr = false, escp = false, end = -1;
    for (let i = start; i < s2.length; i++) {
      const c = s2[i];
      if (escp) { escp = false; continue; }
      if (c === '\\') { escp = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > start) {
      try {
        const arr = JSON.parse(s2.slice(start, end + 1));
        if (Array.isArray(arr) && (arr.length === 0 || typeof arr[0] === 'object')) return arr;
        if (Array.isArray(arr) && primitiveFallback === null) primitiveFallback = arr;
      } catch (e) {}
    }
    start = s2.indexOf('[', start + 1);
  }
  if (primitiveFallback) return primitiveFallback;
  // TRUNCATION SALVAGE: long grounded answers can get cut mid-array (no closing
  // bracket). Scan for every COMPLETE top-level {...} object (string-aware) and
  // parse each individually — a cut-off response still yields all finished items.
  const objs = [];
  let d2 = 0, st2 = -1, inS = false, es2 = false;
  for (let i = 0; i < s2.length; i++) {
    const c = s2[i];
    if (es2) { es2 = false; continue; }
    if (c === '\\') { es2 = true; continue; }
    if (c === '"') { inS = !inS; continue; }
    if (inS) continue;
    if (c === '{') { if (d2 === 0) st2 = i; d2++; }
    else if (c === '}') { d2--; if (d2 === 0 && st2 >= 0) { try { const o = JSON.parse(s2.slice(st2, i + 1)); if (o && typeof o === 'object') objs.push(o); } catch (e) {} st2 = -1; } }
  }
  if (objs.length) return objs.length === 1 ? norm(objs[0]) : objs;
  return null;
}
const noSmell = t => String(t || '')
  .replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',').replace(/,\s*\./g, '.')
  .replace(/\[(?:insert|your|add|name|date|university|position)[^\]]*\]/gi, '');

const cleanEmails = arr => [...new Set((arr || [])
  .map(e => String(e || '').replace(/^mailto:/i, '').trim().replace(/[.,;:]+$/, '').toLowerCase())
  .filter(e => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(e) && !/(example|test)\.(com|org)$/.test(e.split('@')[1])))]
  .sort((a, b) => (/(gmail|yahoo|hotmail|outlook)\./.test(a) ? 1 : 0) - (/(gmail|yahoo|hotmail|outlook)\./.test(b) ? 1 : 0));

/* ---------- DISCOVERY: profile-driven, evidence-only, verified at birth ---------- */
/* Multi-dimensional search strategy shared by every discovery call. */
function searchStrategy() {
  const today = new Date().toISOString().slice(0, 10);
  return 'SEARCH STRATEGY, multi-source and broad: (1) official university/employer admissions and careers pages on their own domains; (2) funding and vacancy databases as discovery leads — EUROPE: DAAD, study-in-germany.de, Campus France, studyinsweden.se, studyinfinland.fi, studyinnorway.no, Study in Denmark/Holland/Austria portals, Erasmus Mundus catalogue, Euraxess, ScholarshipPortal, FindAPhD, FindAMasters, jobs.ac.uk, Academic Positions, THEunijobs, EURES, Turkiye Burslari; PAKISTAN-TRUSTED: HEC Pakistan foreign scholarships (hec.gov.pk), USEFP Fulbright Pakistan; USA: Fulbright, HigherEdJobs, HERC, Science Careers, Nature Careers; CANADA: University Affairs, Canada Job Bank, Vanier/Banting; AUSTRALIA/NZ: Australia Awards, RTP listings, Seek, UniJobs AU, Seek NZ, University of Auckland/Otago scholarship pages; GULF AND HEALTHCARE: SCFHS careers, DHA jobs portal, Hamad Medical Corporation careers, SEHA UAE, Kuwait/Oman/Bahrain MOH careers, GulfTalent, Bayt, Naukrigulf; GLOBAL: Chevening, Commonwealth Scholarships, MEXT, China CSC, Korea GKS, LinkedIn Jobs, Indeed, ResearchGate jobs; cover ALL career families: healthcare (doctors, nurses, pharmacists, allied health), natural sciences, engineering, IT, business, social sciences, education, and every study level; (3) RESEARCH LABS AND INSTITUTES (crucial, do not skip): named research institutes and labs on their OWN pages — Max Planck, Fraunhofer, Helmholtz, CNRS, INSERM, Francis Crick, EMBL, Wellcome Sanger, MRC units (Europe/UK); NIH, HHMI, Broad, Cold Spring Harbor, national labs (USA); CSIRO, WEHI, Garvan (Australia); KAUST, QF research institutes, Sidra, KFSH&RC research (Gulf); and individual professor/PI lab pages that advertise openings directly; (4) SMALL AND NATIVE EMPLOYERS: small private clinics, community hospitals, district health boards, local pharmacies, SME engineering firms and startups that hire internationally — not only the big institutions; (5) public posts and advertisements: professor/lab/department announcements on LinkedIn (lead searches like: linkedin.com/posts PhD position <field> <country>; site:linkedin.com/jobs <role> <city>), X/Twitter posts, Facebook groups and pages where jobs and scholarships are actively posted (country-specific Jobs-in groups, Pakistani-professionals-abroad groups, nursing and doctor recruitment groups), Telegram and WhatsApp public channels, Reddit r/<country>jobs, and local/national job platforms specific to each country (e.g. StepStone/Xing Germany, Seek AU/NZ, Bayt/GulfTalent/Naukrigulf Gulf, Jobbank Canada, Indeed local domains, Pracuj Poland, The Local job boards) — all used ONLY as leads. EVERY fact must then be verified on the official institutional page before reporting, and the url you report must be that official page, openable by anyone, so the user can personally verify it. Never cite a portal or a social post as the source. FRESHNESS, today is ' + today + ': the deadline must be ' + today + ' or later, or the official page must literally state applications are open or rolling; reject expired, closed or unverifiable listings. Read pages with URL context, never rely on snippets. Report ONLY facts literally present on official pages, leave everything else empty.\n\n';
}

/* Comparable nearby destinations, used ONLY to complete a package when the user's
   priority countries cannot fill it. Priority order is always: selected countries first. */
const NEARBY = {
  US:['CA'],CA:['US'],GB:['IE'],IE:['GB'],AU:['NZ'],NZ:['AU'],
  DE:['AT','NL','CH','DK','BE'],AT:['DE','CH'],NL:['DE','BE'],BE:['NL','FR','DE'],CH:['DE','AT','FR'],
  FR:['BE','CH','LU'],IT:['AT','CH','SI'],ES:['PT','FR'],PT:['ES'],
  SE:['NO','DK','FI'],NO:['SE','DK'],DK:['SE','DE','NO'],FI:['SE','EE'],EE:['FI','LV'],LV:['EE','LT'],LT:['LV','PL'],
  PL:['DE','CZ','LT'],CZ:['DE','AT','PL'],HU:['AT','CZ','PL'],
  SA:['AE','QA','BH','KW','OM'],AE:['SA','QA','OM','BH'],QA:['AE','SA','BH'],BH:['SA','AE','QA'],KW:['SA','AE'],OM:['AE','SA'],
  MY:['SG','ID'],SG:['MY'],JP:['KR'],KR:['JP'],CN:['HK','MY'],TR:['AZ','GE']
};
function expandCountries(codes) {
  const out = new Set(codes);
  for (const c of codes) (NEARBY[c] || []).forEach(x => out.add(x));
  return [...out];
}
async function discoverForUser(userId, kind, prefs) {
  prefs = prefs || {};
  /* How many verified positions this run should end with. The old ceiling of 20 with a
     floor of 1 meant a search could legitimately stop after finding a handful, which is
     what made a real search feel empty. Fifteen minimum, sixty maximum. */
  const target = Math.min(60, Math.max(15, Number(prefs.target) || 15));
  const priority = Array.isArray(prefs.countries) ? prefs.countries.filter(c => /^[A-Za-z]{2}$/.test(String(c))).map(c => String(c).toUpperCase()) : [];
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const freshCount = async scope => {
    try {
      let q = admin().from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'verified').gte('created_at', since);
      if (kind) q = q.eq('kind', kind);
      if (scope && scope.length) q = q.in('country_code', scope);
      const { count } = await q; return count || 0;
    } catch (e) { return 0; }
  };
  const { data: p } = await admin().from('profiles').select('*').eq('id', userId).single();
  if (!p) return 0;
  kind = kind || (p.mode === 'work' ? 'work' : 'postdoc');
  // Skip the search ONLY when this user already has genuinely relevant fresh supply —
  // generic inventory that doesn't fit their profile must never block their search.
  if (await freshCount(priority.length ? priority : null) >= target) {
    try {
      const { matchMany } = require('./match');
      let q = admin().from('opportunities').select('*').eq('status', 'verified').gte('created_at', since).order('created_at', { ascending: false }).limit(200);
      q = kind === 'work' ? q.eq('kind', 'work') : q.in('kind', ['study', 'scholarship', 'postdoc']);
      if (priority.length) q = q.in('country_code', priority);
      const { data: fr } = await q;
      const ms = await matchMany(userId, fr || []);
      const relevant = (ms || []).filter(m => m && m.pct != null && m.pct >= 60).length;
      /* Only skip the search when the existing fresh supply genuinely COVERS the target.
         Stopping at three relevant rows was the single biggest reason a search returned
         a near-empty screen: three matches in the database cancelled the entire hunt. */
      if (relevant >= target) return 0;
    } catch (e) { /* on any doubt, search */ }
  }
  const fundedOnly = prefs.fundedOnly || p.funded_only;
  const budgetLine = fundedOnly ? 'ONLY fully funded/salaried positions.' : (Number(p.annual_budget_pkr) > 0 ? 'Annual budget PKR ' + p.annual_budget_pkr + ', prefer affordable or funded options and label estimated costs.' : '');
  let licenseLine = '';  // set after deep profile (px) loads below
  // Spec 2: admin-curated university priority list guides (never limits) discovery.
  let uniLine = '';
  try {
    let uq = admin().from('universities').select('name,country_code').eq('enabled', true).order('priority').limit(60);
    if (priority.length) uq = uq.in('country_code', priority);
    let { data: unis } = await uq;
    if ((!unis || !unis.length) && priority.length) ({ data: unis } = await admin().from('universities').select('name,country_code').eq('enabled', true).order('priority').limit(40));
    if (unis && unis.length) uniLine = 'PRIORITY INSTITUTIONS (search these first — their official pages, department vacancy pages and professor group pages — but NEVER limit yourself to them): ' + unis.map(u => u.name + ' (' + u.country_code + ')').join('; ') + '.';
  } catch (e) {}
  // Package fulfillment: widening passes — priority countries, then comparable
  // nearby destinations, then the best available worldwide — until the target is met.
  const passes = priority.length ? [priority, expandCountries(priority), null] : [null];
  // Each pass attacks from a different source family, so three passes never mine
  // the same vein three times — coverage compounds instead of repeating.
  const ANGLES = [
    'ANGLE FOR THIS PASS: prioritise OFFICIAL university admissions pages, department vacancy pages and employer career portals.',
    'ANGLE FOR THIS PASS: prioritise funding databases, scholarship portals and government scheme pages (verify each on the official page).',
    'ANGLE FOR THIS PASS: prioritise fresh announcements — LinkedIn posts by professors/labs/HR, X posts, department news, conference job boards (verify each on the official page).'
  ];
  // Coverage memory: never re-serve institutions already fresh in the database.
  let knownLine = '';
  try {
    let kq = admin().from('opportunities').select('institution').eq('status', 'verified').order('created_at', { ascending: false }).limit(30);
    kq = kind === 'work' ? kq.eq('kind', 'work') : kq.in('kind', ['study', 'scholarship', 'postdoc']);
    const { data: kn } = await kq;
    const names = [...new Set((kn || []).map(x => x.institution).filter(Boolean))].slice(0, 15);
    if (names.length) knownLine = 'ALREADY IN OUR DATABASE (find DIFFERENT institutions, do NOT repeat these): ' + names.join('; ') + '.';
  } catch (e) {}
  let added = 0, lastPrompt = null;
  for (let pi = 0; pi < passes.length; pi++) {
  const scope = passes[pi];
  const countryLine = prefs.remote
    ? 'COUNTRY SCOPE for the remote lane: search employers registered in ANY of these destinations, because the work itself is done from Pakistan: '
      + (scope && scope.length ? scope.join(', ') : (priority.length ? priority.join(', ') : 'all supported destinations'))
      + '. Also include genuinely borderless remote-first employers with no single office country.'
    : scope
    ? (pi === 0
      ? 'STRICT COUNTRY SCOPE for this pass, only: ' + scope.join(', ') + '.'
      : 'PRIORITY COUNTRIES first: ' + priority.join(', ') + '. To complete the set, comparable nearby destinations are allowed: ' + scope.filter(c => priority.indexOf(c) < 0).join(', ') + '.')
    : (priority.length ? 'PRIORITY COUNTRIES first: ' + priority.join(', ') + ', then the best available worldwide.' : '');
  /* REMOTE IS A WORLDWIDE LANE, NOT A COUNTRY FILTER. When the applicant asks for
     remote, geography stops being a wall: a remote-worldwide employer registered in any
     of our destination countries can hire from Pakistan. So we hunt across the whole
     destination set AND the remote-first job sources, and we force the agent to state
     the eligibility geography exactly, because "remote (US only)" is useless here. */
  const REMOTE_ATLAS = 'REMOTE SOURCE ATLAS, search these thoroughly and follow through to the employer official page before accepting anything: '
    + 'the careers pages of remote-first employers; LinkedIn Jobs with the Remote filter; Indeed worldwide with remote filters; '
    + 'Wellfound (AngelList Talent); WeWorkRemotely; RemoteOK; Remotive; Working Nomads; JustRemote; Remote.co; FlexJobs; Jobspresso; Himalayas; '
    + 'Otta; Arc.dev; Toptal; Turing; Andela; Crossover; Deel Jobs; Remote.com Jobs; Oyster Jobs; '
    + 'EURAXESS (remote and hybrid research posts across Europe); Nature Careers, Times Higher Education Unijobs, jobRxiv, AcademicPositions and ResearchGate Jobs filtered for remote or hybrid; '
    + 'UN Careers, WHO Careers, UNDP Jobs, ReliefWeb, Devex, Impactpool and Idealist for remote international-development and public-health roles; '
    + 'Upwork Enterprise, Contra and Braintrust for contract remote roles; and national portals of every destination country that publish telework vacancies (for example EURES for the EU, Bundesagentur fur Arbeit for Germany, Werk.nl for the Netherlands, Bayt and GulfTalent remote listings for the Gulf).';
  const REMOTE_RULES = 'REMOTE RULES, ABSOLUTE: (1) Search ALL destination countries in scope, not one, because a remote role is not tied to where the applicant lives. '
    + '(2) Return a role ONLY if the official page states it is remote worldwide, remote international, work-from-anywhere, or hybrid with the remote portion open to applicants outside the country. '
    + '(3) If the page restricts remote work to residents of one country or region, you MUST record that restriction verbatim and set remote to false, never present it as remote. '
    + '(4) Set the remote field to the string "true" ONLY when a Pakistan-based applicant could legally hold the role, and put the exact eligibility wording in salary_note or fee_structure. '
    + '(5) Include contract, freelance-to-permanent, employer-of-record (Deel, Remote.com, Oyster, Globalization Partners) and fully distributed roles, since these are the routes that genuinely hire from Pakistan. '
    + '(6) Match every role to the CANDIDATE PROFILE below: their degrees, certifications, licences, publications, software and methods. Do not return generic remote work they are not qualified for, and do not skip a role merely because the title differs from their current one when their stated skills genuinely cover it.';
  const remoteLine = prefs.remote
    ? 'REMOTE LANE ACTIVE. ' + REMOTE_RULES + ' ' + REMOTE_ATLAS
    : (prefs.workmode === 'onsite' ? 'ON-SITE ONLY: exclude remote and work-from-home roles.' : '');
  // Career-stage intelligence: read the deep profile; if the user did not pick
  // levels manually, target the NEXT natural step (BS -> Masters, MS/MPhil -> PhD,
  // PhD -> Postdoc). Never show a PhD holder bachelor or master positions.
  let px = null;
  try { const { data: pxr } = await admin().from('app_settings').select('value').eq('key', 'profilex:' + userId).single(); px = pxr && pxr.value && pxr.value.x; } catch (e) {}
  let ladderLine = '';
  if (kind !== 'work' && !(prefs.levels && prefs.levels.length)) {
    const eduTxt = JSON.stringify((px && px.education) || p.education || '').toLowerCase();
    const highest = /phd|doctorate|dphil/.test(eduTxt) ? 'phd' : /mphil|\bms\b|msc|master/.test(eduTxt) ? 'masters' : /pharm-?d|\bbs\b|bsc|bachelor|\bbe\b|mbbs|\bbds\b/.test(eduTxt) ? 'bachelors' : null;
    if (highest === 'phd') { prefs.levels = ['postdoc']; ladderLine = 'CAREER STAGE: candidate holds a PhD. Target POSTDOC and research positions ONLY, never bachelor, master or PhD admissions.'; }
    else if (highest === 'masters') { prefs.levels = ['phd']; ladderLine = 'CAREER STAGE: candidate holds a Masters/MPhil. Target PhD-level positions and scholarships as the natural next step.'; }
    else if (highest === 'bachelors') { prefs.levels = ['masters']; ladderLine = 'CAREER STAGE: candidate holds a Bachelors. Target Masters/MPhil-level programmes as the natural next step, not PhD directly.'; }
  }
  { const _profIds = (px && px.professions && px.professions.length) ? px.professions.join(' and ') : (p.profession || '');
    licenseLine = kind === 'work' && _profIds ? 'Profession(s): ' + _profIds + '. Only roles a Pakistani-qualified ' + _profIds + ' can realistically be hired into. If the advert states a licence or registration requirement, record it EXACTLY as written so the applicant can judge it for themselves.' : ''; }
    const pxLine = px ? ('CANDIDATE DEPTH: professional identities ' + ((px.professions && px.professions.length) ? px.professions.join(' and ') : (px.profession || p.field || '')) + (px.total_experience_years ? ', ' + px.total_experience_years + ' years total experience' : '') + (px.certifications && px.certifications.length ? ', certifications: ' + px.certifications.slice(0, 5).join('; ') : '') + '.') : '';
  const progLine = (prefs.programTypes && prefs.programTypes.length) ? 'PROGRAMME TYPE: ' + prefs.programTypes.join(' or ').replace(/_/g, ' ') + ' offerings included.' : '';
  const sectorLine = (prefs.sectors && prefs.sectors.length) ? 'EMPLOYER SECTOR: ' + prefs.sectors.join(' or ').replace(/_/g, ' ') + '.' : '';
  /* LANE PREFERENCES. Study answers steer only a study search and job answers only a job
     search, because the two lanes are different products and mixing them produced
     results that fitted neither. */
  const laneLine = (() => {
    const L = [];
    if (prefs.lane !== 'work') {
      if (prefs.instruction === 'english') L.push('The programme must be taught fully in English; state the language of instruction for each result.');
      else if (prefs.instruction === 'local_ok') L.push('Programmes taught in the local language are acceptable; state the language and any required level.');
      else if (prefs.instruction === 'bilingual') L.push('Prefer bilingual or mixed-language programmes and state the split.');
      if (prefs.uniType === 'public') L.push('Prefer public universities.');
      else if (prefs.uniType === 'private') L.push('Prefer private universities.');
      else if (prefs.uniType === 'research') L.push('Prefer research institutes, centres and national laboratories over teaching-only universities.');
      else if (prefs.uniType === 'top_ranked') L.push('Prefer highly ranked institutions and state the ranking or reputation evidence you found.');
      if (prefs.appFee === 'none') L.push('Prefer places with NO application fee, and state the fee exactly when one exists.');
      if (prefs.deadlineIn === 'open') L.push('Prefer rolling admissions with no fixed deadline.');
      else if (prefs.deadlineIn) L.push('Prefer positions closing within ' + prefs.deadlineIn + ' days, and never return one already closed.');
      if (prefs.tuition === 'free') L.push('Prefer tuition-free places or full tuition waivers; state the tuition exactly as printed.');
      if (prefs.stipendPref === 'required') L.push('Only include places that pay a monthly stipend, and quote the figure as printed.');
    } else {
      if (prefs.visaPref === 'required') L.push('Only roles where the employer sponsors a work visa for a Pakistani national; state the sponsorship wording from the page.');
      else if (prefs.visaPref === 'not_needed') L.push('Visa sponsorship is not required for this applicant.');
      if (prefs.contractLen === 'permanent') L.push('Prefer permanent positions.');
      else if (prefs.contractLen === 'fixed') L.push('Prefer fixed-term contracts and state the term.');
      else if (prefs.contractLen === 'locum') L.push('Prefer locum, relief or short assignments and state the duration.');
      if (prefs.startWhen === 'now') L.push('Prefer roles that can start immediately.');
      else if (prefs.startWhen === '1m') L.push('Prefer roles starting within about a month.');
      else if (prefs.startWhen === '3m') L.push('Prefer roles starting within about three months.');
      else if (prefs.startWhen === '6m') L.push('The applicant is available after three months; deadlines further out are fine.');
      if (prefs.salaryBand === 'any_stated') L.push('Only include roles where the pay is actually stated on the page; quote it exactly.');
      else if (prefs.salaryBand === 'high') L.push('Prefer well-paid roles for this experience level and quote the pay exactly as printed.');
    }
    return L.length ? 'LANE PREFERENCES: ' + L.join(' ') : '';
  })();
  /* ForiForeign does not sell licensing help, so there is no exam atlas, no per-exam
     source directive and no "we will get you licensed" framing here any more. The only
     licence fact we carry is the one the applicant told us they ALREADY hold, and it is
     used for one purpose: finding roles that accept it. */
  const PRO_BOARDS = 'PROFESSIONAL JOB BOARDS to hunt for qualified staff: NHS Jobs and Trac.jobs (UK), HSE.ie and IrishJobs (Ireland), SEHA and PureHealth, Hamad Medical, Sidra Medicine, KFSH&RC, Ministry of Health Saudi careers, GulfTalent, Naukrigulf and Bayt, Seek and state health careers (Australia), Health New Zealand careers, Indeed and employer career pages worldwide.';
  const licFitLine = '';
  const licDirective = '';
  const _medField = /medic|pharma|nurs|dent|health|clinic|physio|lab|radiol|surg|midwif|allied|veterin|psycholog/i.test(String(p.field || '') + String(prefs.field || '') + String((px && px.profession) || ''));
  /* The applicant already holds this. We use it to widen what they qualify for; we never
     offer to obtain, prepare or advise on any credential they do not yet hold. */
  const heldName = (prefs.licenseResolved && prefs.licenseResolved.name) || prefs.licenseHeld || '';
  const heldAuth = (prefs.licenseResolved && prefs.licenseResolved.authority) || '';
  const licStatusLine = heldName
    ? 'CREDENTIAL THE CANDIDATE ALREADY HOLDS: ' + heldName + (heldAuth ? ' (' + heldAuth + ')' : '')
      + '. Treat this as a fact about the candidate. Prioritise roles that require or accept it, including roles in other countries that recognise it, and state for each role whether this credential satisfies the stated requirement. '
      + 'NEVER return licensing courses, exam-preparation services or registration pathways as opportunities, and never suggest we assist with obtaining any credential.'
    : '';
  const hardRules = 'HARD RULES, NEVER VIOLATE: match the exact level selected; diploma, short course, fellowship and observership pathways must return ONLY that kind, never a full degree in their place, and never a lower degree than the applicant already holds. Never return positions at a different level than targeted (a PhD applicant must NEVER see bachelor or MPhil listings; a postdoc seeker NEVER PhD admissions). For WORK searches never return academic study or degree positions. SKIP anything closing within 24 hours. Remote jobs ONLY if remote worldwide or explicitly open to applicants from Pakistan. Never present a role as remote when it requires residence in a particular country: record the restriction exactly as the page states it, because an applicant in Pakistan cannot take a role that is remote within the USA only. In the US, UK, Canada, Australia, New Zealand and Europe include authentic openings from small private employers up to large institutions and government bodies.';
  // The prepared documents and the guide must agree: both are told to use the regulator
  // named here as the single source of truth for this applicant.
  const licExamLine = 'NEVER return licensing exams, exam preparation, credential-verification services or registration pathways as opportunities. ForiForeign finds study places and jobs only.';
  const jobAggr = kind === 'work' ? 'JOB RIGOR: hunt VALID, currently-open vacancies in the selected countries aggressively. For every job state ALL requirements before applying: license, language requirement or barrier, minimum experience, and required documents. Disclose everything; hide nothing.' : '';
  const levelLine = (prefs.levels && prefs.levels.length) ? 'STUDY LEVEL: only ' + prefs.levels.join(' or ') + ' level programmes.' : (prefs.level ? 'STUDY LEVEL: only ' + prefs.level + '-level programmes.' : '');
  const fieldLine = prefs.field ? 'FIELD FOCUS: ' + prefs.field + '-related programmes and roles.' : '';
  // HARD ELIGIBILITY: the advertisement itself must admit this applicant's degree/profession.
  /* Retrieval must be generous; precision is enforced later by the match gate, which
     scores level, field and eligibility against the real profile. Telling the search to
     DISCARD anything whose advert does not spell out the applicant's exact degree made
     it discard almost everything, because most adverts never state that. */
  const eligLine = 'ELIGIBILITY: prefer opportunities this applicant could realistically apply for. Where the page states requirements, capture them exactly so eligibility can be judged. Do NOT discard an opportunity merely because its requirements are unstated.';
  const intakeLine = prefs.intake ? 'INTAKE: prefer intakes and start dates in ' + prefs.intake + '.' : '';
  const jobLine = (prefs.jobTypes && prefs.jobTypes.length ? 'JOB TYPE: ' + prefs.jobTypes.join(' or ').replace(/_/g, ' ') + '. ' : '') + (prefs.exps && prefs.exps.length ? 'EXPERIENCE LEVEL: ' + prefs.exps.join(' or ') + '.' : '');
  const langMap = { none: 'no language certificate required', cert_before: 'certificate required to apply (IELTS/TOEFL/OET/PTE)', course_after: 'language course before or alongside the programme accepted', local_lang: 'local-language route (German, French, etc.)' };
  const langLine = (prefs.langs && prefs.langs.length)
    ? 'LANGUAGE RULES: include programmes matching ANY of these situations: ' + prefs.langs.map(k => langMap[k] || k).join('; ') + '. Always state the EXACT language requirement for every result.'
    : (prefs.no_lang ? 'LANGUAGE: strongly prefer programmes with NO IELTS/TOEFL requirement; always state the exact language rule.' : 'Always state the exact language requirement for every result.');
  const licenseLine2 = '';
  const prompt =
`TODAY IS ${new Date().toISOString().slice(0,10)}. RULE ONE: every opportunity you return must still be OPEN today. Its deadline must be ${new Date().toISOString().slice(0,10)} or later, or the page must state that applications are open or rolling. An expired listing is worthless to the applicant and will be discarded, so do not return one.\nSearch the web NOW for currently-open, real ${kind === 'work' ? 'jobs abroad for a Pakistani ' + (p.headline || 'medical professional') : kind + ' opportunities'} matching this applicant:
${p.headline || ''}; field ${p.field || ''}; skills ${String(p.methods || '').slice(0, 200)}. ${budgetLine} ${licenseLine} ${countryLine} ${remoteLine} ${levelLine} ${langLine} ${licenseLine2} ${fieldLine} ${eligLine} ${intakeLine} ${jobLine} ${ladderLine} ${pxLine} ${progLine} ${sectorLine} ${laneLine} ${jobAggr} ${hardRules} ${licExamLine} ${licStatusLine} ${licFitLine} ${licDirective} ${kind === 'work' && _medField ? PRO_BOARDS : ''} ${uniLine} ${ANGLES[pi % ANGLES.length]} ${knownLine}
LICENSING: if the official page names a required licence or exam, capture it EXACTLY as written. Never assume or invent one.
Return AT LEAST ${Math.max(20, target)} genuinely open opportunities if that many exist, up to 40. Breadth matters: a short list means the applicant sees nothing.\nRespond ONLY with a JSON array:
[{"title":"","institution":"","country_code":"ISO2","city":"","url":"official page","deadline":"YYYY-MM-DD or empty","funding":"","funding_type":"fully|partial|self","level":"bachelors|masters|phd|postdoc","stipend":"the pay EXACTLY as printed, including currency, range and period, e.g. GBP 37,338 to 44,962 per annum or EUR 2,300 per month. Never convert, never estimate, leave empty if unstated","tuition":"amount+currency exactly as stated or empty","application_fee":"amount+currency exactly as stated or empty","duration":"","contact_emails":["seen on official pages only"],"apply_via":"email if the page gives an application email address, portal if it uses an online form or applicant system. Determine this from the official page, never guess","extra":{"acceptance_hint":"stated acceptance/selectivity info","annual_living_cost":"","housing_support":"","intake_terms":"","application_process_steps":"brief steps if stated","interview_required":"yes|no|empty","scholarship_stack":"other stackable scholarships named","work_rights":"part-time work rules if stated","pr_pathway_note":"post-study residence route if stated","ranking_or_reputation":""},"criteria":{"req_degree_level":"bachelors|masters|phd|any or empty","req_field":"","req_min_cgpa":"number or empty","req_cgpa_scale":"number or empty","req_language":"IELTS|TOEFL|none or empty","req_language_min":"number or empty","req_nationality":"restriction or empty","req_experience_years":"number or empty","req_license":"DHA|SCFHS|NCLEX|PEBC or empty","req_documents":["required document names literally listed"]}}]
CRITICAL: fill criteria ONLY from requirements literally stated on the official page. Leave any unstated requirement as empty; never guess a CGPA, language score, or restriction.`;
  lastPrompt = prompt;
  // ISOLATED PASS: a 503, timeout or bad parse on this pass logs and moves to the
  // next widening pass. One failed call can never zero-out the whole run again.
  try {
    const txt = await callAI('search_verify', searchStrategy() + prompt, { search: true, urls: true, maxTokens: 3200, userId });
    const items = parseJSON(txt) || [];
    added += await ingestOpps(items, kind, userId);
  } catch (passErr) {
    try { await require('./oblog').errlog('discover:pass' + (pi + 1), passErr, { userId }); } catch (e2) {}
  }
  // Resumable progress: the dashboard can show live "N of T found" even after the app was closed.
  try { if (prefs.progressKey) await admin().from('app_settings').upsert({ key: prefs.progressKey, value: { status: 'running', startedAt: prefs.startedAt || new Date().toISOString(), kind, target, found: added, prefsHash: prefs.prefsHash || null } }); } catch (e) {}
  const scopeForCount = (pi === 0 && priority.length) ? priority : null;
  if (await freshCount(scopeForCount) >= target) break;
  }
  // NEVER-BLANK rescue: a paid search must not end with nothing over a transient
  // failure or an unlucky parse. One clean repeat of the widest pass.
  if (!added && lastPrompt) {
    try {
      const txt2 = await callAI('search_verify', searchStrategy() + lastPrompt, { search: true, urls: true, maxTokens: 3200, userId });
      added += await ingestOpps(parseJSON(txt2) || [], kind, userId);
    } catch (e) {}
  }
  return added;
}

/* Shared ingest: validate, dedupe, and insert discovered opportunities. Used by
   per-user discovery AND admin corridor seeding. */
async function ingestOpps(items, kind, userId) {
  if (!Array.isArray(items)) items = (items && typeof items === 'object') ? (Object.values(items).find(Array.isArray) || [items]) : [];
  let added = 0;
  const VISIBLE = ['study', 'scholarship', 'postdoc', 'work'];
  const inferKind = it => {
    if (kind && VISIBLE.includes(kind)) return kind;
    const t = (String(it.title || '') + ' ' + String(it.funding || '')).toLowerCase();
    if (it.level === 'postdoc') return 'postdoc';
    if (/job|vacancy|position\b.*(hospital|company|engineer|nurse|pharmacist)|hiring|employment/.test(t) && !it.level) return 'work';
    if (/scholarship|burslari|award/.test(t)) return 'scholarship';
    return 'study';
  };
  const { errlog } = require('./oblog');
  for (const it of items) {
    // Deterministic QC gate: AI may propose, only validated facts enter the database.
    const reject = async why => { try { await errlog('qc:reject', new Error(why), { detail: String(it.title || it.url || '').slice(0, 120) }); } catch (e) {} };
    if (!it.url || !/^https?:\/\//i.test(String(it.url))) { await reject('missing/invalid official url'); continue; }
    if (!it.institution || String(it.institution).length < 3) { await reject('missing institution'); continue; }
    if (!it.title || String(it.title).length < 4) { await reject('missing title'); continue; }
    if (it.country_code && !/^[A-Za-z]{2}$/.test(String(it.country_code))) it.country_code = null;
    if (it.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(String(it.deadline))) it.deadline = null;
    if (it.deadline && it.deadline < new Date().toISOString().slice(0, 10)) { await reject('deadline already passed: ' + it.deadline); continue; }
    // Spec 17: opportunity fingerprint = normalized identity; dedup by fingerprint OR url.
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const fp = require('crypto').createHash('sha1').update([norm(it.institution), norm(it.title), it.deadline || '', String(it.level || '')].join('|')).digest('hex');
    const { data: dup } = await admin().from('opportunities').select('id').or('url.eq.' + it.url + ',fingerprint.eq.' + fp).limit(1).then(r => r, async () => await admin().from('opportunities').select('id').eq('url', it.url).limit(1));
    if (dup && dup.length) continue;
    const emails = cleanEmails(it.contact_emails);
    const ft = ['fully', 'partial', 'self'].includes(String(it.funding_type || '').toLowerCase()) ? String(it.funding_type).toLowerCase() : null;
    const lvl = ['bachelors', 'masters', 'phd', 'postdoc', 'diploma', 'short_course', 'fellowship', 'observership'].includes(String(it.level || '').toLowerCase())
      ? String(it.level).toLowerCase()
      : (kind === 'postdoc' ? 'postdoc' : null);
    const row = {
      kind: inferKind(it), title: noSmell(it.title).slice(0, 300), institution: noSmell(it.institution).slice(0, 200),
      country_code: (it.country_code || '').slice(0, 2).toUpperCase() || null,
      // Country-restricted "remote" is not remote for a Pakistan-based applicant, so a
      // genuinely remote role is labelled as such instead of showing an empty location.
      city: it.city || (it.remote === 'true' ? 'Remote' : ''), url: it.url,
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(it.deadline || '') ? it.deadline : null,
      funding: it.funding || '', stipend: it.stipend || '', duration: it.duration || '',
      fee_structure: (it.fee_structure || '').slice(0, 400) || null,
      bank_statement_note: (it.bank_statement || '').slice(0, 200) || null,
      post_admission_reqs: Array.isArray(it.post_admission_requirements) ? it.post_admission_requirements.slice(0, 12).map(x => String(x).slice(0, 160)) : [],
      remote: it.remote === 'true' ? true : it.remote === 'false' ? false : null,
      visa_sponsorship: it.visa_sponsorship === 'true' ? true : null,
      job_type: ['full_time','part_time','contract','internship'].includes(it.job_type) ? it.job_type : null,
      experience_level: ['entry','mid','senior'].includes(it.experience_level) ? it.experience_level : null,
      salary_note: (it.salary_note || '').slice(0, 120) || null,
      verification_confidence: (emails.length && String(it.url).includes('.') ? 'high' : (it.deadline ? 'medium' : 'low')),
      contact_emails: emails, apply_via: emails.length ? (it.apply_via === 'portal' ? 'both' : 'email') : 'portal',
      status: 'verified', verified_at: new Date().toISOString(), source: 'agent',
      fingerprint: fp,
      tuition: String(it.tuition || '').slice(0, 120), application_fee: String(it.application_fee || '').slice(0, 120)
    };
    if (it.extra && typeof it.extra === 'object') {
      const ex = {}; for (const k of ['acceptance_hint','annual_living_cost','housing_support','intake_terms','application_process_steps','interview_required','scholarship_stack','work_rights','pr_pathway_note','ranking_or_reputation']) if (it.extra[k]) ex[k] = String(it.extra[k]).slice(0, 240);
      if (Object.keys(ex).length) row.intelligence = ex;
    }
    if (ft) row.funding_type = ft;
    if (lvl) row.level = lvl;
    // Phase 3: structured eligibility criteria, only where the agent found them stated.
    const c = it.criteria || {};
    const numOrNull = x => { const n = parseFloat(x); return isFinite(n) ? n : null; };
    const strOrNull = x => { const s = String(x || '').trim(); return s ? s.slice(0, 120) : null; };
    const crit = {
      req_degree_level: ['bachelors', 'masters', 'phd', 'postdoc', 'any'].includes(String(c.req_degree_level || '').toLowerCase()) ? String(c.req_degree_level).toLowerCase() : null,
      req_field: strOrNull(c.req_field),
      req_min_cgpa: numOrNull(c.req_min_cgpa),
      req_cgpa_scale: numOrNull(c.req_cgpa_scale),
      req_language: strOrNull(c.req_language),
      req_language_min: numOrNull(c.req_language_min),
      req_nationality: strOrNull(c.req_nationality),
      req_experience_years: numOrNull(c.req_experience_years),
      req_license: strOrNull(c.req_license),
      req_documents: Array.isArray(c.req_documents) ? c.req_documents.slice(0, 12).map(String) : []
    };
    for (const [k, v] of Object.entries(crit)) if (v !== null && !(Array.isArray(v) && !v.length)) row[k] = v;
    let { error } = await admin().from('opportunities').insert(row);
    // If new columns aren't migrated yet, retry without any of them so discovery never breaks.
    if (error && /funding_type|level|req_|column/.test(error.message || '')) {
      const stripped = { ...row };
      ['funding_type', 'level', 'fingerprint', 'tuition', 'application_fee', 'intelligence', 'req_degree_level', 'req_field', 'req_min_cgpa', 'req_cgpa_scale', 'req_language', 'req_language_min', 'req_nationality', 'req_experience_years', 'req_license', 'req_documents'].forEach(k => delete stripped[k]);
      ({ error } = await admin().from('opportunities').insert(stripped));
    }
    if (!error) added++;
  }
  try { await admin().from('audit_log').insert({ actor: userId || null, event: 'DISCOVER', detail: kind + ': +' + added }); } catch (e) {}
  return added;
}

/* ---------- PREPARE: documents from the user's REAL profile only ---------- */
const PREP_STEPS=[['profile','Profile prepared'],['recipient','Researching the right contact'],['cv','Tailoring your CV'],['cover','Writing your cover letter'],['email','Preparing your email'],['final','Final checks']];
async function setProg(appId, doneKeys, activeKey, errKey, errNote) {
  const steps = PREP_STEPS.map(([k, label]) => ({ k, label, done: doneKeys.includes(k), active: k === activeKey, error: k === errKey ? (errNote || 'needs attention') : null }));
  try { await admin().from('applications').update({ prep_progress: steps }).eq('id', appId); } catch (e) {}
}
async function prepareApplication(appId) {
  const { data: a } = await admin().from('applications').select('*, opportunities(*)').eq('id', appId).single();
  if (!a) return;
  const { data: p } = await admin().from('profiles').select('*').eq('id', a.user_id).single();
  const opp = a.opportunities;
  await admin().from('applications').update({ stage: 'preparing', prep_started_at: new Date().toISOString(), prep_status: { plan: ['CV', 'Cover letter'], done: [] } }).eq('id', appId);

  // Deep profile: certifications, achievements and the applicant's own research
  // papers ride into every document, so proposals and letters cite REAL work.
  let px2 = null;
  try { const { data: pxr2 } = await admin().from('app_settings').select('value').eq('key', 'profilex:' + a.user_id).single(); px2 = pxr2 && pxr2.value && pxr2.value.x; } catch (e) {}
  // Licence context so status-aware documents (preparing vs passed) are truly different.
  let licCtx = '';
  try {
    const { data: pfR } = await admin().from('app_settings').select('value').eq('key', 'prefs:' + a.user_id).single();
    const pv = (pfR && pfR.value) || {};
    const held = (pv.licenseResolved && pv.licenseResolved.name) || pv.licenseHeld || '';
    if (held) {
      licCtx = `\nCREDENTIAL ALREADY HELD: ${held}. State it as a strength where the position asks for it. Never write anything implying ForiForeign assists with obtaining a licence.`;
    }
  } catch (e) {}
  const profileBlock =
`APPLICANT (real facts only, never invent): ${p.full_name}; ${p.headline || ''}; field ${p.field || ''}; skills ${p.methods || ''}; education ${JSON.stringify(p.education || []).slice(0, 600)}; publications ${JSON.stringify(p.publications || []).slice(0, 600)}; experience ${JSON.stringify(p.experience || []).slice(0, 600)}${px2 ? `; certifications ${JSON.stringify(px2.certifications || []).slice(0, 300)}; achievements ${JSON.stringify(px2.achievements || []).slice(0, 300)}; research papers ${JSON.stringify(px2.research_papers || []).slice(0, 700)}` : ''}
DEPTH REQUIREMENT: analyse the position deeply and mirror its requirements point by point. For research positions (MS, MPhil, PhD, postdoc) read the applicant's own publications and research papers above and weave their actual findings, methods and titles into the research proposal and motivation, so the documents read as written by this exact researcher. Write at the length and polish of a highly qualified applicant: substantial, specific, warm and human.${licCtx}`;

  const MINLEN = { cv: 2600, cover: 2900, sop: 3000, research_proposal: 4000, scholarship_statement: 2000, checklist: 1200, visa_summary: 1400, motivation: 4200, funder_outreach: 900 }
const MAXLEN = { visa_summary: 4000, motivation: 9000, checklist: 6000, cover: 6000, cv: 20000, sop: 8000, research_proposal: 10000 };
  const CLINICAL_CV = 'CLINICAL/PROFESSIONAL CV BLUEPRINT (job applications): Name with qualifications; contact. LICENSURE AND REGISTRATIONS FIRST, at the very top: every exam passed, license and eligibility numbers, status, verification (DataFlow/EPIC/CGFNS) with dates. PROFESSIONAL PROFILE tuned to the employer. CLINICAL/PROFESSIONAL EXPERIENCE most recent first with unit, bed-count or scale, systems used, quantified duties. EDUCATION. CERTIFICATIONS (BLS/ACLS etc.). SKILLS AND LANGUAGES with OET/IELTS scores. REFEREES available. Also list a CREDENTIALING PACK line: documents ready (license copies, experience certificates, good-standing letters).';
  const BLUEPRINT = {
    cv: 'CV BLUEPRINT — produce a COMPLETE, MULTI-PAGE, world-class academic/professional CV (never a short one-page summary; for a PhD or postdoc it should be a full academic CV of appropriate length). Use EVERY real detail from the applicant profile, omit nothing. STRUCTURE: Full name with all degrees and a professional contact line. PROFESSIONAL/RESEARCH PROFILE (a rich 6-9 line narrative tuned to this exact position). KEY AREAS OF EXPERTISE (10-14 real items). EDUCATION (every degree with institution, years, CGPA/medals, thesis title). RESEARCH EXPERIENCE and PROFESSIONAL EXPERIENCE (each role: Title - Organization | dates, then 4-7 specific achievement lines naming real systems, methods, standards, programmes, quantified outcomes). PEER-REVIEWED PUBLICATIONS (FULL citations with authors, title, journal, year, DOI where known — list ALL of them). CONFERENCES AND PRESENTATIONS if any. CERTIFICATIONS, TRAINING AND WORKSHOPS (all of them). TECHNICAL SKILLS, METHODS AND SOFTWARE. AWARDS AND HONOURS. PROFESSIONAL MEMBERSHIPS. LANGUAGES. REFEREES (names and affiliations if present). Depth, precision and completeness are mandatory; this must read like a top professional wrote it.',
    cover: 'COVER LETTER BLUEPRINT: formal letterhead lines (name, contact, date, recipient, institution). Salutation. Opening: the exact position and one sharp reason of fit. Body 2-3 paragraphs: mirror the position requirements point by point against real experience, name real projects, standards and outcomes; for research roles cite the applicant own publications by title. Closing: availability, documents attached, courteous sign-off. 350-500 words.',
    sop: 'MOTIVATION/SOP BLUEPRINT: compelling personal-academic narrative in 4-6 rich paragraphs: origin of interest; academic and professional milestones with specifics; why THIS programme/institution (name professors, labs, modules where verifiable); goals and return value; 500-700 words, warm, human, zero cliches.',
    funder_outreach: 'FUNDING AND PI OUTREACH NOTE: for a postdoc or research fellowship, prepare a short second outreach email addressed to the FUNDING BODY or fellowship scheme (e.g. HEC, Fulbright, MSCA, DAAD, Wellcome, host-country research council) expressing intent to be hosted by the named principal investigator, in parallel with the email to the PI. State the scheme name, the PI and host institution, eligibility fit, and request the correct application route. 180-260 words, formal.',
    research_proposal: 'RESEARCH PROPOSAL BLUEPRINT: TITLE. BACKGROUND AND SIGNIFICANCE (cite the applicant own published work by title and journal, connect to the target group research). RESEARCH QUESTIONS AND OBJECTIVES. METHODOLOGY (concrete methods the applicant genuinely commands). EXPECTED OUTCOMES AND IMPACT. TIMELINE. SELECTED REFERENCES including the applicant own papers. 700-900 words, publication-grade academic register.'
  };
  /* DOCUMENT HONESTY, ABSOLUTE. We author letters, statements and proposals in the
     applicant's own voice from their real profile. We NEVER produce, reproduce or
     simulate an issued document: no degree, no transcript, no experience certificate,
     no good-standing letter, no licence, no bank statement, no test score report. Those
     are issued by an institution and the applicant supplies the originals themselves. */
  const NEVER_INVENT = ' ABSOLUTE RULE: never write, recreate or simulate any document that an institution issues. That means no degree certificate, transcript, mark sheet, experience or service certificate, good-standing letter, licence, registration certificate, bank statement, or language test report, not even as a sample, template or placeholder. If such a document is required, name it in the checklist as something the applicant must obtain and attach themselves, and say who issues it. You may only author documents that are genuinely written by the applicant: letters, statements, proposals and emails.';
  const mk = async (kind, title, instruction) => {
    instruction = (instruction || '') + NEVER_INVENT;
    const isJobCase = (opp.kind === 'work');
    if (isJobCase && String(kind).includes('cv')) instruction = (instruction || '') + ' ' + CLINICAL_CV;
    else instruction = (instruction || '') + ' ' + (BLUEPRINT[kind] || BLUEPRINT[String(kind).includes('proposal') ? 'research_proposal' : String(kind).includes('sop') || String(kind).includes('motivation') ? 'sop' : String(kind).includes('cover') ? 'cover' : String(kind).includes('cv') || String(kind).includes('resume') ? 'cv' : ''] || '');
    const need = MINLEN[kind] || 600;
    // Resume guard: a substantial version already exists for this case — keep it, zero AI cost on retry.
    try {
      const { data: ex } = await admin().from('application_documents').select('id,content').eq('application_id', appId).eq('kind', kind).limit(1);
      if (ex && ex.length && String(ex[0].content || '').length >= Math.min(need, 600)) return;
    } catch (e) {}
    let content = '';
    try {
      content = noSmell(await callAI('case_writing',
        `${STYLE}\n\n${profileBlock}\n\nPOSITION: ${opp.title} at ${opp.institution}${opp.country_code ? ', ' + opp.country_code : ''}. ${instruction}`,
        { maxTokens: Math.max(2200, Math.round(need / 2.2)), userId: a.user_id, applicationId: appId }));
    } catch (e) { /* guaranteed-document rule below */ }
    /* AUTOMATED QUALITY GATE. Every client-facing document is inspected before it is
       stored: completeness, required sections, placeholders, markdown leakage, hedging
       language, truncation, repetition and factual grounding. A failing document is
       regenerated ONCE with the specific faults named, so the model fixes exactly what
       was wrong instead of rewriting blindly. The better of the two drafts is kept. */
    const docqa = require('./docqa');
    let qa = docqa.inspect(kind, title, content, p);
    if (content && !qa.pass) {
      const faults = qa.hard.concat(qa.soft).slice(0, 6).join('; ');
      try {
        const t2 = noSmell(await callAI('case_writing',
          `${STYLE}\n\nThe previous draft FAILED quality review for these specific reasons: ${faults}. Fix every one of them. ${profileBlock}\n\nPOSITION: ${opp.title} at ${opp.institution}. ${instruction} Write the COMPLETE document, at least ${Math.round(need / 6)} words, every section fully written, finish every sentence, no placeholders, no markdown symbols, no repetition, and never write that something is unavailable.`,
          { maxTokens: Math.max(3000, Math.round(need / 1.8)), thinking: 'high', userId: a.user_id, applicationId: appId }));
        const qa2 = docqa.inspect(kind, title, t2, p);
        if (qa2.score > qa.score) { content = t2; qa = qa2; }
      } catch (e) {}
    }
    // Record the outcome so quality is measurable rather than assumed.
    try {
      await admin().from('audit_log').insert({ actor: a.user_id, event: 'DOC_QA',
        detail: kind + ' score ' + qa.score + (qa.pass ? ' PASS' : ' FAIL: ' + qa.hard.concat(qa.soft).slice(0, 3).join('; ')) });
    } catch (e) {}
    if (!content || content.length < 200) {
      content = noSmell(`${p.full_name}\n${p.headline || ''}\n\n${kind === 'cv'
        ? 'PROFILE\n' + (p.field || '') + '. Core skills: ' + (p.methods || '') + '.\n\nEDUCATION\n' + (p.education || []).map(e => `${e.degree || ''}, ${e.institution || ''}, ${e.year || ''}`).join('\n') + '\n\nPUBLICATIONS\n' + (p.publications || []).map(x => typeof x === 'string' ? x : x.title || '').join('\n')
        : 'Dear Selection Committee,\n\nI am writing to apply for the ' + opp.title + ' at ' + opp.institution + '. My background in ' + (p.field || 'my field') + ' aligns directly with this position, and my documents are attached for your consideration.\n\nThank you for your time.\n\nKind regards,\n' + p.full_name}`);
    }
    // Enforce a ceiling so no document sprawls into an unreadable wall.
    try { const cap = MAXLEN[kind]; if (cap && content && content.length > cap) content = content.slice(0, cap).replace(/\s+\S*$/, ''); } catch (e) {}
    await admin().from('application_documents').delete().eq('application_id', appId).eq('kind', kind);
    await admin().from('application_documents').insert({ application_id: appId, user_id: a.user_id, kind, title, content });
    // 12b: THEME-PRESERVING CV. If this is the CV doc and the user uploaded a .docx CV,
    // tailor a copy of THEIR file (fonts/colours/layout kept), storing it as a downloadable
    // themed version alongside the text. Fails silently to the text version.
    if (String(kind).includes('cv')) {
      try {
        const { BUCKET } = require('./docs');
        const { tailorDocx, docxText } = require('./cvtheme');
        // Multi-CV aware: prefer a Word original (theme can be preserved). If the user has
        // several, take the most recent. PDF-only users correctly fall back to the
        // generated professional CV, which is the only safe option for a flat PDF.
        const { data: origs } = await admin().from('documents').select('storage_key,mime,name,created_at').eq('user_id', a.user_id).eq('generated', false).ilike('mime', '%wordprocessingml%').order('created_at', { ascending: false }).limit(5);
        const pick = (origs || []).find(d => /cv|resume/i.test(String(d.name || ''))) || (origs || [])[0];
        const orig = pick;
        if (orig && orig.storage_key) {
          const { data: f } = await admin().storage.from(BUCKET).download(orig.storage_key);
          if (f) {
            const buf = Buffer.from(await f.arrayBuffer());
            const originalText = docxText(buf);
            // Ask the writer for SAFE edits only: literal replacements + an additions section.
            let edits = { replacements: [], additions: [] };
            try {
              const raw = await callAI('case_writing',
                'You are tailoring an existing CV for a specific position WITHOUT changing its style. ORIGINAL CV TEXT:\n' + originalText.slice(0, 6000) +
                '\n\nPOSITION: ' + opp.title + ' at ' + opp.institution + (opp.country_code ? ', ' + opp.country_code : '') +
                '\n\nReturn ONLY JSON: {"replacements":[{"find":"exact text present in the CV","replace":"improved wording, same meaning"}],"additions":[{"heading":"SECTION TITLE","lines":["concise professional lines relevant to THIS position, drawn only from the applicant real profile"]}]}. Keep replacements minimal and safe (only exact substrings that appear). additions may include a short section highlighting the position-relevant strengths, licences or availability. Never invent facts.',
                { maxTokens: 1200, json: true, userId: a.user_id, applicationId: appId });
              const parsed = JSON.parse(String(raw).replace(/```json|```/g, '').match(/\{[\s\S]*\}/)[0]);
              if (parsed && typeof parsed === 'object') edits = { replacements: Array.isArray(parsed.replacements) ? parsed.replacements.slice(0, 25) : [], additions: Array.isArray(parsed.additions) ? parsed.additions.slice(0, 4) : [] };
            } catch (e) {}
            const outBuf = tailorDocx(buf, edits);
            if (outBuf && outBuf.length > 500) {
              const key = a.user_id + '/tailored/' + appId + '_cv.docx';
              await admin().storage.from(BUCKET).upload(key, outBuf, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: true });
              await admin().from('application_documents').update({ themed_key: key }).eq('application_id', appId).eq('kind', kind);
            }
          }
        }
      } catch (e) { /* themed version is a bonus; text CV already stored */ }
    }
    const { data: cur } = await admin().from('applications').select('prep_status').eq('id', appId).single();
    const ps = (cur && cur.prep_status) || { plan: [], done: [] };
    ps.done = [...new Set([...(ps.done || []), title])];
    await admin().from('applications').update({ prep_status: ps }).eq('id', appId);
  };

  // Progressive eligibility: classify what this application needs NOW vs later (never blocks browsing)
  try {
    const { data: mydocs } = await admin().from('documents').select('kind').eq('user_id', a.user_id);
    const have = (mydocs || []).map(d => d.kind);
    const txt = await callAI('main',
      `Position: ${opp.title} at ${opp.institution} (${opp.kind}). Applicant already uploaded: ${have.join(', ') || 'nothing'}.
Classify realistic document requirements. For work positions list any licence or registration the advert itself states, exactly as written, without adding steps the advert does not mention. JSON only:
{"required_now":["needed to SUBMIT this application"],"required_later":["needed after acceptance, visa stage"],"optional":["strengthens the case"],"missing_urgent":["required_now items the applicant has NOT uploaded"]}`,
      { maxTokens: 500, userId: a.user_id, applicationId: appId });
    const reqs = parseJSON(txt);
    if (reqs) {
      const { data: cur0 } = await admin().from('applications').select('prep_status').eq('id', appId).single();
      const ps0 = (cur0 && cur0.prep_status) || {};
      ps0.reqs = reqs;
      await admin().from('applications').update({ prep_status: ps0 }).eq('id', appId);
    }
  } catch (e) {}

  /* WHAT GETS PREPARED IS DECIDED BY THE OPPORTUNITY, NOT BY A SETTING.
     An admin checklist used to cap this at CV + cover letter, which quietly threw away
     the motivation letter, the research concept note and the scholarship statement that
     a position actually asked for. There is no cap now: every document in the catalogue
     is available to every case, and the position's own stated requirements decide which
     ones are written. */
  const DOC_CATALOG = {
    motivation: ['Letter of Motivation', 'Write a FULL letter of motivation, at least 700 words, in the voice of the applicant. This is not a cover letter summary: it is the document that persuades. STRUCTURE: (1) why this exact position at this exact institution, naming what the group or department actually works on; (2) the applicant research story told properly, the question they pursued, why it mattered, what they found, with real techniques and models named from their profile; (3) hands-on methods, listing the specific assays, instruments, software and models they have personally run, not a generic skills list; (4) how their work connects to the host work, stated honestly, including where they would be learning rather than leading; (5) what they intend to do over the appointment and where they want the work to go afterwards; (6) a measured, confident close. Cite the applicant own publications by title where they support a claim. Never inflate, never claim a technique that is not in the profile, and never write a paragraph that could belong to a different applicant.'],
    funder_outreach: ['Funding Body Outreach Email', 'Write the short parallel outreach email to the funding body or fellowship scheme as described. Name the scheme, the principal investigator, and the host institution; state eligibility fit and request the correct application route. Formal, 180-260 words.'],
    visa_summary: ['Country and Visa Summary', 'Write a concise COUNTRY AND VISA SUMMARY for this specific role and country: the work visa or permit route this employer normally uses and who sponsors it; whether income is taxed and at roughly what level; whether dependants can accompany and work; typical housing, flights and leave conventions for this market; and the realistic route to longer-term residence if one exists. Six short sections, factual, no filler, and state clearly where a figure is indicative rather than official.'],
    checklist: ['Requirements and Documents Checklist', 'Produce the definitive REQUIREMENTS AND DOCUMENTS CHECKLIST for THIS exact position per its official protocol. Sections: DOCUMENTS REQUIRED (every document this employer/portal/authority demands: licenses with numbers, degree + attestation status, experience certificates, good-standing letters, passport, photos with exact specs, language scores, verification reports like DataFlow/EPIC/CGFNS where applicable - each with the format and any attestation it must carry). PORTAL AND SUBMISSION PROTOCOL (exact submission route, account creation needs, fees, file formats and size limits where stated). TIMELINE EXPECTATIONS (realistic processing windows for each verification and the hiring stage). COMMON REJECTION REASONS to avoid. SUBMISSION ROUTE, SAY WHICH ONE APPLIES. If this position is applied for BY EMAIL, list every file the applicant must send us or upload so we attach it to the draft, and state plainly that we attach everything and they only press Send. If this position is applied for THROUGH AN ONLINE PORTAL, do NOT ask them to upload anything to us: tell them exactly which documents to keep ready on their own device, in what format and size, because they will upload those themselves on the official site while we fill in the form fields for them. RESPONSIBILITY AND PROCESS NOTE (state clearly): the applicant must provide genuine, correctly attested documents, attestation and verification (HEC, MOFA, PMDC or the relevant council, and portal verification such as DataFlow or EPIC) are the applicant own responsibility and are done in person or on the official portal; ForiForeign prepares and organises the documents and the application, and where a step requires the applicant in person (portal upload, biometrics, payment, interview) the applicant completes it themselves. Cite the official authority for every requirement. Be specific to the position and country; never generic filler.'],
    cv: ['CV', 'Write an opportunity-specific CV from ONLY the real facts above. Include EVERY real publication and degree, never drop one, never invent. Bold section headings, most relevant research first.'],
    cover: ['Cover letter', 'Write a full, serious cover letter of 450 to 600 words addressed to the named person where one is known, otherwise to the selection committee. This is the letter that decides whether the rest of the file is read, so it must be specific enough that it could not be sent to any other institution. STRUCTURE: (1) open by naming the exact position, the start date if stated, and what the group or department actually does, showing you have read their work rather than their homepage; (2) explain what your own research or professional work established, naming the real techniques, models, systems and standards you personally used, and cite your own publications by title where they support a claim; (3) connect your work to theirs concretely, saying where the two lines meet and what you could contribute from the first month; (4) be honest about one area you would be developing rather than leading, because candour reads as competence, not weakness; (5) note availability, any relocation or visa route that applies, and that your CV and supporting documents are attached; (6) close with quiet confidence and full contact details. Vary sentence length. Never use the words passionate, dynamic, leverage or synergy. Never claim a technique that is absent from the profile, and never write a paragraph that would fit a different applicant.'],
    sop: ['Statement of Purpose', 'Write a focused statement of purpose grounded ONLY in the real facts above: motivation, fit with this specific program/institution, and concrete goals. No invented achievements.'],
    research_proposal: ['Research Concept Note', 'Write a FULL research concept note of at least 900 words that a principal investigator would actually read to the end. It must connect the applicant own work to what THIS host group works on. STRUCTURE: (1) a specific, arguable research question as a heading, not a topic label; (2) what the applicant has already established, with real techniques, models and published findings named from their profile, cited by title; (3) what the host group has shown, and where the two lines meet or disagree, stated precisely; (4) AIMS, numbered, each one feasible within the appointment and each mapped to the host existing datasets, facilities or expertise; (5) METHOD for each aim, naming the actual approach; (6) FEASIBILITY, written honestly, including a fallback if the primary approach underpowers, so the appointment produces output either way; (7) what the applicant must learn, stated plainly rather than hidden; (8) why this host and no other. Be specific and technical. Never invent prior results, never claim a method absent from the profile, and never write a paragraph that would fit any other applicant or any other institution.'],
    scholarship_statement: ['Scholarship statement', 'Write a concise scholarship/financial-need statement grounded ONLY in the real facts above, professional and specific to this opportunity.']
  };
  let plan = ['cv', 'cover'];
  let _portalOnly = false;
  // Resolved once, before any plan assembly, so every branch sees it.
  /* There is no licence case any more. ForiForeign prepares documents for a study place
     or a job; a licensing application is made personally on the regulator's portal and we
     neither prepare nor submit it. */
  try {
    // The whole catalogue is on the table for every case. Nothing is switched off.
    const allowed = Object.keys(DOC_CATALOG);
    /* REQUIREMENT-DRIVEN AND GENEROUS. We write everything this position genuinely calls
       for, judged from its own stated criteria and the applicant's data, and we err
       towards preparing a document rather than omitting one. What we will not do is
       manufacture an issued document; that rule lives in NEVER_INVENT above. */
    const blob = [opp.title, opp.funding, opp.level, opp.kind, JSON.stringify(opp.criteria || ''), JSON.stringify(opp.intelligence || ''), JSON.stringify(opp.req_documents || ''), opp.description || ''].join(' ').toLowerCase();
    const needs = k => {
      if (k === 'cv' || k === 'cover' || k === 'checklist') return true;
      if (k === 'sop') return opp.kind !== 'work' && (['bachelors', 'masters', 'phd', 'postdoc'].includes(opp.level) || /statement of purpose|motivation letter|personal statement|\bsop\b/.test(blob));
      if (k === 'research_proposal') return ['phd', 'postdoc'].includes(opp.level) || /research|proposal|concept note|thesis|dissertation|scientist|fellow|lecturer|faculty/.test(blob);
      if (k === 'scholarship_statement') return opp.kind === 'scholarship' || opp.funding_type === 'fully' || opp.funding_type === 'partial' || /scholarship|stipend|bursary|financial need|funding application/.test(blob);
      if (k === 'motivation') return opp.kind !== 'work' || /motivation|why this|personal statement/.test(blob);
      if (k === 'visa_summary') return true;   // every applicant abroad needs the route
      if (k === 'funder_outreach') return /postdoc|fellow|research|scholarship/.test(blob);
      return false;
    };
    plan = allowed.filter(needs);
    if (opp.kind === 'work') { if (!plan.includes('checklist')) plan.push('checklist'); if (!plan.includes('visa_summary')) plan.push('visa_summary'); }
    /* The applicant's own CV is authoritative. Ours summarised it and lost the
       experience, certifications and awards sections entirely, so we no longer rewrite
       it: we attach theirs and spend the effort on documents that do not yet exist. */
    plan = plan.filter(k => k !== 'cv');
    // Research roles deserve a genuine research case, not just a cover letter.
    if (/postdoc|fellow|research|phd|scientist|lecturer|faculty/i.test(String(opp.title || '') + ' ' + String(opp.kind || ''))) {
      if (!plan.includes('research_proposal')) plan.push('research_proposal');
      if (!plan.includes('motivation')) plan.push('motivation');
    }
    if (opp.kind !== 'work' && /postdoc|fellow|research/i.test(String(opp.kind) + ' ' + String(opp.title))) plan.push('funder_outreach');
    if (!plan.includes('cv')) plan.unshift('cv');
    if (!plan.includes('cover')) plan.splice(1, 0, 'cover');
    /* PORTAL CASES GET THE SAME DOCUMENTS. Trimming them to a CV was a false economy:
       portals ask for a motivation letter or a research statement as an upload just as
       often as an email does. The only difference is DELIVERY. On an email route we
       attach everything to the draft and the applicant presses Send. On a portal route
       the applicant downloads the same set and uploads it themselves on the official
       site while we fill in the form fields. */
    const portalOnly = (opp.apply_via === 'portal') && !((opp.contact_emails || []).length); _portalOnly = portalOnly;
    if (portalOnly && !plan.includes('checklist')) plan.push('checklist');
  } catch (e) {}
  await setProg(appId, ['profile','recipient'], 'cv');
  let _di = 0;
  for (const k of plan) {
    await mk(k, DOC_CATALOG[k][0], DOC_CATALOG[k][1]);
    _di++;
    if (_di === 1) await setProg(appId, ['profile','recipient','cv'], 'cover');
    if (_di >= 2) await setProg(appId, ['profile','recipient','cv','cover'], 'email');
  }
  if (plan.length < 2) await setProg(appId, ['profile','recipient','cv','cover'], 'email');

  if (_portalOnly) {
    /* Portal route. The same full set of documents has been written; the applicant
       downloads them and uploads them on the official site themselves, because a portal
       will not accept an upload from us and should not. We fill the form fields. */
    await setProg(appId, ['profile','cv','cover','checklist'], 'done');
    try { await admin().from('applications').update({
      stage: 'portal_apply',
      next_action: 'Download your prepared documents from this case, then open the official portal. The assistant fills your details; you upload the documents yourself and complete any in-person step.'
    }).eq('id', appId); } catch (e) {}
    return;
  }
  await draftMessage(appId);
}

/* ---------- DRAFT: guaranteed email, hunted or fallback; R4 authorization gate ---------- */
async function draftMessage(appId) {
  const { data: a } = await admin().from('applications').select('*, opportunities(*)').eq('id', appId).single();
  if (!a) return;
  const { data: p } = await admin().from('profiles').select('*').eq('id', a.user_id).single();
  // Resume guard: a substantial draft already exists — never regenerate it, just finish the stage.
  try {
    const { data: exmsg } = await admin().from('messages').select('id,body,to_emails').eq('application_id', appId).eq('status', 'pending').limit(1);
    if (exmsg && exmsg.length && String(exmsg[0].body || '').length > 300 && (exmsg[0].to_emails || []).length) {
      await admin().from('applications').update({ stage: 'awaiting_authorization', updated_at: new Date().toISOString(), next_action: 'Review the email and authorize sending' }).eq('id', appId);
      await setProg(appId, PREP_STEPS.map(x => x[0]), null);
      return;
    }
  } catch (e) {}
  await setProg(appId, ['profile','cv','cover'], 'recipient');
  const opp = a.opportunities;
  // RecipientDiscoveryService (spec #12/#13): determine the correct recipient, verify, assign
  // confidence and source. Independent, reusable module — never invents an address.
  // Cost guard: verified official emails already on the opportunity are used directly —
  // no grounded re-hunt on retries or for opportunities discovered with contacts.
  const recipients = require('./recipients');
  const pre = cleanEmails(opp.contact_emails || []);
  let rec = { email: null, alternatives: [], recipientName: null, roleLabel: null };
  if (pre.length) { rec = { email: pre[0], alternatives: pre.slice(1), recipientName: null, roleLabel: null }; }
  else {
    rec = await recipients.discover(opp, callAI, { userId: a.user_id, applicationId: appId });
    if (rec.email) await recipients.persist(opp.id, rec);
  }
  let emails = rec.email ? [rec.email, ...rec.alternatives].filter(Boolean) : [];
  // Uploaded-vs-missing footer on the checklist: computed from the user's real vault, zero AI.
  try {
    const { data: myDocs } = await admin().from('documents').select('kind,name').eq('user_id', a.user_id).eq('generated', false);
    const have = (myDocs || []).map(d => (d.kind || 'document') + (d.name ? ' (' + String(d.name).slice(0, 40) + ')' : ''));
    const { data: chk } = await admin().from('application_documents').select('id,content').eq('application_id', appId).eq('kind', 'checklist').limit(1);
    if (chk && chk.length) {
      const foot = '\n\nYOUR VAULT RIGHT NOW\n' + (have.length ? ('Already uploaded with us: ' + have.join(', ') + '.') : 'No supporting documents uploaded yet.') + '\nUpload everything still missing in ONE go from your case screen, the Upload all missing documents button accepts multiple files together.';
      await admin().from('application_documents').update({ content: (chk[0].content || '') + foot }).eq('id', chk[0].id);
    }
  } catch (e) {}
  await setProg(appId, ['profile','recipient','cv','cover'], 'email');
  let subject = '', body = '';
  const greetTo = rec.recipientName ? rec.recipientName : (rec.roleLabel || (opp.kind === 'work' ? 'Hiring Team' : 'Selection Committee'));
  try {
    const txt = await callAI('case_writing',
      `${STYLE}\n\nWrite a POLISHED, SUBSTANTIAL first-contact application email (320-420 words, under 3200 characters) from ${p.full_name} (${p.headline || ''}, ${p.field || ''}) for: ${opp.title} at ${opp.institution}. Address it to ${greetTo}. STRUCTURE: respectful salutation; opening paragraph naming the exact position and the single strongest reason of fit; middle paragraph mirroring 2-3 stated requirements against real experience with named programmes, standards or systems${(px2 && (px2.research_papers || []).length) ? ', and citing one of the applicant own publications by title where relevant' : ''}; brief paragraph on documents attached (CV, cover letter and supporting documents) and availability for interview at their convenience; courteous professional close with full name and contact. Format with clean paragraphs and line breaks appropriate to a ${opp.kind === 'work' ? 'professional job application' : 'formal academic application'}. Respond ONLY with JSON {"subject":"","body":""}`,
      { maxTokens: 1500, json: true, userId: a.user_id, applicationId: appId });
    const d = parseJSON(txt) || {};
    subject = noSmell(d.subject || '').slice(0, 200); body = noSmell(d.body || '').slice(0, 3400);
    // QUALITY GATE: a client-facing draft must be substantial and specific. If weak, one retry at high thinking.
    if (body.length < 900 || !subject || !body.includes(p.full_name)) {
      const txt2 = await callAI('case_writing',
        `${STYLE}\n\nThe previous draft was too weak. Write a STRONGER first-contact application email (170-200 words, under 1600 characters) from ${p.full_name} (${p.headline || ''}, ${p.field || ''}) for: ${opp.title} at ${opp.institution}. Address it to ${greetTo}. It must mention one specific, genuine detail from the applicant profile and one from the opportunity. Sign with the applicant's full name. Respond ONLY with JSON {"subject":"","body":""}`,
        { maxTokens: 700, json: true, thinking: 'high', userId: a.user_id, applicationId: appId });
      const d2 = parseJSON(txt2) || {};
      if ((d2.body || '').length > body.length) { subject = noSmell(d2.subject || subject).slice(0, 200); body = noSmell(d2.body).slice(0, 3400); }
    }
  } catch (e) {}
  if (!body) {
    /* Built from the applicant's real profile, never a three-sentence stub. If the model
       is unavailable the draft must still read like a serious professional wrote it. */
    const px3 = px2 || {};
    const papers = (px3.research_papers || []).filter(r => r && r.title).slice(0, 2);
    const methods = String(p.methods || '').split(/[,;]/).map(t => t.trim()).filter(Boolean).slice(0, 6);
    const edu = (p.education || []).map(e => e && (e.degree || '')).filter(Boolean).slice(0, 3);
    const L = [];
    L.push('Dear ' + greetTo + ',');
    L.push('');
    L.push('I am writing to apply for the ' + opp.title + ' at ' + opp.institution + '.' +
      (p.headline ? ' I am ' + p.headline + '.' : '') +
      (edu.length ? ' I hold ' + edu.join(', ') + '.' : ''));
    L.push('');
    if (px3.headline || p.field) {
      L.push('My work sits in ' + (p.field || px3.field || 'this field') + '.' +
        (methods.length ? ' My hands-on methods include ' + methods.join(', ') + '.' : '') +
        ((px3.total_experience_years) ? ' I have ' + px3.total_experience_years + ' of research and professional experience.' : ''));
      L.push('');
    }
    if (papers.length) {
      L.push('My published work includes ' + papers.map(r =>
        r.title + (r.venue ? ', ' + r.venue : '') + (r.year ? ', ' + r.year : '')).join('; ') + '.');
      L.push('');
    }
    L.push('My curriculum vitae and supporting documents are attached for your consideration. I would welcome the opportunity to discuss how my experience could support your current work.');
    L.push('');
    L.push('Thank you for your time and consideration.');
    L.push('');
    L.push('Kind regards,');
    L.push(p.full_name + (p.email ? '\n' + p.email : '') + (p.phone ? '\n' + p.phone : ''));
    subject = 'Application, ' + (opp.title || '').slice(0, 80) + ', ' + p.full_name;
    body = noSmell(L.join('\n'));
  }
  await setProg(appId, ['profile','recipient','cv','cover','email'], 'final');
  await admin().from('messages').delete().eq('application_id', appId).eq('status', 'pending');
  if (emails.length) {
    // Email route: a verified recipient exists (personal, or official department/HR inbox).
    await admin().from('messages').insert({
      user_id: a.user_id, application_id: appId, direction: 'outbound',
      to_emails: emails, subject, body, status: 'pending'
    });
    await admin().from('applications').update({
      stage: 'awaiting_authorization', updated_at: new Date().toISOString(),
      next_action: 'Review the email and authorize sending'
    }).eq('id', appId);
    await setProg(appId, PREP_STEPS.map(x=>x[0]), null);
  } else {
    // No verified email anywhere official -> NEVER a blank recipient. Prepare the full package
    // for the official application portal instead, with a concrete next action and link.
    const portalUrl = opp.url || '';
    await admin().from('applications').update({
      stage: 'portal_apply', submission_method: 'portal', updated_at: new Date().toISOString(),
      portal_url: portalUrl || null,
      next_action: portalUrl
        ? 'This opportunity accepts applications on its official portal. Your CV, letter and documents are ready — apply at the official link.'
        : 'This opportunity has no published email or portal yet. We will keep checking; your prepared documents are saved and ready.'
    }).eq('id', appId);
    if (portalUrl) { try { await portalPack(appId); } catch (e) { console.error('[portalpack]', e.message); } }
    await setProg(appId, PREP_STEPS.map(x=>x[0]), null);
  }
}

/* Admin corridor seeding (weakness #1): populate real verified inventory before launch.
   Runs the SAME quality bar and ingest as user discovery — nothing fake, official pages only. */
/* PHASE 1 — Portal Preparation Pack.
   Reads the official portal page (URL context), extracts every form question and
   required document, and maps each to the client's REAL profile answer.
   Unknown answers are listed as questions for the client — never invented. */
async function portalPack(appId) {
  const { data: a } = await admin().from('applications').select('*, opportunities(*), profiles:user_id(*)').eq('id', appId).single();
  if (!a) return;
  const opp = a.opportunities, p = a.profiles || {};
  const url = opp.portal_url || opp.url; if (!url) return;
  const prof = { full_name: p.full_name, email: p.email, phone: p.phone, country: 'Pakistan', headline: p.headline, field: p.field, degree: p.degree_level, cgpa: p.cgpa, university: p.last_institution, experience_years: p.experience_years, language: p.language_scores };
  const txt = await callAI('search_verify',
`Read this application portal page with URL context: ${url}
List EVERY form field/question and every required document the applicant must provide.
Then map each field to this applicant profile (use ONLY these facts, never invent): ${JSON.stringify(prof)}
Respond ONLY with JSON: {"fields":[{"question":"","answer":"answer from profile or empty","needs_client":true|false}],"documents":["required uploads"],"fees":"application fee if stated","notes":"key portal instructions"}`,
    { urls: true, maxTokens: 1600, json: false, userId: a.user_id, applicationId: appId });
  const d = parseJSON(txt) || {};
  const fields = Array.isArray(d.fields) ? d.fields.slice(0, 40) : [];
  const docs = Array.isArray(d.documents) ? d.documents.slice(0, 15) : [];
  const ask = fields.filter(f => f.needs_client || !f.answer);
  let md = '# Portal Answer Sheet\n\nOfficial portal: ' + url + '\n\n## Your answers, ready to copy\n\n';
  for (const f of fields) md += '**' + String(f.question).slice(0, 140) + '**\n' + (f.answer ? String(f.answer).slice(0, 300) : '_Please provide this — see below_') + '\n\n';
  if (docs.length) md += '## Documents the portal requires\n\n' + docs.map(x => '- ' + x).join('\n') + '\n\n';
  if (d.fees) md += '## Fees\n\n' + String(d.fees).slice(0, 200) + '\n\n';
  if (ask.length) md += '## We still need from you\n\n' + ask.map(f => '- ' + String(f.question).slice(0, 120)).join('\n') + '\n\nAdd these in your Profile or reply to Support, then press Prepare again.\n\n';
  if (d.notes) md += '## Portal notes\n\n' + String(d.notes).slice(0, 400) + '\n';
  md += '\n_Every answer above comes from your own documents. Review, then submit on the official portal yourself._';
  await admin().from('application_documents').delete().eq('application_id', appId).eq('kind', 'portal_pack');
  await admin().from('application_documents').insert({ application_id: appId, user_id: a.user_id, kind: 'portal_pack', title: 'Portal Answer Sheet', content: md });
  return fields.length;
}

async function seedDiscovery(kind, query, userId) {
  // Normalize to the four VISIBLE kinds (study/scholarship/postdoc/work) — any level
  // word (masters, phd, bachelors) maps to 'study' so seeded rows always show in browse.
  const seedLevel = ['masters', 'phd', 'bachelors'].includes(kind) ? kind : null;
  kind = kind === 'work' ? 'work' : ['scholarship', 'postdoc'].includes(kind) ? kind : 'study';
  query = (seedLevel ? seedLevel + ' level: ' : '') + query;
  const prompt =
`Search the web NOW for currently-open, real ${kind === 'work' ? 'jobs abroad suitable for Pakistani professionals' : kind + ' opportunities for international (Pakistani) students'}: ${query}.
QUALITY BAR: only positions you verified on the OFFICIAL university/employer page, currently open, funded/paid where stated. Extract contact emails ONLY if literally printed on official pages, never guessed.
Respond ONLY with a JSON array, up to 10 items, same schema as always:
[{"title":"","institution":"","country_code":"ISO2","city":"","url":"official page","deadline":"YYYY-MM-DD or empty","funding":"","funding_type":"fully|partial|self","level":"bachelors|masters|phd|postdoc","stipend":"the pay EXACTLY as printed, including currency, range and period, e.g. GBP 37,338 to 44,962 per annum or EUR 2,300 per month. Never convert, never estimate, leave empty if unstated","tuition":"amount+currency exactly as stated or empty","fee_structure":"semester or annual fee breakdown exactly as stated or empty","bank_statement":"proof-of-funds amount exactly as stated or empty","post_admission_requirements":["requirements after admission literally listed"],"extra":{"acceptance_hint":"","annual_living_cost":"","housing_support":"","intake_terms":"","application_process_steps":"","interview_required":"","scholarship_stack":"","work_rights":"","pr_pathway_note":"","ranking_or_reputation":""},"application_fee":"amount+currency exactly as stated or empty","duration":"","contact_emails":["seen on official pages only"],"apply_via":"email if the page gives an application email address, portal if it uses an online form or applicant system. Determine this from the official page, never guess","criteria":{"req_degree_level":"","req_field":"","req_min_cgpa":"","req_cgpa_scale":"","req_language":"","req_language_min":"","req_nationality":"","req_experience_years":"","req_license":"","req_documents":[]}}]
CRITICAL: fill fields ONLY from facts literally stated on the official page; leave everything else empty.`;
  const txt = await callAI('search_verify', searchStrategy() + prompt, { search: true, urls: true, maxTokens: 3200, userId });
  return await ingestOpps(parseJSON(txt) || [], kind, userId);
}

module.exports = { discoverForUser, prepareApplication, draftMessage, cleanEmails, noSmell, parseJSON, ingestOpps, seedDiscovery, portalPack };
