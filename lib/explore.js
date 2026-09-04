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
async function explore(q) {
  q = Object.assign({}, q || {}); const category = String(q.category || '').toLowerCase();
  const { cc, subject, level, kind, institution, funding, text, page } = q; const per = 30; const p = Math.max(1, Number(page) || 1);
  let query = admin().from('opportunities').select('id,kind,level,title,institution,country_code,city,deadline,funding_type,funding,stipend,salary_note,req_field,field,url,is_partner,sponsor_verified,category,verified_at,description,requirements,intelligence,contact_emails,apply_via,visa_sponsorship,job_type,experience_level,req_language,created_at').eq('status', 'verified').limit(3000);
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
module.exports = { explore, institution, institutionsFor, subjectOf, SUBJECTS, LEVELS };
