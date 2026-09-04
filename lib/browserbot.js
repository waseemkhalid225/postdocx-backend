// lib/browserbot.js — the Browser Agent: an always-on, consented watcher of the applicant's OWN portal accounts.
// Shape: the applicant (or their consultant, on the applicant's behalf with recorded consent) connects a portal
// (visa centre, immigration account, university portal) with its login; the secret is encrypted at rest; a
// scheduled run logs in as the applicant, reads the status page, hashes it, and raises a Case Brain event when it
// changes. Scope is graded (watch → upload → submit) and capped by policy at platform, organisation and user level.
// The real browser runs in a separate worker (tools/browser-worker.js, Playwright); this module is the brain,
// the policy gate and the fallback (HTTP fetch of public status pages when a portal offers a no-login tracker).
const crypto = require('crypto');
const { admin } = require('./supa');
const C = require('./crypto');
const PORTALS = {
  uk_vfs: { name: 'UK visa (VFS Global tracking)', login_url: 'https://www.vfsglobal.com/en/individuals/track-your-application.html', public: true },
  gb_ukvi: { name: 'UK Visas & Immigration account', login_url: 'https://www.gov.uk/track-your-visa-application' },
  ca_ircc: { name: 'IRCC secure account (Canada)', login_url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/account.html' },
  au_immi: { name: 'ImmiAccount (Australia)', login_url: 'https://online.immi.gov.au/lusc/login' },
  nz_inz: { name: 'Immigration New Zealand online services', login_url: 'https://onlineservices.immigration.govt.nz/' },
  us_ceac: { name: 'US CEAC status', login_url: 'https://ceac.state.gov/CEACStatTracker/Status.aspx', public: true },
  de_videx: { name: 'Germany VIDEX / consular portal', login_url: 'https://digital.diplo.de/' },
  ie_avats: { name: 'Ireland AVATS / visa decisions', login_url: 'https://www.irishimmigration.ie/visa-decisions/', public: true },
  ae_icp: { name: 'UAE ICP smart services', login_url: 'https://smartservices.icp.gov.ae/', public: true },
  sa_mofa: { name: 'Saudi MOFA visa inquiry', login_url: 'https://visa.mofa.gov.sa/VisaInquiry', public: true },
  qa_moi: { name: 'Qatar MOI visa inquiry', login_url: 'https://portal.moi.gov.qa/', public: true },
  my_emgs: { name: 'EMGS (Malaysia) tracking', login_url: 'https://visa.educationmalaysia.gov.my/', public: true },
  university: { name: 'University / employer portal', login_url: '' },
  /* Every destination and the main origins, so no one has to pick "other". */
  ie_avats: { name: 'Ireland AVATS / visa decisions', login_url: 'https://www.irishimmigration.ie/visa-decisions/', public: true },
  ae_icp: { name: 'UAE ICP smart services', login_url: 'https://icp.gov.ae/en/services/' },
  sa_mofa: { name: 'Saudi MOFA visa inquiry', login_url: 'https://visa.mofa.gov.sa/', public: true },
  sa_musaned: { name: 'Saudi Musaned (domestic work)', login_url: 'https://musaned.com.sa/' },
  qa_moi: { name: 'Qatar MOI visa inquiry', login_url: 'https://portal.moi.gov.qa/', public: true },
  kw_paci: { name: 'Kuwait PACI / MOI e-visa', login_url: 'https://evisa.moi.gov.kw/', public: true },
  om_rop: { name: 'Oman ROP visa status', login_url: 'https://evisa.rop.gov.om/', public: true },
  bh_npra: { name: 'Bahrain NPRA e-visa status', login_url: 'https://www.evisa.gov.bh/', public: true },
  de_videx: { name: 'Germany VIDEX / consular portal', login_url: 'https://videx.diplo.de/' },
  de_ausland: { name: 'Germany consular services portal', login_url: 'https://digital.diplo.de/' },
  fr_france_visas: { name: 'France-Visas', login_url: 'https://france-visas.gouv.fr/' },
  nl_ind: { name: 'Netherlands IND', login_url: 'https://ind.nl/' },
  be_visa: { name: 'Belgium visa on web', login_url: 'https://visaonweb.diplomatie.be/' },
  it_vfs: { name: 'Italy VFS tracking', login_url: 'https://visa.vfsglobal.com/', public: true },
  es_blsspain: { name: 'Spain BLS / consulate', login_url: 'https://www.blsspainvisa.com/' },
  pt_vfs: { name: 'Portugal VFS / AIMA', login_url: 'https://visa.vfsglobal.com/', public: true },
  at_bmeia: { name: 'Austria consular portal', login_url: 'https://www.bmeia.gv.at/' },
  ch_sem: { name: 'Switzerland SEM / consulate', login_url: 'https://www.sem.admin.ch/' },
  se_migration: { name: 'Sweden Migrationsverket', login_url: 'https://www.migrationsverket.se/' },
  no_udi: { name: 'Norway UDI', login_url: 'https://www.udi.no/' },
  dk_nyidanmark: { name: 'Denmark nyidanmark', login_url: 'https://www.nyidanmark.dk/' },
  fi_enterfinland: { name: 'Finland Enter Finland', login_url: 'https://enterfinland.fi/' },
  pl_evisa: { name: 'Poland e-Konsulat', login_url: 'https://www.e-konsulat.gov.pl/' },
  cz_vfs: { name: 'Czechia VFS tracking', login_url: 'https://visa.vfsglobal.com/', public: true },
  hu_consulate: { name: 'Hungary consular portal', login_url: 'https://konzinfoidopont.mfa.gov.hu/' },
  ro_evisa: { name: 'Romania eViza', login_url: 'https://eviza.mae.ro/' },
  sk_consulate: { name: 'Slovakia consular portal', login_url: 'https://www.mzv.sk/' },
  gr_consulate: { name: 'Greece consular portal', login_url: 'https://www.mfa.gr/' },
  lt_migris: { name: 'Lithuania MIGRIS', login_url: 'https://www.migracija.lt/' },
  lv_pmlp: { name: 'Latvia PMLP', login_url: 'https://www.pmlp.gov.lv/' },
  ee_ppa: { name: 'Estonia PPA', login_url: 'https://www.politsei.ee/' },
  jp_immi: { name: 'Japan Immigration Services online', login_url: 'https://www.moj.go.jp/isa/' },
  kr_hikorea: { name: 'Korea HiKorea / EPS', login_url: 'https://www.hikorea.go.kr/' },
  cn_visa: { name: 'China visa application centre', login_url: 'https://www.visaforchina.cn/', public: true },
  sg_ica: { name: 'Singapore ICA / MOM e-services', login_url: 'https://www.ica.gov.sg/' },
  my_emgs: { name: 'EMGS (Malaysia) tracking', login_url: 'https://visa.educationmalaysia.gov.my/', public: true },
  my_esd: { name: 'Malaysia ESD / MyXpats', login_url: 'https://esd.imi.gov.my/' },
  th_evisa: { name: 'Thailand e-Visa', login_url: 'https://www.thaievisa.go.th/' },
  tr_evisa: { name: 'Türkiye e-Visa / consulate', login_url: 'https://www.evisa.gov.tr/' },
  hk_immd: { name: 'Hong Kong ImmD', login_url: 'https://www.immd.gov.hk/' },
  tw_boca: { name: 'Taiwan BOCA', login_url: 'https://www.boca.gov.tw/' },
  br_consular: { name: 'Brazil e-consular', login_url: 'https://www.gov.br/mre/' },
  mx_inm: { name: 'Mexico INM / consulate', login_url: 'https://www.gob.mx/inm' },
  za_vfs: { name: 'South Africa VFS tracking', login_url: 'https://visa.vfsglobal.com/', public: true },
  kz_egov: { name: 'Kazakhstan eGov visa', login_url: 'https://egov.kz/' },
  uz_evisa: { name: 'Uzbekistan e-Visa', login_url: 'https://e-visa.gov.uz/' },
  az_evisa: { name: 'Azerbaijan ASAN visa', login_url: 'https://evisa.gov.az/' },
  ge_evisa: { name: 'Georgia e-Visa', login_url: 'https://www.evisa.gov.ge/' },
  cy_civil: { name: 'Cyprus Civil Registry & Migration', login_url: 'https://www.moi.gov.cy/' },
  mt_identity: { name: 'Malta Identità', login_url: 'https://identita.gov.mt/' },
  hr_mup: { name: 'Croatia MUP', login_url: 'https://mup.gov.hr/' },
  lu_visa: { name: 'Luxembourg guichet.lu', login_url: 'https://guichet.public.lu/' },
  /* origin-side: emigration clearance and passports */
  pk_beoe: { name: 'Pakistan BEOE / Protector of Emigrants', login_url: 'https://beoe.gov.pk/' },
  pk_nadra: { name: 'Pakistan NADRA / passport (DGIP)', login_url: 'https://onlinemrp.dgip.gov.pk/' },
  pk_hec: { name: 'Pakistan HEC attestation', login_url: 'https://eservices.hec.gov.pk/' },
  in_emigrate: { name: 'India eMigrate', login_url: 'https://emigrate.gov.in/' },
  in_passport: { name: 'India Passport Seva', login_url: 'https://www.passportindia.gov.in/' },
  bd_bmet: { name: 'Bangladesh BMET / Ami Probashi', login_url: 'https://www.amiprobashi.com/' },
  np_dofe: { name: 'Nepal DoFE', login_url: 'https://dofe.gov.np/' },
  lk_slbfe: { name: 'Sri Lanka SLBFE', login_url: 'https://www.slbfe.lk/' },
  ph_dmw: { name: 'Philippines DMW e-Registration', login_url: 'https://onlineservices.dmw.gov.ph/' },
  ng_nis: { name: 'Nigeria Immigration Service', login_url: 'https://portal.immigration.gov.ng/' },
  ke_ecitizen: { name: 'Kenya eCitizen', login_url: 'https://www.ecitizen.go.ke/' },
  eg_tasheel: { name: 'Egypt Tasheel / labour attestation', login_url: 'https://tasheel.gov.eg/' },
};
const SCOPES = ['watch', 'watch_and_upload', 'watch_upload_submit', 'staff_assist'];   // staff_assist = watch by platform staff, applicant approval required
async function policyFor(userId, orgId) {
  const { data } = await admin().from('browser_policies').select('*').eq('enabled', true);
  const rows = data || []; const plat = rows.find(r => r.scope_kind === 'platform'); const org = orgId ? rows.find(r => r.scope_kind === 'org' && r.scope_id === orgId) : null; const usr = rows.find(r => r.scope_kind === 'user' && r.scope_id === userId);
  const cap = [plat, org, usr].filter(Boolean).reduce((m, r) => Math.min(m, SCOPES.indexOf(r.max_scope)), 2);
  const domains = [].concat(...[plat, org, usr].filter(Boolean).map(r => r.allowed_domains || []));
  return { max_scope: SCOPES[Math.max(0, cap)], allowed_domains: domains, platform_enabled: !plat || plat.enabled !== false };
}
async function connect(userId, { portal_key, portal_name, login_url, status_url, username, secret, scope, client_id, org_id, consent }) {
  if (!consent) throw new Error('The applicant must consent to the portal being watched on their behalf.');
  const pk = String(portal_key || 'university'); const def = PORTALS[pk] || PORTALS.university;
  const url = String(login_url || def.login_url || ''); if (!/^https:\/\//.test(url)) throw new Error('A valid https login URL is required');
  const pol = await policyFor(userId, org_id); if (!pol.platform_enabled) throw new Error('Browser automation is switched off by the platform.');
  const host = new URL(url).hostname; if (pol.allowed_domains.length && !pol.allowed_domains.some(d => host === d || host.endsWith('.' + d))) throw new Error('This portal domain is not on the allowed list. Ask your administrator.');
  const want = SCOPES.includes(scope) ? scope : 'watch'; const eff = SCOPES[Math.min(SCOPES.indexOf(want), SCOPES.indexOf(pol.max_scope))];
  const enc = secret ? (C.enabled() ? C.encrypt(String(secret)) : null) : null; if (secret && !enc) throw new Error('Field encryption (FF_DATA_KEY) must be on before portal passwords can be stored.');
  const { data, error } = await admin().from('portal_connections').insert({ user_id: userId, client_id: client_id || null, org_id: org_id || null, portal_key: pk, portal_name: String(portal_name || def.name).slice(0, 120), login_url: url, status_url: status_url || null, username: String(username || '').slice(0, 200) || null, secret_enc: enc, consent: true, consent_at: new Date().toISOString(), scope: eff }).select('id,portal_key,portal_name,scope,status,watch_every_minutes').single();
  if (error) throw new Error(error.message);
  await admin().from('audit_log').insert({ actor: userId, event: 'PORTAL_CONNECTED', detail: pk + ' ' + host + ' scope=' + eff, org_id: org_id || null }).then(() => {}, () => {});
  const Q = require('./queue'); await Q.enqueue('portal_watch', { connectionId: data.id }, { userId, maxAttempts: 2 });
  return data;
}
async function list(userId) { const { data } = await admin().from('portal_connections').select('id,portal_key,portal_name,login_url,status_url,username,scope,status,watch_every_minutes,last_run_at,last_status_text,last_error,consent_at').eq('user_id', userId).order('created_at', { ascending: false }); return data || []; }
async function runs(userId, connectionId) { const { data } = await admin().from('portal_runs').select('id,started_at,finished_at,outcome,status_text,error,extracted').eq('connection_id', connectionId).eq('user_id', userId).order('started_at', { ascending: false }).limit(30); return data || []; }
async function setStatus(userId, id, status) { if (!['connected', 'paused', 'disconnected'].includes(status)) throw new Error('Bad status'); const patch = { status }; if (status === 'disconnected') patch.secret_enc = null; await admin().from('portal_connections').update(patch).eq('id', id).eq('user_id', userId); return { ok: true }; }
/* One watch run. If a Playwright worker is present it does the login; otherwise public trackers are fetched
   without login; anything else is recorded as "needs the browser worker" instead of pretending. */
async function watch(connectionId) {
  const { data: c } = await admin().from('portal_connections').select('*').eq('id', connectionId).maybeSingle(); if (!c || c.status !== 'connected') return { skipped: true };
  const { data: run } = await admin().from('portal_runs').insert({ connection_id: c.id, user_id: c.user_id }).select('id').single();
  let outcome = 'error', statusText = null, err = null, extracted = {};
  try {
    const def = PORTALS[c.portal_key] || {};
    let worker = null; try { worker = require('../tools/worker/worker'); } catch (e) { worker = null; }   // optional in-process worker; the separate package is the normal way
    if (worker && typeof worker.watch === 'function') {
      const r = await worker.watch({ login_url: c.login_url, status_url: c.status_url, username: c.username, password: c.secret_enc ? C.decrypt(c.secret_enc) : null, portal_key: c.portal_key });
      statusText = r.status_text; extracted = r.extracted || {}; outcome = 'ok';
    } else if (def.public && c.status_url) {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
      const r = await fetch(c.status_url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (ForiForeign status watch; consented)' } }); clearTimeout(tm);
      const html = await r.text(); statusText = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000); outcome = 'ok';
    } else { outcome = 'blocked'; err = 'Needs the browser worker (tools/browser-worker.js on a Playwright service) to log in. Watching is scheduled; nothing is lost.'; }
    if (outcome === 'ok' && statusText) {
      const h = crypto.createHash('sha256').update(statusText).digest('hex');
      if (c.last_status_hash && c.last_status_hash !== h) { outcome = 'changed'; try { await require('./notify').push(c.user_id, 'portal_status', 'Status changed on ' + c.portal_name, statusText.slice(0, 300), 'profile'); } catch (e) {} }
      await admin().from('portal_connections').update({ last_run_at: new Date().toISOString(), last_status_text: statusText.slice(0, 2000), last_status_hash: h, last_error: null }).eq('id', c.id);
    } else await admin().from('portal_connections').update({ last_run_at: new Date().toISOString(), last_error: err, status: outcome === 'login_failed' ? 'error' : c.status }).eq('id', c.id);
  } catch (e) { err = String(e.message).slice(0, 300); outcome = /login|credential|password/i.test(err) ? 'login_failed' : 'error'; await admin().from('portal_connections').update({ last_run_at: new Date().toISOString(), last_error: err }).eq('id', c.id); }
  await admin().from('portal_runs').update({ finished_at: new Date().toISOString(), outcome, status_text: statusText ? statusText.slice(0, 2000) : null, extracted, error: err }).eq('id', run.id);
  return { outcome };
}
/* Scheduler: re-queue every connected portal whose interval has elapsed. */
async function sweep() {
  const { data } = await admin().from('portal_connections').select('id,last_run_at,watch_every_minutes').eq('status', 'connected'); let n = 0; const Q = require('./queue');
  for (const c of (data || [])) { const due = !c.last_run_at || (Date.now() - new Date(c.last_run_at).getTime()) > (c.watch_every_minutes || 720) * 60000; if (due) { await Q.enqueue('portal_watch', { connectionId: c.id }, { maxAttempts: 1 }); n++; } }
  return { queued: n };
}
module.exports = { PORTALS, SCOPES, policyFor, connect, list, runs, setStatus, watch, sweep };

/* ---------- Remote worker protocol (R6500): the worker polls for due connections, runs them, reports back. ---------- */
async function nextForWorker(limit) {
  const { data: rows } = await admin().from('portal_connections').select('*').eq('status', 'connected').or('last_run_at.is.null,last_run_at.lt.' + new Date(Date.now() - 6 * 3600000).toISOString()).limit(limit || 5);
  const jobs = []; for (const c of (rows || [])) { const def = PORTALS[c.portal_key] || {}; if (def.public && c.status_url) continue; const { data: run } = await admin().from('portal_runs').insert({ connection_id: c.id, user_id: c.user_id }).select('id').single(); await admin().from('portal_connections').update({ last_run_at: new Date().toISOString() }).eq('id', c.id); jobs.push({ run_id: run && run.id, connection_id: c.id, portal_name: c.portal_name, portal_key: c.portal_key, login_url: c.login_url, portal_url: c.status_url || c.login_url, username: c.username, password: c.secret_enc ? C.decrypt(c.secret_enc) : null, scope: c.scope, fill: /upload|submit/.test(c.scope || '') }); }
  return jobs;
}
async function reportFromWorker({ run_id, connection_id, result }) {
  const r = result || {}; const { data: c } = await admin().from('portal_connections').select('*').eq('id', connection_id).maybeSingle(); if (!c) return { ok: false };
  let outcome = r.error ? 'error' : 'ok'; const statusText = String(r.status_text || '').slice(0, 4000); let hash = c.last_status_hash;
  if (!r.error && statusText) { hash = crypto.createHash('sha256').update(statusText).digest('hex'); if (c.last_status_hash && c.last_status_hash !== hash) { outcome = 'changed'; try { await require('./notify').push(c.user_id, 'portal_status', 'Status changed on ' + c.portal_name, statusText.slice(0, 300), 'profile'); } catch (e) {} } }
  if (r.screenshot) { try { const { BUCKET } = require('./docs'); const key = 'portal/' + c.user_id + '/' + connection_id + '/' + Date.now() + '.png'; await admin().storage.from(BUCKET).upload(key, Buffer.from(r.screenshot, 'base64'), { contentType: 'image/png', upsert: true }); r.screenshot_key = key; } catch (e) {} }
  await admin().from('portal_connections').update({ last_run_at: new Date().toISOString(), last_status_text: statusText.slice(0, 2000), last_status_hash: hash, last_error: r.error || null }).eq('id', connection_id);
  if (run_id) await admin().from('portal_runs').update({ finished_at: new Date().toISOString(), outcome, status_text: statusText.slice(0, 2000), extracted: { filled: r.filled || 0, needs_person: r.needs_person || null, screenshot_key: r.screenshot_key || null }, error: r.error || null }).eq('id', run_id);
  return { ok: true, outcome };
}
module.exports.nextForWorker = nextForWorker; module.exports.reportFromWorker = reportFromWorker;
