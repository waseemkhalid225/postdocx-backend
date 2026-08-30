// ForiForeign Harvest — the four free-inventory tools working as one pipeline:
//   1) rssWatch:    pull RSS feeds from major portals (zero AI cost) -> lead queue
//   2) braveLeads:  raw web-search lead harvesting via Brave API (needs BRAVE_API_KEY) -> lead queue
//   3) verifyLeads: batches of queued URLs verified with URL-context AI -> real opportunities
//   4) uniSweep:    rotating scheduled sweep of admin priority institutions' official pages
// Every path ends at ingestOpps, so the same QC gate guards everything.
const { admin } = require('./supa');
const { errlog } = require('./oblog');

const DEFAULT_FEEDS = [
  'https://www.jobs.ac.uk/feeds/all',
  'https://euraxess.ec.europa.eu/jobs/rss',
  'https://www.nature.com/naturecareers/rss',
  'https://www.findaphd.com/common/rss/latestphds.aspx',
  'https://www.timeshighereducation.com/unijobs/rss'
];

const QKEY = 'lead_queue';

async function getQueue() {
  try { const { data } = await admin().from('app_settings').select('value').eq('key', QKEY).single(); return (data && data.value && data.value.items) || []; }
  catch (e) { return []; }
}
async function setQueue(items) {
  try { await admin().from('app_settings').upsert({ key: QKEY, value: { items: items.slice(0, 300) } }); } catch (e) {}
}

async function pushLeads(leads, src) {
  if (!leads.length) return 0;
  const q = await getQueue();
  const seen = new Set(q.map(x => x.url));
  let added = 0;
  for (const l of leads) {
    const url = String(l.url || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    // Never queue what the database already holds.
    try { const { data: dup } = await admin().from('opportunities').select('id').eq('url', url).limit(1); if (dup && dup.length) continue; } catch (e) {}
    q.push({ url, title: String(l.title || '').slice(0, 140), src, at: new Date().toISOString() });
    seen.add(url); added++;
    if (q.length >= 300) break;
  }
  await setQueue(q);
  return added;
}

/* ---- Tool 1: RSS watcher — finds openings hours after posting, zero AI cost ---- */
async function rssWatch() {
  let feeds = DEFAULT_FEEDS;
  try { const { data } = await admin().from('app_settings').select('value').eq('key', 'harvest_feeds').single(); if (data && data.value && Array.isArray(data.value.items) && data.value.items.length) feeds = data.value.items; } catch (e) {}
  let total = 0;
  for (const feed of feeds.slice(0, 10)) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(feed, { signal: ctl.signal, headers: { 'user-agent': 'ForiForeignBot/1.0 (+https://foriforeign.com)' } });
      clearTimeout(t);
      if (!r.ok) continue;
      const xml = await r.text();
      const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].slice(0, 15).map(m => {
        const b = m[0];
        const g = re => { const mm = b.match(re); return mm ? mm[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''; };
        return { title: g(/<title[^>]*>([\s\S]*?)<\/title>/i), url: g(/<link[^>]*>([\s\S]*?)<\/link>/i) || g(/<guid[^>]*>([\s\S]*?)<\/guid>/i) };
      }).filter(x => x.url);
      total += await pushLeads(items, 'rss');
    } catch (e) { /* a dead feed is silently skipped */ }
  }
  if (total) console.log('[harvest] rssWatch queued ' + total + ' leads');
  return total;
}

