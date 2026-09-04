// lib/explore.js — the catalogue every competitor has and ForiForeign lacked: browse by subject,
// university, country, level and funding, with counts, without needing a CV first. Locked rows
// use the same identity scrub as search; nothing here bypasses the paywall or the eligibility gate
// at application time.
const { admin } = require('./supa');
const SUBJECTS = [
  ['Pharmacy & pharmaceutical sciences', /pharm/i], ['Medicine & clinical', /medic|clinic|mbbs|surg|oncolog|cardio|neuro|patholog|radiolog|anesth|dermat|psychiatr/i], ['Nursing & allied health', /nurs|physio|midwif|occupational therap|paramedic|allied health/i], ['Public health & epidemiology', /public health|epidemiolog|global health|health polic/i],
  ['Biological sciences', /biolog|biochem|molecular|genetic|microbiolog|immunolog|neuroscience|biotech|bioinformatic/i], ['Chemistry & materials', /chemi|materials|polymer|nanotech/i], ['Physics & astronomy', /physic|astronom|optic|photonic|quantum/i], ['Mathematics & statistics', /mathemat|statistic|actuar/i], ['Environment, earth & agriculture', /environment|climate|earth|geolog|agricult|forestry|marine|ecolog|sustainab/i],
  ['Computer science & AI', /computer|software|data science|artificial intelligence|machine learning|\bai\b|cyber|informatic|robotic/i], ['Engineering', /engineer|mechatron|aerospace|automotive/i], ['Business, management & economics', /business|management|mba|econom|finance|account|marketing|entrepreneur|supply chain/i], ['Law & policy', /\blaw\b|legal|policy|public administration|governance/i],
  ['Education', /educat|teach|pedagog|curricul/i], ['Social sciences & psychology', /psycholog|sociolog|anthropolog|political|international relations|development studies|social work/i], ['Arts, humanities & languages', /histor|philosoph|linguist|literature|language|art\b|design|architect|media|journal|music|theolog|islamic/i]
];
function subjectOf(text) { const t = String(text || ''); for (const [name, re] of SUBJECTS) if (re.test(t)) return name; return 'Other / interdisciplinary'; }
const LEVELS = ['bachelors', 'masters', 'phd', 'postdoc', 'fellowship', 'diploma', 'short_course'];
/* UNDERSTAND THE QUERY: "canada", "ca", "uk", "dubai", "driver job", "nurse germany" — country words and aliases become the country
   filter, job words set the lane, the rest searches titles. And ALWAYS SHOW RESULTS: if the exact search is empty, the search widens
   (drop the text, then the country) and says so. Nobody should meet an empty page. */
