// lib/partners.js — Day 7 · Institution / employer partner portal and service partners.
// A partner opening becomes a normal opportunity row (verified at publish, source PARTNER) so
// every applicant sees it through the same eligibility gate and scorer; it is labelled
// "Partner" and receives no ranking advantage. Applicants' files reach the partner only with
// the applicant's explicit consent. Service partners fill the journey's partner slots.
const { admin } = require('./supa');

function cleanOpening(b) {
  const o = {};
  for (const k of ['title', 'level', 'field', 'city', 'description', 'requirements', 'funding_or_salary', 'url', 'contact_email']) if (b[k] !== undefined) o[k] = String(b[k] || '').slice(0, k === 'description' || k === 'requirements' ? 6000 : 300) || null;
  if (b.kind !== undefined) o.kind = ['study', 'postdoc', 'phd', 'masters', 'work'].includes(b.kind) ? b.kind : 'study';
  if (b.country_code !== undefined) o.country_code = String(b.country_code || '').toUpperCase().slice(0, 2);
  if (b.deadline !== undefined) o.deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? b.deadline : null;
  return o;
}
async function orgKind(orgId) { const { data } = await admin().from('organisations').select('id,name,kind,country_code').eq('id', orgId).maybeSingle(); return data; }
async function create(orgId, userId, body) {
  const org = await orgKind(orgId); if (!org || !['institution', 'employer'].includes(org.kind)) throw new Error('Only institution or employer workspaces can post openings.');
  const row = Object.assign({ org_id: orgId, created_by: userId, status: 'draft' }, cleanOpening(body || {}));
  if (!row.title || !row.country_code) throw new Error('Title and country are required');
  const { data, error } = await admin().from('partner_openings').insert(row).select('*').single(); if (error) throw new Error(error.message); return data;
}
async function list(orgId) { const { data } = await admin().from('partner_openings').select('*').eq('org_id', orgId).order('created_at', { ascending: false }); return data || []; }
async function update(orgId, id, body) {
  const patch = cleanOpening(body || {}); patch.updated_at = new Date().toISOString();
  const { data, error } = await admin().from('partner_openings').update(patch).eq('id', id).eq('org_id', orgId).select('*').single(); if (error) throw new Error(error.message);
  if (data.opportunity_id) await mirror(data, await orgKind(orgId));
  return data;
}
/* Publish: mirror into opportunities as a verified partner row (or refresh it). Close: retire it. */
async function mirror(op, org) {
  const kindMap = { study: 'study', masters: 'study', phd: 'phd', postdoc: 'postdoc', work: 'work' };
  const levelMap = { masters: 'masters', phd: 'phd', postdoc: 'postdoc' };
  const row = { kind: kindMap[op.kind] || 'study', level: op.level || levelMap[op.kind] || null, title: op.title, institution: org.name, country_code: op.country_code, city: op.city || '', description: op.description || '', requirements: op.requirements || '',
    funding: op.funding_or_salary || '', salary_note: op.kind === 'work' ? (op.funding_or_salary || '').slice(0, 120) : null, deadline: op.deadline, url: op.url || ('https://foriforeign.com/partner/' + op.id), contact_emails: op.contact_email ? [op.contact_email] : [], apply_via: op.contact_email ? 'both' : 'portal',
    status: 'verified', verified_at: new Date().toISOString(), source: 'partner', source_kind: 'PARTNER', confidence: 1, last_verified_at: new Date().toISOString(), is_partner: true, partner_org_id: op.org_id, req_field: op.field || null, verification_confidence: 'high', provenance: { method: 'partner_posted', by: 'partner_portal', org: op.org_id, at: new Date().toISOString() } };
  if (op.opportunity_id) { let { error } = await admin().from('opportunities').update(row).eq('id', op.opportunity_id); if (error) { for (const k of ['is_partner', 'partner_org_id', 'source_kind', 'confidence', 'last_verified_at', 'provenance']) delete row[k]; await admin().from('opportunities').update(row).eq('id', op.opportunity_id); } return op.opportunity_id; }
  let { data, error } = await admin().from('opportunities').insert(row).select('id').single();
  if (error) { for (const k of ['is_partner', 'partner_org_id', 'source_kind', 'confidence', 'last_verified_at', 'provenance']) delete row[k]; ({ data, error } = await admin().from('opportunities').insert(row).select('id').single()); }
  if (error) throw new Error(error.message);
  await admin().from('partner_openings').update({ opportunity_id: data.id }).eq('id', op.id);
  return data.id;
}
async function setStatus(orgId, id, status) {
  if (!['draft', 'live', 'closed'].includes(status)) throw new Error('Bad status');
  const { data: op } = await admin().from('partner_openings').select('*').eq('id', id).eq('org_id', orgId).maybeSingle(); if (!op) throw new Error('Not found');
  const org = await orgKind(orgId);
  if (status === 'live') await mirror(op, org);
  if (status === 'closed' && op.opportunity_id) await admin().from('opportunities').update({ status: 'expired' }).eq('id', op.opportunity_id).then(() => {}, () => {});
  if (status === 'draft' && op.opportunity_id) await admin().from('opportunities').update({ status: 'expired' }).eq('id', op.opportunity_id).then(() => {}, () => {});
  const { data, error } = await admin().from('partner_openings').update({ status, updated_at: new Date().toISOString() }).eq('id', id).select('*').single(); if (error) throw new Error(error.message); return data;
}
/* Applicants the partner may see: only applications to its openings, only with consent. */
async function applicants(orgId) {
  const ops = await list(orgId); const oppIds = ops.map(o => o.opportunity_id).filter(Boolean); if (!oppIds.length) return [];
  const { data: apps } = await admin().from('applications').select('id,user_id,opportunity_id,status,created_at,updated_at').in('opportunity_id', oppIds).order('created_at', { ascending: false }).limit(500);
  const { data: shares } = await admin().from('application_shares').select('*').eq('org_id', orgId);
  const shareOf = Object.fromEntries((shares || []).map(s => [s.application_id, s]));
  const uids = [...new Set((apps || []).map(a => a.user_id))];
  const { data: profs } = uids.length ? await admin().from('profiles').select('id,full_name,headline,field,total_experience_years,nationality,email').in('id', uids) : { data: [] };
  const pOf = Object.fromEntries((profs || []).map(p => [p.id, p]));
  const opOf = Object.fromEntries(ops.map(o => [o.opportunity_id, o]));
  return (apps || []).map(a => { const s = shareOf[a.id]; const p = pOf[a.user_id] || {}; const consented = !!(s && s.consent);
    return { application_id: a.id, opening: opOf[a.opportunity_id] ? { id: opOf[a.opportunity_id].id, title: opOf[a.opportunity_id].title } : null, applied_at: a.created_at, applicant_status: a.status, consent: consented,
      applicant: consented ? { name: p.full_name, headline: p.headline, field: p.field, years: p.total_experience_years, nationality: p.nationality, email: p.email } : { name: 'Applicant ' + a.id.slice(0, 6), field: p.field || null, nationality: p.nationality || null },
      partner_status: s ? s.partner_status : 'received', partner_note: s ? s.partner_note : null }; });
}
async function setPartnerStatus(orgId, applicationId, status, note) {
  if (!['received', 'reviewing', 'shortlisted', 'interview', 'offer', 'rejected'].includes(status)) throw new Error('Bad status');
  const { data: a } = await admin().from('applications').select('id,user_id,opportunity_id').eq('id', applicationId).maybeSingle(); if (!a) throw new Error('Application not found');
  const { data: op } = await admin().from('partner_openings').select('id').eq('org_id', orgId).eq('opportunity_id', a.opportunity_id).maybeSingle(); if (!op) throw new Error('Not your opening');
  await admin().from('application_shares').upsert({ application_id: applicationId, user_id: a.user_id, org_id: orgId, opening_id: op.id, partner_status: status, partner_note: String(note || '').slice(0, 1000) || null }, { onConflict: 'application_id,org_id' });
  // The applicant's own case status follows the partner's decision when it is an outcome.
  const mapped = { interview: 'interview', offer: 'offer', rejected: 'rejected' }[status]; if (mapped) await admin().from('applications').update({ status: mapped }).eq('id', applicationId).then(() => {}, () => {});
  try { require('./notify').push(a.user_id, 'applicant_status', 'Update on your application: ' + status, note || null, 'apps'); } catch (e) {}
  return { ok: true };
}
/* The applicant consents (or withdraws consent) to share their file with a partner. */
async function consent(userId, applicationId, give) {
  const { data: a } = await admin().from('applications').select('id,opportunity_id').eq('id', applicationId).eq('user_id', userId).maybeSingle(); if (!a) throw new Error('Not your application');
  const { data: op } = await admin().from('partner_openings').select('id,org_id').eq('opportunity_id', a.opportunity_id).maybeSingle(); if (!op) throw new Error('This position is not a partner opening');
  await admin().from('application_shares').upsert({ application_id: applicationId, user_id: userId, org_id: op.org_id, opening_id: op.id, consent: !!give, shared_at: give ? new Date().toISOString() : null }, { onConflict: 'application_id,org_id' });
  return { ok: true, consent: !!give };
}
async function servicePartners(slot, cc) {
  let q = admin().from('service_partners').select('id,slot,name,url,whatsapp,countries,description').eq('status', 'live'); if (slot) q = q.eq('slot', slot);
  const { data } = await q; const rows = data || [];
  return cc ? rows.filter(p => !p.countries || !p.countries.length || p.countries.includes(String(cc).toUpperCase())) : rows;
}
module.exports = { create, list, update, setStatus, applicants, setPartnerStatus, consent, servicePartners };