/* ---- Tool 3: Brave web-search lead harvesting (raw, non-AI, cheap) ---- */
const BRAVE_QUERIES = [
  'fully funded masters scholarships international students 2026',
  'fully funded PhD positions Europe stipend open now',
  'postdoc positions life sciences open application',
  'government scholarships for Pakistani students',
  // Licensed-professional depth: the credential world's own vocabulary
  'DHA licensed pharmacist vacancy Dubai hospital',
  'SCFHS registered nurse jobs Saudi Arabia hospital careers',
  'QCHP doctor vacancy Qatar Hamad Sidra',
  'NHS Trust IMG doctor vacancy Trac jobs',
  'NMC registered nurse UK international recruitment NHS',
  'MOH Kuwait Oman Bahrain pharmacist nurse vacancy',
  'PEBC pharmacist jobs Canada licensed',
  'AHPRA registered nurse jobs Australia sponsorship',
  'UPDA engineer vacancy Qatar',
  'Saudi Council of Engineers jobs Aramco NEOM SABIC careers',
  'medical laboratory technologist ASCP Gulf vacancy DataFlow',
  'physiotherapist HCPC NHS vacancy international'
];
async function braveLeads() {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return 0;
  let total = 0;
  const q = BRAVE_QUERIES[Math.floor(Math.random() * BRAVE_QUERIES.length)];
  try {
    const r = await fetch('https://api.search.brave.com/res/v1/web/search?count=10&q=' + encodeURIComponent(q), {
      headers: { 'X-Subscription-Token': key, accept: 'application/json' } });
    if (!r.ok) return 0;
    const d = await r.json();
    const items = ((d.web && d.web.results) || []).map(x => ({ url: x.url, title: x.title }));
    total = await pushLeads(items, 'brave');
    if (total) console.log('[harvest] braveLeads queued ' + total + ' leads for: ' + q);
  } catch (e) { await errlog('harvest:brave', e, {}); }
  return total;
}

/* ---- Tool 2: URL-verification queue — AI reads queued pages, only real openings enter ---- */
async function verifyLeads() {
  const q = await getQueue();
  if (!q.length) return 0;
  const batch = q.slice(0, 6);
  await setQueue(q.slice(6));
  const { callAI } = require('./router');
  const { ingestOpps, parseJSON } = require('./engine');
  const prompt =
`Open and READ each of these pages with URL context. For EVERY page that is a currently-open study, scholarship, or job opportunity (deadline today or later, or literally stated as open/rolling), output one item in the JSON schema. Skip listings pages, expired, or non-opportunity pages entirely.
PAGES:\n${batch.map(x => '- ' + x.url + (x.title ? ' (' + x.title + ')' : '')).join('\n')}
Respond ONLY with a JSON array (possibly empty), schema:
[{"title":"","institution":"","country_code":"ISO2","city":"","url":"official page","deadline":"YYYY-MM-DD or empty","funding":"","funding_type":"fully|partial|self","level":"bachelors|masters|phd|postdoc","stipend":"","tuition":"","application_fee":"","duration":"","contact_emails":["seen on the page only"],"apply_via":"email|portal","criteria":{"req_degree_level":"","req_field":"","req_min_cgpa":"","req_cgpa_scale":"","req_language":"","req_language_min":"","req_nationality":"","req_experience_years":"","req_license":"","req_documents":[]}}]
CRITICAL: facts literally present on the page only; leave everything else empty.`;
  try {
    const txt = await callAI('search_verify', prompt, { urls: true, search: false, maxTokens: 3200, userId: null });
    const added = await ingestOpps(parseJSON(txt) || [], null, null);
    if (added) console.log('[harvest] verifyLeads added ' + added + ' verified opportunities from ' + batch.length + ' leads');
    return added;
  } catch (e) { await errlog('harvest:verify', e, {}); return 0; }
}

/* ---- Tool 4: rotating sweep of admin priority institutions' official pages ---- */
async function uniSweep() {
  try {
    const { data: unis } = await admin().from('universities').select('name,country_code').eq('enabled', true).order('priority');
    if (!unis || !unis.length) return 0;
    let cursor = 0;
    try { const { data } = await admin().from('app_settings').select('value').eq('key', 'unisweep_cursor').single(); cursor = Number(data && data.value && data.value.i) || 0; } catch (e) {}
    const batch = []; for (let i = 0; i < Math.min(6, unis.length); i++) batch.push(unis[(cursor + i) % unis.length]);
    await admin().from('app_settings').upsert({ key: 'unisweep_cursor', value: { i: (cursor + batch.length) % unis.length } });
    const { seedDiscovery } = require('./engine');
    let added = 0;
    for (const u of batch) {
      try { added += await seedDiscovery(null, 'currently open funded positions, admissions or scholarships at ' + u.name + ' (' + u.country_code + '), from its OFFICIAL website only', null); }
      catch (e) { await errlog('harvest:unisweep', e, { detail: u.name }); }
      await new Promise(r => setTimeout(r, 8000));
    }
    if (added) console.log('[harvest] uniSweep added ' + added + ' from ' + batch.length + ' institutions');
    return added;
  } catch (e) { await errlog('harvest:unisweep', e, {}); return 0; }
}

module.exports = { rssWatch, braveLeads, verifyLeads, uniSweep, pushLeads, getQueue };
