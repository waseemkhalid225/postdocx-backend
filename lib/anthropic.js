/* Anthropic Claude caller: premium writing and normalization lane.
   Used ONLY where reasoning/writing quality materially improves the result;
   every call is guarded by a Gemini fallback in the router, so a missing key
   or an outage can never break a workflow. */
const AMODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

async function anthropicCall(prompt, opts = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const model = opts.model || AMODEL();
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), opts.timeoutMs || 100000);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: opts.maxTokens || 3000,
          system: opts.system || undefined,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: ctl.signal
      });
      clearTimeout(tm);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        lastErr = new Error('Anthropic ' + r.status + ': ' + String(d && d.error && d.error.message || '').slice(0, 200));
        if (r.status >= 500 || r.status === 429) { await new Promise(z => setTimeout(z, 3000 * (attempt + 1))); continue; }
        throw lastErr;
      }
      const text = (d.content || []).map(b => b.text || '').join('');
      const u = d.usage || {};
      return { text, model, usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0 } };
    } catch (e) {
      clearTimeout(tm);
      lastErr = e.name === 'AbortError' ? new Error('Anthropic timeout') : e;
      if (attempt === 0) { await new Promise(z => setTimeout(z, 2500)); continue; }
    }
  }
  throw lastErr || new Error('Anthropic call failed');
}

module.exports = { anthropicCall, AMODEL };
