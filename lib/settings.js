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
  // (single source: the merged contact block lives below, keep it in one place)
  /* Phase 2 · agency plans and commission policy. Priced per organisation, never per seat.
     Owner's defaults; editable from Admin → Settings and live immediately. */
  agency: {
    /* Agency plans: applications (prepared cases) per month, searches per day and per month for the whole organisation,
       seats and sub-agents. Quota can be allocated down to branches, sub-branches and members (Workspace → Team → Quota).
       Priced for consultancies in Pakistan, India and Bangladesh: per case far below what they charge a client, while the
       platform keeps a healthy margin at the unit costs in Admin → Economics. Annual = 10 months. */
    tiers: [
      { key: 'starter', name: 'Starter 100', usd_month: 149, usd_year: 1490, cases_month: 100, searches_day: 100, searches_month: 2000, seats: 5, sub_agents: 5, branches: 3, white_label: false, api: false },
      { key: 'growth', name: 'Growth 500', usd_month: 599, usd_year: 5990, cases_month: 500, searches_day: 400, searches_month: 8000, seats: 20, sub_agents: 30, branches: 15, white_label: true, api: true, featured: true },
      { key: 'scale', name: 'Scale 1000', usd_month: 999, usd_year: 9990, cases_month: 1000, searches_day: 800, searches_month: 16000, seats: 999, sub_agents: 999, branches: 999, white_label: true, api: true }
    ],
    overage_usd_per_case: 2.5,
    commission_pct_agency: 20,       // share of a package sold through the agency's clients
    commission_pct_sub_agent: 10,    // share paid onward to the sub-agent who owns the client
    referral_pct_partner: 10
  },
  /* Currency of record is USD everywhere. Local currency is shown as an approximation from
     the live rate; card payments are charged in USD by the gateway. */
  pricing: { currency: 'USD', show_local: true },   // USD is the price; a local estimate at today's rate is shown beside it, marked indicative
  /* Add-on packs (USD, one-time unless noted): the stages where the platform charges after the application package. */
  prospecting: { auto: false, daily_cap: 40, trial_days: 15, signer: 'Dr Waseem Khalid, Director, Partnerships', targets: [{ kind: 'university', country_code: 'GB' }, { kind: 'agency', country_code: 'PK', city: 'Lahore' }, { kind: 'agency', country_code: 'IN', city: 'Delhi' }] },
  mail_policy: { allow_personal_forward: false, members_require_platform_address: false },   // staff join with their own organisation email; applicants' applications use the platform mailbox
  /* Cost intelligence inputs (Admin → Costs): fixed monthly costs, gateway, target and floor margins, utilisation. */
  costs: { fixed_monthly_usd: { railway: 20, supabase: 25, resend: 20, domains: 3, whatsapp: 0, redis: 0, other: 0 }, gateway: { pct: 5, fixed: 0.5 }, target_margin_pct: 40, floor_margin_pct: 25, agency_utilisation_pct: 60, model_prices: {} },
  /* Partner system autopilot: auto=true runs the pipeline daily for one destination at a time; priority for MOU partners is always on. */
  partners: { auto: false, daily_cap: 5, priority_label: 'Partner' },
  addons: { offer_pack_usd: 15, visa_desk_usd: 29, arrival_pack_usd: 19, residence_year_usd: 79, interview_extra_usd: 5, employer_per_hire_usd: 199, labour_starter_usd: 9 },   // Residence $79/year is the retention product; labour starter $9 for one case
  /* Issuing entity for invoices and receipts (Pakistan): company name, NTN, address; PSEB registration when you have it. */
  legal: { company_name: 'ForiForeign (Private) Limited', ntn: '', address: 'Islamabad, Pakistan', pseb_reg: '', sales_tax_reg: '' },   // ForiForeign is its own company; fill NTN/SECP once registered
  payment: {
    bank_name: '', account_title: 'Waseem Khalid Malik', account_number: '', iban: '',
    jazzcash_number: '', easypaisa_number: '03455216903',
    instructions: 'Transfer the amount to the account below, then submit your transaction reference. Your credits appear after our team confirms the transfer.'
  },
  social: { facebook: '', instagram: '', linkedin: '', youtube: '', tiktok: '', google_business: '', website: '' },
  features: { payments: true, opportunity_search: true, reviews: false, discovery_enabled: true, prepare_enabled: true, signup_enabled: true },
  background_video_url: '',
  contact: { email: 'admin@foriforeign.com', phone: '', whatsapp: '0345 5216903', address: '', hours: '' },
  apply_assistant: { enabled: true, apply_button: true, providers: { gmail: true, outlook: true }, fallback: 'download', store_urls: { chrome: '', edge: '', firefox: '' } },
  limits: { max_upload_mb: 10, max_files_per_upload: 6 },   // no waiting between searches, ever
  announcement: { enabled: false, text: '' },
  maintenance: { enabled: false, message: 'We are improving ForiForeign. Please check back shortly.' },
  stats: { users_helped: '', applications_prepared: '', note: 'Admin-entered figures. Leave blank to hide.' },
  ai: { usd_to_pkr: 278, pkr_override_per_case: '' },
  content: { privacy: 'Your privacy is the foundation of ForiForeign.\n\nWHAT WE STORE: only what you give us to prepare applications, your profile, CV and the documents you upload. They are encrypted in transit and stored on secured infrastructure (Supabase), used for one purpose only, preparing YOUR applications.\n\nWHAT WE NEVER TOUCH: your email password, your inbox, your contacts. Applications open in your own email and YOU press Send. Confidential items needed after admission, bank statements, passport, visa papers, are sent by you directly to the institution. ForiForeign never stores or processes them.\n\nACCESS CONTROL: staff access is role-based and limited to what support requires. No one browses your documents. Every sensitive action is logged.\n\nYOUR CONTROL: you can view, replace or delete your documents any time, and request full account deletion from Support.\n\nWe do not sell or share your data with anyone.', help: 'How ForiForeign works, in 4 steps:\n\n1. UPLOAD YOUR CV. One file is enough, we read it and build your profile automatically.\n2. WE FIND VERIFIED MATCHES. Our research team searches official university and employer pages only, checks eligibility, deadlines and funding, and shows the source link on every opportunity.\n3. WE PREPARE YOUR FULL CASE. A complete set of customized documents written for that exact position, a personalized message to the verified contact, and the exact document list the opportunity requires.\n4. YOU APPLY FROM YOUR OWN EMAIL. One click opens your Gmail or Outlook with everything attached. You review, you press Send, you stay in control.\n\nBuilt in Pakistan by a PhD student, for students and young professionals aiming for Europe, the Gulf and the best destinations worldwide.', refund: 'THE FAIREST DEAL WE COULD BUILD.\n\nYour CV ANALYSIS IS COMPLETELY FREE: upload your CV and see your match scores, countries and funding picture before paying anything.\n\nEvery stated requirement of an opportunity is shown to you and confirmed by you BEFORE a credit is used; if the official page later shows a requirement we did not list at that moment, that credit is returned.\n\nA case costs just __PRICE__, this is not a consultancy fee, it only covers site maintenance and the research computing behind your case. Compare that with Rs 50,000+ consultants charge for less: we keep it almost free because ForiForeign was built by a Pakistani student FOR students and young job seekers.\n\nREFUNDS: unused case credits are refundable within 14 days, no questions. Credits already spent on delivered work (a completed search or prepared case) are not refundable, the work has been done and you keep every document.\n\nWHAT WE NEVER CHARGE FOR: admission, scholarship or visa outcomes. No honest service can guarantee those, and we never will. What we guarantee is the work: official-source verification and complete, customized preparation.\n\nRefund requests: message Support, returned via your original payment method within 7 working days.' },
  reviews: [],
  // Admin-editable packages: each tier's credits (cases the user can apply to) and how many
  // matches are shown. Changing these in admin deploys instantly to the whole app via cache.
  // Admin-editable FAQs shown in Ask us. Empty array = use the app's built-in defaults.
  faqs: [],
  // Referral rewards: N qualified referrals earn free case credits, each valid M months.
  // qualify_on: 'cv_uploaded' (default), 'signup', or 'first_purchase'.
  referral: { per_milestone: 5, credits_per_milestone: 1, expiry_months: 6, qualify_on: 'cv_uploaded' },
  /* SEARCHING. Three a day for everyone, five a day once a package has been bought,
     with no waiting between searches. Buying a package also clears whatever has already
     been used, that same day or any earlier day, so the five start clean. Nothing is
     sold that raises the ceiling further. Staff are exempt. */
  fair_use: { enabled: true, daily_searches: 3, paid_daily_searches: 5, notify_admin: true },
  // Model names, editable without a deploy when a provider renames or retires a model.
  models: { gemini_primary: '', gemini_fallback: '', gemini_extra: '' },
  // Admin-editable notification wording. {name} {n} {credits} are substituted.
  notify: {
    payment_confirmed: 'ForiForeign: your payment is verified and {credits} case credit(s) are now active. Open your dashboard to pick your best match. foriforeign.com',
    results_ready: 'ForiForeign: your matches are ready! {n} verified opportunities are waiting on your dashboard. foriforeign.com'
  },
  packages: {
    tiers: [
      /* view = how many matched positions open for the buyer to read and compare.
         credits = how many of those they may actually apply to. Choice is the product,
         so view is always larger than credits. Admin can change both. */
      { key: 'basic', name: 'Basic', credits: 2, view: 5, usd: 25, promo_usd: 19, pkr: 5000, feats: ['See your 5 best-matched opportunities', 'Choose and apply to any 2 of them', 'Customized documents prepared for each position, from official pages'] },
      { key: 'smart', name: 'Smart', credits: 5, view: 8, usd: 69, promo_usd: 49, pkr: 15000, featured: true, visa_desk_included: 2, feats: ['Visa desk included for two files', 'See your 8 best-matched opportunities', 'Choose and apply to any 5 of them', 'Customized documents prepared for each position you choose'] },
      { key: 'premium', name: 'Premium', credits: 10, view: 20, usd: 119, promo_usd: 79, pkr: 30000, feats: ['See your 20 best-matched opportunities', 'Choose and apply to any 10 of them', 'Re-search with new filters anytime for 6 months', 'Priority preparation of every case'] },
    ]
  },
  /* Retired. Which documents a case includes is decided by the opportunity's own stated
     requirements, never by a setting. Capping it here silently dropped the motivation
     letter and research note that some positions explicitly ask for. Kept as an empty
     key only so older stored configs still load without complaint. */
  case_plan: {},
  country_updates: []                     // admin-entered updates: [{title, text, date}]
};

