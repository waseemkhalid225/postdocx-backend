// lib/quota.js — agency quota: plan limits at organisation level, allocated down to branches, sub-branches and members.
// The lower limit always wins. Counters live in usage_meter (org_id + scope_key) so a manager can see who used what.
const { admin } = require('./supa');
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };
const dayStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString(); };
async function activeSub(orgId) { const { data } = await admin().from('org_subscriptions').select('*').eq('org_id', orgId).eq('status', 'active').gt('period_end', new Date().toISOString()).order('period_end', { ascending: false }).limit(1); return data && data[0] || null; }
async function allocations(orgId) { const { data } = await admin().from('quota_allocations').select('*').eq('org_id', orgId); return data || []; }
async function used(orgId, capability, scopeKey, since) { let q = admin().from('usage_meter').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('capability', capability).gte('created_at', since); if (scopeKey) q = q.eq('scope_key', scopeKey); const { count } = await q; return count || 0; }
/* Limits that apply to a member: organisation plan, then their branch chain, then their own allocation. */
async function limitsFor(orgId, member) {
  const sub = await activeSub(orgId); if (!sub) return { ok: false, reason: 'No active agency plan. Choose a plan under Billing first.', code: 'NO_PLAN' };
  const allocs = await allocations(orgId); const chain = [];
  const branch = member && member.branch; if (branch) { const parts = branch.split('/'); for (let i = 1; i <= parts.length; i++) chain.push(parts.slice(0, i).join('/')); }
  const lim = { cases_month: sub.cases_month, searches_day: sub.searches_day || 100, searches_month: sub.searches_month || sub.cases_month * 20, scope: 'organisation' };
  for (const b of chain) { const a = allocs.find(x => x.scope_kind === 'branch' && x.scope_key === b); if (a) { if (a.cases_month) lim.cases_month = Math.min(lim.cases_month, a.cases_month); if (a.searches_day) lim.searches_day = Math.min(lim.searches_day, a.searches_day); lim.scope = 'branch ' + b; } }
  const m = allocs.find(x => x.scope_kind === 'member' && x.scope_key === member.user_id); if (m) { if (m.cases_month) lim.cases_month = Math.min(lim.cases_month, m.cases_month); if (m.searches_day) lim.searches_day = Math.min(lim.searches_day, m.searches_day); lim.scope = 'you'; }
  return { ok: true, sub, lim, chain };
}
async function check(orgId, member, capability, n) {
  const L = await limitsFor(orgId, member); if (!L.ok) return L; n = n || 1;
  if (capability === 'org_case') { const orgUsed = L.sub.cases_used || 0; if (orgUsed + n > L.sub.cases_month) return { ok: false, reason: 'Only ' + Math.max(0, L.sub.cases_month - orgUsed) + ' case(s) left this month on your ' + L.sub.tier_name + ' plan.', code: 'LIMIT' };
    for (const b of L.chain) { const a = (await allocations(orgId)).find(x => x.scope_kind === 'branch' && x.scope_key === b); if (a && a.cases_month) { const u = await used(orgId, 'org_case', 'branch:' + b, monthStart()); if (u + n > a.cases_month) return { ok: false, reason: 'Branch ' + b + ' has used its ' + a.cases_month + ' cases this month.', code: 'LIMIT' }; } }
    const mu = await used(orgId, 'org_case', 'member:' + member.user_id, monthStart()); const ma = (await allocations(orgId)).find(x => x.scope_kind === 'member' && x.scope_key === member.user_id); if (ma && ma.cases_month && mu + n > ma.cases_month) return { ok: false, reason: 'You have used your ' + ma.cases_month + ' allocated cases this month.', code: 'LIMIT' };
    return { ok: true, lim: L.lim }; }
  if (capability === 'org_search') { const dayOrg = await used(orgId, 'org_search', null, dayStart()); if (dayOrg + n > L.lim.searches_day && L.lim.scope === 'organisation') return { ok: false, reason: 'Your organisation has used its ' + L.lim.searches_day + ' searches today.', code: 'LIMIT' };
    const monOrg = await used(orgId, 'org_search', null, monthStart()); if (monOrg + n > L.lim.searches_month) return { ok: false, reason: 'Your organisation has used its ' + L.lim.searches_month + ' searches this month.', code: 'LIMIT' };
    for (const b of L.chain) { const a = (await allocations(orgId)).find(x => x.scope_kind === 'branch' && x.scope_key === b); if (a && a.searches_day) { const u = await used(orgId, 'org_search', 'branch:' + b, dayStart()); if (u + n > a.searches_day) return { ok: false, reason: 'Branch ' + b + ' has used its ' + a.searches_day + ' searches today.', code: 'LIMIT' }; } }
    const ma = (await allocations(orgId)).find(x => x.scope_kind === 'member' && x.scope_key === member.user_id); if (ma && ma.searches_day) { const u = await used(orgId, 'org_search', 'member:' + member.user_id, dayStart()); if (u + n > ma.searches_day) return { ok: false, reason: 'You have used your ' + ma.searches_day + ' searches today.', code: 'LIMIT' }; }
    return { ok: true, lim: L.lim }; }
  return { ok: true };
}
async function consume(orgId, member, capability, n) { const rows = []; const branch = member && member.branch; const chain = []; if (branch) { const parts = branch.split('/'); for (let i = 1; i <= parts.length; i++) chain.push(parts.slice(0, i).join('/')); }
  for (let i = 0; i < (n || 1); i++) { rows.push({ user_id: member.user_id, org_id: orgId, capability, units: 1, scope_key: 'member:' + member.user_id }); for (const b of chain) rows.push({ user_id: member.user_id, org_id: orgId, capability, units: 1, scope_key: 'branch:' + b }); }
  // one row per (member) counts the organisation total; branch rows are for allocation checks only
  await admin().from('usage_meter').insert(rows.filter(r => r.scope_key.startsWith('member:'))); if (chain.length) await admin().from('usage_meter').insert(rows.filter(r => r.scope_key.startsWith('branch:')).map(r => Object.assign(r, { capability: r.capability }))); }
async function usage(orgId) { const [m, d, allocs, members] = await Promise.all([admin().from('usage_meter').select('scope_key,capability').eq('org_id', orgId).gte('created_at', monthStart()), admin().from('usage_meter').select('scope_key,capability').eq('org_id', orgId).gte('created_at', dayStart()), allocations(orgId), admin().from('org_members').select('user_id,role,branch').eq('org_id', orgId)]);
  const agg = (rows, cap) => { const o = {}; for (const r of (rows.data || [])) if (r.capability === cap && r.scope_key) o[r.scope_key] = (o[r.scope_key] || 0) + 1; return o; };
  return { month: { cases: agg(m, 'org_case'), searches: agg(m, 'org_search') }, today: { searches: agg(d, 'org_search') }, allocations: allocs, members: members.data || [] }; }
module.exports = { activeSub, allocations, limitsFor, check, consume, usage };
