// lib/costs.js — approximate monthly living-cost averages per destination country.
// These are broad public averages (accommodation + food + transport + insurance for a
// single student), NOT official figures. Every consumer of this data must label it
// "approximate estimate". PKR conversion uses the admin-set rate in Settings -> ai.usd_to_pkr.
// Admin can override any country from Settings later; unknown countries return null
// and the UI says "no estimate available" rather than guessing.

const AVG_LIVING_USD = {
  DE: [850, 1200], AT: [900, 1300], NL: [1000, 1400], BE: [850, 1200], FR: [900, 1400],
  IT: [750, 1100], ES: [700, 1050], PT: [650, 950], PL: [500, 800], CZ: [550, 850],
  HU: [500, 800], SE: [900, 1300], NO: [1100, 1600], DK: [1000, 1500], FI: [850, 1200],
  GB: [1100, 1700], IE: [1100, 1600], CH: [1600, 2300],
  US: [1200, 2000], CA: [900, 1500], AU: [1100, 1700], NZ: [900, 1400],
  JP: [800, 1300], KR: [700, 1200], CN: [450, 800], MY: [400, 700], TR: [400, 700],
  SA: [700, 1200], AE: [900, 1500], QA: [900, 1500], KW: [700, 1200], OM: [600, 1000], BH: [700, 1100]
};

function livingEstimate(countryCode) {
  const r = AVG_LIVING_USD[String(countryCode || '').toUpperCase()];
  if (!r) return null;
  return { usd_low: r[0], usd_high: r[1], basis: 'Approximate public average for a single student; not an official figure.' };
}

module.exports = { livingEstimate, AVG_LIVING_USD };
