// lib/sponsors.js — Day 17 · employer sponsorship verification from public registers.
// The UK publishes its Register of Licensed Sponsors (Workers) as a CSV; an admin imports it and
// every UK work opportunity is checked by employer name. Other countries are added the same way.
const { admin } = require('./supa');
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(ltd|limited|plc|llp|inc|the|uk|nhs foundation trust|foundation trust|trust|group|holdings)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function parseCsv(text) {
  const rows = []; let cur = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; } else if (ch === '"') q = true; else if (ch === ',') { cur.push(field); field = ''; } else if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; } else if (ch !== '\r') field += ch; }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}
async function importCsv(countryCode, text, sourceUrl) {
  const rows = parseCsv(text); if (rows.length < 2) throw new Error('CSV has no rows');
  const head = rows[0].map(h => h.toLowerCase());
  const iName = head.findIndex(h => /organisation name|organization name|employer|name/.test(h)), iTown = head.findIndex(h => /town|city/.test(h)), iRoute = head.findIndex(h => /route|type/.test(h)), iRating = head.findIndex(h => /rating/.test(h));
  if (iName < 0) throw new Error('No organisation name column found');
  await admin().from('sponsor_register').delete().eq('country_code', countryCode);
  const batch = []; let n = 0; const seen = new Set();
  for (const r of rows.slice(1)) { const name = (r[iName] || '').trim(); if (!name) continue; const key = norm(name) + '|' + (r[iRoute] || ''); if (seen.has(key)) continue; seen.add(key);
    batch.push({ country_code: countryCode, org_name: name.slice(0, 200), org_norm: norm(name), town: (r[iTown] || '').slice(0, 100) || null, route: (r[iRoute] || '').slice(0, 100) || null, rating: iRating >= 0 ? (r[iRating] || '').slice(0, 40) || null : null, source_url: sourceUrl || null });
    if (batch.length >= 1000) { const { error } = await admin().from('sponsor_register').insert(batch.splice(0)); if (error) throw new Error(error.message); n += 1000; } }
  if (batch.length) { const { error } = await admin().from('sponsor_register').insert(batch); if (error) throw new Error(error.message); n += batch.length; }
  return { imported: n };
}
async function checkOpportunities(countryCode) {
  const { data: opps } = await admin().from('opportunities').select('id,institution').eq('country_code', countryCode).eq('kind', 'work').eq('status', 'verified').limit(2000);
  let yes = 0, no = 0;
  for (const o of (opps || [])) { const nm = norm(o.institution); if (!nm) continue; const first = nm.split(' ').slice(0, 2).join(' ');
    const { data } = await admin().from('sponsor_register').select('id,org_norm').eq('country_code', countryCode).ilike('org_norm', first + '%').limit(50);
    const hit = (data || []).some(s => s.org_norm === nm || s.org_norm.startsWith(nm) || nm.startsWith(s.org_norm));
    await admin().from('opportunities').update({ sponsor_verified: hit, sponsor_checked_at: new Date().toISOString() }).eq('id', o.id); hit ? yes++ : no++; }
  return { checked: (opps || []).length, verified: yes, not_found: no };
}
/* Single-employer lookup for the offer verifier: found / not found / register not loaded (null). */
async function check(name, countryCode) { const cc = countryCode || 'GB'; const { count } = await admin().from('sponsor_register').select('id', { count: 'exact', head: true }).eq('country_code', cc); if (!count) return null; const nm = norm(name); if (!nm) return null; const first = nm.split(' ').slice(0, 2).join(' '); const { data } = await admin().from('sponsor_register').select('org_norm').eq('country_code', cc).ilike('org_norm', first + '%').limit(50); return { found: (data || []).some(x => x.org_norm === nm || x.org_norm.startsWith(nm) || nm.startsWith(x.org_norm)) }; }
async function status() { const { data } = await admin().from('sponsor_register').select('country_code'); const by = {}; for (const r of (data || [])) by[r.country_code] = (by[r.country_code] || 0) + 1; return by; }
module.exports = { importCsv, checkOpportunities, check, status, norm, parseCsv };
