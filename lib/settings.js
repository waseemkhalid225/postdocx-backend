// lib/settings.js — Phase 1: central configuration architecture.
// One authoritative config, stored in app_settings (key 'site_config'), with
// versioning and a full audit trail. Web, Android and the future agent all read
// the same values from the API; nothing business-critical is hard-coded client-side.
const { admin } = require('./supa');

// Defaults: used until the admin saves overrides. Every key here is admin-editable.
const DEFAULTS = {
  brand: {
    name: 'ForiForeign',
    tagline: 'Your path to studying and working abroad.',
    hero_heading: 'Go further. Go abroad.',
    hero_subtitle: 'Upload your documents once. We understand your background, find verified opportunities that truly match you, and prepare every application for your approval.'
  },
  contact: { email: '', phone: '', whatsapp: '', address: '', hours: '' },
  payment: {
    bank_name: '', account_title: '', account_number: '', iban: '',
    jazzcash_number: '', easypaisa_number: '',
    instructions: 'Transfer the amount to the account below, then submit your transaction reference. Your credits appear after our team confirms the transfer.'
  },
  social: { facebook: '', instagram: '', linkedin: '', youtube: '', tiktok: '', google_business: '', website: '' },
  features: { free_first_case: true, payments: true, opportunity_search: true, reviews: false },
  apply_assistant: { enabled: true, apply_button: true, providers: { gmail: true, outlook: true }, fallback: 'download', store_urls: { chrome: '', edge: '', firefox: '' } },
  limits: { max_upload_mb: 10, max_files_per_upload: 6, search_cooldown_minutes: 30 },
  announcement: { enabled: false, text: '' },
  maintenance: { enabled: false, message: 'We are improving ForiForeign. Please check back shortly.' },
  stats: { users_helped: '', applications_prepared: '', note: 'Admin-entered figures. Leave blank to hide.' },
  ai: { usd_to_pkr: 278, pkr_override_per_case: '' },
  content: {
    privacy: 'Your documents are private and stored securely. They are used only to build your profile and prepare your own applications. Your profile is not publicly visible. You control your information and your applications; nothing is submitted on your behalf without your approval where approval is required.',
    help: 'Build your profile by uploading your CV, degrees and transcripts. Search opportunities ranked to your real background. Open an application case, review the prepared material, and approve it. You stay in control at every step.',
    terms: '',
    faq: ''
  },
  reviews: [],
  case_plan: { docs: ['cv', 'cover'] },   // which documents every prepared case includes; catalog: cv, cover, sop, research_proposal, scholarship_statement
  country_updates: []                     // admin-entered updates: [{title, text, date}]
};

// Public subset safe for any visitor (no secrets, no internal limits beyond UX needs).
function publicView(cfg) {
  return {
    brand: cfg.brand, contact: cfg.contact, social: cfg.social, payment: cfg.payment,
    features: cfg.features, announcement: cfg.announcement,
    maintenance: { enabled: cfg.maintenance.enabled, message: cfg.maintenance.message },
    stats: cfg.stats, content: cfg.content,
    reviews: (cfg.reviews || []).filter(r => r && r.visible !== false),
    country_updates: (cfg.country_updates || []).slice(0, 10),
    apply_assistant: { enabled: (cfg.apply_assistant||{}).enabled !== false, apply_button: (cfg.apply_assistant||{}).apply_button !== false, providers: (cfg.apply_assistant||{}).providers || {}, store_urls: (cfg.apply_assistant||{}).store_urls || {} }
  };
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') out[k] = deepMerge(base[k], over[k]);
    else out[k] = over[k];
  }
  return out;
}

let _cache = null, _cacheAt = 0;
async function getConfig(fresh) {
  if (!fresh && _cache && Date.now() - _cacheAt < 30000) return _cache;
  let stored = {};
  try {
    const { data } = await admin().from('app_settings').select('value').eq('key', 'site_config').single();
    stored = (data && data.value && data.value.config) || {};
  } catch (e) {}
  _cache = deepMerge(DEFAULTS, stored); _cacheAt = Date.now();
  return _cache;
}

// Save a partial update. Only keys that exist in DEFAULTS are accepted (validation),
// every change is versioned and audit-logged with old and new values.
async function saveConfig(patch, actorId) {
  const clean = {};
  for (const k of Object.keys(patch || {})) if (k in DEFAULTS) clean[k] = patch[k];
  if (!Object.keys(clean).length) throw new Error('No valid settings in update');
  const { data: row } = await admin().from('app_settings').select('value').eq('key', 'site_config').single().then(r => r, () => ({ data: null }));
  const prev = (row && row.value) || { config: {}, version: 0, history: [] };
  const oldCfg = deepMerge(DEFAULTS, prev.config || {});
  const newStored = deepMerge(prev.config || {}, clean);
  const version = (prev.version || 0) + 1;
  // keep last 20 versions inline for rollback
  const history = [{ version: prev.version || 0, config: prev.config || {}, at: new Date().toISOString(), by: actorId }, ...(prev.history || [])].slice(0, 20);
  await admin().from('app_settings').upsert({ key: 'site_config', value: { config: newStored, version, history, updated_at: new Date().toISOString(), updated_by: actorId } });
  for (const k of Object.keys(clean)) {
    await admin().from('audit_log').insert({
      actor: actorId, event: 'SETTING_CHANGED',
      detail: (k + ' v' + version + ' old=' + JSON.stringify(oldCfg[k]).slice(0, 180) + ' new=' + JSON.stringify(deepMerge(oldCfg[k], clean[k])).slice(0, 180)).slice(0, 480)
    }).then(() => {}, () => {});
  }
  _cache = null;
  return { version };
}

async function rollback(toVersion, actorId) {
  const { data: row } = await admin().from('app_settings').select('value').eq('key', 'site_config').single();
  const cur = (row && row.value) || {};
  const target = (cur.history || []).find(h => h.version === Number(toVersion));
  if (!target) throw new Error('Version ' + toVersion + ' not in history');
  const version = (cur.version || 0) + 1;
  const history = [{ version: cur.version || 0, config: cur.config || {}, at: new Date().toISOString(), by: actorId }, ...(cur.history || [])].slice(0, 20);
  await admin().from('app_settings').upsert({ key: 'site_config', value: { config: target.config, version, history, updated_at: new Date().toISOString(), updated_by: actorId } });
  await admin().from('audit_log').insert({ actor: actorId, event: 'SETTING_ROLLBACK', detail: 'rolled back to v' + toVersion + ' as v' + version }).then(() => {}, () => {});
  _cache = null;
  return { version };
}

module.exports = { getConfig, saveConfig, rollback, publicView, DEFAULTS };
