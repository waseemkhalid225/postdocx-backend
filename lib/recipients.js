// lib/recipients.js — RecipientDiscoveryService (spec #12, #13).
// Independent, reusable service: given an opportunity, determine the CORRECT recipient
// (type, name, email), verify against official sources, record the source, and assign a
// confidence level. Never invents an email. If a personal contact cannot be verified, it
// falls back to the appropriate official department contact.
//
// This module is deliberately decoupled from the frontend and from the application engine,
// so email-hunting can be improved later without touching the rest of ForiForeign.

const { admin } = require('./supa');

// Recipient types, in priority order per opportunity kind.
const STUDY_TYPES = ['supervisor', 'program_coordinator', 'graduate_admissions', 'international_admissions', 'admissions', 'department'];
const WORK_TYPES = ['hiring_manager', 'recruiter', 'hr', 'department', 'organization_contact'];

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
function extractEmails(text) {
  return [...new Set((String(text || '').match(EMAIL_RE) || [])
    .map(e => e.toLowerCase().trim())
    .filter(e => !/(example|test|noreply|no-reply|donotreply|sentry|wixpress|\.png|\.jpg)/.test(e)))];
}

// Does an email's domain plausibly belong to the institution? (soft signal, not proof)
function domainMatchesOrg(email, org) {
  if (!email || !org) return false;
  const domain = email.split('@')[1] || '';
  const orgWords = String(org).toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(w => w.length > 3);
  return orgWords.some(w => domain.includes(w.slice(0, 5)));
}

function confidenceFor({ email, verifiedOnOfficial, domainMatch, recipientNamed }) {
  if (!email) return 'none';
  let score = 0;
  if (verifiedOnOfficial) score += 2;
  if (domainMatch) score += 1;
  if (recipientNamed) score += 1;
  if (score >= 3) return 'high';
  if (score === 2) return 'medium';
  return 'low';
}

/**
 * discover(opportunity, callAI, ctx) -> recipient object (never throws)
 * Returns:
 *   { email, recipientName, recipientType, roleLabel, confidence, source, alternatives:[], apply_via }
 * callAI is injected (from engine) so this service stays independent of any specific AI client.
 */
