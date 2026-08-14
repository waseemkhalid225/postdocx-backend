// lib/openai.js — optional second reviewer (GPT) for high-stakes documents
async function gptReview(text, context) {
  if (!process.env.OPENAI_API_KEY) return '';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.5',
        max_completion_tokens: 700,
        messages: [{ role: 'user', content:
`You are a strict senior grant reviewer. Review this ${context} in under 250 words: name the 3 weakest points a hostile reviewer would attack (feasibility, novelty, unsupported claims, fit) and give one concrete fix for each. No praise padding, no dashes.\n\n---\n${String(text).slice(0, 12000)}` }]
      })
    });
    if (!res.ok) return '';
    const d = await res.json();
    return ((d.choices || [])[0] || {}).message ? d.choices[0].message.content.trim() : '';
  } catch (e) { return ''; }
}
async function gptDraft(prompt, maxTokens) {
  if (!process.env.OPENAI_API_KEY) return '';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.5',
        max_completion_tokens: maxTokens || 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) return '';
    const d = await res.json();
    return (((d.choices || [])[0] || {}).message || {}).content ? d.choices[0].message.content.trim() : '';
  } catch (e) { return ''; }
}
async function testOpenAI() {
  if (!process.env.OPENAI_API_KEY) return { ok: false, note: 'No OpenAI key set' };
  try {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: 'Bearer ' + process.env.OPENAI_API_KEY } });
    return { ok: res.ok, note: res.ok ? 'Connected' : 'Key rejected (' + res.status + ')' };
  } catch (e) { return { ok: false, note: 'Unreachable' }; }
}
module.exports = { gptReview, gptDraft, testOpenAI };
