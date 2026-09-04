// lib/payscale.js - what a pay scale actually MEANS, in plain words.
//
// WHY. An advert that says "TV-L E13, 65%" or "NIH NRSA Postdoctoral Stipend rate" or
// "NHS Band 6" has stated its salary precisely - to somebody who already knows the
// system. To a pharmacist in Rawalpindi it is a code, and our screen simply repeated the
// code back at them, or worse said "fully funded" with no number at all. That is the
// question every applicant asks first and we were answering it with jargon.
//
// Each entry explains the scale in one sentence and gives the pay the scale itself
// publishes, so the applicant sees a real figure. The figure comes from the published
// scale, NOT from the advert, so it is always labelled as "typical for this scale" and
// never presented as the exact offer. We never invent a number for a scale we do not know.

const SCALES = [
  { rx: /\bTV-?[LÖ]D?\s*E\s?1[34]\b|\bE\s?13\b|\bTVL\s?13\b/i, cur: 'EUR', monthly: 4200,
    name: 'TV-L E13',
    plain: 'The German public service pay scale for research staff. E13 is the standard grade for a PhD researcher or postdoc. Many PhD posts are advertised at 65% or 75% of it, which is stated separately.' },
  { rx: /\bTV-?[LÖ]D?\s*E\s?1[45]\b|\bE\s?14\b/i, cur: 'EUR', monthly: 4700,
    name: 'TV-L E14',
    plain: 'The German public service scale one grade above E13, used for senior postdocs and group leaders.' },
  { rx: /NIH\s*(NRSA|stipend)|NRSA\b/i, cur: 'USD', yearly: 61008,
    name: 'NIH NRSA postdoctoral stipend',
    plain: 'The United States National Institutes of Health publishes a fixed postdoctoral stipend scale, which rises with each year of experience. Year one is the entry figure.' },
  { rx: /NHS\s*band\s*([5-9])/i, cur: 'GBP', yearly: 37000,
    name: 'NHS pay band',
    plain: 'The United Kingdom National Health Service pay scale. Band 5 is a newly registered nurse or pharmacist, band 6 a specialist, band 7 an advanced practitioner or manager.' },
  { rx: /\bUS\s*grade\s*GS-?\d+|\bGS-?1[0-5]\b/i, cur: 'USD', yearly: 70000,
    name: 'US federal GS scale',
    plain: 'The United States federal government pay scale, used by public agencies and national laboratories.' },
  { rx: /\bMSCA\b|Marie\s*Sk|Curie\s*(fellow|action)/i, cur: 'EUR', monthly: 5000,
    name: 'Marie Sklodowska-Curie allowance',
    plain: 'A European Commission fellowship with a published living allowance, plus mobility and family allowances on top. The exact amount is adjusted by a country cost factor.' },
  { rx: /\bDAAD\b/i, cur: 'EUR', monthly: 1300,
    name: 'DAAD scholarship rate',
    plain: 'The German Academic Exchange Service publishes fixed monthly rates by study level, plus health insurance and a travel allowance.' },
  { rx: /\bCSC\b|China Scholarship Council/i, cur: 'CNY', monthly: 3500,
    name: 'China Scholarship Council rate',
    plain: 'The Chinese government scholarship: tuition is waived, accommodation is provided or subsidised, and a fixed monthly living allowance is paid by study level.' },
  { rx: /Stipendium\s*Hungaricum/i, cur: 'HUF', monthly: 140000,
    name: 'Stipendium Hungaricum rate',
    plain: 'The Hungarian government scholarship: tuition waived, a monthly stipend, and a housing contribution.' },
  { rx: /\bMEXT\b/i, cur: 'JPY', monthly: 145000,
    name: 'MEXT scholarship rate',
    plain: 'The Japanese government scholarship: tuition waived, a monthly allowance by study level, and flights.' },
  { rx: /\bGKS\b|Korean Government Scholarship/i, cur: 'USD', monthly: 900,
    name: 'Korean Government Scholarship rate',
    plain: 'Tuition waived, a monthly living allowance, a settlement allowance and a Korean language year.' },
  { rx: /\bSCFHS\b|Saudi Commission/i, cur: 'SAR', monthly: 0,
    name: 'SCFHS classification',
    plain: 'The Saudi Commission for Health Specialties grades health professionals; the grade determines the salary band the employer may offer. The employer states the actual figure.' }
];

