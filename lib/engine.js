// lib/engine.js — ForiForeign pipeline: discover -> verify -> prepare -> draft
// Ported from the battle-tested PostDocX rules: evidence-only, no invented emails,
// truthful documents, no AI-smell, guaranteed drafts, human authorization (R4).
const { admin } = require('./supa');
const { callAI } = require('./router');

const STYLE = `STRICT OUTPUT RULES: never use the words tailored, customized, AI, Claude, GPT, Gemini, generated, or template. Never leave placeholder brackets like [name] or blank fields, omit unknowns and write around them. No em dashes or en dashes anywhere. Structure documents with clear short section headings written as a line wrapped in ** (for example **Education**), followed by flowing professional prose a senior applicant would sign, ready to send with zero editing. Respond with the final text only.`;

function parseJSON(t) {
  if (!t) return null;
  const s2 = String(t).replace(/```json|```/g, '');
  // Fast path: outermost array/object by regex.
  try { const m = s2.match(/\[[\s\S]*\]|\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch (e) {}
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
  const om = s2.match(/\{[\s\S]*?\}/);
  if (om) { try { const o = JSON.parse(om[0]); return Array.isArray(o) ? o : [o]; } catch (e) {} }
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
  return 'SEARCH STRATEGY, multi-source and broad: (1) official university/employer admissions and careers pages on their own domains; (2) funding and vacancy databases as discovery leads — EUROPE: DAAD, study-in-germany.de, Campus France, studyinsweden.se, studyinfinland.fi, studyinnorway.no, Study in Denmark/Holland/Austria portals, Erasmus Mundus catalogue, Euraxess, ScholarshipPortal, FindAPhD, FindAMasters, jobs.ac.uk, Academic Positions, THEunijobs, EURES, Turkiye Burslari; PAKISTAN-TRUSTED: HEC Pakistan foreign scholarships (hec.gov.pk), USEFP Fulbright Pakistan; USA: Fulbright, HigherEdJobs, HERC, Science Careers, Nature Careers; CANADA: University Affairs, Canada Job Bank, Vanier/Banting; AUSTRALIA/NZ: Australia Awards, RTP listings, Seek, UniJobs AU, Seek NZ, University of Auckland/Otago scholarship pages; GULF AND HEALTHCARE: SCFHS careers, DHA jobs portal, Hamad Medical Corporation careers, SEHA UAE, Kuwait/Oman/Bahrain MOH careers, GulfTalent, Bayt, Naukrigulf; GLOBAL: Chevening, Commonwealth Scholarships, MEXT, China CSC, Korea GKS, LinkedIn Jobs, Indeed, ResearchGate jobs; cover ALL career families: healthcare (doctors, nurses, pharmacists, allied health), natural sciences, engineering, IT, business, social sciences, education, and every study level; (3) public posts and advertisements: professor/lab/department announcements on LinkedIn (try lead searches like: linkedin.com/posts PhD position <field> <country>), X posts, Facebook scholarship groups and pages, university newspaper and portal advertisements, department news pages, professor homepages, and conference job boards — all used ONLY as leads. EVERY fact must then be verified on the official institutional page before reporting, and the url you report must be that official page, openable by anyone, so the user can personally verify it. Never cite a portal or a social post as the source. FRESHNESS, today is ' + today + ': the deadline must be ' + today + ' or later, or the official page must literally state applications are open or rolling; reject expired, closed or unverifiable listings. Read pages with URL context, never rely on snippets. Report ONLY facts literally present on official pages, leave everything else empty.\n\n';
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
  const target = Math.min(20, Math.max(1, Number(prefs.target) || 5));
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
      let q = admin().from('opportunities').select('*').eq('status', 'verified').gte('created_at', since).order('created_at', { ascending: false }).limit(40);
      q = kind === 'work' ? q.eq('kind', 'work') : q.in('kind', ['study', 'scholarship', 'postdoc']);
      if (priority.length) q = q.in('country_code', priority);
      const { data: fr } = await q;
      const ms = await matchMany(userId, fr || []);
      const relevant = (ms || []).filter(m => m && m.pct != null && m.pct >= 60).length;
      if (relevant >= Math.min(3, target)) return 0; // truly relevant supply exists — save the cost
    } catch (e) { /* on any doubt, search */ }
  }
  const fundedOnly = prefs.fundedOnly || p.funded_only;
  const budgetLine = fundedOnly ? 'ONLY fully funded/salaried positions.' : (Number(p.annual_budget_pkr) > 0 ? 'Annual budget PKR ' + p.annual_budget_pkr + ', prefer affordable or funded options and label estimated costs.' : '');
  const licenseLine = kind === 'work' && p.profession ? 'Profession: ' + p.profession + '. Only roles where a Pakistani-qualified ' + p.profession + ' can realistically obtain registration; name the license/exam required (e.g. DHA, SCFHS, NCLEX, PEBC).' : '';
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
  const countryLine = scope
    ? (pi === 0
      ? 'STRICT COUNTRY SCOPE for this pass, only: ' + scope.join(', ') + '.'
      : 'PRIORITY COUNTRIES first: ' + priority.join(', ') + '. To complete the set, comparable nearby destinations are allowed: ' + scope.filter(c => priority.indexOf(c) < 0).join(', ') + '.')
    : (priority.length ? 'PRIORITY COUNTRIES first: ' + priority.join(', ') + ', then the best available worldwide.' : '');
  const remoteLine = prefs.remote && kind === 'work' ? 'Prefer remote-eligible roles; state remote status explicitly.' : '';
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
  const pxLine = px ? ('CANDIDATE DEPTH: profession ' + (px.profession || p.field || '') + (px.total_experience_years ? ', ' + px.total_experience_years + ' years total experience' : '') + (px.certifications && px.certifications.length ? ', certifications: ' + px.certifications.slice(0, 5).join('; ') : '') + '.') : '';
  const progLine = (prefs.programTypes && prefs.programTypes.length) ? 'PROGRAMME TYPE: ' + prefs.programTypes.join(' or ').replace(/_/g, ' ') + ' offerings included.' : '';
  const sectorLine = (prefs.sectors && prefs.sectors.length) ? 'EMPLOYER SECTOR: ' + prefs.sectors.join(' or ').replace(/_/g, ' ') + '.' : '';
  const jobAggr = kind === 'work' ? 'JOB RIGOR: hunt VALID, currently-open vacancies in the selected countries aggressively. For every job state ALL requirements before applying: license, language requirement or barrier, minimum experience, and required documents. Disclose everything; hide nothing.' : '';
  const levelLine = (prefs.levels && prefs.levels.length) ? 'STUDY LEVEL: only ' + prefs.levels.join(' or ') + ' level programmes.' : (prefs.level ? 'STUDY LEVEL: only ' + prefs.level + '-level programmes.' : '');
  const fieldLine = prefs.field ? 'FIELD FOCUS: ' + prefs.field + '-related programmes and roles.' : '';
  const intakeLine = prefs.intake ? 'INTAKE: prefer intakes and start dates in ' + prefs.intake + '.' : '';
  const jobLine = (prefs.jobTypes && prefs.jobTypes.length ? 'JOB TYPE: ' + prefs.jobTypes.join(' or ').replace(/_/g, ' ') + '. ' : '') + (prefs.exps && prefs.exps.length ? 'EXPERIENCE LEVEL: ' + prefs.exps.join(' or ') + '.' : '');
  const langLine = prefs.noLang ? 'LANGUAGE: strongly prefer programmes with NO IELTS/TOEFL requirement (English-taught, MOI letter accepted). State the language requirement explicitly.' : '';
  const licenseLine2 = (prefs.licenses && prefs.licenses.length) ? 'LICENSING: target roles open to ' + prefs.licenses.join(' / ') + ' license holders or eligible candidates; state the licensing requirement explicitly.' : (prefs.license ? 'LICENSING: target roles open to ' + prefs.license + ' license holders; state the licensing requirement explicitly.' : '');
  const prompt =
`Search the web NOW for currently-open, real ${kind === 'work' ? 'jobs abroad for a Pakistani ' + (p.headline || 'medical professional') : kind + ' opportunities'} matching this applicant:
${p.headline || ''}; field ${p.field || ''}; skills ${String(p.methods || '').slice(0, 200)}. ${budgetLine} ${licenseLine} ${countryLine} ${remoteLine} ${levelLine} ${langLine} ${licenseLine2} ${fieldLine} ${intakeLine} ${jobLine} ${ladderLine} ${pxLine} ${progLine} ${sectorLine} ${jobAggr} ${uniLine} ${ANGLES[pi % ANGLES.length]} ${knownLine}
LICENSING AWARENESS: when the official page names a required license or exam, capture it EXACTLY. Recognize these when stated (never assume): DOCTORS: USMLE/ECFMG (US), PLAB/GMC (UK), MCCQE (Canada), AMC (Australia), Kenntnisprufung+FSP/Approbation (Germany), EU country medical boards, HPCSA (South Africa), SCHS/SCFHS Prometric (Saudi), DHA/DOH-HAAD/MOHAP (UAE), QCHP-DHP (Qatar), NHRA (Bahrain), OMSB (Oman), Kuwait MOH, SMC (Singapore), MMC (Malaysia), HAAD-equivalent Gulf Prometrics. NURSES: NCLEX-RN (US/some Gulf), CBT+OSCE NMC (UK), NCLEX/OIIQ (Canada), OBA/NCLEX AHPRA (Australia), Anerkennung (Germany), NMBI (Ireland), SNB (Singapore), Gulf Prometrics (SCFHS/DHA/DOH/MOHAP/QCHP/NHRA/OMSB). PHARMACISTS: FPGEE+NAPLEX (US), GPhC OSPAP (UK), PEBC (Canada), KAPS+APC/AHPRA (Australia), PSI (Ireland), Gulf pharmacy Prometrics. DENTISTS: INBDE/bench (US), ORE/GDC (UK), NDEB (Canada), ADC (Australia), Gulf dental Prometrics. ALLIED HEALTH: CORU (Ireland), HCPC (UK), ASCP-i (labs, US/Gulf), Gulf allied Prometrics. ENGINEERS: FE/PE-NCEES (US), CEng/IET-ICE (UK), P.Eng/EGBC-PEO (Canada), NER/Engineers Australia CDR, Chartered Engineer (Ireland), Saudi Council of Engineers SCE, UAE Society of Engineers, MMUP/UPDA (Qatar), Kuwait Society of Engineers, PEC recognition routes. IT/SOFTWARE: usually NO license, visa routes instead (EU Blue Card, Germany Opportunity Card, UK Skilled Worker); certs like AWS/Azure/CISSP only if the posting states them. LANGUAGE: IELTS/OET/PTE, Goethe-TELC B1-B2 (Germany), TEF/TCF (France/Canada), DELE (Spain), JLPT (Japan), TOPIK (Korea).\nQUALITY BAR: only positions you verified on the OFFICIAL university/employer page, currently open, funded/paid. Extract contact emails ONLY if literally printed on official pages, never guessed.
Respond ONLY with a JSON array, up to 10 items:
[{"title":"","institution":"","country_code":"ISO2","city":"","url":"official page","deadline":"YYYY-MM-DD or empty","funding":"","funding_type":"fully|partial|self","level":"bachelors|masters|phd|postdoc","stipend":"","tuition":"amount+currency exactly as stated or empty","application_fee":"amount+currency exactly as stated or empty","duration":"","contact_emails":["seen on official pages only"],"apply_via":"email|portal","extra":{"acceptance_hint":"stated acceptance/selectivity info","annual_living_cost":"","housing_support":"","intake_terms":"","application_process_steps":"brief steps if stated","interview_required":"yes|no|empty","scholarship_stack":"other stackable scholarships named","work_rights":"part-time work rules if stated","pr_pathway_note":"post-study residence route if stated","ranking_or_reputation":""},"criteria":{"req_degree_level":"bachelors|masters|phd|any or empty","req_field":"","req_min_cgpa":"number or empty","req_cgpa_scale":"number or empty","req_language":"IELTS|TOEFL|none or empty","req_language_min":"number or empty","req_nationality":"restriction or empty","req_experience_years":"number or empty","req_license":"DHA|SCFHS|NCLEX|PEBC or empty","req_documents":["required document names literally listed"]}}]
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
    const lvl = ['bachelors', 'masters', 'phd', 'postdoc'].includes(String(it.level || '').toLowerCase())
      ? String(it.level).toLowerCase()
      : (kind === 'postdoc' ? 'postdoc' : null);
    const row = {
      kind: inferKind(it), title: noSmell(it.title).slice(0, 300), institution: noSmell(it.institution).slice(0, 200),
      country_code: (it.country_code || '').slice(0, 2).toUpperCase() || null,
      city: it.city || '', url: it.url,
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
      req_degree_level: ['bachelors', 'masters', 'phd', 'any'].includes(String(c.req_degree_level || '').toLowerCase()) ? String(c.req_degree_level).toLowerCase() : null,
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

  const profileBlock =
`APPLICANT (real facts only, never invent): ${p.full_name}; ${p.headline || ''}; field ${p.field || ''}; skills ${p.methods || ''}; education ${JSON.stringify(p.education || []).slice(0, 600)}; publications ${JSON.stringify(p.publications || []).slice(0, 600)}; experience ${JSON.stringify(p.experience || []).slice(0, 600)}`;

  const MINLEN = { cv: 1200, cover: 900, sop: 900, research_proposal: 900, scholarship_statement: 600 };
  const mk = async (kind, title, instruction) => {
    const need = MINLEN[kind] || 600;
    // Resume guard: a substantial version already exists for this case — keep it, zero AI cost on retry.
    try {
      const { data: ex } = await admin().from('application_documents').select('id,content').eq('application_id', appId).eq('kind', kind).limit(1);
      if (ex && ex.length && String(ex[0].content || '').length >= Math.min(need, 600)) return;
    } catch (e) {}
    let content = '';
    try {
      content = noSmell(await callAI('high_value',
        `${STYLE}\n\n${profileBlock}\n\nPOSITION: ${opp.title} at ${opp.institution}${opp.country_code ? ', ' + opp.country_code : ''}. ${instruction}`,
        { maxTokens: 2200, userId: a.user_id, applicationId: appId }));
    } catch (e) { /* guaranteed-document rule below */ }
    // Quality gate: a client-facing document must be complete and substantial.
    // One rescue attempt at high thinking with an explicit completeness requirement.
    if (content && content.length < need) {
      try {
        const t2 = noSmell(await callAI('high_value',
          `${STYLE}\n\nThe previous draft was too short and incomplete. ${profileBlock}\n\nPOSITION: ${opp.title} at ${opp.institution}. ${instruction} Write the COMPLETE document, at least ${Math.round(need / 6)} words, every section fully written, nothing abbreviated or summarised.`,
          { maxTokens: 3000, thinking: 'high', userId: a.user_id, applicationId: appId }));
        if (t2.length > content.length) content = t2;
      } catch (e) {}
    }
    if (!content || content.length < 200) {
      content = noSmell(`${p.full_name}\n${p.headline || ''}\n\n${kind === 'cv'
        ? 'PROFILE\n' + (p.field || '') + '. Core skills: ' + (p.methods || '') + '.\n\nEDUCATION\n' + (p.education || []).map(e => `${e.degree || ''}, ${e.institution || ''}, ${e.year || ''}`).join('\n') + '\n\nPUBLICATIONS\n' + (p.publications || []).map(x => typeof x === 'string' ? x : x.title || '').join('\n')
        : 'Dear Selection Committee,\n\nI am writing to apply for the ' + opp.title + ' at ' + opp.institution + '. My background in ' + (p.field || 'my field') + ' aligns directly with this position, and my documents are attached for your consideration.\n\nThank you for your time.\n\nKind regards,\n' + p.full_name}`);
    }
    await admin().from('application_documents').delete().eq('application_id', appId).eq('kind', kind);
    await admin().from('application_documents').insert({ application_id: appId, user_id: a.user_id, kind, title, content });
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
Classify realistic document requirements. For work positions include the licensing/registration steps (license exams are eligibility, never inferred from a degree alone). JSON only:
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

  // Spec 28: the package/document plan is admin-configurable (Settings -> case_plan).
  const DOC_CATALOG = {
    cv: ['CV', 'Write an opportunity-specific CV from ONLY the real facts above. Include EVERY real publication and degree, never drop one, never invent. Bold section headings, most relevant research first.'],
    cover: ['Cover letter', 'Write a one-page cover letter, warm, confident, specific to this institution and role, stating documents are attached.'],
    sop: ['Statement of Purpose', 'Write a focused statement of purpose grounded ONLY in the real facts above: motivation, fit with this specific program/institution, and concrete goals. No invented achievements.'],
    research_proposal: ['Research proposal outline', 'Write a short research proposal outline aligned with this position, grounded ONLY in the applicant\'s real background above; frame realistic aims, never invent prior results.'],
    scholarship_statement: ['Scholarship statement', 'Write a concise scholarship/financial-need statement grounded ONLY in the real facts above, professional and specific to this opportunity.']
  };
  let plan = ['cv', 'cover'];
  try {
    const cfg = await require('./settings').getConfig();
    const wanted = (cfg.case_plan && cfg.case_plan.docs) || [];
    const allowed = wanted.filter(k => DOC_CATALOG[k]);
    // REQUIREMENT-DRIVEN: the admin plan is the allowed superset; each case generates
    // ONLY what this specific official position calls for. CV + cover always; the rest
    // only when the listing's level, kind or stated criteria require it. No wasted AI.
    const blob = [opp.title, opp.funding, opp.level, opp.kind, JSON.stringify(opp.criteria || ''), JSON.stringify(opp.intelligence || ''), opp.description || ''].join(' ').toLowerCase();
    const needs = k => {
      if (k === 'cv' || k === 'cover') return true;
      if (k === 'sop') return opp.kind !== 'work' && (['bachelors', 'masters', 'phd'].includes(opp.level) || /statement of purpose|motivation letter|personal statement|\bsop\b/.test(blob));
      if (k === 'research_proposal') return ['phd', 'postdoc'].includes(opp.level) || /research proposal|research plan|concept note|research statement/.test(blob);
      if (k === 'scholarship_statement') return opp.kind === 'scholarship' || /scholarship (essay|statement)|financial need/.test(blob);
      return false;
    };
    plan = (allowed.length ? allowed : ['cv', 'cover']).filter(needs);
    if (!plan.includes('cv')) plan.unshift('cv');
    if (!plan.includes('cover')) plan.splice(1, 0, 'cover');
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
  await setProg(appId, ['profile','recipient','cv','cover'], 'email');
  let subject = '', body = '';
  const greetTo = rec.recipientName ? rec.recipientName : (rec.roleLabel || (opp.kind === 'work' ? 'Hiring Team' : 'Selection Committee'));
  try {
    const txt = await callAI('high_value',
      `${STYLE}\n\nWrite a first-contact application email (150-200 words, MUST be under 1600 characters total) from ${p.full_name} (${p.headline || ''}, ${p.field || ''}) for: ${opp.title} at ${opp.institution}. Address it to ${greetTo}. Specific, warm, respectful; documents stated as attached; courteous close. Respond ONLY with JSON {"subject":"","body":""}`,
      { maxTokens: 700, json: true, userId: a.user_id, applicationId: appId });
    const d = parseJSON(txt) || {};
    subject = noSmell(d.subject || '').slice(0, 200); body = noSmell(d.body || '').slice(0, 1700);
    // QUALITY GATE: a client-facing draft must be substantial and specific. If weak, one retry at high thinking.
    if (body.length < 350 || !subject || !body.includes(p.full_name)) {
      const txt2 = await callAI('high_value',
        `${STYLE}\n\nThe previous draft was too weak. Write a STRONGER first-contact application email (170-200 words, under 1600 characters) from ${p.full_name} (${p.headline || ''}, ${p.field || ''}) for: ${opp.title} at ${opp.institution}. Address it to ${greetTo}. It must mention one specific, genuine detail from the applicant profile and one from the opportunity. Sign with the applicant's full name. Respond ONLY with JSON {"subject":"","body":""}`,
        { maxTokens: 700, json: true, thinking: 'high', userId: a.user_id, applicationId: appId });
      const d2 = parseJSON(txt2) || {};
      if ((d2.body || '').length > body.length) { subject = noSmell(d2.subject || subject).slice(0, 200); body = noSmell(d2.body).slice(0, 1700); }
    }
  } catch (e) {}
  if (!body) {
    subject = 'Application, ' + (opp.title || '').slice(0, 80) + ', ' + p.full_name;
    body = noSmell(`Dear ${greetTo},\n\nI am writing to apply for the ${opp.title} at ${opp.institution}. My background in ${p.field || 'my field'} matches this position closely, and my CV and cover letter are attached for your consideration.\n\nThank you for your time, I would welcome the opportunity to discuss my application.\n\nKind regards,\n${p.full_name}`);
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
[{"title":"","institution":"","country_code":"ISO2","city":"","url":"official page","deadline":"YYYY-MM-DD or empty","funding":"","funding_type":"fully|partial|self","level":"bachelors|masters|phd|postdoc","stipend":"","tuition":"amount+currency exactly as stated or empty","fee_structure":"semester or annual fee breakdown exactly as stated or empty","bank_statement":"proof-of-funds amount exactly as stated or empty","post_admission_requirements":["requirements after admission literally listed"],"extra":{"acceptance_hint":"","annual_living_cost":"","housing_support":"","intake_terms":"","application_process_steps":"","interview_required":"","scholarship_stack":"","work_rights":"","pr_pathway_note":"","ranking_or_reputation":""},"application_fee":"amount+currency exactly as stated or empty","duration":"","contact_emails":["seen on official pages only"],"apply_via":"email|portal","criteria":{"req_degree_level":"","req_field":"","req_min_cgpa":"","req_cgpa_scale":"","req_language":"","req_language_min":"","req_nationality":"","req_experience_years":"","req_license":"","req_documents":[]}}]
CRITICAL: fill fields ONLY from facts literally stated on the official page; leave everything else empty.`;
  const txt = await callAI('search_verify', searchStrategy() + prompt, { search: true, urls: true, maxTokens: 3200, userId });
  return await ingestOpps(parseJSON(txt) || [], kind, userId);
}

module.exports = { discoverForUser, prepareApplication, draftMessage, cleanEmails, noSmell, parseJSON, ingestOpps, seedDiscovery, portalPack };
