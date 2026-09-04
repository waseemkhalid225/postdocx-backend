// lib/tenancy.js — Phase 0 of the Global Mobility OS: organisations, members, clients.
// Backward-compatible by construction: a user with no organisation gets a personal one
// on first touch, and is its owner and its only client. Nothing in the B2C product
// changes; agencies, institutions, employers and partners get real homes to grow into.
const { admin } = require('./supa');

async function ensurePersonalOrg(userId, profile) {
  if (!userId) return null;
  try {
    const { data: m } = await admin().from('org_members').select('org_id,role,organisations(id,kind,name,plan,country_code,settings)').eq('user_id', userId).limit(5);
    const rows = m || [];
    const personal = rows.find(r => r.organisations && r.organisations.kind === 'personal');
    if (personal) return { org: personal.organisations, role: personal.role, memberships: rows.map(r => ({ org: r.organisations, role: r.role })) };
    const name = (profile && profile.full_name) || 'Personal';
    const { data: org, error } = await admin().from('organisations').insert({ kind: 'personal', name, owner_user_id: userId }).select('id,kind,name,plan,country_code,settings').single();
    if (error || !org) return null;
    await admin().from('org_members').insert({ org_id: org.id, user_id: userId, role: 'owner' }).then(() => {}, () => {});
    await admin().from('clients').insert({ org_id: org.id, user_id: userId, owner_user_id: userId, full_name: name, email: profile && profile.email, stage: 'discover' }).then(() => {}, () => {});
    return { org, role: 'owner', memberships: rows.map(r => ({ org: r.organisations, role: r.role })).concat([{ org, role: 'owner' }]) };
  } catch (e) { return null; }
}

// The client record the current user IS (personal org). Agencies address clients by id.
async function selfClient(userId) {
  try {
    const { data } = await admin().from('clients').select('id,org_id,stage,profile').eq('user_id', userId).order('created_at', { ascending: true }).limit(1);
    return (data && data[0]) || null;
  } catch (e) { return null; }
}

// Journey stage is the spine of the OS. It only moves forward unless explicitly reset.
const STAGES = ['lead','discover','qualify','match','decide','prepare','apply','secured','visa','travel','arrived','settled','pr'];
async function advanceStage(clientId, stage) {
  if (!clientId || !STAGES.includes(stage)) return false;
  try {
    const { data: c } = await admin().from('clients').select('stage').eq('id', clientId).single();
    if (!c) return false;
    if (STAGES.indexOf(stage) <= STAGES.indexOf(c.stage)) return true;
    await admin().from('clients').update({ stage, updated_at: new Date().toISOString() }).eq('id', clientId);
    return true;
  } catch (e) { return false; }
}

module.exports = { ensurePersonalOrg, selfClient, advanceStage, STAGES };
