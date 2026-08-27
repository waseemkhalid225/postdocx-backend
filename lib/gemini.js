// lib/gemini.js — single AI provider for ForiForeign: Google Gemini 3.7 Flash.
// Current Gemini API (v1beta generateContent). Server-side only; the key never
// leaves the backend. Supports: thinking levels (minimal/low/medium/high),
// Google Search grounding, URL Context, strict JSON output, and multimodal input
// (base64 PDFs/images). Deprecated params (temperature/top_p/top_k/thinking_budget)
// are intentionally NOT used, per current Gemini 3.x requirements.

const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const FALLBACK = () => process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash';

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

  // Reliability: 45s timeout per attempt, 3 attempts total with backoff on 429/5xx/network.
  let res, d, lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const useModel = attempt === 3 ? FALLBACK() : MODEL(); // final attempt: stable fallback model
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 45000);
      res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + useModel + ':generateContent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify(body), signal: ctl.signal
      });
      clearTimeout(t);
      d = await res.json();
      if (res.ok) break;
      lastErr = new Error('Gemini API ' + res.status + ': ' + JSON.stringify(d).slice(0, 300));
      if (res.status !== 429 && res.status < 500) throw lastErr; // 4xx (except 429): no retry
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error('Gemini timeout after 45s') : e;
      if (!/timeout|429|5\d\d|fetch failed|network/i.test(String(lastErr.message))) throw lastErr;
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 2500 * (attempt + 1)));
  }
  if (!res || !res.ok) {
    if (process.env.OPENAI_API_KEY && !search && !urls) {
      try { return await openaiBackup(prompt, maxTokens, json); } catch (e2) { /* fall through to original error */ }
    }
    throw (lastErr || new Error('Gemini unavailable'));
  }
  const cand = (d.candidates || [])[0] || {};
  const text = ((cand.content || {}).parts || []).filter(p => p.text).map(p => p.text).join('\n');
  const um = d.usageMetadata || {};
  return {
    text,
    usage: {
      input_tokens: um.promptTokenCount || 0,
      output_tokens: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0)
    }
  };
}

/* openaiBackup — dormant emergency path. Zero cost until Gemini is completely down.
   Text-only calls (drafting, extraction, matching). Never used for web-grounded verification. */
async function openaiBackup(prompt, maxTokens, json) {
  const content = typeof prompt === 'string' ? prompt
    : (prompt || []).filter(b => b.type === 'text').map(b => b.text).join('\n') || 'Continue.';
  const body = { model: process.env.OPENAI_BACKUP_MODEL || 'gpt-5.4-mini', max_completion_tokens: maxTokens || 1200,
    messages: [{ role: 'user', content }] };
  if (json) body.response_format = { type: 'json_object' };
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error('OpenAI backup ' + r.status);
  console.log(JSON.stringify({ t: new Date().toISOString(), area: 'ai', msg: 'BACKUP PROVIDER USED (Gemini down)' }));
  const u = d.usage || {};
  return { text: (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '',
    usage: { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0 } };
}
module.exports = { geminiCall, MODEL };
