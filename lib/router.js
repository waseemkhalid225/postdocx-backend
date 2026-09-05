// lib/router.js — single-model AI router (Gemini 3.7 Flash) with per-call cost ledger.
// One model, different thinking levels per purpose (spec #18): low for simple/bulk,
// medium default, high only where quality genuinely justifies the tokens.
const prices = require('./prices');
const { admin } = require('./supa');
const { geminiCall, MODEL } = require('./gemini');

// PURPOSE → thinking level + reason. Editable registry; reasons logged with every call.
const REGISTRY = {
  extract:       { thinking: 'low',    reason: 'high-volume extraction/classification' },
  classify:      { thinking: 'low',    reason: 'cheap classification' },
  main:          { thinking: 'medium', reason: 'default reasoning and drafting' },
  doc_extract:   { thinking: 'medium', reason: 'PDF/image document reading' },
  search_verify: { thinking: 'low',    reason: 'web-grounded extraction; low thinking keeps the full output budget for RESULTS (medium was truncating arrays)' },
  high_value:    { thinking: 'high',   reason: 'professor/committee-facing writing and hard matching' },
  /* Premium Claude lane: quality-critical writing and validation ONLY.
     High-volume search/extraction stays on Flash to control cost. */
  case_writing:      { provider: 'anthropic', thinking: 'high',   reason: 'case documents: SOP, cover letters, research proposals, application emails' },
  profile_normalize: { provider: 'anthropic', thinking: 'medium', reason: 'final deep profile normalization and cross-document fact validation' },
  enrich_deep:       { provider: 'anthropic', thinking: 'medium', reason: 'applicant-specific university analysis (on demand only)' }
};

/* Admin-configurable model routing: app_settings key 'ai_models' can override
   {purpose: {provider, model}} live, no code change, cached 60s. */
let _ovCache = { at: 0, v: {} };
async function modelOverrides() {
  if (Date.now() - _ovCache.at < 60000) return _ovCache.v;
  try {
    const { data } = await admin().from('app_settings').select('value').eq('key', 'ai_models').single();
    _ovCache = { at: Date.now(), v: (data && data.value) || {} };
  } catch (e) { _ovCache = { at: Date.now(), v: {} }; }
  return _ovCache.v;
}

function route(purpose) { return REGISTRY[purpose] || REGISTRY.main; }

function costUsd(model, inTok, outTok) {
  const p = prices[model] || { in: 1, out: 4 };
  return (inTok * p.in + outTok * p.out) / 1e6;
}

