// lib/rulewatch.js — Gap 6 · change detection on every rule source page. A verified rule whose source changed is
// flagged "re-verify" and the admin queue shows it; nothing silently stays "verified" against a page that moved.
const crypto = require('crypto'); const { admin } = require('./supa');
async function sweep(limit) {
  const { data: rules } = await admin().from('visa_rules').select('id,source_url,status').neq('status', 'superseded').not('source_url', 'is', null);
  const urls = [...new Set((rules || []).map(r => r.source_url))].slice(0, limit || 150); let changed = 0, checked = 0;
  for (const url of urls) {
    try { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000); const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 ForiForeign rule-watch' } }); clearTimeout(tm); const html = await r.text();
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); const h = crypto.createHash('sha256').update(text).digest('hex'); checked++;
      const { data: prev } = await admin().from('rule_sources').select('last_hash').eq('source_url', url).maybeSingle();
      if (prev && prev.last_hash && prev.last_hash !== h) { changed++; await admin().from('visa_rules').update({ source_changed: true }).eq('source_url', url).eq('status', 'verified'); await admin().from('rule_sources').update({ last_hash: h, last_checked_at: new Date().toISOString(), last_changed_at: new Date().toISOString(), status: 'changed' }).eq('source_url', url); }
      else await admin().from('rule_sources').upsert({ source_url: url, last_hash: h, last_checked_at: new Date().toISOString(), status: r.ok ? 'ok' : 'http_' + r.status });
    } catch (e) { await admin().from('rule_sources').upsert({ source_url: url, last_checked_at: new Date().toISOString(), status: 'unreachable' }).then(() => {}, () => {}); }
  }
  if (changed) { try { const { data: admins } = await admin().from('profiles').select('id').in('role', ['admin', 'super_admin']); for (const a of (admins || [])) await require('./notify').push(a.id, 'rules', changed + ' rule source page(s) changed', 'Verified rules on those pages are flagged re-verify in Admin → Visa rules.', 'adminx'); } catch (e) {} }
  return { checked, changed };
}
module.exports = { sweep };
