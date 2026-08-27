// lib/engine.js — ForiForeign pipeline: discover -> verify -> prepare -> draft
// Ported from the battle-tested PostDocX rules: evidence-only, no invented emails,
// truthful documents, no AI-smell, guaranteed drafts, human authorization (R4).
const { admin } = require('./supa');
const { callAI } = require('./router');

const STYLE = `STRICT OUTPUT RULES: never use the words tailored, customized, AI, Claude, GPT, Gemini, generated, or template. Never leave placeholder brackets like [name] or blank fields, omit unknowns and write around them. No em dashes, no bullet spam, flowing professional prose a senior applicant would sign, ready to send with zero editing. Respond with the final text only.`;

function parseJSON(t) {
  try { const m = String(t).match(/\[[\s\S]*\]|\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch (e) { return null; }
}
const noSmell = t => String(t || '')
  .replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',').replace(/,\s*\./g, '.')
  .replace(/\[(?:insert|your|add|name|date|university|position)[^\]]*\]/gi, '');

const cleanEmails = arr => [...new Set((arr || [])
  .map(e => String(e || '').replace(/^mailto:/i, '').trim().replace(/[.,;:]+$/, '').toLowerCase())
  .filter(e => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(e) && !/(example|test)\.(com|org)$/.test(e.split('@')[1])))]
  .sort((a, b) => (/(gmail|yahoo|hotmail|outlook)\./.test(a) ? 1 : 0) - (/(gmail|yahoo|hotmail|outlook)\./.test(b) ? 1 : 0));

