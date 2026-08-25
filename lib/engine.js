// lib/engine.js — ForiForeign pipeline: discover -> verify -> prepare -> draft
// Ported from the battle-tested PostDocX rules: evidence-only, no invented emails,
// truthful documents, no AI-smell, guaranteed drafts, human authorization (R4).
const { admin } = require('./supa');
const { callAI } = require('./router');

const STYLE = `STRICT OUTPUT RULES: never use the words tailored, customized, AI, Claude, GPT, generated, or template. Never leave placeholder brackets like [name] or blank fields, omit unknowns and write around them. No em dashes, no bullet spam, flowing professional prose a senior applicant would sign, ready to send with zero editing. Respond with the final text only.`;

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
  const prompt =
`Search the web NOW for currently-open, real ${kind === 'work' ? 'jobs abroad for a Pakistani ' + (p.headline || 'medical professional') : kind + ' opportunities'} matching this applicant:
${p.headline || ''}; field ${p.field || ''}; skills ${String(p.methods || '').slice(0, 200)}. ${budgetLine} ${licenseLine}
QUALITY BAR: only positions you verified on the OFFICIAL university/employer page, currently open, funded/paid. Extract contact emails ONLY if literally printed on official pages, never guessed.
Respond ONLY with a JSON array, up to 5 items:
[{"title":"","institution":"","country_code":"ISO2","city":"","url":"official page","deadline":"YYYY-MM-DD or empty","funding":"","stipend":"","duration":"","contact_emails":["seen on official pages only"],"apply_via":"email|portal"}]`;
  const txt = await callAI('search_verify', prompt, { search: true, searchUses: 5, maxTokens: 1800, userId });
  const items = parseJSON(txt) || [];
  let added = 0;
  for (const it of items) {
    if (!it.url || !it.institution) continue;
    const { data: dup } = await admin().from('opportunities').select('id').eq('url', it.url).limit(1);
    if (dup && dup.length) continue;
    const emails = cleanEmails(it.contact_emails);
    const { error } = await admin().from('opportunities').insert({
      kind, title: noSmell(it.title).slice(0, 300), institution: noSmell(it.institution).slice(0, 200),
      country_code: (it.country_code || '').slice(0, 2).toUpperCase() || null,
      city: it.city || '', url: it.url,
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(it.deadline || '') ? it.deadline : null,
      funding: it.funding || '', stipend: it.stipend || '', duration: it.duration || '',
      contact_emails: emails, apply_via: emails.length ? (it.apply_via === 'portal' ? 'both' : 'email') : 'portal',
      status: 'verified', verified_at: new Date().toISOString(), source: 'agent'
    });
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

  await mk('cv', 'CV', 'Write an opportunity-specific CV from ONLY the real facts above. Include EVERY real publication and degree, never drop one, never invent. Bold section headings, most relevant research first.');
  await mk('cover', 'Cover letter', 'Write a one-page cover letter, warm, confident, specific to this institution and role, stating documents are attached.');

  await draftMessage(appId);
}

/* ---------- DRAFT: guaranteed email, hunted or fallback; R4 authorization gate ---------- */
async function draftMessage(appId) {
  const { data: a } = await admin().from('applications').select('*, opportunities(*)').eq('id', appId).single();
  if (!a) return;
  const { data: p } = await admin().from('profiles').select('*').eq('id', a.user_id).single();
  const opp = a.opportunities;
  let emails = cleanEmails(opp.contact_emails || []);
  if (!emails.length) {
    try {
      const huntTxt = await callAI('search_verify',
        `Find a REAL contact email for: ${opp.title} at ${opp.institution}. Check the posting, staff directory, department page. JSON array of addresses literally SEEN on official pages, never guessed: ["..."] or []`,
        { search: true, searchUses: 3, maxTokens: 250, userId: a.user_id, applicationId: appId });
      emails = cleanEmails(parseJSON(huntTxt) || []);
      if (emails.length) await admin().from('opportunities').update({ contact_emails: emails, apply_via: 'both' }).eq('id', opp.id);
    } catch (e) {}
  }
  let subject = '', body = '';
  try {
    const txt = await callAI('high_value',
      `${STYLE}\n\nWrite a first-contact application email (170-220 words) from ${p.full_name} (${p.headline || ''}, ${p.field || ''}) for: ${opp.title} at ${opp.institution}. Specific, warm, respectful; documents stated as attached; courteous close. Respond ONLY with JSON {"subject":"","body":""}`,
      { maxTokens: 700, userId: a.user_id, applicationId: appId });
    const d = parseJSON(txt) || {};
    subject = noSmell(d.subject || '').slice(0, 200); body = noSmell(d.body || '');
  } catch (e) {}
  if (!body) {
    subject = 'Application, ' + (opp.title || '').slice(0, 80) + ', ' + p.full_name;
    body = noSmell(`Dear ${opp.kind === 'work' ? 'Hiring Team' : 'Selection Committee'},\n\nI am writing to apply for the ${opp.title} at ${opp.institution}. My background in ${p.field || 'my field'} matches this position closely, and my CV and cover letter are attached for your consideration.\n\nThank you for your time, I would welcome the opportunity to discuss my application.\n\nKind regards,\n${p.full_name}`);
  }
  await admin().from('messages').delete().eq('application_id', appId).eq('status', 'pending');
  await admin().from('messages').insert({
    user_id: a.user_id, application_id: appId, direction: 'outbound',
    to_emails: emails, subject, body, status: 'pending'
  });
  // R4: email route waits for authorization; portal-only becomes a human task with everything prepared
  await admin().from('applications').update({
    stage: 'awaiting_authorization', updated_at: new Date().toISOString(),
    next_action: emails.length ? 'Review the email and authorize sending' : 'No official email published. Apply on the portal with your prepared documents.'
  }).eq('id', appId);
}

module.exports = { discoverForUser, prepareApplication, draftMessage, cleanEmails, noSmell, parseJSON };