async function discover(opp, callAI, ctx) {
  ctx = ctx || {};
  const kind = opp.kind === 'work' ? 'work' : 'study';
  const typeOrder = kind === 'work' ? WORK_TYPES : STUDY_TYPES;

  // 1) Start from anything already captured on the opportunity (seen on official pages during discovery).
  let known = extractEmails((opp.contact_emails || []).join(' '));
  let source = known.length ? (opp.url || 'opportunity record') : '';
  let recipientName = opp.contact_name || '';
  let recipientType = '';
  let roleLabel = '';

  // 2) If nothing reliable yet, run a focused, official-source-first search (no guessing).
  if (!known.length && typeof callAI === 'function') {
    try {
      const q = kind === 'work'
        ? `For the job "${opp.title}" at "${opp.institution}", find the correct application contact (recruiter, hiring manager, HR, or official job contact). Search only official company/careers pages. Return ONLY JSON: {"name":"","role":"","email":"","source":"official URL where seen","email_seen_on_official_page":true|false}. Never guess an email. If none is published, return email as "".`
        : `For "${opp.title}" at "${opp.institution}", find the correct recipient to email (supervisor/professor, program coordinator, or graduate/international admissions). Search only official university/department pages. Return ONLY JSON: {"name":"","role":"","email":"","source":"official URL where seen","email_seen_on_official_page":true|false}. Never guess an email. If none is published, return email as "".`;
      const txt = await callAI('search_verify', q, { search: true, urls: true, maxTokens: 300, userId: ctx.userId, applicationId: ctx.applicationId });
      const d = safeJSON(txt) || {};
      const found = extractEmails(d.email);
      if (found.length && d.email_seen_on_official_page) {
        known = found;
        recipientName = String(d.name || '').slice(0, 120);
        roleLabel = String(d.role || '').slice(0, 120);
        source = String(d.source || '').slice(0, 300) || (opp.url || '');
      }
    } catch (e) { /* fall through to department fallback */ }
  }

  // 2b) FALLBACK STRATEGY (spec: never a blank recipient). If no personal/direct email was
  //     verified, look specifically for the official DEPARTMENT / admissions / HR inbox — a
  //     published general address is a legitimate, honest recipient. Still never guessed.
  if (!known.length && typeof callAI === 'function') {
    try {
      const q = kind === 'work'
        ? `Find the official general application or HR/careers email address published for "${opp.institution}" (for the role "${opp.title}"). Only an address literally shown on the official company/careers/contact page. Return ONLY JSON: {"email":"","role":"","source":"official URL","email_seen_on_official_page":true|false}. If none is published anywhere official, return email "".`
        : `Find the official department, admissions or graduate-office email address published for "${opp.institution}" (relevant to "${opp.title}"). Only an address literally shown on the official university/department/contact page. Return ONLY JSON: {"email":"","role":"","source":"official URL","email_seen_on_official_page":true|false}. If none is published anywhere official, return email "".`;
      const txt = await callAI('search_verify', q, { search: true, urls: true, maxTokens: 250, userId: ctx.userId, applicationId: ctx.applicationId });
      const d = safeJSON(txt) || {};
      const found = extractEmails(d.email);
      if (found.length && d.email_seen_on_official_page) {
        known = found;
        roleLabel = String(d.role || '').slice(0, 120) || (kind === 'work' ? 'HR / Careers' : 'Department / Admissions Office');
        source = String(d.source || '').slice(0, 300) || (opp.url || '');
        recipientType = kind === 'work' ? 'hr' : 'department';
      }
    } catch (e) { /* still nothing verifiable -> portal route below */ }
  }

  // 3) Classify recipient type from the role label (best-effort).
  const rl = (roleLabel || '').toLowerCase();
  recipientType = typeOrder.find(t => rl.includes(t.replace(/_/g, ' '))) ||
    (rl.includes('professor') || rl.includes('supervisor') ? 'supervisor' :
     rl.includes('admission') ? 'admissions' :
     rl.includes('recruit') ? 'recruiter' :
     rl.includes('hr') || rl.includes('human resources') ? 'hr' : '');

  const email = known[0] || '';
  const verifiedOnOfficial = !!(email && source && /^https?:\/\//.test(source));
  const domainMatch = domainMatchesOrg(email, opp.institution);
  const confidence = confidenceFor({ email, verifiedOnOfficial, domainMatch, recipientNamed: !!recipientName });

  // 4) If we could not verify a personal/direct email, prefer the official department contact
  //    rather than a low-confidence guess. Never invent — if truly nothing, apply_via = portal.
  const apply_via = email ? 'email' : 'portal';
  if (!recipientType && email) recipientType = 'department';
  if (!roleLabel) roleLabel = defaultRole(recipientType, kind);

  return {
    email,
    recipientName: recipientName || '',
    recipientType: recipientType || '',
    roleLabel,
    confidence,
    source: source || '',
    alternatives: known.slice(1, 4),
    apply_via
  };
}

function defaultRole(type, kind) {
  const map = {
    supervisor: 'Supervisor / Professor',
    program_coordinator: 'Program Coordinator',
    graduate_admissions: 'Graduate Admissions',
    international_admissions: 'International Admissions',
    admissions: 'Admissions Office',
    department: 'Department Contact',
    hiring_manager: 'Hiring Manager',
    recruiter: 'Recruiter',
    hr: 'Human Resources',
    organization_contact: 'Organization Contact'
  };
  return map[type] || (kind === 'work' ? 'Recruitment Contact' : 'Admissions Office');
}

function safeJSON(s) {
  if (!s) return null;
  try { const m = String(s).match(/[\[{][\s\S]*[\]}]/); return m ? JSON.parse(m[0]) : JSON.parse(s); } catch (e) { return null; }
}

/**
 * persist(opportunityId, recipient) — cache the discovered recipient on the opportunity,
 * degrading gracefully if the columns don't exist yet (migration 0018 adds them).
 */
async function persist(opportunityId, r) {
  if (!opportunityId) return;
  const patch = {
    contact_emails: r.email ? [r.email, ...r.alternatives].filter(Boolean) : [],
    contact_name: r.recipientName || null,
    recipient_type: r.recipientType || null,
    recipient_role: r.roleLabel || null,
    recipient_confidence: r.confidence || null,
    recipient_source: r.source || null,
    apply_via: r.email ? 'both' : 'portal'
  };
  try {
    const { error } = await admin().from('opportunities').update(patch).eq('id', opportunityId);
    if (error && /column/.test(error.message || '')) {
      // migration not run yet — store only the always-present fields
      await admin().from('opportunities').update({ contact_emails: patch.contact_emails, apply_via: patch.apply_via }).eq('id', opportunityId);
    }
  } catch (e) { /* non-fatal */ }
}

module.exports = { discover, persist, extractEmails, STUDY_TYPES, WORK_TYPES };