const COUNTRY_ALIASES = { canada: 'CA', ca: 'CA', uk: 'GB', 'united kingdom': 'GB', britain: 'GB', england: 'GB', london: 'GB', scotland: 'GB', usa: 'US', us: 'US', america: 'US', 'united states': 'US', germany: 'DE', deutschland: 'DE', berlin: 'DE', australia: 'AU', aus: 'AU', 'new zealand': 'NZ', nz: 'NZ', ireland: 'IE', dubai: 'AE', uae: 'AE', emirates: 'AE', 'abu dhabi': 'AE', saudi: 'SA', ksa: 'SA', riyadh: 'SA', qatar: 'QA', doha: 'QA', oman: 'OM', kuwait: 'KW', bahrain: 'BH', japan: 'JP', korea: 'KR', 'south korea': 'KR', china: 'CN', singapore: 'SG', malaysia: 'MY', turkey: 'TR', turkiye: 'TR', france: 'FR', paris: 'FR', italy: 'IT', spain: 'ES', portugal: 'PT', netherlands: 'NL', holland: 'NL', belgium: 'BE', sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI', poland: 'PL', czech: 'CZ', czechia: 'CZ', hungary: 'HU', romania: 'RO', austria: 'AT', switzerland: 'CH', greece: 'GR', cyprus: 'CY', malta: 'MT', croatia: 'HR', lithuania: 'LT', latvia: 'LV', estonia: 'EE', slovakia: 'SK', slovenia: 'SI', bulgaria: 'BG', luxembourg: 'LU', 'hong kong': 'HK', taiwan: 'TW', thailand: 'TH', brunei: 'BN', kazakhstan: 'KZ', uzbekistan: 'UZ', azerbaijan: 'AZ', georgia: 'GE' };
const WORK_WORDS = /\b(job|jobs|driver|nurse|nursing|care worker|carer|welder|electrician|plumber|technician|chef|cook|cleaner|security|labour|labor|warehouse|factory|engineer|pharmacist|doctor|teacher|accountant|developer|it|helper|mason|carpenter|vacancy|vacancies|hiring|salary|work|employment|visa sponsorship)\b/i;
const STUDY_WORDS = /\b(scholarship|scholarships|masters|master's|msc|ma|phd|bachelor|bachelors|bsc|study|degree|university|admission|admissions|course|programme|program|postdoc|fellowship)\b/i;
function understand(q) { let text = String(q.text || '').trim(); const out = { cc: q.cc, kind: q.kind, text, notes: [] }; const low = text.toLowerCase(); const words = low.split(/[^a-z']+/).filter(Boolean);
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES).sort((a, b) => b[0].length - a[0].length)) { const re = new RegExp('(^|\\s)' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)', 'i'); if (re.test(low)) { if (!out.cc) { out.cc = code; out.notes.push('country ' + code); } text = text.replace(re, ' ').trim(); break; } }
  if (!out.kind) { if (WORK_WORDS.test(low) && !STUDY_WORDS.test(low)) { out.kind = 'work'; out.notes.push('work lane'); } else if (STUDY_WORDS.test(low) && !WORK_WORDS.test(low)) { out.kind = 'study'; out.notes.push('study lane'); } }
  text = text.replace(/\b(job|jobs|vacancy|vacancies|hiring|in|for|at|abroad|the|a|an)\b/gi, ' ').replace(/\s+/g, ' ').trim(); out.text = text; return out; }
async function explore(q) {
  q = Object.assign({}, q || {}); const category = String(q.category || '').toLowerCase();
  const u = understand(q); q.cc = u.cc; q.kind = u.kind; q.text = u.text;
  const first = await exploreOnce(q, category); if (first.total > 0 || (!q.text && !q.cc)) return Object.assign(first, { understood: u.notes });
  if (q.text) { const wider = await exploreOnce(Object.assign({}, q, { text: '' }), category); if (wider.total > 0) return Object.assign(wider, { understood: u.notes, widened: 'No exact match for "' + u.text + '"; showing everything else that fits your filters.' }); }
  if (q.cc) { const widest = await exploreOnce(Object.assign({}, q, { text: '', cc: '' }), category); if (widest.total > 0) return Object.assign(widest, { understood: u.notes, widened: 'Nothing verified in that country yet; showing the closest options in other countries.' }); }
  return Object.assign(first, { understood: u.notes });
}
async function exploreOnce(q, category) {
  const { cc, subject, level, kind, institution, funding, text, page } = q; const per = 30; const p = Math.max(1, Number(page) || 1);
  let query = admin().from('opportunities').select('id,kind,level,title,institution,country_code,city,deadline,funding_type,funding,stipend,salary_note,req_field,field,url,is_partner,sponsor_verified,category,verified_at,description,requirements,visa_sponsorship,apply_via,tuition,duration,req_language,req_language_min,description,requirements,intelligence,contact_emails,apply_via,visa_sponsorship,job_type,experience_level,req_language,created_at').eq('status', 'verified').limit(3000);
  if (cc) query = query.in('country_code', String(cc).toUpperCase().split(',').filter(Boolean));
  if (kind === 'work' || kind === 'labour') query = query.eq('kind', 'work'); else if (kind === 'study') query = query.neq('kind', 'work');
  if (kind === 'labour' || category === 'labour') query = query.in('category', ['labour', 'care']); else if (category) query = query.eq('category', category);
  if (level && LEVELS.includes(level)) query = query.eq('level', level);
  if (funding) query = query.eq('funding_type', funding);
  if (institution) query = query.ilike('institution', '%' + String(institution).slice(0, 80) + '%');
  if (text) query = query.or('title.ilike.%' + String(text).slice(0, 60).replace(/[%,]/g, ' ') + '%,institution.ilike.%' + String(text).slice(0, 60).replace(/[%,]/g, ' ') + '%');
  const { data } = await query; let rows = (data || []).filter(o => !o.deadline || o.deadline >= new Date().toISOString().slice(0, 10));
  rows = rows.map(o => Object.assign(o, { subject: subjectOf([o.req_field, o.field, o.title].join(' ')) }));
  if (subject) rows = rows.filter(o => o.subject === subject);
  const categories = {}; for (const o of rows) categories[o.category || 'skilled'] = (categories[o.category || 'skilled'] || 0) + 1;
  /* PARTNER PRIORITY: institutions with a countersigned MOU come first among the options that meet the same filters; the card says so. */
  rows.sort((a, b) => (b.is_partner ? 1 : 0) - (a.is_partner ? 1 : 0));
  const count = (key, fn) => { const m = {}; for (const o of rows) { const k = fn(o); if (k) m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, n })); };
  const facets = { categories: Object.entries(categories).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n), countries: count('cc', o => o.country_code), subjects: count('s', o => o.subject), levels: count('l', o => o.level), funding: count('f', o => o.funding_type), institutions: count('i', o => o.institution).slice(0, 60), kinds: count('k', o => o.kind === 'work' ? 'work' : 'study') };
  rows.sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1);
  return { total: rows.length, page: p, per, facets, rows: rows.slice((p - 1) * per, p * per) };
}
async function institutionsFor(cc) { const { data } = await admin().from('institutions').select('name,domain,website,kind,verified,partner_org_id').eq('country_code', String(cc || '').toUpperCase()).order('name').limit(100); return data || []; }
async function institution(name) {
  const { data } = await admin().from('opportunities').select('id,kind,level,title,institution,country_code,city,deadline,funding_type,url,is_partner,sponsor_verified').eq('status', 'verified').ilike('institution', String(name || '').slice(0, 120)).limit(200);
  const rows = data || []; let cc = rows[0] && rows[0].country_code; let entity = null;
  try { const { data: e } = await admin().from('institutions').select('*').ilike('name', String(name || '').slice(0, 120)).maybeSingle(); entity = e; if (!cc && e) cc = e.country_code; } catch (e) {}
  let rules = []; if (cc) { try { const { data: r } = await admin().from('visa_rules').select('route_key,route_name,rule_type,text,source_url,status').eq('country_code', cc).in('rule_type', ['pr_path', 'work_rights', 'note']).neq('status', 'superseded').limit(8); rules = r || []; } catch (e) {} }
  return { institution: name, entity, country_code: cc, openings: rows.length, by_level: rows.reduce((m, o) => { m[o.level || o.kind] = (m[o.level || o.kind] || 0) + 1; return m; }, {}), rows, rules };
}
module.exports = { explore, understand, COUNTRY_ALIASES, institution, institutionsFor, subjectOf, SUBJECTS, LEVELS };
