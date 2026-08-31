// lib/entity.js — Canonical entity naming for institutions and employers.
// The same organisation appears with many spellings across sources
// ("Riphah International University", "Riphah Intl. Univ.", "RIPHAH INTL UNIVERSITY").
// We derive a canonical key for matching while ALWAYS preserving the original text,
// so deduplication and profile matching work without rewriting what the source said.

const ABBREV = {
  'univ': 'university', 'uni': 'university', 'intl': 'international', "int'l": 'international',
  'inst': 'institute', 'tech': 'technology', 'natl': 'national', 'nat': 'national',
  'coll': 'college', 'sch': 'school', 'dept': 'department', 'hosp': 'hospital',
  'med': 'medical', 'ctr': 'center', 'centre': 'center', 'sci': 'science',
  'engg': 'engineering', 'eng': 'engineering', 'mgmt': 'management', 'admin': 'administration'
};
// Words that carry no distinguishing information for matching purposes.
const STOP = new Set(['the', 'of', 'and', 'for', 'at', 'in', 'a', 'an']);

/** A stable key for comparing two names that may refer to the same organisation. */
function canonicalKey(name) {
  let s = String(name || '')
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')          // drop punctuation, keep word boundaries
    .replace(/\s+/g, ' ')
    .trim();
  const words = s.split(' ')
    .map(w => ABBREV[w] || w)
    .filter(w => w && !STOP.has(w));
  return words.sort().join(' ');            // order-independent: "univ of x" == "x university"
}

/** Do two names plausibly refer to the same organisation? */
function sameEntity(a, b) {
  const ka = canonicalKey(a), kb = canonicalKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  // Containment covers "Riphah University" vs "Riphah International University".
  const wa = new Set(ka.split(' ')), wb = new Set(kb.split(' '));
  const small = wa.size <= wb.size ? wa : wb, large = wa.size <= wb.size ? wb : wa;
  if (small.size < 2) return false;                     // one distinctive word is not enough
  let hit = 0; for (const w of small) if (large.has(w)) hit++;
  return hit === small.size;
}

/** Presentation form: collapse whitespace and expand common abbreviations, keep the source casing style. */
function displayName(name) {
  const raw = String(name || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.replace(/\b(Univ|Uni|Intl|Inst|Natl|Coll|Dept|Hosp)\b\.?/gi, m => {
    const k = m.toLowerCase().replace('.', '');
    const full = ABBREV[k];
    return full ? full.charAt(0).toUpperCase() + full.slice(1) : m;
  });
}

module.exports = { canonicalKey, sameEntity, displayName };
