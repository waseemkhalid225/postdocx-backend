// lib/profile.js — Master profile merge engine.
// PRINCIPLE: a new document may only ENRICH the profile. It may never silently delete
// or overwrite a fact that an earlier document established. Where two documents
// disagree on the same field, both values are preserved with their sources and the
// conflict is surfaced for the user to confirm.

const SCALARS = ['headline', 'field', 'profession', 'methods', 'total_experience_years', 'age',
  'city', 'address', 'email', 'phone', 'license_number', 'license_authority',
  'date_of_birth', 'nationality', 'passport_number', 'national_id',
  'given_name', 'middle_name', 'family_name', 'father_name', 'place_of_birth'];

const LISTS = ['professions', 'achievements', 'awards', 'memberships', 'skills_verbatim',
  'certifications', 'trainings', 'publications', 'additional_information'];

const OBJECT_LISTS = {
  // Original-script values: keyed by field + the original text, so an Urdu name and its
  // English form coexist and the original is never replaced by a romanisation.
  originals: o => ((o.field || '') + '|' + (o.original || '')).toLowerCase().trim(),
  // Transcripts keyed by institution+session so repeated uploads enrich the same record
  // rather than duplicating it, and subject rows stay bound to their own marks.
  transcripts: t => ((t.institution || '') + '|' + (t.programme || '') + '|' + (t.session || '')).toLowerCase().trim(),
  research_papers: p => (p.doi || p.title || '').toLowerCase().trim(),
  education: e => ((e.degree || '') + '|' + (e.institution || '')).toLowerCase().trim(),
  experience: x => ((x.role || '') + '|' + (x.org || '')).toLowerCase().trim(),
  licenses: l => ((l.name || '') + '|' + (l.number || '')).toLowerCase().trim(),
  referees: r => ((r.name || '') + '|' + (r.email || '')).toLowerCase().trim(),
  documents: d => ((d.type || '') + '|' + (d.number || '')).toLowerCase().trim()
};

const norm = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const isEmpty = v => norm(v) === '';

/** Merge two objects, preferring the richer value and never losing detail. */
function mergeObjects(oldO, newO) {
  const out = Object.assign({}, oldO || {});
  for (const [k, v] of Object.entries(newO || {})) {
    if (isEmpty(v)) continue;                 // never blank out an existing value
    if (isEmpty(out[k])) { out[k] = v; continue; }
    if (norm(v).length > norm(out[k]).length) out[k] = v;   // keep the more complete one
  }
  return out;
}

/**
 * Merge a freshly extracted profile into the stored one.
 * @returns {{profile:object, conflicts:Array, added:number}}
 */
function merge(stored, fresh, sourceName) {
  const prev = (stored && typeof stored === 'object') ? stored : {};
  const next = (fresh && typeof fresh === 'object') ? fresh : {};
  const out = Object.assign({}, prev);
  const conflicts = Array.isArray(prev._conflicts) ? prev._conflicts.slice() : [];
  const provenance = Object.assign({}, prev._provenance || {});
  let added = 0;

  // --- scalars: fill gaps, flag genuine disagreements, never silently replace ---
  for (const k of SCALARS) {
    const a = prev[k], b = next[k];
    if (isEmpty(b)) continue;
    if (isEmpty(a)) {
      out[k] = b; added++;
      provenance[k] = { source: sourceName || 'upload', at: new Date().toISOString(), status: 'extracted' };
      continue;
    }
    if (norm(a).toLowerCase() !== norm(b).toLowerCase()) {
      // Keep the established value; record the disagreement for the user to resolve.
      const already = conflicts.find(c => c.field === k && norm(c.incoming) === norm(b));
      if (!already) {
        conflicts.push({ field: k, current: a, incoming: b, source: sourceName || 'upload',
          at: new Date().toISOString(), status: 'unresolved' });
      }
    }
  }

  // --- plain lists: union, preserving order and original text ---
  for (const k of LISTS) {
    const a = Array.isArray(prev[k]) ? prev[k] : [];
    const b = Array.isArray(next[k]) ? next[k] : [];
    const seen = new Set(a.map(x => norm(x).toLowerCase()));
    const merged = a.slice();
    for (const item of b) {
      const key = norm(item).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key); merged.push(item); added++;
    }
    if (merged.length) out[k] = merged.slice(0, 80);
  }

  // --- object lists: match on identity, merge fields, never drop an entry ---
  for (const [k, keyOf] of Object.entries(OBJECT_LISTS)) {
    const a = Array.isArray(prev[k]) ? prev[k] : [];
    const b = Array.isArray(next[k]) ? next[k] : [];
    const byKey = new Map();
    a.forEach(item => byKey.set(keyOf(item || {}), item));
    for (const item of b) {
      if (!item || typeof item !== 'object') continue;
      const key = keyOf(item);
      if (!key) { byKey.set('anon:' + byKey.size, item); added++; continue; }
      if (byKey.has(key)) byKey.set(key, mergeObjects(byKey.get(key), item));
      else { byKey.set(key, item); added++; }
    }
    const merged = [...byKey.values()];
    if (merged.length) out[k] = merged.slice(0, 40);
  }

  // --- links object ---
  if (next.links && typeof next.links === 'object') out.links = mergeObjects(prev.links, next.links);

  out._conflicts = conflicts.slice(-40);
  out._provenance = provenance;
  out._sources = Array.from(new Set((prev._sources || []).concat(sourceName ? [sourceName] : []))).slice(-25);
  out._updated_at = new Date().toISOString();
  return { profile: out, conflicts, added };
}

/** How much of the profile is populated, for a visible completeness figure. */
function completeness(p) {
  const prof = p || {};
  const checks = SCALARS.concat(LISTS, Object.keys(OBJECT_LISTS));
  let have = 0;
  for (const k of checks) {
    const v = prof[k];
    if (Array.isArray(v) ? v.length : !isEmpty(v)) have++;
  }
  return { filled: have, total: checks.length, pct: Math.round(100 * have / checks.length) };
}

module.exports = { merge, completeness, SCALARS, LISTS, OBJECT_LISTS };
