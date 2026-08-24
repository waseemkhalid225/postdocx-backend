// lib/anthropic.js — minimal Claude caller returning text + token usage
async function claudeCall(prompt, { model, maxTokens = 1200, search = false, searchUses = 3 } = {}) {
  const body = {
    model, max_tokens: maxTokens,
    messages: [{ role: 'user', content: typeof prompt === 'string' ? prompt : prompt }]
  };
  if (search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: searchUses }];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  const d = await res.json();
  if (!res.ok) throw new Error('Anthropic API ' + res.status + ': ' + JSON.stringify(d).slice(0, 300));
  const text = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  return { text, usage: { input_tokens: (d.usage || {}).input_tokens || 0, output_tokens: (d.usage || {}).output_tokens || 0 } };
}
module.exports = { claudeCall };
