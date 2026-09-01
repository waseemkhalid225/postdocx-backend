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
module.exports = { decode, SCALES };
