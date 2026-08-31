// lib/pay.js — Make a stated salary or stipend meaningful to a Pakistani applicant.
// A line like "NHS Band 6" or "€2,300/month" tells them little on its own. We express
// it per year, in the local currency, and in PKR at the admin-set rate.
// PRINCIPLE: we never invent a figure. If the page states nothing, we say nothing.

// Approximate units per 1 USD. Admin sets USD→PKR; these convert other currencies to USD
// first. Marked clearly as approximate wherever shown.
const PER_USD = {
  USD: 1, EUR: 0.92, GBP: 0.79, CHF: 0.88, SEK: 10.5, NOK: 10.8, DKK: 6.9,
  CAD: 1.36, AUD: 1.52, NZD: 1.64, JPY: 152, CNY: 7.2, SGD: 1.34,
  AED: 3.67, SAR: 3.75, QAR: 3.64, KWD: 0.31, BHD: 0.377, OMR: 0.385,
  PLN: 3.9, CZK: 22.5, HUF: 355, TRY: 34, ZAR: 18.2, MYR: 4.4, HKD: 7.8, PKR: 278
};
const SYMBOL = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₨': 'PKR', 'Rs': 'PKR', 'kr': 'SEK', 'CHF': 'CHF' };

/** Pull currency, amount(s) and period out of free text taken from an official page. */
function parsePay(text) {
  const t = String(text || '').replace(/\u00a0/g, ' ').trim();
  if (!t) return null;

  // Currency: an explicit code wins, then a symbol.
  let cur = (t.match(/\b(USD|EUR|GBP|CHF|SEK|NOK|DKK|CAD|AUD|NZD|JPY|CNY|SGD|AED|SAR|QAR|KWD|BHD|OMR|PLN|CZK|HUF|TRY|ZAR|MYR|HKD|PKR)\b/i) || [])[1];
  if (cur) cur = cur.toUpperCase();
  if (!cur) { for (const [sym, code] of Object.entries(SYMBOL)) if (t.includes(sym)) { cur = code; break; } }

  // Amounts: handle 1,234.56 and 1.234,56 and bare thousands.
  const nums = [];
  for (const m of t.matchAll(/(\d[\d.,\s]{2,})/g)) {
    let raw = m[1].replace(/\s/g, '');
    if (/,\d{2}$/.test(raw) && raw.includes('.')) raw = raw.replace(/\./g, '').replace(',', '.');
    else raw = raw.replace(/,/g, '');
    const v = parseFloat(raw);
    if (isFinite(v) && v >= 100) nums.push(v);   // ignore band numbers like "Band 6"
  }
  if (!nums.length) return null;

  // Period, so we can annualise honestly.
  const per = /per\s*(year|annum|a)\b|\/\s*(year|yr|a)\b|p\.?a\.?\b|annual/i.test(t) ? 'year'
    : /per\s*month|\/\s*(month|mo)\b|monthly|pcm/i.test(t) ? 'month'
    : /per\s*week|\/\s*w(k|eek)\b|weekly/i.test(t) ? 'week'
    : /per\s*hour|\/\s*h(r|our)\b|hourly/i.test(t) ? 'hour'
    : null;

  return { currency: cur || null, low: Math.min(...nums), high: Math.max(...nums), period: per };
}

/** Convert to an annual figure in the source currency. Returns null if the period is unknown. */
function annualise(p) {
  if (!p || !p.period) return null;
  const mult = { year: 1, month: 12, week: 52, hour: 1800 }[p.period];   // 1800h ≈ full-time year
  if (!mult) return null;
  return { low: p.low * mult, high: p.high * mult };
}

const fmt = n => Math.round(n).toLocaleString('en-US');

/**
 * Build a plain-language pay summary.
 * @param {string} text  stated pay from the official page
 * @param {number} usdToPkr  admin-set rate
 * @returns {{annual:string, pkr:string, currency:string, note:string}|null}
 */
