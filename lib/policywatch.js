// lib/policywatch.js — Policy Watch agent. When a rule's source page changes, the agent reads the old and new text,
// writes a plain summary of what changed and who it affects, files a policy update, flags the rules, and notifies
// admins and every applicant whose target countries or visa files touch that destination. Nothing is rewritten in
// the registry by the machine: humans verify, the agent watches and explains.
const crypto = require('crypto'); const { admin } = require('./supa'); const { callAI } = require('./router');
const clean = html => String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
async function sweep(limit) {
  const { data: rules } = await admin().from('visa_rules').select('id,country_code,source_url,source_title,lane,rule_type').neq('status', 'superseded').not('source_url', 'is', null);
  const byUrl = {}; for (const r of (rules || [])) (byUrl[r.source_url] = byUrl[r.source_url] || []).push(r);
  const urls = Object.keys(byUrl).slice(0, limit || 150); let checked = 0, changed = 0;
  for (const url of urls) {
    try { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000); const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 ForiForeign policy-watch' } }); clearTimeout(tm); if (!r.ok) { await admin().from('rule_sources').upsert({ source_url: url, last_checked_at: new Date().toISOString(), status: 'http_' + r.status }); continue; }
      const text = clean(await r.text()).slice(0, 60000); const h = crypto.createHash('sha256').update(text).digest('hex'); checked++;
      const { data: prev } = await admin().from('rule_sources').select('last_hash,last_text').eq('source_url', url).maybeSingle();
      if (prev && prev.last_hash && prev.last_hash !== h) {
        changed++; const rs = byUrl[url]; const cc = rs[0].country_code; const lanes = [...new Set(rs.map(x => x.lane))];
        let v = { summary: 'The source page changed.', impact: 'Verify the rules linked to this page.', severity: 'review' };
        try { const txt = await callAI('high_value', `You compare two versions of an official immigration/education page and report the change for a study-and-work-abroad platform. Answer ONLY JSON: {"summary":"2-3 plain sentences: what changed (fees, thresholds, dates, eligibility, documents, process)","impact":"who is affected and what they must do differently; say 'no material change' if only layout/wording changed","severity":"info|review|urgent"}\nCOUNTRY: ${cc}\nPAGE: ${rs[0].source_title || url}\nOLD (excerpt): ${String(prev.last_text || '').slice(0, 6000)}\nNEW (excerpt): ${text.slice(0, 6000)}`, { maxTokens: 500, json: true }); const m = String(txt).match(/\{[\s\S]*\}/); if (m) v = Object.assign(v, JSON.parse(m[0])); } catch (e) {}
        const { data: pu } = await admin().from('policy_updates').insert({ country_code: cc, source_url: url, source_title: rs[0].source_title || null, summary: String(v.summary).slice(0, 1500), impact: String(v.impact || '').slice(0, 1500), affected_lanes: lanes, severity: ['info', 'review', 'urgent'].includes(v.severity) ? v.severity : 'review' }).select('id').single();
        await admin().from('visa_rules').update({ source_changed: true }).eq('source_url', url).neq('status', 'superseded');
        try { await admin().from('app_settings').delete().like('key', 'reqbrief:' + cc + ':%'); } catch (e) {}   // requirement checklists for this destination are rebuilt on next open
        await admin().from('rule_sources').upsert({ source_url: url, last_hash: h, last_text: text.slice(0, 20000), last_checked_at: new Date().toISOString(), last_changed_at: new Date().toISOString(), status: 'changed' });
        const N = require('./notify');
        try { const { data: admins } = await admin().from('profiles').select('id').in('role', ['admin', 'super_admin']); for (const a of (admins || [])) await N.push(a.id, 'policy', 'Policy change: ' + cc + ' (' + (v.severity || 'review') + ')', v.summary, 'adminx'); } catch (e) {}
        if (v.severity !== 'info' && !/no material change/i.test(String(v.impact))) { try { const { data: vc } = await admin().from('visa_cases').select('user_id').eq('country_code', cc).in('status', ['draft', 'preparing', 'ready', 'submitted', 'decision_pending']); const { data: tg } = await admin().from('profiles').select('id,mobility').contains('mobility', { target_countries: [cc] }).limit(500); const ids = new Set([...(vc || []).map(x => x.user_id), ...(tg || []).map(x => x.id)]); for (const uid of ids) await N.push(uid, 'policy', 'Policy update for ' + cc, v.summary + (v.impact ? ' ' + v.impact : ''), 'profile'); } catch (e) {} }
      } else await admin().from('rule_sources').upsert({ source_url: url, last_hash: h, last_text: prev && prev.last_text && prev.last_hash === h ? prev.last_text : text.slice(0, 20000), last_checked_at: new Date().toISOString(), status: 'ok' });
    } catch (e) { await admin().from('rule_sources').upsert({ source_url: url, last_checked_at: new Date().toISOString(), status: 'unreachable' }).then(() => {}, () => {}); }
  }
  return { checked, changed };
}
async function updates(cc, limit) { let q = admin().from('policy_updates').select('*').order('detected_at', { ascending: false }).limit(limit || 50); if (cc) q = q.eq('country_code', cc); const { data } = await q; return data || []; }
module.exports = { sweep, updates };
