// lib/reranker.js — "the best options for you": after the scorer, the model reads the top candidates against the person's
// profile and picks the strongest set with one plain reason each. Cached per person per day; ties broken by quality.
const { admin } = require('./supa'); const { callAI } = require('./router'); const DQ = require('./discovery_quality');
async function best(userId, cards, n) {
  const key = 'best:' + userId + ':' + new Date().toISOString().slice(0, 10); try { const { data: c } = await admin().from('app_settings').select('value').eq('key', key).maybeSingle(); if (c && c.value && c.value.ids && c.value.ids.length) { const byId = Object.fromEntries(cards.map(x => [x.id, x])); const out = c.value.ids.map(i => byId[i.id] ? Object.assign({}, byId[i.id], { why_best: i.why }) : null).filter(Boolean); if (out.length) return out; } } catch (e) {}
  const top = cards.slice(0, 30); if (top.length <= (n || 10)) return top;
  const { data: p } = await admin().from('profiles').select('field,profession,degree,total_experience_years,origin_country,mobility').eq('id', userId).maybeSingle();
  let picks = []; try { const txt = await callAI('high_value', `Pick the ${n || 10} best opportunities for this person from the candidates and give one honest reason each (fit, funding, deadline, verification, access). Answer ONLY JSON: [{"id":"","why":"one line"}] in order of preference.\nPERSON: ${JSON.stringify({ field: p && p.field, profession: p && p.profession, degree: p && p.degree, years: p && p.total_experience_years, origin: p && p.origin_country, targets: p && p.mobility && p.mobility.target_countries })}\nCANDIDATES: ${JSON.stringify(top.map(c => ({ id: c.id, title: c.title, institution: c.institution, country: c.country_code, kind: c.kind, level: c.level, deadline: c.deadline, funding: c.funding_type, match: c.match_pct || c.match, quality: (c.quality || DQ.score(c)).quality, sponsorship: c.visa_sponsorship, access: c.access_score })))}`, { maxTokens: 900, json: true, userId }); const m = String(txt).match(/\[[\s\S]*\]/); if (m) picks = JSON.parse(m[0]); } catch (e) {}
  if (!picks.length) return top.slice(0, n || 10);
  const byId = Object.fromEntries(top.map(x => [x.id, x])); const out = picks.map(i => byId[i.id] ? Object.assign({}, byId[i.id], { why_best: String(i.why || '').slice(0, 160) }) : null).filter(Boolean).slice(0, n || 10);
  try { await admin().from('app_settings').upsert({ key, value: { ids: picks.slice(0, n || 10), at: new Date().toISOString() } }); } catch (e) {} return out;
}
module.exports = { best };
