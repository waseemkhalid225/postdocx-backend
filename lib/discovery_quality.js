// lib/discovery_quality.js — a quality score for every opportunity card, computed from evidence not vibes:
// source type (structured feed > official page fetch > AI-grounded text), employer/institution verification,
// freshness of the last check, completeness (deadline, contact, requirements, pay), and closed-detection.
// Shown to the applicant as a confidence chip with reasons; used by the ranker as a tie-breaker only.
function score(o) {
  const reasons = []; let s = 0;
  const src = String((o.extra && o.extra.source_key) || o.source || ''); if (/^(greenhouse|lever|workable|adzuna|reed|usajobs|jooble|arbeitnow|rss|json):/.test(src)) { s += 30; reasons.push('from the employer\'s own feed or a job API'); } else if (o.verified_at || o.status === 'verified') { s += 20; reasons.push('verified on the official page'); } else { s += 5; reasons.push('found by search, not yet verified'); }
  if (o.employer_verified === true || o.sponsor_verified === true) { s += 20; reasons.push(o.sponsor_verified ? 'employer on the official sponsor register' : 'employer domain and registry verified'); } else if (o.is_partner) { s += 10; reasons.push('partner institution'); }
  const days = o.verified_at || o.updated_at ? (Date.now() - new Date(o.verified_at || o.updated_at).getTime()) / 86400000 : 999; if (days <= 7) { s += 20; reasons.push('checked in the last week'); } else if (days <= 30) { s += 12; reasons.push('checked in the last month'); } else { reasons.push('not checked for over a month'); }
  let comp = 0; if (o.deadline) comp++; if ((o.contact_emails || []).length || o.apply_via === 'portal') comp++; if (o.requirements && Object.keys(o.requirements).length) comp++; if (o.salary_note || o.stipend || o.funding_type) comp++; s += comp * 5; if (comp >= 3) reasons.push('complete details'); else reasons.push('some details missing');
  if (o.eligibility_flag === 'citizens_only') { s = Math.min(s, 20); reasons.unshift('citizens of the destination only'); } else if (o.eligibility_flag === 'clearance') { s = Math.min(s, 25); reasons.unshift('security clearance required'); } else if (o.eligibility_flag === 'local_only') { s = Math.min(s, 40); reasons.unshift('no sponsorship or local candidates only, per the posting'); }
  if (o.closed || o.status === 'closed' || o.status === 'expired') { s = Math.min(s, 10); reasons.unshift('closed or expired'); }
  if (o.deadline && new Date(o.deadline) < new Date()) { s = Math.min(s, 15); reasons.unshift('deadline passed'); }
  s = Math.max(0, Math.min(100, s)); return { quality: s, label: s >= 75 ? 'high' : s >= 50 ? 'medium' : 'low', reasons: reasons.slice(0, 4) };
}
module.exports = { score };