/* ---------- DISCOVERY: profile-driven, evidence-only, verified at birth ---------- */
async function discoverForUser(userId, kind) {
  const { data: p } = await admin().from('profiles').select('*').eq('id', userId).single();
  if (!p) return 0;
  kind = kind || (p.mode === 'work' ? 'work' : 'postdoc');
  const budgetLine = p.funded_only ? 'ONLY fully funded/salaried positions.' : (Number(p.annual_budget_pkr) > 0 ? 'Annual budget PKR ' + p.annual_budget_pkr + ', prefer affordable or funded options and label estimated costs.' : '');
  const licenseLine = kind === 'work' && p.profession ? 'Profession: ' + p.profession + '. Only roles where a Pakistani-qualified ' + p.profession + ' can realistically obtain registration; name the license/exam required (e.g. DHA, SCFHS, NCLEX, PEBC).' : '';
  // Spec 2: admin-curated university priority list guides (never limits) discovery.
  let uniLine = '';
  try {
    const { data: unis } = await admin().from('universities').select('name,country_code').eq('enabled', true).order('priority').limit(40);
    if (unis && unis.length) uniLine = 'PRIORITY INSTITUTIONS (check these first where relevant, but do not limit yourself to them): ' + unis.map(u => u.name + ' (' + u.country_code + ')').join('; ') + '.';
  } catch (e) {}
  const prompt =
`Search the web NOW for currently-open, real ${kind === 'work' ? 'jobs abroad for a Pakistani ' + (p.headline || 'medical professional') : kind + ' opportunities'} matching this applicant:
${p.headline || ''}; field ${p.field || ''}; skills ${String(p.methods || '').slice(0, 200)}. ${budgetLine} ${licenseLine} ${uniLine}
QUALITY BAR: only positions you verified on the OFFICIAL university/employer page, currently open, funded/paid. Extract contact emails ONLY if literally printed on official pages, never guessed.
Respond ONLY with a JSON array, up to 5 items:
[{"title":"","institution":"","country_code":"ISO2","city":"","url":"official page","deadline":"YYYY-MM-DD or empty","funding":"","funding_type":"fully|partial|self","level":"bachelors|masters|phd|postdoc","stipend":"","tuition":"amount+currency exactly as stated or empty","application_fee":"amount+currency exactly as stated or empty","duration":"","contact_emails":["seen on official pages only"],"apply_via":"email|portal","criteria":{"req_degree_level":"bachelors|masters|phd|any or empty","req_field":"","req_min_cgpa":"number or empty","req_cgpa_scale":"number or empty","req_language":"IELTS|TOEFL|none or empty","req_language_min":"number or empty","req_nationality":"restriction or empty","req_experience_years":"number or empty","req_license":"DHA|SCFHS|NCLEX|PEBC or empty","req_documents":["required document names literally listed"]}}]
CRITICAL: fill criteria ONLY from requirements literally stated on the official page. Leave any unstated requirement as empty; never guess a CGPA, language score, or restriction.`;
  const txt = await callAI('search_verify', prompt, { search: true, urls: true, maxTokens: 1800, userId });
  const items = parseJSON(txt) || [];
  let added = 0;
  for (const it of items) {
    if (!it.url || !it.institution) continue;
    // Spec 17: opportunity fingerprint = normalized identity; dedup by fingerprint OR url.
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const fp = require('crypto').createHash('sha1').update([norm(it.institution), norm(it.title), it.deadline || '', String(it.level || '')].join('|')).digest('hex');
    const { data: dup } = await admin().from('opportunities').select('id').or('url.eq.' + it.url + ',fingerprint.eq.' + fp).limit(1).then(r => r, async () => await admin().from('opportunities').select('id').eq('url', it.url).limit(1));
    if (dup && dup.length) continue;
    const emails = cleanEmails(it.contact_emails);
    const ft = ['fully', 'partial', 'self'].includes(String(it.funding_type || '').toLowerCase()) ? String(it.funding_type).toLowerCase() : null;
    const lvl = ['bachelors', 'masters', 'phd', 'postdoc'].includes(String(it.level || '').toLowerCase())
      ? String(it.level).toLowerCase()
      : (kind === 'postdoc' ? 'postdoc' : null);
    const row = {
      kind, title: noSmell(it.title).slice(0, 300), institution: noSmell(it.institution).slice(0, 200),
      country_code: (it.country_code || '').slice(0, 2).toUpperCase() || null,
      city: it.city || '', url: it.url,
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(it.deadline || '') ? it.deadline : null,
      funding: it.funding || '', stipend: it.stipend || '', duration: it.duration || '',
      contact_emails: emails, apply_via: emails.length ? (it.apply_via === 'portal' ? 'both' : 'email') : 'portal',
      status: 'verified', verified_at: new Date().toISOString(), source: 'agent',
      fingerprint: fp,
      tuition: String(it.tuition || '').slice(0, 120), application_fee: String(it.application_fee || '').slice(0, 120)
    };
    if (ft) row.funding_type = ft;
    if (lvl) row.level = lvl;
    // Phase 3: structured eligibility criteria, only where the agent found them stated.
    const c = it.criteria || {};
    const numOrNull = x => { const n = parseFloat(x); return isFinite(n) ? n : null; };
    const strOrNull = x => { const s = String(x || '').trim(); return s ? s.slice(0, 120) : null; };
    const crit = {
      req_degree_level: ['bachelors', 'masters', 'phd', 'any'].includes(String(c.req_degree_level || '').toLowerCase()) ? String(c.req_degree_level).toLowerCase() : null,
      req_field: strOrNull(c.req_field),
      req_min_cgpa: numOrNull(c.req_min_cgpa),
      req_cgpa_scale: numOrNull(c.req_cgpa_scale),
      req_language: strOrNull(c.req_language),
      req_language_min: numOrNull(c.req_language_min),
      req_nationality: strOrNull(c.req_nationality),
      req_experience_years: numOrNull(c.req_experience_years),
      req_license: strOrNull(c.req_license),
      req_documents: Array.isArray(c.req_documents) ? c.req_documents.slice(0, 12).map(String) : []
    };
    for (const [k, v] of Object.entries(crit)) if (v !== null && !(Array.isArray(v) && !v.length)) row[k] = v;
    let { error } = await admin().from('opportunities').insert(row);
    // If new columns aren't migrated yet, retry without any of them so discovery never breaks.
    if (error && /funding_type|level|req_|column/.test(error.message || '')) {
      const stripped = { ...row };
      ['funding_type', 'level', 'fingerprint', 'tuition', 'application_fee', 'req_degree_level', 'req_field', 'req_min_cgpa', 'req_cgpa_scale', 'req_language', 'req_language_min', 'req_nationality', 'req_experience_years', 'req_license', 'req_documents'].forEach(k => delete stripped[k]);
      ({ error } = await admin().from('opportunities').insert(stripped));
    }
    if (!error) added++;
  }
  await admin().from('audit_log').insert({ actor: userId, event: 'DISCOVER', detail: kind + ': +' + added });
  return added;
}

