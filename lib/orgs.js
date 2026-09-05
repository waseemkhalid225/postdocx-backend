// lib/orgs.js — Phase 0: organisations, membership and clients.
// Every existing user silently becomes the owner of a personal organisation; nothing in the
// B2C flow changes. Agencies, institutions, employers and partners are the same shape with a
// different `kind`, so one permission model serves every persona.
const crypto = require('crypto');
const { admin } = require('./supa');

const ORG_ROLES = ['owner', 'manager', 'consultant', 'sub_agent', 'viewer'];
const CAN = {
  'clients.read':   ['owner', 'manager', 'consultant', 'sub_agent', 'viewer'],
  'clients.write':  ['owner', 'manager', 'consultant', 'sub_agent'],
  'clients.assign': ['owner', 'manager'],
  'members.write':  ['owner', 'manager'],
  'org.settings':   ['owner'],
  'finance.read':   ['owner', 'manager'],
  'finance.write':  ['owner', 'manager']
};

function identityHash(email, phone) {
  const e = String(email || '').trim().toLowerCase();
  const p = String(phone || '').replace(/[^0-9]/g, '').replace(/^0/, '92');
  if (!e && !p) return null;
  return crypto.createHash('sha256').update(e + '|' + p).digest('hex');
}

async function ensurePersonalOrg(userId, displayName) {
  const { data: own } = await admin().from('organisations').select('id,name,kind,plan').eq('owner_id', userId).eq('kind', 'personal').limit(1);
  if (own && own[0]) return own[0];
  const { data, error } = await admin().from('organisations').insert({ name: (displayName || 'My workspace').slice(0, 80), kind: 'personal', owner_id: userId }).select('id,name,kind,plan').single();
  if (error) throw new Error(error.message);
  await admin().from('org_members').upsert({ org_id: data.id, user_id: userId, role: 'owner' });
  return data;
}

/* IDENTITY RULES for organisations: the platform's names are reserved; a consultancy trades under its own registered name;
   impersonating another organisation's name is refused; contact addresses must be the organisation's own, never a platform address. */
const RESERVED = /fori\s*foreign|forimail|foriforeign|fori-foreign/i;
function checkOrgName(name) { const n = String(name || '').trim(); if (n.length < 2) throw new Error('Organisation name is required.'); if (RESERVED.test(n)) throw new Error('That name is reserved for the platform. Use your own registered consultancy or organisation name.'); return n.slice(0, 80); }
async function checkNameUnique(name, exceptOrgId) { const { data } = await admin().from('organisations').select('id,name').ilike('name', String(name).trim()).limit(5); if ((data || []).some(o => o.id !== exceptOrgId)) throw new Error('An organisation with this name already exists on the platform. If it is yours, ask its owner to add you; otherwise use your registered name with a distinguishing word.'); }
function checkOwnContact(email) { const e = String(email || '').trim().toLowerCase(); if (!e) return ''; const dom = e.split('@')[1] || ''; if (/^(forimail\.com|foriforeign\.com)$/.test(dom) || dom.endsWith('.forimail.com')) throw new Error('Use your organisation\'s own email address for coordination; platform mailbox addresses are for applicants\' applications only.'); if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) throw new Error('Enter a valid email address.'); return e; }
async function createOrg(userId, { name, kind, country_code }) {
  name = checkOrgName(name); await checkNameUnique(name, null);
  // Resale lock: a consultant or sub-agent inside a consultancy cannot open their own consultancy while a member elsewhere.
  if (kind === 'agency') { const { data: mem } = await admin().from('org_members').select('org_id,role').eq('user_id', userId).in('role', ['consultant', 'sub_agent', 'manager']); if (mem && mem.length) { const ids = mem.map(m => m.org_id); const { data: ag } = await admin().from('organisations').select('id').in('id', ids).eq('kind', 'agency'); if (ag && ag.length) throw new Error('You are a member of a consultancy on ForiForeign. Ask its owner to open a branch for you instead of a second consultancy.'); } }
  if (!name || String(name).trim().length < 2) throw new Error('Organisation name required');
  const k = ['agency', 'institution', 'employer', 'partner'].includes(kind) ? kind : 'agency';
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Math.random().toString(36).slice(2, 6);
  const { data, error } = await admin().from('organisations').insert({ name: String(name).trim().slice(0, 80), kind: k, owner_id: userId, country_code: (country_code || 'PK').toUpperCase().slice(0, 2), slug }).select('*').single();
  if (error) throw new Error(error.message);
  await admin().from('org_members').upsert({ org_id: data.id, user_id: userId, role: 'owner' });
  return data;
}

