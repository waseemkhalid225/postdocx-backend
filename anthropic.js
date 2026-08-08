// lib/anthropic.js — Claude reasoning layer (with live web search)
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

async function claude(prompt, { system, search = true, maxTokens = 2500 } = {}) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  };
  if (system) body.system = system;
  if (search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, attempt * 4000));
      continue;
    }
    if (!res.ok) throw new Error('Anthropic API ' + res.status + ': ' + (await res.text()).slice(0, 200));
    const data = await res.json();
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

module.exports = { claude, parseJSON };
