// lib/learning.js — Day 6 · the outcome learning loop.
// Verified outcomes (applied → interview → offer → visa) are aggregated by destination, lane and
// applicant field, and fed back into ranking as a BOUNDED nudge (never more than ±4 points) with
// a plain sentence saying why. Deterministic eligibility is never touched by learning.
const { admin } = require('./supa');
const KEY = 'learning:outcomes';
const MAX_NUDGE = 4;
function bucketField(s) { const f = String(s || '').toLowerCase(); if (/pharm/.test(f)) return 'pharmacy'; if (/medic|mbbs|clinic|surg/.test(f)) return 'medicine'; if (/nurs/.test(f)) return 'nursing'; if (/comput|software|data|it\b|ai\b/.test(f)) return 'computing'; if (/engineer/.test(f)) return 'engineering'; if (/business|mba|manage|finance|account/.test(f)) return 'business'; if (/bio|chem|physic|math|science/.test(f)) return 'science'; if (/law|legal/.test(f)) return 'law'; if (/educat|teach/.test(f)) return 'education'; return f ? 'other' : 'unknown'; }
async function rebuild() {
  const { data: apps } = await admin().from('applications').select('id,user_id,opportunity_id,status,created_at').limit(20000);
  if (!apps || !apps.length) return { groups: 0 };
  const oppIds = [...new Set(apps.map(a => a.opportunity_id).filter(Boolean))], userIds = [...new Set(apps.map(a => a.user_id))];
  const oppOf = {}, fieldOf = {};
  for (let i = 0; i < oppIds.length; i += 500) { const { data } = await admin().from('opportunities').select('id,country_code,kind,level').in('id', oppIds.slice(i, i + 500)); for (const o of (data || [])) oppOf[o.id] = o; }
  for (let i = 0; i < userIds.length; i += 500) { const { data } = await admin().from('profiles').select('id,field,profession').in('id', userIds.slice(i, i + 500)); for (const p of (data || [])) fieldOf[p.id] = bucketField(p.field || p.profession); }
  const { data: offers } = await admin().from('offers').select('user_id,opportunity_id,application_id,status');
  const offerApps = new Set((offers || []).map(o => o.application_id).filter(Boolean));
  const g = {};
  for (const a of apps) {
    const o = oppOf[a.opportunity_id]; if (!o || !o.country_code) continue;
    const k = [o.country_code, o.kind || 'study', fieldOf[a.user_id] || 'unknown'].join('|');
    const r = g[k] = g[k] || { country_code: o.country_code, kind: o.kind || 'study', field: fieldOf[a.user_id] || 'unknown', applied: 0, interview: 0, offer: 0 };
    r.applied++;
    const st = String(a.status || '').toLowerCase();
    if (/interview/.test(st)) r.interview++;
    if (/offer|accept|admit|hired|granted/.test(st) || offerApps.has(a.id)) r.offer++;
  }
  const groups = Object.values(g).map(r => ({ ...r, offer_rate: r.applied ? Math.round(100 * r.offer / r.applied) : null, interview_rate: r.applied ? Math.round(100 * r.interview / r.applied) : null }));
  const allApplied = groups.reduce((s, x) => s + x.applied, 0), allOffers = groups.reduce((s, x) => s + x.offer, 0);
  const value = { at: new Date().toISOString(), baseline_offer_rate: allApplied ? Math.round(100 * allOffers / allApplied) : null, groups };
  await admin().from('app_settings').upsert({ key: KEY, value }, { onConflict: 'key' });
  _cache = { at: Date.now(), value };
  return { groups: groups.length, baseline: value.baseline_offer_rate };
}
let _cache = { at: 0, value: null };
async function current() {
  if (_cache.value && Date.now() - _cache.at < 10 * 60000) return _cache.value;
  try { const { data } = await admin().from('app_settings').select('value').eq('key', KEY).maybeSingle(); _cache = { at: Date.now(), value: (data && data.value) || null }; } catch (e) {}
  return _cache.value;
}
/* The nudge: needs at least 8 applications in the group to say anything; bounded; explained. */
function nudge(learn, opp, fieldBucket) {
  if (!learn || !learn.groups || !opp) return { delta: 0, note: null };
  const g = learn.groups.find(x => x.country_code === opp.country_code && x.kind === (opp.kind || 'study') && x.field === fieldBucket);
  if (!g || g.applied < 8 || g.offer_rate == null || learn.baseline_offer_rate == null) return { delta: 0, note: null };
  const diff = g.offer_rate - learn.baseline_offer_rate;
  const delta = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, Math.round(diff / 5)));
  if (!delta) return { delta: 0, note: null };
  return { delta, note: (delta > 0 ? 'Applicants like you have done better than average here: ' : 'Applicants like you have found this destination harder: ') + g.offer_rate + '% reached an offer (' + g.applied + ' tracked applications).' };
}
module.exports = { rebuild, current, nudge, bucketField, MAX_NUDGE };