async function myOrgs(userId) {
  const { data: mem } = await admin().from('org_members').select('org_id,role,branch').eq('user_id', userId);
  const ids = (mem || []).map(m => m.org_id);
  if (!ids.length) return [];
  const { data: orgs } = await admin().from('organisations').select('id,name,kind,plan,country_code,slug,created_at').in('id', ids);
  const roleOf = Object.fromEntries((mem || []).map(m => [m.org_id, m.role]));
  return (orgs || []).map(o => ({ ...o, my_role: roleOf[o.id] }));
}

async function memberRole(orgId, userId) {
  const { data } = await admin().from('org_members').select('role').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  return data ? data.role : null;
}
async function membership(orgId, userId) {
  const { data } = await admin().from('org_members').select('role,branch').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  return data || null;
}
/* WHO SEES WHICH CLIENTS. Owner: every client. Manager: their branch (all, if no branch set).
   Consultant: their branch. Sub-agent: only the clients they created. Viewer: read-only, branch. */
function scopeFor(m, userId) {
  if (!m) return { none: true };
  if (m.role === 'owner') return {};
  if (m.role === 'sub_agent') return { owner_user_id: userId };
  return m.branch ? { branch: m.branch } : {};
}
/* Branches are paths: "Lahore" covers "Lahore/DHA" and "Lahore/Gulberg". A manager of "Lahore" sees the whole
   subtree; a consultant in "Lahore/DHA" sees only that sub-branch. Owners see everything in the organisation. */
function applyScope(query, scope) {
  if (scope.owner_user_id) query = query.eq('owner_user_id', scope.owner_user_id);
  if (scope.branch) query = query.or('branch.eq.' + scope.branch + ',branch.like.' + scope.branch + '/%');
  return query;
}

async function requireOrg(req, orgId, permission) {
  const role = await memberRole(orgId, req.userId);
  if (!role) { const e = new Error('Not a member of this organisation'); e.status = 403; throw e; }
  if (permission && !(CAN[permission] || []).includes(role)) { const e = new Error('Your role cannot ' + permission); e.status = 403; throw e; }
  return role;
}

async function createClient(orgId, ownerUserId, body) {
  // Conflict of interest: institutions, employers and service partners receive applicants; they do not own clients.
  try { const { data: o } = await admin().from('organisations').select('kind').eq('id', orgId).maybeSingle(); if (o && ['institution', 'employer', 'partner'].includes(o.kind)) throw new Error('This workspace receives applicants; it cannot hold consultant clients. Open a separate consultancy workspace if you also advise applicants.'); } catch (e) { if (/cannot hold consultant clients/.test(String(e.message))) throw e; }
  const full_name = String((body || {}).full_name || '').trim();
  if (full_name.length < 2) throw new Error('Client name required');
  const row = {
    org_id: orgId, owner_user_id: ownerUserId,
    full_name: full_name.slice(0, 120),
    email: (body.email || '').trim().toLowerCase().slice(0, 160) || null,
    phone: (body.phone || '').trim().slice(0, 40) || null,
    whatsapp: (body.whatsapp || body.phone || '').trim().slice(0, 40) || null,
    nationality: (body.nationality || 'PK').toUpperCase().slice(0, 2),
    lane: ['study', 'work', 'both'].includes(body.lane) ? body.lane : 'both',
    profile: body.profile && typeof body.profile === 'object' ? body.profile : {},
    identity_hash: identityHash(body.email, body.phone),
    branch: (body.branch || '').trim().slice(0, 60) || null
  };
  // STRICT SEPARATION: a client record is the consultancy's own. It is never matched to, linked with, or reported against any
  // existing ForiForeign account. Direct applicants and FF-CRM clients are two populations that never meet.
  /* A ForiForeign address for the client, minted now, so replies to anything sent in their name land in FF-CRM from day one. */
  try { const base = String(body.full_name || 'client').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 2).join('.').slice(0, 24) || 'client'; const dom = process.env.APPLY_DOMAIN || 'forimail.com'; for (let i = 0; i < 6; i++) { const cand = base + (i ? '.' + Math.random().toString(36).slice(2, 5) : '') + '@' + dom; const { data: cl } = await admin().from('clients').select('id').eq('apply_email', cand).limit(1); const { data: pr } = await admin().from('profiles').select('id').eq('apply_email', cand).limit(1); if (!(cl && cl.length) && !(pr && pr.length)) { row.apply_email = cand; break; } } } catch (e) {}
  const { data, error } = await admin().from('clients').insert(row).select('*').single();
  if (error) {
    if (String(error.message).includes('idx_clients_identity')) throw new Error('This client already exists in your organisation (same email or phone).');
    throw new Error(error.message);
  }
  return data;
}

