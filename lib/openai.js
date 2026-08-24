// lib/openai.js — minimal GPT caller returning text + token usage
async function gptCall(prompt, { model, maxTokens = 1200 } = {}) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({ model, max_completion_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
  });
  const d = await res.json();
  if (!res.ok) throw new Error('OpenAI API ' + res.status + ': ' + JSON.stringify(d).slice(0, 300));
  return { text: ((d.choices || [])[0] || {}).message?.content || '', usage: { input_tokens: (d.usage || {}).prompt_tokens || 0, output_tokens: (d.usage || {}).completion_tokens || 0 } };
}
module.exports = { gptCall };