// Public subset safe for any visitor (no secrets, no internal limits beyond UX needs).
function publicView(cfg) {
  return {
    brand: cfg.brand, social: cfg.social, payment: cfg.payment,
    features: cfg.features, announcement: cfg.announcement,
    maintenance: { enabled: cfg.maintenance.enabled, message: cfg.maintenance.message },
    stats: cfg.stats, content: cfg.content,
    reviews: (cfg.reviews || []).filter(r => r && r.visible !== false),
    country_updates: (cfg.country_updates || []).slice(0, 10),
    background_video_url: cfg.background_video_url || '',
    contact: cfg.contact || { email: 'admin@foriforeign.com', whatsapp: '0345 5216903' },
    apply_assistant: { enabled: (cfg.apply_assistant||{}).enabled !== false, apply_button: (cfg.apply_assistant||{}).apply_button !== false, providers: (cfg.apply_assistant||{}).providers || {}, store_urls: (cfg.apply_assistant||{}).store_urls || {} },
    packages: cfg.packages || { tiers: [] },
    pricing: cfg.pricing || { currency: 'USD', show_local: true },
    gateway: { card: !!(process.env.STRIPE_SECRET_KEY || (process.env.LEMON_API_KEY && process.env.LEMON_STORE_ID)), provider: process.env.STRIPE_SECRET_KEY ? 'stripe' : ((process.env.LEMON_API_KEY && process.env.LEMON_STORE_ID) ? 'lemonsqueezy' : null), pk_local: !!(process.env.SAFEPAY_API_KEY && process.env.SAFEPAY_SECRET) },
    agency: cfg.agency || { tiers: [] },
    faqs: cfg.faqs || [],
    referral: cfg.referral || {},
    /* The daily allowance is user-facing copy, not a secret: the app quotes it in the
       last-chance warning and on the package cards, so it must reach the client. */
    fair_use: { enabled: (cfg.fair_use||{}).enabled !== false,
      daily_searches: Number((cfg.fair_use||{}).daily_searches) || 3,
      paid_daily_searches: Number((cfg.fair_use||{}).paid_daily_searches) || 5 },
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
let _refreshing = null;
async function getConfig(fresh) {
  if (!fresh && _cache && Date.now() - _cacheAt < 30000) return _cache;
  /* STALE-WHILE-REVALIDATE. The config is read by middleware on every API request. When
     the 30-second cache expired, whichever request arrived next paid the full database
     round trip inline before it could be answered - a random user's button went slow
     once every half minute for no reason they could see. The stale copy is served at
     once and the refresh runs behind it. */
  if (!fresh && _cache) {
    if (!_refreshing) _refreshing = (async () => { try { await getConfig(true); } finally { _refreshing = null; } })();
    return _cache;
  }
  let stored = {};
  try {
    const { data } = await admin().from('app_settings').select('value').eq('key', 'site_config').single();
    stored = (data && data.value && data.value.config) || {};
  } catch (e) {}
  _cache = deepMerge(DEFAULTS, stored); _cacheAt = Date.now();
  /* Payment details: an empty saved field never blanks a shipped default, so the
     checkout can never show no account at all. Anything the admin types wins. */
  try { for (const k of Object.keys(DEFAULTS.payment)) if (!String(_cache.payment[k] || '').trim()) _cache.payment[k] = DEFAULTS.payment[k]; } catch (e) {}
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