/* What does this pay text mean? Returns null when we recognise nothing - silence is
   better than a guess. */
function decode(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  for (const s of SCALES) {
    const m = t.match(s.rx);
    if (!m) continue;
    /* A fraction of a scale is a German convention ("E13, 65%") and it changes the real
       pay enormously, so it is honoured there. It is NOT applied anywhere else: the NIH
       line "NRSA stipend rate (>11% h..." contains a percent sign that has nothing to do
       with pay, and reading it as a fraction cut a real stipend to a ninth of its value. */
    const pctM = /TV-?[LÖ]/i.test(s.name) ? t.match(/(\d{2,3})\s*%/) : null;
    const rawPct = pctM ? parseInt(pctM[1], 10) : 0;
    const pct = (rawPct >= 25 && rawPct <= 100) ? rawPct / 100 : 1;
    let monthly = s.monthly ? s.monthly * pct : (s.yearly ? (s.yearly / 12) * pct : 0);
    return {
      name: s.name,
      plain: s.plain + (pct < 1 ? ' This position is advertised at ' + Math.round(pct * 100) + '% of the scale.' : ''),
      currency: s.cur,
      monthly: monthly ? Math.round(monthly) : 0,
      yearly: monthly ? Math.round(monthly * 12) : 0,
      approximate: true
    };
  }
  return null;
}
/* SALARY PARSER: "45,000 GBP/yr", "AED 2,500 per month", "SAR 1800/month + food + accommodation", "£12.50/hour", "1.2 lakh INR per month".
   Returns { currency, min, max, period, monthly_usd, perks[] } or null; never invents a figure. Fallback rates keep it working offline. */
