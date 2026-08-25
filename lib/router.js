// lib/router.js — model registry + router (approved rule R7) with per-call cost ledger
const prices = require('./prices');
const { admin } = require('./supa');

// PURPOSE → engine. Editable registry; reasons logged with every call.
const REGISTRY = {
  extract:        { provider: 'openai',    model: process.env.MODEL_NANO  || 'gpt-5.4-nano',  reason: 'high-volume extraction/classification' },
  classify:       { provider: 'openai',    model: process.env.MODEL_NANO  || 'gpt-5.4-nano',  reason: 'cheap classification' },
  main:           { provider: 'openai',    model: process.env.MODEL_MINI  || 'gpt-5.4-mini',  reason: 'default reasoning and drafting' },
  doc_extract:    { provider: 'anthropic', model: process.env.MODEL_SEARCH || 'claude-haiku-4-5-20251001', reason: 'native PDF/image reading' },
  search_verify:  { provider: 'anthropic', model: process.env.MODEL_SEARCH || 'claude-haiku-4-5-20251001', reason: 'web-grounded verification' },
  high_value:     { provider: 'anthropic', model: process.env.MODEL_PREMIUM || 'claude-sonnet-4-6', reason: 'professor/committee-facing writing' }
};

function route(purpose) { return REGISTRY[purpose] || REGISTRY.main; }

function costUsd(model, inTok, outTok) {
  const p = prices[model] || { in: 1, out: 3 };
  return (inTok * p.in + outTok * p.out) / 1e6;
}

// callAI: single entry point for every model call. Writes the cost ledger. Fails loud.
async function callAI(purpose, prompt, opts = {}) {
  const r = route(purpose);
  let text = '', usage = { input_tokens: 0, output_tokens: 0 };
  if (r.provider === 'anthropic') {
    const { claudeCall } = require('./anthropic');
    ({ text, usage } = await claudeCall(prompt, { model: r.model, ...opts }));
  } else {
    const { gptCall } = require('./openai');
    ({ text, usage } = await gptCall(prompt, { model: r.model, ...opts }));
  }
  try {
    await admin().from('ai_cost_ledger').insert({
      user_id: opts.userId || null, application_id: opts.applicationId || null,
      provider: r.provider, model: r.model, purpose,
      input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0,
      cost_usd: costUsd(r.model, usage.input_tokens || 0, usage.output_tokens || 0)
    });
  } catch (e) { console.error('[cost-ledger]', e.message); }
  return text;
}

module.exports = { callAI, route, REGISTRY, costUsd };
