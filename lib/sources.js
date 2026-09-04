// lib/sources.js — Gap 9 · structured source adapters. Feeds first, AI only for extraction/verification later.
const { admin } = require('./supa');
async function fetchJson(url) { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000); try { const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } }); clearTimeout(tm); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { clearTimeout(tm); throw e; } }
async function fetchText(url) { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000); try { const r = await fetch(url, { signal: ctl.signal }); clearTimeout(tm); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); } catch (e) { clearTimeout(tm); throw e; } }
const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const ADAPTERS = {
  greenhouse: async s => { const d = await fetchJson('https://boards-api.greenhouse.io/v1/boards/' + encodeURIComponent(s.key) + '/jobs?content=true'); return (d.jobs || []).map(j => ({ title: j.title, institution: s.org_name || s.key, url: j.absolute_url, city: (j.location && j.location.name) || '', description: strip(j.content).slice(0, 6000), posted_at: j.updated_at || j.first_published, country_code: s.country_code })); },
  lever: async s => { const d = await fetchJson('https://api.lever.co/v0/postings/' + encodeURIComponent(s.key) + '?mode=json'); return (d || []).map(j => ({ title: j.text, institution: s.org_name || s.key, url: j.hostedUrl, city: (j.categories && j.categories.location) || '', description: strip(j.descriptionPlain || j.description).slice(0, 6000), posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null, country_code: s.country_code })); },
  workable: async s => { const d = await fetchJson('https://apply.workable.com/api/v1/widget/accounts/' + encodeURIComponent(s.key)); return (d.jobs || []).map(j => ({ title: j.title, institution: s.org_name || d.name || s.key, url: j.url, city: [j.city, j.country].filter(Boolean).join(', '), description: strip(j.description).slice(0, 6000), posted_at: j.published_on, country_code: s.country_code })); },
  rss: async s => { const x = await fetchText(s.key); const items = [...x.matchAll(/<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/g)].map(m => m[1] || m[2]); return items.map(it => { const g = t => { const m = it.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return m ? strip(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : ''; }; const link = g('link') || (it.match(/<link[^>]*href="([^"]+)"/) || [])[1] || ''; return { title: g('title'), institution: s.org_name || '', url: link, description: (g('description') || g('summary') || g('content')).slice(0, 6000), posted_at: g('pubDate') || g('updated') || g('published') || null, country_code: s.country_code }; }); },
  json: async s => { const d = await fetchJson(s.key); const arr = Array.isArray(d) ? d : (d.jobs || d.items || d.results || []); return arr.map(j => ({ title: j.title || j.name, institution: s.org_name || j.company || j.institution || '', url: j.url || j.link || j.apply_url, city: j.location || j.city || '', description: strip(j.description || j.content || '').slice(0, 6000), posted_at: j.posted_at || j.date || j.updated_at || null, country_code: s.country_code || j.country_code })); }
};
/* Run one source: fetch, normalise, dedupe by url, hand to the existing verified ingest (AI extraction/verification). */
async function run(sourceId) {
  const { data: s } = await admin().from('sources').select('*').eq('id', sourceId).maybeSingle(); if (!s || !s.enabled) return { skipped: true };
  try {
    const items = (await ADAPTERS[s.kind](s)).filter(i => i.title && i.url);
    const urls = items.map(i => i.url); const { data: have } = urls.length ? await admin().from('opportunities').select('url').in('url', urls.slice(0, 500)) : { data: [] }; const seen = new Set((have || []).map(h => h.url));
    const fresh = items.filter(i => !seen.has(i.url)).slice(0, 60);
    let added = 0;
    if (fresh.length) { const { ingestOpps } = require('./engine'); added = await ingestOpps(fresh.map(i => Object.assign({ kind: s.lane === 'work' ? 'work' : 'study', funding: '', deadline: '', country_code: i.country_code || '', contact_emails: [], apply_via: 'portal', remote: 'false', extra: { source_key: s.kind + ':' + s.key } }, i)), s.lane === 'work' ? 'work' : 'postdoc', null).catch(() => 0); }
    // Freshness for rows we already hold: refresh posted_at from the feed.
    for (const i of items.filter(x => seen.has(x.url) && x.posted_at).slice(0, 200)) await admin().from('opportunities').update({ posted_at: i.posted_at, source_key: s.kind + ':' + s.key, last_verified_at: new Date().toISOString() }).eq('url', i.url).then(() => {}, () => {});
    // Closed detection: anything from this source no longer in the feed is expired.
    if (items.length >= 3) { const { data: mine } = await admin().from('opportunities').select('id,url').eq('source_key', s.kind + ':' + s.key).eq('status', 'verified'); for (const o of (mine || [])) if (!urls.includes(o.url)) await admin().from('opportunities').update({ status: 'expired' }).eq('id', o.id); }
    await admin().from('sources').update({ last_run_at: new Date().toISOString(), last_count: items.length, last_error: null }).eq('id', s.id);
    return { items: items.length, added };
  } catch (e) { await admin().from('sources').update({ last_run_at: new Date().toISOString(), last_error: String(e.message).slice(0, 200) }).eq('id', s.id); throw e; }
}
async function sweep() { const { data } = await admin().from('sources').select('id').eq('enabled', true); const Q = require('./queue'); for (const s of (data || [])) await Q.enqueue('source_run', { sourceId: s.id }, { maxAttempts: 1 }); return { queued: (data || []).length }; }
module.exports = { ADAPTERS, run, sweep };