const CUR = { '£': 'GBP', '€': 'EUR', '$': 'USD', '₹': 'INR', '¥': 'JPY', '₩': 'KRW', '₺': 'TRY', 'aed': 'AED', 'dhs': 'AED', 'dirham': 'AED', 'dirhams': 'AED', 'sar': 'SAR', 'sr': 'SAR', 'riyal': 'SAR', 'riyals': 'SAR', 'qar': 'QAR', 'qr': 'QAR', 'kwd': 'KWD', 'kd': 'KWD', 'dinar': 'KWD', 'omr': 'OMR', 'ro': 'OMR', 'bhd': 'BHD', 'bd': 'BHD', 'gbp': 'GBP', 'pound': 'GBP', 'pounds': 'GBP', 'eur': 'EUR', 'euro': 'EUR', 'euros': 'EUR', 'usd': 'USD', 'dollar': 'USD', 'dollars': 'USD', 'cad': 'CAD', 'aud': 'AUD', 'nzd': 'NZD', 'sgd': 'SGD', 'myr': 'MYR', 'rm': 'MYR', 'ringgit': 'MYR', 'jpy': 'JPY', 'yen': 'JPY', 'krw': 'KRW', 'won': 'KRW', 'pln': 'PLN', 'zł': 'PLN', 'zloty': 'PLN', 'ron': 'RON', 'lei': 'RON', 'huf': 'HUF', 'czk': 'CZK', 'kč': 'CZK', 'chf': 'CHF', 'sek': 'SEK', 'nok': 'NOK', 'dkk': 'DKK', 'inr': 'INR', 'rs': 'PKR', 'pkr': 'PKR', 'bdt': 'BDT', 'tk': 'BDT', 'thb': 'THB', 'baht': 'THB', 'try': 'TRY', 'lira': 'TRY', 'hkd': 'HKD', 'twd': 'TWD', 'cny': 'CNY', 'rmb': 'CNY', 'yuan': 'CNY' };
const RATES = { GBP: 0.78, EUR: 0.92, USD: 1, AED: 3.67, SAR: 3.75, QAR: 3.64, KWD: 0.31, OMR: 0.385, BHD: 0.377, CAD: 1.37, AUD: 1.5, NZD: 1.65, SGD: 1.34, MYR: 4.4, JPY: 150, KRW: 1350, PLN: 4, RON: 4.6, HUF: 360, CZK: 23, CHF: 0.88, SEK: 10.5, NOK: 10.7, DKK: 6.9, INR: 84, PKR: 280, BDT: 120, THB: 34, TRY: 34, HKD: 7.8, TWD: 32, CNY: 7.2 };
const PERKS = [[/accommodation|housing|lodging|hostel|rent[- ]free/i, 'accommodation'], [/\bfood\b|meals|catering/i, 'food'], [/transport|pick ?up|bus service/i, 'transport'], [/flight|air ?ticket|return ticket/i, 'flights'], [/medical|health insurance|insurance/i, 'medical'], [/overtime|ot\b/i, 'overtime'], [/bonus|incentive|tips/i, 'bonus'], [/visa (cost|fee)s? (paid|covered)|free visa/i, 'visa paid']];
function parseSalary(text, ccHint) { const t = String(text || '').replace(/\s+/g, ' ').trim(); if (!t) return null; const low = t.toLowerCase();
  let currency = null; for (const [k, v] of Object.entries(CUR)) { const re = k.length === 1 ? new RegExp(k.replace(/[$]/g, '\\$')) : new RegExp('(^|[^a-z])' + k + '([^a-z]|$)', 'i'); if (re.test(low)) { currency = v; break; } }
  if (!currency && ccHint) currency = ({ GB: 'GBP', AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', OM: 'OMR', BH: 'BHD', US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', MY: 'MYR', JP: 'JPY', KR: 'KRW', PL: 'PLN', RO: 'RON', HU: 'HUF', CZ: 'CZK', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', IN: 'INR', PK: 'PKR', DE: 'EUR', NL: 'EUR', IE: 'EUR', IT: 'EUR', ES: 'EUR', PT: 'EUR', FR: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR', CY: 'EUR', MT: 'EUR', LT: 'EUR', LV: 'EUR', EE: 'EUR', SK: 'EUR', SI: 'EUR', HR: 'EUR', LU: 'EUR', TR: 'TRY', TH: 'THB', HK: 'HKD', TW: 'TWD', CN: 'CNY', BD: 'BDT' })[String(ccHint).toUpperCase()] || null;
  const nums = [...low.matchAll(/(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*(k|lakh|lac)?/g)].map(m => { let v = Number(String(m[1]).replace(/,/g, '').replace(/\.(?=\d{3}\b)/g, '')); if (m[2] === 'k') v *= 1000; if (m[2] === 'lakh' || m[2] === 'lac') v *= 100000; return v; }).filter(v => v > 0 && v < 1e8);
  if (!nums.length) return null; const min = Math.min(...nums.slice(0, 2)), max = Math.max(...nums.slice(0, 2));
  const period = /hour|hr\b|\/h\b|p\/h|per h\b/.test(low) ? 'hour' : /day|daily|\/d\b/.test(low) ? 'day' : /week|weekly|\/w\b|pw\b/.test(low) ? 'week' : /year|annum|yr\b|\/y\b|pa\b|annual/.test(low) ? 'year' : 'month';
  const perMonth = { hour: 173, day: 22, week: 4.33, month: 1, year: 1 / 12 }[period]; const rate = currency ? RATES[currency] : null;
  const monthly_usd = rate ? Math.round((min * perMonth) / rate) : null; const monthly_usd_max = rate ? Math.round((max * perMonth) / rate) : null;
  const perks = PERKS.filter(([re]) => re.test(low)).map(([, k]) => k);
  return { currency, min, max, period, monthly_usd, monthly_usd_max, perks, raw: t.slice(0, 80) }; }
module.exports = { parseSalary, decode, SCALES };