function summarise(text, usdToPkr) {
  const p = parsePay(text);
  if (!p || !p.currency) return null;
  const ann = annualise(p);
  if (!ann) return null;
  const perUsd = PER_USD[p.currency];
  const rate = Number(usdToPkr) || 278;
  const out = {
    currency: p.currency,
    annual: p.currency + ' ' + fmt(ann.low) + (ann.high !== ann.low ? ' – ' + fmt(ann.high) : '') + ' per year',
    pkr: null,
    note: 'Converted from the figure stated on the official page. Currency rates move, so treat the PKR figure as indicative.'
  };
  if (perUsd) {
    const usdLow = ann.low / perUsd, usdHigh = ann.high / perUsd;
    out.pkr = 'PKR ' + fmt(usdLow * rate) + (usdHigh !== usdLow ? ' – ' + fmt(usdHigh * rate) : '') + ' per year';
    out.monthly_pkr = 'PKR ' + fmt(usdLow * rate / 12) + (usdHigh !== usdLow ? ' – ' + fmt(usdHigh * rate / 12) : '') + ' per month';
  }
  return out;
}

/* LIVE RATES. A hardcoded table drifts, and a client may make a life decision on a
   stale figure. We refresh daily from a public source, cache in memory, and fall back to
   the table if the network fails. The date used is always reported. */
let _fx = { at: 0, rates: null, asOf: null };
async function liveRates() {
  if (_fx.rates && Date.now() - _fx.at < 24 * 3600e3) return _fx;
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ctl.signal });
    clearTimeout(tm);
    const d = await r.json();
    if (d && d.result === 'success' && d.rates && d.rates.PKR) {
      _fx = { at: Date.now(), rates: d.rates, asOf: d.time_last_update_utc || new Date().toISOString().slice(0, 10) };
      return _fx;
    }
  } catch (e) {}
  _fx = { at: Date.now(), rates: null, asOf: null };   // retry tomorrow, use the table today
  return _fx;
}
/** Units of `cur` per 1 USD, live where possible. */
async function perUsd(cur) {
  const f = await liveRates();
  if (f.rates && f.rates[cur]) return { rate: f.rates[cur], live: true, asOf: f.asOf };
  return { rate: PER_USD[cur] || null, live: false, asOf: null };
}
/** Async version of summarise that uses live rates when available. */
async function summariseLive(text, usdToPkrFallback) {
  const p = parsePay(text);
  if (!p || !p.currency) return null;
  const ann = annualise(p);
  if (!ann) return null;
  const src = await perUsd(p.currency);
  const pkrInfo = await perUsd('PKR');
  const pkrRate = (pkrInfo.rate && pkrInfo.live) ? pkrInfo.rate : (Number(usdToPkrFallback) || 278);
  const out = {
    currency: p.currency,
    annual: p.currency + ' ' + fmt(ann.low) + (ann.high !== ann.low ? ' – ' + fmt(ann.high) : '') + ' per year',
    pkr: null, monthly_pkr: null,
    live: !!(src.live && pkrInfo.live),
    as_of: src.asOf || null,
    note: (src.live && pkrInfo.live)
      ? 'Converted at today\'s rate' + (src.asOf ? ' (' + String(src.asOf).slice(0, 16) + ')' : '') + '. Rates move, so treat the rupee figure as indicative.'
      : 'Converted at an approximate rate. Confirm the current rate before making any decision.'
  };
  if (src.rate) {
    const usdLow = ann.low / src.rate, usdHigh = ann.high / src.rate;
    out.pkr = 'PKR ' + fmt(usdLow * pkrRate) + (usdHigh !== usdLow ? ' – ' + fmt(usdHigh * pkrRate) : '') + ' per year';
    out.monthly_pkr = 'PKR ' + fmt(usdLow * pkrRate / 12) + (usdHigh !== usdLow ? ' – ' + fmt(usdHigh * pkrRate / 12) : '') + ' per month';
    /* G4: absolute rupees are hard to judge. A senior professional salary in Pakistan is
       roughly PKR 3,000,000 a year, so we express the multiple, clearly labelled. */
    const PK_SENIOR_ANNUAL = 3000000;
    const mult = (usdLow * pkrRate) / PK_SENIOR_ANNUAL;
    if (isFinite(mult) && mult > 0.2) {
      out.comparison = 'Around ' + (mult >= 10 ? Math.round(mult) : mult.toFixed(1)) +
        ' times a senior professional salary in Pakistan, before tax and living costs there.';
    }
  }
  return out;
}
module.exports = { parsePay, annualise, summarise, summariseLive, liveRates, perUsd, PER_USD };