async function listClients(orgId, { stage, q, limit, scope } = {}) {
  let query = admin().from('clients').select('id,full_name,email,phone,whatsapp,nationality,lane,stage,status,branch,owner_user_id,user_id,created_at,updated_at,assigned_to,priority,stage_changed_at,last_activity_at,profile,source,target_country,apply_email,invited_at,archived_at').eq('org_id', orgId).order('updated_at', { ascending: false }).limit(Math.min(500, limit || 100));
  if (!(arguments[1] && arguments[1].include_archived)) query = query.is('archived_at', null);
  query = applyScope(query, scope || {});
  if (stage) query = query.eq('stage', stage);
  if (q) query = query.ilike('full_name', '%' + String(q).slice(0, 60) + '%');
  const { data } = await query;
  return data || [];
}

async function updateClient(orgId, clientId, patch) {
  const allowed = {};
  for (const k of ['full_name', 'email', 'phone', 'whatsapp', 'nationality', 'lane', 'stage', 'status', 'profile', 'owner_user_id', 'branch', 'assigned_to', 'priority', 'sub_agent_user_id', 'sub_agent_share_pct', 'source', 'lost_reason', 'target_country']) if (patch[k] !== undefined) allowed[k] = patch[k];
  if (allowed.profile && typeof allowed.profile !== 'object') delete allowed.profile;
  allowed.updated_at = new Date().toISOString();
  const { data, error } = await admin().from('clients').update(allowed).eq('id', clientId).eq('org_id', orgId).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

async function addMember(orgId, email, role, branch, invitedBy) {
  const r = ORG_ROLES.includes(role) && role !== 'owner' ? role : 'consultant';
  const em = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw new Error('A valid email is required');
  const br = (branch || '').trim().slice(0, 60) || null;
  /* Consultancy staff join with their OWN organisation email (their CRM, their identity). The platform mailbox is only the
     applicants' application address, never a condition for staff access. A platform mailbox address cannot be used as a staff login. */
  if (/@(forimail\.com|foriforeign\.com)$/i.test(em)) { const { data: thisOrg } = await admin().from('organisations').select('kind').eq('id', orgId).maybeSingle(); if (thisOrg && thisOrg.kind !== 'personal') throw new Error('Invite staff with their own organisation email address; platform mailbox addresses are reserved for applicants\' applications.'); }
  const { data: p } = await admin().from('profiles').select('id,full_name,role').ilike('email', em).maybeSingle();
  // Conflict of interest: ForiForeign platform staff never sit inside a customer organisation.
  if (p && ['staff', 'content_admin', 'admin', 'super_admin'].includes(p.role)) throw new Error('ForiForeign staff cannot be members of customer organisations.');
  // Resale lock: a person who OWNS another consultancy cannot be a member here (no re-selling one plan across agencies).
  if (p) { const { data: owns } = await admin().from('organisations').select('id,kind').eq('owner_id', p.id).eq('kind', 'agency'); const { data: thisOrg } = await admin().from('organisations').select('kind').eq('id', orgId).maybeSingle(); if (thisOrg && thisOrg.kind === 'agency' && owns && owns.length) throw new Error('This person owns another consultancy on ForiForeign; each consultancy holds its own plan.'); }
  if (!p) {
    // No account yet: the invite waits, and is honoured automatically the moment they sign up.
    await admin().from('org_invites').upsert({ org_id: orgId, email: em, role: r, branch: br, invited_by: invitedBy || null }, { onConflict: 'org_id,email' }).then(() => {}, async () => {
      await admin().from('org_invites').insert({ org_id: orgId, email: em, role: r, branch: br, invited_by: invitedBy || null });
    });
    return { pending: true, email: em, role: r, note: 'Invitation saved. When ' + em + ' signs up to ForiForeign they join your workspace automatically as ' + r.replace('_', '-') + '.' };
  }
  await admin().from('org_members').upsert({ org_id: orgId, user_id: p.id, role: r, branch: br });
  return { ok: true, user_id: p.id, full_name: p.full_name, role: r, branch: br };
}
async function listMembers(orgId) {
  const { data: mem } = await admin().from('org_members').select('user_id,role,branch,created_at').eq('org_id', orgId);
  const ids = (mem || []).map(m => m.user_id);
  const { data: profs } = ids.length ? await admin().from('profiles').select('id,full_name,email,whatsapp,phone').in('id', ids) : { data: [] };
  const pOf = Object.fromEntries((profs || []).map(p => [p.id, p]));
  const { data: inv } = await admin().from('org_invites').select('id,email,role,branch,created_at').eq('org_id', orgId).is('accepted_at', null);
  return { members: (mem || []).map(m => ({ ...m, full_name: (pOf[m.user_id] || {}).full_name || '', email: (pOf[m.user_id] || {}).email || '', whatsapp: (pOf[m.user_id] || {}).whatsapp || (pOf[m.user_id] || {}).phone || '' })), invites: inv || [] };
}
async function updateMember(orgId, actorUserId, userId, patch) {
  if (userId === actorUserId && patch.role && patch.role !== 'owner') throw new Error('You cannot demote yourself.');
  const upd = {};
  if (patch.role && ORG_ROLES.includes(patch.role)) upd.role = patch.role;
  if (patch.branch !== undefined) upd.branch = (patch.branch || '').trim().slice(0, 60) || null;
  const { error } = await admin().from('org_members').update(upd).eq('org_id', orgId).eq('user_id', userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
async function removeMember(orgId, actorUserId, userId) {
  if (userId === actorUserId) throw new Error('You cannot remove yourself. Transfer ownership first.');
  const { data: org } = await admin().from('organisations').select('owner_id').eq('id', orgId).maybeSingle();
  if (org && org.owner_id === userId) throw new Error('The owner cannot be removed.');
  await admin().from('org_members').delete().eq('org_id', orgId).eq('user_id', userId);
  return { ok: true };
}
/* Called at login: any pending invitation for this email becomes a membership. */
async function acceptInvites(userId, email) {
  const em = String(email || '').trim().toLowerCase(); if (!em) return 0;
  const { data: inv } = await admin().from('org_invites').select('id,org_id,role,branch').ilike('email', em).is('accepted_at', null);
  let n = 0;
  for (const i of (inv || [])) {
    await admin().from('org_members').upsert({ org_id: i.org_id, user_id: userId, role: i.role, branch: i.branch });
    await admin().from('org_invites').update({ accepted_at: new Date().toISOString(), accepted_user_id: userId }).eq('id', i.id);
    n++;
  }
  return n;
}
async function updateOrgSettings(orgId, patch) {
  const { data: org } = await admin().from('organisations').select('settings,name').eq('id', orgId).maybeSingle();
  const st = Object.assign({}, (org && org.settings) || {});
  for (const k of ['whatsapp', 'email', 'website', 'city', 'staff_whatsapp_mode', 'brand_color', 'logo_url', 'tax_id', 'address', 'phone', 'contact_email', 'support_email', 'reg_no', 'tagline', 'signature_name', 'signature_title']) if (patch[k] !== undefined) st[k] = String(patch[k] || '').slice(0, 300);
  if (patch.email !== undefined) st.email = checkOwnContact(patch.email); if (patch.contact_email !== undefined) st.contact_email = checkOwnContact(patch.contact_email); if (patch.support_email !== undefined) st.support_email = checkOwnContact(patch.support_email);
  if (st.tagline && /fori\s*foreign|forimail/i.test(st.tagline)) throw new Error('The platform\'s name cannot appear in your tagline.');
  const upd = { settings: st }; if (patch.name && String(patch.name).trim().length >= 2) { upd.name = checkOrgName(patch.name); await checkNameUnique(upd.name, orgId); }
  const { error } = await admin().from('organisations').update(upd).eq('id', orgId);
  if (error) throw new Error(error.message);
  return st;
}

module.exports = { checkOrgName, checkOwnContact, RESERVED, ORG_ROLES, CAN, identityHash, ensurePersonalOrg, createOrg, myOrgs, memberRole, membership, scopeFor, applyScope, requireOrg, createClient, listClients, updateClient, addMember, listMembers, updateMember, removeMember, acceptInvites, updateOrgSettings };
