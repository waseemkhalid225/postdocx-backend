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
  search_verify: { thinking: 'medium', reason: 'web-grounded verification (Search + URL context)' },
  high_value:    { thinking: 'high',   reason: 'professor/committee-facing writing and hard matching' }
};

function route(purpose) { return REGISTRY[purpose] || REGISTRY.main; }

function costUsd(model, inTok, outTok) {
  const p = prices[model] || { in: 1, out: 4 };
  return (inTok * p.in + outTok * p.out) / 1e6;
}

// callAI: single entry point for every model call. Writes the cost ledger. Fails loud.
// opts: maxTokens, search, urls, json, userId, applicationId, thinking (override)
async function callAI(purpose, prompt, opts = {}) {
  const r = route(purpose);
  const model = MODEL();
  const { text, usage } = await geminiCall(prompt, {
    maxTokens: opts.maxTokens,
    thinking: opts.thinking || r.thinking,
    search: !!opts.search,
    urls: !!opts.urls,
    json: !!opts.json
  });
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

module.exports = { callAI, route, REGISTRY, costUsd };
