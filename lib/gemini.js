// lib/gemini.js — single AI provider for ForiForeign: Google Gemini 3.7 Flash.
// Current Gemini API (v1beta generateContent). Server-side only; the key never
// leaves the backend. Supports: thinking levels (minimal/low/medium/high),
// Google Search grounding, URL Context, strict JSON output, and multimodal input
// (base64 PDFs/images). Deprecated params (temperature/top_p/top_k/thinking_budget)
// are intentionally NOT used, per current Gemini 3.x requirements.

/* Model names change when Google renames or retires a model. Admin settings win, then
   environment variables, then the built-in default, so a rename never needs a deploy. */
const _cfgModels = () => { try { return (require('./settings').cache() || {}).models || {}; } catch (e) { return {}; } };
const MODEL = () => _cfgModels().gemini_primary || process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const FALLBACK = () => _cfgModels().gemini_fallback || process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash';

// Accepts either a plain string prompt or the existing Anthropic-style content
// blocks used by docs.js/reader.js ([{type:'text',text},{type:'document'|'image',
// source:{media_type,data}}]) and converts them to Gemini parts, so the document
// pipeline keeps working unchanged.
function toParts(prompt) {
  if (typeof prompt === 'string') return [{ text: prompt }];
  return (prompt || []).map(b => {
    if (b.type === 'text') return { text: b.text || '' };
    if ((b.type === 'document' || b.type === 'image') && b.source && b.source.data) {
      return { inline_data: { mime_type: b.source.media_type || 'application/pdf', data: b.source.data } };
    }
    return { text: '' };
  });
}

/**
 * geminiCall(prompt, opts) -> { text, usage:{input_tokens,output_tokens} }
 * opts: maxTokens, thinking ('minimal'|'low'|'medium'|'high', default 'medium'),
 *       search (Google Search grounding), urls (URL Context), json (strict JSON output)
 */
async function geminiCall(prompt, { maxTokens = 1200, thinking = 'medium', search = false, urls = false, json = false } = {}) {
  const body = {
    contents: [{ role: 'user', parts: toParts(prompt) }],
    generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingLevel: thinking } }
  };
  const tools = [];
  if (search) tools.push({ google_search: {} });
  if (urls) tools.push({ url_context: {} });
  if (tools.length) body.tools = tools;
  // Strict JSON only when no grounding tools are attached (API restriction).
  if (json && !tools.length) body.generationConfig.responseMimeType = 'application/json';

  // Reliability: adaptive timeout per attempt. Grounded calls legitimately take 60-90s+.
  const tmoMs = (search || urls) ? 120000 : 45000;
  // Multi-model cascade: when the primary is overloaded (503) or slow, the SAME
  // request rotates to the fallback and then to stable GA models. A single busy
  // model can never zero-out a discovery run again.
  // Chain reflects the LIVE model reality (2.x retired per Google): primary, fallback,
  // and the officially recommended 3.6-flash; the OpenAI grounded backup sits behind all.
  const extra = String(_cfgModels().gemini_extra || '').split(',').map(x => x.trim()).filter(Boolean);
  const chain = [...new Set([MODEL(), FALLBACK(), ...extra, 'gemini-3.6-flash'])];
  let res, d, lastErr;
  for (let attempt = 0; attempt < chain.length; attempt++) {
    const useModel = chain[Math.min(attempt, chain.length - 1)];
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), tmoMs);
      res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + useModel + ':generateContent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify(body), signal: ctl.signal
      });
      clearTimeout(t);
      d = await res.json();
      if (res.ok) break;
      const emsg = JSON.stringify(d && d.error && d.error.message || d).slice(0, 300);
      lastErr = new Error('Gemini API ' + res.status + ': ' + emsg);
      // THE zero-results killer: some API/model variants reject thinkingConfig with a 400,
      // which previously threw instantly — every discovery died before finding anything.
      // Strip the field for the process lifetime and retry the same attempt.
      if (res.status === 400 && !_noThinking && /thinking|unknown name|invalid/i.test(emsg)) {
        _noThinking = true;
        delete body.generationConfig.thinkingConfig;
        attempt--; continue;
      }
      // Model name not available on this API? Skip straight to the next model in the chain.
      if ((res.status === 404 || res.status === 400) && /not found|not supported|does not exist/i.test(emsg)) continue;
      if (res.status !== 429 && res.status < 500) throw lastErr; // other 4xx (except 429): no retry
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error('Gemini timeout after ' + Math.round(tmoMs / 1000) + 's') : e;
      if (!/timeout|429|5\d\d|fetch failed|network/i.test(String(lastErr.message))) throw lastErr;
    }
    // Overload-aware backoff: 503s come in bursts; wait long enough for the burst to pass.
    if (attempt < chain.length - 1) await new Promise(r => setTimeout(r, 4000 * (attempt + 1) + Math.random() * 3000));
  }
  if (!res || !res.ok) {
    // FINAL SAFETY NET: the entire Gemini chain failed. Hand the SAME request to
    // the OpenAI backup — grounded (web_search) or plain — before ever giving up.
    if (process.env.OPENAI_API_KEY) {
      try { return await openaiBackup(prompt, maxTokens, json, search || urls); } catch (e2) { /* fall through to original error */ }
    }
    throw (lastErr || new Error('Gemini unavailable'));
  }
  const cand = (d.candidates || [])[0] || {};
  const text = ((cand.content || {}).parts || []).filter(p => p.text).map(p => p.text).join('\n');
  const um = d.usageMetadata || {};
  return {
    text,
    model: (res && res.url || '').split('/models/')[1] ? (res.url.split('/models/')[1] || '').split(':')[0] : undefined,
    usage: {
      input_tokens: um.promptTokenCount || 0,
      output_tokens: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0)
    }
  };
}

