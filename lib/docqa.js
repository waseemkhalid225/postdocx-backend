// lib/docqa.js — Automated document quality gate.
// Every generated document passes through here BEFORE it is stored and shown.
// It catches the failures a human would notice instantly: missing sections, lost
// facts, placeholder text, markdown leakage, truncation, repetition and thin content.
// Nothing is delivered on a hard failure: the caller regenerates.

const PLACEHOLDER = /\[(name|your name|insert|position|company|institution|date|xx+|tbd|todo)\]|\bLorem ipsum\b|\bXXXX\b/i;
const MARKDOWN = /\*\*|^#{1,6}\s|`{3}|^\s*\*\s+/m;
const AI_TELLS = /\bas an ai\b|\bi am an ai\b|\blanguage model\b|\bcannot browse\b|\bI do not have access\b/i;
const HEDGE = /\bdata not available\b|\bnot available\b|\bnot specified\b|\bnot stated\b|\binformation not found\b|\bN\/A\b/i;
const BANNED_STYLE = /\btailored\b|\bcustomi[sz]ed\b|\bleverage\b|\bsynerg/i;

// Sections each document kind must actually contain to be considered complete.
const REQUIRED = {
  cv: ['EXPERIENCE', 'EDUCATION'],
  cover: [],
  sop: [],
  research_proposal: ['METHODOLOGY'],
  checklist: ['DOCUMENTS'],
  visa_summary: [],
  funder_outreach: []
};

// Minimum characters per kind (mirrors the generator's own floor).
const MINLEN = {
  cv: 2600, cover: 2200, sop: 3000, research_proposal: 4000,
  scholarship_statement: 2000, checklist: 1200,
  visa_summary: 1400, funder_outreach: 900
};

function normalise(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

/** Repetition detector: the same sentence appearing twice reads as machine output. */
function repeatedSentences(text) {
  const seen = new Map(); const dupes = [];
  for (const raw of String(text).split(/(?<=[.!?])\s+/)) {
    const s = normalise(raw).toLowerCase();
    if (s.length < 40) continue;
    if (seen.has(s)) dupes.push(s.slice(0, 60)); else seen.set(s, 1);
  }
  return dupes;
}

/** Facts the document must not contradict: the applicant's own name and key details. */
function factIssues(text, facts) {
  const out = [];
  const t = String(text);
  if (facts && facts.full_name) {
    const first = String(facts.full_name).split(' ')[0];
    if (first && first.length > 2 && !t.includes(first)) out.push('applicant name missing from the document');
  }
  return out;
}

/**
 * Inspect one generated document.
 * @returns {{score:number, pass:boolean, hard:string[], soft:string[]}}
 */
function inspect(kind, title, content, facts) {
  const hard = [], soft = [];
  const text = String(content || '');
  const len = text.trim().length;

  if (len === 0) hard.push('document is empty');
  const floor = MINLEN[kind];
  if (floor && len < floor * 0.8) hard.push('too short: ' + len + ' chars, expected about ' + floor);
  else if (floor && len < floor) soft.push('slightly short: ' + len + ' of ' + floor);

  if (PLACEHOLDER.test(text)) hard.push('contains placeholder text');
  if (AI_TELLS.test(text)) hard.push('contains assistant/model self-reference');
  if (MARKDOWN.test(text)) hard.push('contains markdown symbols');
  if (HEDGE.test(text)) soft.push('contains a "not available" style hedge');
  if (BANNED_STYLE.test(text)) soft.push('contains banned marketing vocabulary');

  // Truncation: a document that stops mid-sentence is a visible failure.
  const tail = text.trim().slice(-1);
  if (len > 200 && !/[.!?:)"\u2019\u201d]/.test(tail)) hard.push('appears truncated (does not end on a sentence)');

  for (const need of (REQUIRED[kind] || [])) {
    if (!new RegExp(need, 'i').test(text)) hard.push('missing required section: ' + need);
  }

  const dupes = repeatedSentences(text);
  if (dupes.length) soft.push(dupes.length + ' repeated sentence(s)');

  for (const f of factIssues(text, facts)) hard.push(f);

  // Headings should be present and in CAPITALS for the professional format.
  const capsHeadings = (text.match(/^[A-Z][A-Z &,'\-\/()]{4,}$/gm) || []).length;
  if (floor && floor > 1500 && capsHeadings < 3) soft.push('few section headings (' + capsHeadings + ')');

  let score = 100;
  score -= hard.length * 25;
  score -= soft.length * 6;
  score = Math.max(0, Math.min(100, score));
  return { score, pass: hard.length === 0 && score >= 70, hard, soft, length: len, headings: capsHeadings };
}

module.exports = { inspect, MINLEN, REQUIRED };