/* ---------- PREPARE: documents from the user's REAL profile only ---------- */
async function prepareApplication(appId) {
  const { data: a } = await admin().from('applications').select('*, opportunities(*)').eq('id', appId).single();
  if (!a) return;
  const { data: p } = await admin().from('profiles').select('*').eq('id', a.user_id).single();
  const opp = a.opportunities;
  await admin().from('applications').update({ stage: 'preparing', prep_status: { plan: ['CV', 'Cover letter'], done: [] } }).eq('id', appId);

  const profileBlock =
`APPLICANT (real facts only, never invent): ${p.full_name}; ${p.headline || ''}; field ${p.field || ''}; skills ${p.methods || ''}; education ${JSON.stringify(p.education || []).slice(0, 600)}; publications ${JSON.stringify(p.publications || []).slice(0, 600)}; experience ${JSON.stringify(p.experience || []).slice(0, 600)}`;

  const mk = async (kind, title, instruction) => {
    let content = '';
    try {
      content = noSmell(await callAI('high_value',
        `${STYLE}\n\n${profileBlock}\n\nPOSITION: ${opp.title} at ${opp.institution}${opp.country_code ? ', ' + opp.country_code : ''}. ${instruction}`,
        { maxTokens: 2200, userId: a.user_id, applicationId: appId }));
    } catch (e) { /* guaranteed-document rule below */ }
    if (!content || content.length < 200) {
      content = noSmell(`${p.full_name}\n${p.headline || ''}\n\n${kind === 'cv'
        ? 'PROFILE\n' + (p.field || '') + '. Core skills: ' + (p.methods || '') + '.\n\nEDUCATION\n' + (p.education || []).map(e => `${e.degree || ''}, ${e.institution || ''}, ${e.year || ''}`).join('\n') + '\n\nPUBLICATIONS\n' + (p.publications || []).map(x => typeof x === 'string' ? x : x.title || '').join('\n')
        : 'Dear Selection Committee,\n\nI am writing to apply for the ' + opp.title + ' at ' + opp.institution + '. My background in ' + (p.field || 'my field') + ' aligns directly with this position, and my documents are attached for your consideration.\n\nThank you for your time.\n\nKind regards,\n' + p.full_name}`);
    }
    await admin().from('application_documents').delete().eq('application_id', appId).eq('kind', kind);
    await admin().from('application_documents').insert({ application_id: appId, user_id: a.user_id, kind, title, content });
    const { data: cur } = await admin().from('applications').select('prep_status').eq('id', appId).single();
    const ps = (cur && cur.prep_status) || { plan: [], done: [] };
    ps.done = [...new Set([...(ps.done || []), title])];
    await admin().from('applications').update({ prep_status: ps }).eq('id', appId);
  };

  // Progressive eligibility: classify what this application needs NOW vs later (never blocks browsing)
  try {
    const { data: mydocs } = await admin().from('documents').select('kind').eq('user_id', a.user_id);
    const have = (mydocs || []).map(d => d.kind);
    const txt = await callAI('main',
      `Position: ${opp.title} at ${opp.institution} (${opp.kind}). Applicant already uploaded: ${have.join(', ') || 'nothing'}.
Classify realistic document requirements. For work positions include the licensing/registration steps (license exams are eligibility, never inferred from a degree alone). JSON only:
{"required_now":["needed to SUBMIT this application"],"required_later":["needed after acceptance, visa stage"],"optional":["strengthens the case"],"missing_urgent":["required_now items the applicant has NOT uploaded"]}`,
      { maxTokens: 500, userId: a.user_id, applicationId: appId });
    const reqs = parseJSON(txt);
    if (reqs) {
      const { data: cur0 } = await admin().from('applications').select('prep_status').eq('id', appId).single();
      const ps0 = (cur0 && cur0.prep_status) || {};
      ps0.reqs = reqs;
      await admin().from('applications').update({ prep_status: ps0 }).eq('id', appId);
    }
  } catch (e) {}

  // Spec 28: the package/document plan is admin-configurable (Settings -> case_plan).
  const DOC_CATALOG = {
    cv: ['CV', 'Write an opportunity-specific CV from ONLY the real facts above. Include EVERY real publication and degree, never drop one, never invent. Bold section headings, most relevant research first.'],
    cover: ['Cover letter', 'Write a one-page cover letter, warm, confident, specific to this institution and role, stating documents are attached.'],
    sop: ['Statement of Purpose', 'Write a focused statement of purpose grounded ONLY in the real facts above: motivation, fit with this specific program/institution, and concrete goals. No invented achievements.'],
    research_proposal: ['Research proposal outline', 'Write a short research proposal outline aligned with this position, grounded ONLY in the applicant\'s real background above; frame realistic aims, never invent prior results.'],
    scholarship_statement: ['Scholarship statement', 'Write a concise scholarship/financial-need statement grounded ONLY in the real facts above, professional and specific to this opportunity.']
  };
  let plan = ['cv', 'cover'];
  try {
    const cfg = await require('./settings').getConfig();
    const wanted = (cfg.case_plan && cfg.case_plan.docs) || [];
    const valid = wanted.filter(k => DOC_CATALOG[k]);
    if (valid.length) plan = valid;
  } catch (e) {}
  for (const k of plan) await mk(k, DOC_CATALOG[k][0], DOC_CATALOG[k][1]);

  await draftMessage(appId);
}