/* openaiBackup — emergency provider. Zero cost until the whole Gemini chain fails.
   NOW COVERS EVERY CALL TYPE: plain text via chat completions, and web-grounded
   calls via OpenAI's built-in web_search (Responses API). Discovery is never
   left without a working provider again. */
async function openaiBackup(prompt, maxTokens, json, search) {
  const content = typeof prompt === 'string' ? prompt
    : (prompt || []).filter(b => b.type === 'text').map(b => b.text).join('\n') || 'Continue.';
  const model = process.env.OPENAI_BACKUP_MODEL || 'gpt-5.4-mini';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), search ? 150000 : 60000);
  try {
    if (search) {
      // Grounded backup: Responses API + built-in web search tool.
      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
        body: JSON.stringify({ model, tools: [{ type: 'web_search' }], input: content, max_output_tokens: Math.max(2000, maxTokens || 1200) }),
        signal: ctl.signal
      });
      const d = await r.json();
      if (!r.ok) throw new Error('OpenAI grounded backup ' + r.status + ': ' + JSON.stringify(d && d.error && d.error.message || '').slice(0, 160));
      console.log(JSON.stringify({ t: new Date().toISOString(), area: 'ai', msg: 'GROUNDED BACKUP PROVIDER USED (Gemini chain down)', model }));
      const text = d.output_text || (Array.isArray(d.output)
        ? d.output.flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n') : '');
      const u = d.usage || {};
      return { text, model, usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0 } };
    }
    const body = { model, max_completion_tokens: maxTokens || 1200, messages: [{ role: 'user', content }] };
    if (json) body.response_format = { type: 'json_object' };
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify(body), signal: ctl.signal });
    const d = await r.json();
    if (!r.ok) throw new Error('OpenAI backup ' + r.status + ': ' + JSON.stringify(d && d.error && d.error.message || '').slice(0, 160));
    console.log(JSON.stringify({ t: new Date().toISOString(), area: 'ai', msg: 'BACKUP PROVIDER USED (Gemini chain down)', model }));
    const u = d.usage || {};
    return { text: (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '',
      model, usage: { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0 } };
  } finally { clearTimeout(t); }
}
module.exports = { geminiCall, MODEL };
