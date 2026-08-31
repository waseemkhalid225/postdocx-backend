// lib/settings.js - Phase 1: central configuration architecture.
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
  features: { payments: true, opportunity_search: true, reviews: false, discovery_enabled: true, prepare_enabled: true, signup_enabled: true },
  background_video_url: '',
  contact: { email: 'admin@foriforeign.com', whatsapp: '0345 5216903' },
  apply_assistant: { enabled: true, apply_button: true, providers: { gmail: true, outlook: true }, fallback: 'download', store_urls: { chrome: '', edge: '', firefox: '' } },
  limits: { max_upload_mb: 10, max_files_per_upload: 6, search_cooldown_minutes: 0 },   // 0 = no waiting; a mistaken search must never lock a user out
  announcement: { enabled: false, text: '' },
  maintenance: { enabled: false, message: 'We are improving ForiForeign. Please check back shortly.' },
  stats: { users_helped: '', applications_prepared: '', note: 'Admin-entered figures. Leave blank to hide.' },
  ai: { usd_to_pkr: 278, pkr_override_per_case: '' },
  content: { privacy: 'Your privacy is the foundation of ForiForeign.\n\nWHAT WE STORE: only what you give us to prepare applications, your profile, CV and the documents you upload. They are encrypted in transit and stored on secured infrastructure (Supabase), used for one purpose only, preparing YOUR applications.\n\nWHAT WE NEVER TOUCH: your email password, your inbox, your contacts. Applications open in your own email and YOU press Send. Confidential items needed after admission, bank statements, passport, visa papers, are sent by you directly to the institution. ForiForeign never stores or processes them.\n\nACCESS CONTROL: staff access is role-based and limited to what support requires. No one browses your documents. Every sensitive action is logged.\n\nYOUR CONTROL: you can view, replace or delete your documents any time, and request full account deletion from Support.\n\nWe do not sell or share your data with anyone.', help: 'How ForiForeign works, in 4 steps:\n\n1. UPLOAD YOUR CV. One file is enough, we read it and build your profile automatically.\n2. WE FIND VERIFIED MATCHES. Our research team searches official university and employer pages only, checks eligibility, deadlines and funding, and shows the source link on every opportunity.\n3. WE PREPARE YOUR FULL CASE. Tailored CV, cover letter, a personalized email to the verified contact, and the exact document list the opportunity requires.\n4. YOU APPLY FROM YOUR OWN EMAIL. One click opens your Gmail or Outlook with everything attached. You review, you press Send, you stay in control.\n\nBuilt in Pakistan by a PhD student, for students and young professionals aiming for Europe, the Gulf and the best destinations worldwide.', refund: 'THE FAIREST DEAL WE COULD BUILD.\n\nYour CV ANALYSIS IS COMPLETELY FREE: upload your CV and see your match scores, countries and funding picture before paying anything.\n\nEvery stated requirement of an opportunity is shown to you and confirmed by you BEFORE a credit is used; if the official page later shows a requirement we did not list at that moment, that credit is returned.\n\nA case costs just __PRICE__, this is not a consultancy fee, it only covers site maintenance and the research computing behind your case. Compare that with Rs 50,000+ consultants charge for less: we keep it almost free because ForiForeign was built by a Pakistani student FOR students and young job seekers.\n\nREFUNDS: unused case credits are refundable within 14 days, no questions. Credits already spent on delivered work (a completed search or prepared case) are not refundable, the work has been done and you keep every document.\n\nWHAT WE NEVER CHARGE FOR: admission, scholarship or visa outcomes. No honest service can guarantee those, and we never will. What we guarantee is the work: official-source verification and complete, tailored preparation.\n\nRefund requests: message Support, returned via your original payment method within 7 working days.' },
  reviews: [],
  // Admin-editable packages: each tier's credits (cases the user can apply to) and how many
  // matches are shown. Changing these in admin deploys instantly to the whole app via cache.
  // Admin-editable FAQs shown in Ask us. Empty array = use the app's built-in defaults.
  faqs: [],
  // Referral rewards: N qualified referrals earn free Solo credits, each valid M months.
  // qualify_on: 'cv_uploaded' (default), 'signup', or 'first_purchase'.
  referral: { per_milestone: 5, credits_per_milestone: 1, expiry_months: 6, qualify_on: 'cv_uploaded' },
  /* Fair-use ceiling on AI spend per account per month. Searching is limited daily
     in normal use; this only stops runaway or abusive usage. Staff are exempt.
     soft_usd: warn the user gently. hard_usd: pause discovery until next month or until
     they activate a package. paid_multiplier: paying customers get proportionally more. */
  /* Fair use on AI spend. Limits are per CALENDAR MONTH (resetting on the 1st) with a
     separate DAILY cap so nobody can exhaust a month in one sitting.
     Roughly $0.10 per search, so 0.60 = about 6 free searches a month, 0.25 = 2-3 a day.
     Paying customers get paid_multiplier times these figures. Staff are exempt. */
  /* Fair use on AI spend, per CALENDAR MONTH (resets on the 1st) with a separate DAILY
     cap. About $0.10 per search, so: free 2/day and 5/month; paid 5/day and 20/month.
     The search-only package raises this to its own allowance. Staff are exempt. */
  /* Search limits, counted as SEARCHES rather than dollars so they are understandable to
     both the user and the operator. Per calendar day and per calendar month.
     Buying any package resets the counters to zero, so a purchase always feels like a
     fresh start. Staff are exempt. */
  /* Search limit: a simple daily allowance that refills at midnight in the user's own
     timezone. No monthly cap, because a wait of hours is fair while a wait of weeks is
     not. Buying any package resets the day immediately. Staff are exempt. */
  fair_use: { enabled: true, daily_searches: 3, pass_daily_searches: 6, notify_admin: true },
  // Model names, editable without a deploy when a provider renames or retires a model.
  models: { gemini_primary: '', gemini_fallback: '', gemini_extra: '' },
  // Admin-editable notification wording. {name} {n} {credits} are substituted.
  notify: {
    payment_confirmed: 'ForiForeign: your payment is verified and {credits} case credit(s) are now active. Open your dashboard to pick your best match. foriforeign.com',
    results_ready: 'ForiForeign: your matches are ready! {n} verified opportunities are waiting on your dashboard. foriforeign.com'
  },
  packages: {
    tiers: [
      { key: 'solo', name: 'Solo', credits: 1, view: 2, pkr: 2000, feats: ['See your best-matched opportunities', 'Prepare and apply, fully done for you', 'Tailored CV, cover letter and application from official pages'] },
      { key: 'smart', name: 'Smart', credits: 5, view: 8, pkr: 8000, featured: true, feats: ['See your best-matched opportunities', 'Every document tailored to each position', 'Your strongest, highest-scoring matches first'] },
      { key: 'premium', name: 'Premium', credits: 10, view: 15, pkr: 15000, feats: ['Re-search with new filters anytime for 6 months', 'Priority preparation of every case', 'Nothing repeated, always fresh matches'] },
      /* Search-only pass: more searches per day for a month, no case preparation. */
      { key: 'search', name: 'Search Pass', credits: 0, view: 15, pkr: 5000, search_only: true, days: 30, daily_searches: 6,
        feats: ['6 searches a day for 30 days', 'See your 15 best matches every time',
                'Full analysis and scoring on every search', 'Case preparation is bought separately when you are ready'] }
    ]
  },
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
    background_video_url: cfg.background_video_url || '',
    contact: cfg.contact || { email: 'admin@foriforeign.com', whatsapp: '0345 5216903' },
    apply_assistant: { enabled: (cfg.apply_assistant||{}).enabled !== false, apply_button: (cfg.apply_assistant||{}).apply_button !== false, providers: (cfg.apply_assistant||{}).providers || {}, store_urls: (cfg.apply_assistant||{}).store_urls || {} },
    packages: cfg.packages || { tiers: [] },
    faqs: cfg.faqs || [],
    referral: cfg.referral || {},
    fair_use: { enabled: (cfg.fair_use||{}).enabled !== false },
    notify: cfg.notify || {}
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

function cache() { return _cache || DEFAULTS; }
module.exports = { getConfig, saveConfig, rollback, publicView, DEFAULTS, cache };
