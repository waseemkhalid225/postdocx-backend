// lib/anthropic.js — Claude reasoning layer (with live web search)
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
// Running usage tally, read and reset by the cycle for the daily report
const tally = { input: 0, output: 0, calls: 0 };
function getUsage(reset) {
  const t = { ...tally };
  if (reset) { tally.input = 0; tally.output = 0; tally.calls = 0; }
  return t;
}
// Premium model for high-stakes writing (proposals, interview briefings, dossiers, weekly review)
const PREMIUM = process.env.PREMIUM_MODEL || MODEL;

async function claude(prompt, { system, search = true, maxTokens = 2500, premium = false, searchUses = 5 } = {}) {
  // prompt may be a plain string or an array of content blocks (text / document / image)
  const body = {
    model: premium ? PREMIUM : MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  };
  if (system) body.system = system;
  if (search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: searchUses }];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 100000); // no single call may stall the cycle
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 3) throw new Error('Anthropic API timeout');
      continue;
    }
    clearTimeout(timer);
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, attempt * 4000));
      continue;
    }
    if (!res.ok) throw new Error('Anthropic API ' + res.status + ': ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    if (data.usage) { tally.input += data.usage.input_tokens || 0; tally.output += data.usage.output_tokens || 0; tally.calls++; }
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  }
  throw new Error('Anthropic API unavailable after retries');
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  const a = clean.indexOf('['), o = clean.indexOf('{');
  let start, end;
  if (a > -1 && (o === -1 || a < o)) { start = a; end = clean.lastIndexOf(']'); }
  else { start = o; end = clean.lastIndexOf('}'); }
  if (start === -1 || end === -1) throw new Error('No JSON found in model output');
  return JSON.parse(clean.slice(start, end + 1));
}

// AI ROUTER: which model is best for each task type. The engine already calls the
// right model at each site; this documents and centralizes the policy.
// - Web-grounded work (discovery, verification, supervisor study, news): Claude (has web search).
// - High-stakes writing a professor reads (outreach, concept notes): Claude premium (Opus).
// - Cover letters and independent review: GPT (via lib/openai). Falls back to Claude if no OpenAI key.
const ROUTER = {
  discover: 'claude', verify: 'claude', supervisor: 'claude', news: 'claude', labmap: 'claude-premium',
  outreach: 'claude-premium', concept: 'claude-premium', tailorCV: 'claude-premium',
  coverLetter: 'gpt', review: 'gpt'
};
function routeModel(task) { return ROUTER[task] || 'claude'; }
module.exports = { claude, parseJSON, getUsage, routeModel, ROUTER };