/* ---------- DRAFT: guaranteed email, hunted or fallback; R4 authorization gate ---------- */
async function draftMessage(appId) {
  const { data: a } = await admin().from('applications').select('*, opportunities(*)').eq('id', appId).single();
  if (!a) return;
  const { data: p } = await admin().from('profiles').select('*').eq('id', a.user_id).single();
  const opp = a.opportunities;
  // RecipientDiscoveryService (spec #12/#13): determine the correct recipient, verify, assign
  // confidence and source. Independent, reusable module — never invents an address.
  const recipients = require('./recipients');
  const rec = await recipients.discover(opp, callAI, { userId: a.user_id, applicationId: appId });
  if (rec.email) await recipients.persist(opp.id, rec);
  let emails = rec.email ? [rec.email, ...rec.alternatives].filter(Boolean) : cleanEmails(opp.contact_emails || []);
  let subject = '', body = '';
  const greetTo = rec.recipientName ? rec.recipientName : (rec.roleLabel || (opp.kind === 'work' ? 'Hiring Team' : 'Selection Committee'));
  try {
    const txt = await callAI('high_value',
      `${STYLE}\n\nWrite a first-contact application email (150-200 words, MUST be under 1600 characters total) from ${p.full_name} (${p.headline || ''}, ${p.field || ''}) for: ${opp.title} at ${opp.institution}. Address it to ${greetTo}. Specific, warm, respectful; documents stated as attached; courteous close. Respond ONLY with JSON {"subject":"","body":""}`,
      { maxTokens: 700, json: true, userId: a.user_id, applicationId: appId });
    const d = parseJSON(txt) || {};
    subject = noSmell(d.subject || '').slice(0, 200); body = noSmell(d.body || '').slice(0, 1700);
  } catch (e) {}
  if (!body) {
    subject = 'Application, ' + (opp.title || '').slice(0, 80) + ', ' + p.full_name;
    body = noSmell(`Dear ${greetTo},\n\nI am writing to apply for the ${opp.title} at ${opp.institution}. My background in ${p.field || 'my field'} matches this position closely, and my CV and cover letter are attached for your consideration.\n\nThank you for your time, I would welcome the opportunity to discuss my application.\n\nKind regards,\n${p.full_name}`);
  }
  await admin().from('messages').delete().eq('application_id', appId).eq('status', 'pending');
  if (emails.length) {
    // Email route: a verified recipient exists (personal, or official department/HR inbox).
    await admin().from('messages').insert({
      user_id: a.user_id, application_id: appId, direction: 'outbound',
      to_emails: emails, subject, body, status: 'pending'
    });
    await admin().from('applications').update({
      stage: 'awaiting_authorization', updated_at: new Date().toISOString(),
      next_action: 'Review the email and authorize sending'
    }).eq('id', appId);
  } else {
    // No verified email anywhere official -> NEVER a blank recipient. Prepare the full package
    // for the official application portal instead, with a concrete next action and link.
    const portalUrl = opp.url || '';
    await admin().from('applications').update({
      stage: 'portal_apply', submission_method: 'portal', updated_at: new Date().toISOString(),
      portal_url: portalUrl || null,
      next_action: portalUrl
        ? 'This opportunity accepts applications on its official portal. Your CV, letter and documents are ready — apply at the official link.'
        : 'This opportunity has no published email or portal yet. We will keep checking; your prepared documents are saved and ready.'
    }).eq('id', appId);
  }
}

module.exports = { discoverForUser, prepareApplication, draftMessage, cleanEmails, noSmell, parseJSON };