// callAI: single entry point for every model call. Writes the cost ledger. Fails loud.
// opts: maxTokens, search, urls, json, userId, applicationId, thinking (override)
/* Plain GPT writer: the direct backup for the Claude premium lane. */
async function openaiPlain(purpose, prompt, opts = {}) {
  const bm = process.env.OPENAI_BACKUP_MODEL || 'gpt-5.4-mini';
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 90000);
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({ model: bm, input: prompt, max_output_tokens: opts.maxTokens || 3000 }), signal: ctl.signal });
  clearTimeout(tm);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + String(d && d.error && d.error.message || '').slice(0, 160));
  const t2 = (d.output || []).flatMap(o => (o.content || [])).map(c => c.text || '').join('') || d.output_text || '';
  if (!t2) throw new Error('OpenAI empty response');
  try { await admin().from('ai_cost_ledger').insert({ user_id: opts.userId || null, application_id: opts.applicationId || null, provider: 'openai', model: bm, purpose, input_tokens: (d.usage || {}).input_tokens || 0, output_tokens: (d.usage || {}).output_tokens || 0 }); } catch (e) {}
  return t2;
}
async function callAI(purpose, prompt, opts = {}) {
  /* TEST-ONLY: a canned model answer, so extraction and writers can be exercised end to end without a provider. Never in production. */
  if (process.env.FF_FAKE_AI_FILE && process.env.NODE_ENV !== 'production') { try { return require('fs').readFileSync(process.env.FF_FAKE_AI_FILE, 'utf8'); } catch (e) {} }
  // House style for every writer: one voice, right length, no AI marks, never invented facts (lib/style.js).
  if (purpose === 'case_writing') { try { const { houseStyle } = require('./style'); prompt = houseStyle({ kind: opts.kind || guessKind(prompt), cc: opts.cc || guessCc(prompt) }) + '\n\n' + prompt; } catch (e) {} }
  const base = route(purpose);
  const ov = await modelOverrides();
  const r = Object.assign({}, base, ov && ov[purpose]);
  // Premium lane: Claude for quality-critical writing; grounded/search calls and
  // any Claude failure fall through to the untouched Gemini path below.
  if (r.provider === 'anthropic' && process.env.ANTHROPIC_API_KEY && !opts.search && !opts.urls) {
    try {
      const { anthropicCall } = require('./anthropic');
      const a = await anthropicCall(prompt, { maxTokens: opts.maxTokens || 3000, model: r.model });
      try {
        await admin().from('ai_cost_ledger').insert({
          user_id: opts.userId || null, application_id: opts.applicationId || null,
          provider: 'anthropic', model: a.model, purpose,
          input_tokens: a.usage.input_tokens, output_tokens: a.usage.output_tokens,
          est_cost_usd: (a.usage.input_tokens * 3 + a.usage.output_tokens * 15) / 1e6
        });
      } catch (e) {}
      return a.text;
    } catch (e) {
      try { require('./oblog').errlog('anthropic:' + purpose, e); } catch (e2) {}
      // Owner's rule: Sonnet's backup is GPT, directly. Flash never writes premium documents.
      if (process.env.OPENAI_API_KEY) {
        try { return await openaiPlain(purpose, prompt, opts); } catch (e3) { try { require('./oblog').errlog('openai:' + purpose, e3); } catch (e4) {} }
      }
      throw e; // both premium writers down; callers keep their own guaranteed-document fallback
    }
  }
  const model = MODEL();
  let text, usage;
  try {
    ({ text, usage } = await geminiCall(prompt, {
    maxTokens: opts.maxTokens,
    thinking: opts.thinking || r.thinking,
    search: !!opts.search,
    urls: !!opts.urls,
    json: !!opts.json
    }));
  } catch (gemErr) {
    // Safety net for Gemini writing lanes: plain (non-search) calls fall to GPT.
    if (!opts.search && !opts.urls && process.env.OPENAI_API_KEY) {
      try { return await openaiPlain(purpose, prompt, opts); } catch (e) {}
    }
    throw gemErr;
  }
  try {
    await admin().from('ai_cost_ledger').insert({
      user_id: opts.userId || null, application_id: opts.applicationId || null,
      provider: 'google', model, purpose,
      input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0,
      cost_usd: costUsd(model, usage.input_tokens || 0, usage.output_tokens || 0)
    });
  } catch (e) { console.error('[cost-ledger]', e.message); }
  return text;
}

function guessKind(p) { const t = String(p || '').slice(0, 400).toLowerCase(); if (/cover letter/.test(t)) return 'cover_letter'; if (/statement of purpose|\bsop\b/.test(t)) return 'sop'; if (/research statement/.test(t)) return 'research_statement'; if (/personal statement/.test(t)) return 'personal_statement'; if (/motivation letter/.test(t)) return 'motivation_letter'; if (/memorandum|\bmou\b/.test(t)) return 'mou'; if (/proposal letter|partnership proposal/.test(t)) return 'proposal'; if (/reply|respond/.test(t)) return 'reply'; if (/email/.test(t)) return 'email'; return ''; }
function guessCc(p) { const m = String(p || '').match(/\((?:country|cc)?:?\s*([A-Z]{2})\)|\bcountry\s*[:=]\s*"?([A-Z]{2})\b|\(([A-Z]{2})\)/); return m ? (m[1] || m[2] || m[3]) : ''; }
module.exports = { callAI, route, REGISTRY, costUsd };
