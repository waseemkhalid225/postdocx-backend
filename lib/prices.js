// lib/prices.js — EDITABLE price table (USD per million tokens). Update when providers change pricing.
module.exports = {
  'gpt-5.4-nano':      { in: 0.10,  out: 0.40 },
  'gpt-5.4-mini':      { in: 0.60,  out: 2.40 },
  'gpt-5.5':           { in: 1.25,  out: 10.00 },
  'claude-haiku-4-5-20251001': { in: 1.00, out: 5.00 },
  'claude-sonnet-4-6': { in: 3.00,  out: 15.00 },
  'claude-opus-4-8':   { in: 15.00, out: 75.00 }
};
