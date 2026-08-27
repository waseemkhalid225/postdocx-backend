// lib/prices.js — per-model USD per 1M tokens, used by the cost ledger.
// Gemini 3.7 Flash introductory pricing (until Dec 31, 2026): $0.75 in / $3.75 out;
// listed at $1.50 / $7.50 after. We record at the current billed (intro) rate.
module.exports = {
  'gemini-3.7-flash': { in: 0.75, out: 3.75 }
};
