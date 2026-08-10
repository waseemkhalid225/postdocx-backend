// lib/agent.js — the PostDocX daily cycle
const { claude, parseJSON, getUsage } = require('./anthropic');
const db = require('./sheets');
const { sendMail, checkReplies } = require('./mailer');
const { decrypt } = require('./crypt');
const gdrive = require('./drive');
const storage = require('./storage');
async function fileBuffer(id) { return storage.isStorageId(id) ? storage.get(id) : gdrive.getBuffer(id); }
const { gptReview, gptDraft } = require('./openai');

function userCreds(u) { // full send capability
  if (u && u.emailConnected === 'yes' && u.smtpEmail && u.encPass) {
    const pass = decrypt(u.encPass);
    if (pass) return { user: u.smtpEmail, pass };
  }
  return null; // falls back to the global GMAIL_USER account with Reply-To the researcher
}
function imapCreds(u) { // read capability (also covers imap-only connections)
  if (u && (u.emailConnected === 'yes' || u.emailConnected === 'imap') && u.smtpEmail && u.encPass) {
    const pass = decrypt(u.encPass);
    if (pass) return { user: u.smtpEmail, pass };
  }
  return null;
}

const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const clamp = n => Math.max(0, Math.min(100, parseInt(n) || 0));

const STYLE = `Writing style, mandatory: BANNED phrases and patterns, never use any of these: "I am writing to express", "I hope this email finds you well", "esteemed", "renowned", "prestigious", "I would be honored", "passionate about", "keen interest", "delve", "leverage", "cutting edge", "state of the art", "aligns with my", "resonates", "moreover", "furthermore", "in conclusion", "as an AI", chains of three parallel clauses, and any sentence that could open a thousand other applicants' emails. Anchoring rule: every substantive sentence must contain something specific and checkable, a real paper, a real method, a real result, a real system the applicant built, or a real finding of the recipient's group; if a sentence would survive with the names swapped out, rewrite it. write in the natural voice of an experienced researcher, first person where appropriate. Plain, precise, confident academic English. Vary sentence length and rhythm. Never use em dashes or en dashes anywhere; use commas, colons or a new sentence instead. Avoid formulaic phrasing such as "delve", "moreover", "furthermore", "in conclusion", "cutting-edge", "novel insights", "paradigm". No bullet points inside prose. No padding, no symmetrical three-part sentences, no generic openings. Every factual claim must come from the researcher's real profile or from literature you actually found.`;


/* ---------- SOURCE TRUST FILTER ---------- */
const PREDATORY = ['axact', 'degree-mill', 'diplomamill', 'instantdegrees'];
const AGGREGATORS = ['indeed.', 'linkedin.com/jobs', 'glassdoor.', 'ziprecruiter.', 'simplyhired.', 'jooble.', 'careerjet.'];
function sourceTrust(url, institution) {
  const u = String(url || '').toLowerCase(), inst = String(institution || '').toLowerCase();
  const blocked = (process.env.BLOCKED_INSTITUTIONS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (PREDATORY.some(b => u.includes(b) || inst.includes(b))) return 'blocked';
  if (blocked.some(b => b && (u.includes(b) || inst.includes(b)))) return 'blocked';
  if (/\.(edu|ac\.[a-z]{2}|edu\.[a-z]{2})([/:]|$)/.test(u)) return 'trusted';
  if (AGGREGATORS.some(a => u.includes(a))) return 'aggregator';
  return 'normal';
}
// Visa quick-reference for Pakistani passport holders (applied as a note per country)
const VISA = {
  'germany': 'Germany: EU Blue Card or researcher visa (sec.18d), 6-10 wk processing, family joins with work rights',
  'uk': 'UK: Global Talent or Skilled Worker route, endorsement can take 4-8 wk, dependants allowed',
  'united kingdom': 'UK: Global Talent or Skilled Worker route, endorsement can take 4-8 wk, dependants allowed',
  'usa': 'USA: J-1 (most postdocs) or H-1B, J-1 has 2-yr home rule unless waived, spouse J-2 can request work permit',
  'united states': 'USA: J-1 (most postdocs) or H-1B, J-1 has 2-yr home rule unless waived, spouse J-2 can request work permit',
  'canada': 'Canada: closed work permit with LMIA-exempt category for postdocs, spouse gets open work permit',
  'netherlands': 'Netherlands: highly skilled migrant scheme via university sponsor, fast (2-4 wk), partner can work',
  'denmark': 'Denmark: researcher fast-track scheme, partner gets work rights',
  'sweden': 'Sweden: researcher residence permit, family included',
  'switzerland': 'Switzerland: non-EU quota permits, university sponsors, allow 8-12 wk',
  'saudi arabia': 'KSA: employer-sponsored iqama, university handles it, family sponsorship possible',
  'uae': 'UAE: employer-sponsored residence, fast, family sponsorship straightforward',
  'qatar': 'Qatar: employer-sponsored RP, family sponsorship by salary threshold',
  'australia': 'Australia: subclass 482/494 via university sponsor, partner work rights included',
  'france': 'France: Passeport Talent chercheur, hosting agreement from institution, family accompanies',
  'norway': 'Norway: skilled worker/researcher permit, family included',
  'japan': 'Japan: Professor/Researcher status of residence, university sponsors, dependents allowed',
  'south korea': 'South Korea: E-3 research visa, university sponsors'
};
function visaNote(country) {
  const k = String(country || '').toLowerCase().trim();
  for (const key of Object.keys(VISA)) if (k.includes(key)) return VISA[key];
  return '';
}

// Remove em and en dashes from any generated text, whatever the model does
function noDashes(t) {
  return String(t || '').replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',').replace(/,\s*\./g, '.');
}

const RULES = `Core rules: only real, currently-open opportunities from credible primary sources; never invent institutions, PIs, emails, URLs, deadlines or publications; mark anything unconfirmed as needing verification; never misrepresent the applicant; optimize for fit quality, not volume.`;

function profileBlock(r) {
  return `RESEARCHER: ${r.name} — ${r.title}\nEMAIL: ${r.email}\nFIELD: ${r.field}\nMETHODS: ${r.methods}\nPUBLICATIONS: ${r.pubs}\nPREFERENCES: ${r.prefs}\nLINKS: ${r.links || 'n/a'}`;
}

let runtimeSendMode = null;
function setRuntimeMode(m) { runtimeSendMode = (m === 'auto') ? 'auto' : 'approval'; }
async function loadRuntimeMode() {
  try {
    const row = (await db.all('Settings')).find(x => x.key === 'sendMode');
    if (row && row.value) runtimeSendMode = row.value;
  } catch (e) {}
}

function cfg() {
  return {
    autoSend: (runtimeSendMode || process.env.SEND_MODE || 'approval').toLowerCase() === 'auto',
    maxEmailsPerDay: parseInt(process.env.MAX_EMAILS_PER_DAY || '5'),
    maxDiscover: parseInt(process.env.MAX_DISCOVER_PER_RESEARCHER || '5'),
    maxVerify: parseInt(process.env.MAX_VERIFY_PER_RUN || '6'),
    followupDays: parseInt(process.env.FOLLOWUP_DAYS || '8'),
    maxFollowups: parseInt(process.env.MAX_FOLLOWUPS || '2'),
    minEngage: parseInt(process.env.MIN_ENGAGE_SCORE || '65'),
    regions: process.env.REGIONS || 'All of Europe with special emphasis on Scandinavia (Denmark, Sweden, Norway, Finland) and English-friendly labs, UK, Ireland, USA, Canada, Australia, and the Gulf (Saudi Arabia, UAE, Qatar)',
    baseUrl: (process.env.BASE_URL || '').replace(/\/$/, ''),
    approveKey: process.env.APPROVE_KEY || 'change-me'
  };
}

/* ---------- 1. DISCOVER ---------- */
async function discover(r, report) {
  const c = cfg();
  let arr = [];
  try {
    const txt = await claude(
`${RULES}\n\n${profileBlock(r)}\n\nTASK: Search the web NOW (today: ${today()}) for currently-open postdoctoral positions, fellowships or credible hostable routes matching this researcher, a PhD holder seeking SENIOR research roles. Regions: ${c.regions}.${r.minSalary ? ' Minimum acceptable compensation: ' + r.minSalary + '. Exclude anything clearly below it.' : ''}\nQUALITY BAR, strict: only salaried or fully funded positions at reputable universities, institutes, medical schools or serious industry research groups. EXCLUDE completely: unpaid or volunteer roles, internships, PhD or MPhil studentships, master-level positions, teaching-only jobs, roles on suspicious job boards without an institutional source, and anything with vague or missing funding. Prefer the highest paying and most prestigious options: named fellowships, well funded labs, senior postdoc, research scientist or research fellow level. A position whose deadline is already past today is invalid, never include it.\nFind up to ${c.maxDiscover} real, active items. Prefer the original institutional advertisement. Include the PI's publicly listed institutional email ONLY if you actually found it on an official page, never guess an email.\nRespond with ONLY a JSON array. Each element:\n{"title":"","institution":"","country":"","pi":"","piEmail":"","url":"","deadline":"YYYY-MM-DD or empty","funding":"Fully funded|Partially funded|Hostable / self-funded|Grant-first","level":"Postdoc|Senior postdoc|Research scientist|Fellowship|Leading position","compensation":"salary or stipend if stated, with currency, else empty","summary":"1 sentence","fit":"1-2 sentences","momentum":"note if the PI or department recently won a major grant (ERC, NIH, Wellcome, DFG etc), else empty","matchScore":0-100}`,
      { system: 'You are PostDocX, an academic opportunity scout. Return only strict JSON when asked.' });
    arr = parseJSON(txt);
    if (!Array.isArray(arr)) arr = [arr];
  } catch (e) { report.errors.push(`Discovery failed for ${r.name}: ${e.message}`); return; }

  const existing = await db.all('Opportunities');
  for (const x of arr) {
    if (!x.title || !x.institution) continue;
    const dupKey = (r.id + '|' + x.institution + '|' + x.title).toLowerCase().replace(/\s+/g, ' ');
    if (existing.some(o => o.dupKey === dupKey)) { report.dupes++; continue; }
    await db.add('Opportunities', {
      id: uid(), resId: r.id, title: x.title, institution: x.institution, country: x.country || '',
      pi: x.pi || '', url: x.url || '', deadline: isDate(x.deadline) ? x.deadline : '',
      funding: x.funding || 'Funding TBC', status: 'NEEDS_VERIFICATION',
      matchScore: clamp(x.matchScore),
      note: [x.summary, x.fit, x.momentum ? 'Momentum: ' + x.momentum : '', x.piEmail ? 'PI email: ' + x.piEmail : '', visaNote(x.country)].filter(Boolean).join(' | '),
      dupKey, addedOn: today(), verifiedOn: '', coupleKey: '', category: 'international_job',
      level: x.level || 'Postdoc', compensation: x.compensation || '', section: 'postdoc'
    });
    report.discovered.push(`${x.title} — ${x.institution} (${clamp(x.matchScore)}/100) [${r.name}]`);
  }
}

/* ---------- 2. VERIFY ---------- */
async function verifyBatch(report) {
  const c = cfg();
  const opps = (await db.all('Opportunities'))
    .filter(o => o.status === 'NEEDS_VERIFICATION')
    .sort((a, b) => {
      const pa = (a.section || 'postdoc') === 'postdoc' ? 1 : 0;
      const pb = (b.section || 'postdoc') === 'postdoc' ? 1 : 0;
      if (pb - pa) return pb - pa; // postdoc always verified first
      return (parseInt(b.matchScore) || 0) - (parseInt(a.matchScore) || 0);
    })
    .slice(0, c.maxVerify);
  await Promise.allSettled(opps.map(async o => {
    try {
      const txt = await claude(
`${RULES}\n\nSearch the web to verify whether this position is REAL and CURRENTLY ACTIVE today (${today()}):\nTitle: ${o.title}\nInstitution: ${o.institution}\nURL: ${o.url || 'unknown'}\nRules: if the application deadline has already passed relative to today, or the posting page is gone, or the advertisement is clearly stale (posted long ago with no live deadline), answer verified:false. A position is verified true ONLY if the original institutional page is live and accepting applications now.\nRespond ONLY with JSON: {"verified":true|false|"unclear","deadline":"YYYY-MM-DD or empty","contactEmail":"official application/PI email if publicly listed, else empty","note":"1-2 sentences"}`, { searchUses: 3 });
      const v = parseJSON(txt);
      o._row.set('status', v.verified === true ? 'VERIFIED' : v.verified === false ? 'EXPIRED' : 'NEEDS_VERIFICATION');
      if (isDate(v.deadline)) o._row.set('deadline', v.deadline);
      if (v.contactEmail && /@/.test(v.contactEmail)) o._row.set('note', (o.note + ' | Contact: ' + v.contactEmail).slice(0, 900));
      o._row.set('verifiedOn', today());
      await o._row.save();
      if (v.verified === true && (parseInt(o.matchScore) || 0) >= cfg().minEngage) await ensureCase(o, 'Verified');
      report.verified.push(`${o.title} — ${o.institution}: ${v.verified === true ? 'ACTIVE ✓' : v.verified === false ? 'expired ✗' : 'unclear'}`);
    } catch (e) { report.errors.push(`Verify failed (${o.institution}): ${e.message}`); }
  }));
}

/* ---------- 3. DRAFT OUTREACH for verified high matches ---------- */
function extractEmail(text) {
  const m = String(text || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : '';
}

async function draftOutreachBatch(researchers, report) {
  const opps = await db.all('Opportunities');
  const outbox = await db.all('Outbox');
  const winners = outbox.filter(m => m.replied === 'yes' && m.type === 'outreach').map(m => m.subject).slice(-5);
  const learn = winners.length ? `\nSubject lines that earned replies before (match their concreteness, do not copy): ${winners.join(' | ')}` : '';
  const targets = opps.filter(o =>
    o.status === 'VERIFIED' && (parseInt(o.matchScore) || 0) >= cfg().minEngage &&
    (!isDate(o.deadline) || o.deadline > today()) &&
    !outbox.some(m => m.oppId === o.id));
  await Promise.allSettled(targets.slice(0, 4).map(async o => {
    const r = researchers.find(x => x.id === o.resId);
    if (!r) return;
    const toEmail = extractEmail(o.note);
    try {
      const txt = await claude(
`${RULES}\n\n${profileBlock(r)}\n\nVERIFIED OPPORTUNITY: ${o.title} at ${o.institution}${o.pi ? ', PI ' + o.pi : ''}. Notes: ${o.note}\n\n${STYLE}\n\nWrite a warm, respectful, confident first-contact email from the applicant to the supervisor, 180 to 240 words, in flowing prose paragraphs with no bullets and no headings. First, a genuine specific opening showing real familiarity with the supervisor's recent work, naming one concrete recent result of theirs precisely. Then a brief confident introduction of the applicant and directly relevant strengths, grounded in real published work. Then one concrete idea or research gap where the applicant's specific methods could contribute to the supervisor's current work. Then a clear warm statement that the applicant HAS ATTACHED a tailored CV and a short research concept note for their consideration (the documents ARE attached, so never ask permission to send them and never say could I send), that the applicant would welcome discussing a postdoctoral position, and would actively pursue external fellowship funding together. Then a courteous respectful closing thanking them for their time and consideration. Warm and human, never servile, never boastful. BEFORE writing, search the web for this supervisor's 2-3 most recent relevant publications and current research directions, then anchor the email in ONE specific recent result of theirs, named precisely (paper topic or finding, not a generic compliment), connected to a specific capability of the applicant. No flattery, no invented facts. SUBJECT RULE: the subject line must name the supervisor's specific research topic or the position, never generic greetings like Good morning, Hello, Postdoc inquiry, Job application or Seeking position.${learn}\nRespond ONLY with JSON: {"subject":"","body":""}`, { premium: true, search: true, searchUses: 3 });
      const d = parseJSON(txt);
      if (!d.subject || !d.body) throw new Error('empty draft');
      d.subject = fixSubject(noDashes(d.subject), o); d.body = noDashes(d.body);
      await db.add('Outbox', {
        id: uid(), resId: r.id, oppId: o.id, toEmail, toName: o.pi || o.institution,
        subject: d.subject, body: d.body, type: 'outreach',
        status: toEmail ? 'PENDING' : 'NO_EMAIL', createdOn: today(),
        sentOn: '', followups: '0', lastFollowupOn: '', replied: ''
      });
      await caseStageByOpp(o.id, toEmail ? 'Email prepared' : 'Verified', toEmail ? 'Approve outreach' : 'NO VERIFIED EMAIL — add contact manually');
      // Auto-prepare the full document package for every engaged position (CV + concept/cover), attached on send
      tailoredCV(o.id).catch(() => {});
      if ((o.section || 'postdoc') === 'job') coverLetter(o.id).catch(() => {});
      else draftProposal(o.id).catch(() => {});
      // If the only route is a web portal (no email found), capture it as a ready-to-submit task
      if (!toEmail && o.url) {
        const tset = await db.all('Tasks');
        const ttl = 'Submit on portal: ' + o.url;
        if (!tset.some(t => t.oppId === o.id && t.title === ttl)) {
          await db.add('Tasks', { id: uid(), resId: o.resId, oppId: o.id, category: o.category || 'international_job', title: ttl, status: 'Open', createdOn: today() });
        }
      }
      report.drafted.push(`${o.pi || o.institution} — "${d.subject}" ${toEmail ? '' : '(no public email found — add manually in Outbox)'}`);
    } catch (e) { report.errors.push(`Draft failed (${o.institution}): ${e.message}`); }
  }));
}


function fixSubject(subj, opp) {
  const bad = /^(good (morning|day|evening|afternoon)|hello|hi|greetings|dear\b|postdoc(toral)?( position| inquiry| application)?$|job application|application for|seeking( a)? (position|job)|opportunity)/i;
  const sj = String(subj || '').trim();
  if (!sj || sj.length < 18 || bad.test(sj)) {
    return ('Research direction for ' + (opp ? opp.title + ', ' + opp.institution : 'your laboratory')).slice(0, 90);
  }
  return sj;
}
/* ---------- 4. SEND or QUEUE ---------- */
async function sendBatch(researchers, report) {
  const c = cfg();
  const outbox = await db.all('Outbox');
  const sentToday = outbox.filter(m => m.sentOn === today()).length;
  let budget = Math.max(0, c.maxEmailsPerDay - sentToday);
  const oppsNow = await db.all('Opportunities');
  const chanceRank = c => /strong/i.test(c) ? 0 : /moderate/i.test(c) ? 1 : 2;
  const ready = outbox.filter(m => {
    if (!((m.status === 'PENDING' || m.status === 'APPROVED') && m.toEmail)) return false;
    const o = oppsNow.find(x => x.id === m.oppId);
    if (o && isDate(o.deadline) && o.deadline < today()) return false;
    return true;
  }).sort((a, b) => {
    const oa = oppsNow.find(x => x.id === a.oppId) || {}, ob = oppsNow.find(x => x.id === b.oppId) || {};
    // #5 nearer deadline first
    const da = isDate(oa.deadline) ? new Date(oa.deadline) : new Date('2099-01-01');
    const dbb = isDate(ob.deadline) ? new Date(ob.deadline) : new Date('2099-01-01');
    if (da - dbb) return da - dbb;
    // #2 stronger chance first
    return chanceRank(oa.chance || '') - chanceRank(ob.chance || '');
  });
  for (const m of ready) {
    const mustApprove = !c.autoSend && m.status !== 'APPROVED';
    if (mustApprove) { report.awaiting.push(m); continue; }
    if (c.autoSend && m.oppId) {
      const o2 = oppsNow.find(x => x.id === m.oppId);
      if (o2) { const rd = await computeReadiness(o2); if (!rd.ready) { report.awaiting.push(m); continue; } }
    }
    if (budget <= 0) { report.awaiting.push(m); continue; }
    const r = researchers.find(x => x.id === m.resId) || {};
    try {
      let attachments = [];
      if (m.type === 'outreach') {
        const docs = await db.all('Documents');
        const cv = docs.find(d => d.resId === m.resId && /cv/i.test(d.type) && d.attach === 'yes');
        if (cv) {
          try {
            if (cv.driveId) attachments = [{ filename: cv.name || 'CV.pdf', content: await fileBuffer(cv.driveId) }];
            else if (cv.url) attachments = [{ filename: (cv.name || 'CV') + '.pdf', path: cv.url }];
          } catch (e) { /* attachment optional */ }
        }
      }
      const creds = userCreds(r);
      await sendMail({
        to: m.toEmail, subject: m.subject,
        text: m.body + `\n\nBest regards,\n${r.name || ''}\n${r.title || ''}${r.email ? '\n' + r.email : ''}${r.orcid ? '\nORCID: ' + (r.orcid.startsWith('http') ? r.orcid : 'https://orcid.org/' + r.orcid) : ''}${r.schedLink ? '\nBook a call: ' + r.schedLink : ''}${/scholar\.google/i.test(r.links || '') ? '\nGoogle Scholar: ' + ((r.links.match(/https?:\/\/scholar\.google[^\s,]+/i) || [''])[0]) : ''}`,
        fromName: r.name, attachments, creds,
        replyTo: creds ? undefined : (r.email || undefined),
        bcc: r.email || undefined
      });
      m._row.set('status', 'SENT'); m._row.set('sentOn', today());
      await m._row.save();
      budget--;
      if (m.oppId) await caseStageByOpp(m.oppId, 'Sent', 'Await reply');
      report.sent.push(`${m.toName} <${m.toEmail}> — "${m.subject}"`);
      await db.log('EMAIL_SENT', `${m.toEmail} | ${m.subject}`);
    } catch (e) { report.errors.push(`Send failed (${m.toEmail}): ${e.message}`); }
  }
}


/* ---------- SEND ONE OUTBOX ITEM IMMEDIATELY (used by Approve and send) ---------- */
async function sendOne(outboxId, opts) {
  await db.connect();
  const m = (await db.all('Outbox')).find(x => x.id === outboxId);
  if (!m) return { ok: false, error: 'Draft not found' };
  if (m.status === 'SENT') return { ok: false, error: 'Already sent' };
  if (!m.toEmail) return { ok: false, error: 'No verified recipient email on this draft. The agent could not find an official address, add it in the case before sending.' };
  // #7 readiness gate: in auto mode, never send a case that is not fully prepared
  if (opts && opts.enforceReadiness && m.oppId) {
    const o2 = (await db.all('Opportunities')).find(o => o.id === m.oppId);
    if (o2) { const rd = await computeReadiness(o2); if (!rd.ready) return { ok: false, error: 'Case not fully prepared (' + rd.pct + '%). Missing: ' + (rd.missing.join(', ') || 'documents still generating') + '.' }; }
  }
  const opp = (await db.all('Opportunities')).find(o => o.id === m.oppId);
  if (opp && isDate(opp.deadline) && opp.deadline < today()) return { ok: false, error: 'This position deadline has passed, not sending.' };
  const r = (await db.all('Users')).find(x => x.id === m.resId) || {};
  const creds = userCreds(r);
  let attachments = [];
  if (m.type === 'outreach' || m.type === 'application') {
    const docs = await db.all('Documents');
    const attachDocs = docs.filter(d => d.resId === m.resId && d.attach === 'yes' && d.driveId);
    for (const d of attachDocs.slice(0, 5)) {
      try { attachments.push({ filename: d.name || (d.type + '.pdf'), content: await fileBuffer(d.driveId) }); } catch (e) {}
    }
  }
  const sig = `\n\nBest regards,\n${r.name || ''}\n${r.title || ''}${r.email ? '\n' + r.email : ''}${r.orcid ? '\nORCID: ' + (r.orcid.startsWith('http') ? r.orcid : 'https://orcid.org/' + r.orcid) : ''}${r.schedLink ? '\nBook a call: ' + r.schedLink : ''}`;
  try {
    await sendMail({ to: m.toEmail, subject: m.subject, text: m.body + sig, fromName: r.name, attachments, creds, replyTo: creds ? undefined : (r.email || undefined), bcc: r.email || undefined });
    m._row.set('status', 'SENT'); m._row.set('sentOn', today()); await m._row.save();
    if (m.oppId) await caseStageByOpp(m.oppId, 'Sent', 'Await reply');
    await db.log('EMAIL_SENT', m.toEmail + ' | ' + m.subject);
    return { ok: true, to: m.toEmail, attachments: attachments.length };
  } catch (e) {
    await db.log('SEND_FAILED', m.toEmail + ' | ' + e.message);
    return { ok: false, error: e.message };
  }
}

/* ===== FEATURE 4: reminder system ===== */
async function buildReminders() {
  await db.connect();
  const [opps, cases, outbox, reminders, users] = await Promise.all([
    db.all('Opportunities'), db.all('Cases'), db.all('Outbox'), db.all('Reminders'), db.all('Users')
  ]);
  const existing = new Set(reminders.filter(r => r.status !== 'done').map(r => r.oppId + '|' + r.kind));
  const add = [];
  const todayD = new Date();
  for (const o of opps) {
    if (o.status === 'EXPIRED' || o.archived === 'yes') continue;
    // deadline approaching (within 10 days)
    if (isDate(o.deadline)) {
      const days = Math.ceil((new Date(o.deadline) - todayD) / 86400000);
      if (days >= 0 && days <= 10 && !existing.has(o.id + '|deadline')) {
        add.push({ id: uid(), resId: o.resId, oppId: o.id, kind: 'deadline', dueOn: o.deadline, note: o.institution + ': deadline in ' + days + ' day(s)', status: 'open', createdOn: today() });
      }
    }
  }
  // awaiting reply too long (sent >8 days ago, no reply)
  for (const m of outbox) {
    if (m.status === 'SENT' && m.replied !== 'yes' && m.sentOn) {
      const days = Math.floor((todayD - new Date(m.sentOn + 'T00:00:00')) / 86400000);
      if (days >= 8 && days <= 30 && !existing.has(m.oppId + '|awaiting')) {
        const o = opps.find(x => x.id === m.oppId) || {};
        add.push({ id: uid(), resId: m.resId, oppId: m.oppId || '', kind: 'awaiting', dueOn: today(), note: (o.institution || m.toName) + ': no reply in ' + days + ' days, follow-up may help', status: 'open', createdOn: today() });
      }
    }
  }
  if (add.length) await db.addMany('Reminders', add);
  return add.length;
}
/* ---------- 5. FOLLOW-UPS ---------- */
async function followups(researchers, report) {
  const c = cfg();
  const outbox = await db.all('Outbox');
  for (const m of outbox) {
    if (m.status !== 'SENT' || m.replied === 'yes') continue;
    const nFu = parseInt(m.followups) || 0;
    if (nFu >= c.maxFollowups) continue;
    const last = m.lastFollowupOn || m.sentOn;
    if (!last) continue;
    const daysSince = Math.floor((Date.now() - new Date(last + 'T00:00:00')) / 86400000);
    if (daysSince < c.followupDays) continue;
    const r = researchers.find(x => x.id === m.resId) || {};
    try {
      const txt = await claude(
`${STYLE}\n\nWrite a very short (under 70 words), courteous, professional follow-up email from ${r.name} to ${m.toName} regarding the earlier message "${m.subject}". Do not guilt-trip, do not repeat the whole pitch; add one small new element of value (e.g. availability for a brief call or a relevant recent result from the researcher's real profile: ${r.pubs}). Respond ONLY with JSON: {"subject":"","body":""}`,
        { search: false, maxTokens: 500 });
      const d = parseJSON(txt);
      d.subject = noDashes(d.subject); d.body = noDashes(d.body);
      if (cfg().autoSend) {
        await sendMail({ to: m.toEmail, subject: d.subject, text: d.body + `\n\nBest regards,\n${r.name || ''}`, fromName: r.name });
        m._row.set('followups', String(nFu + 1)); m._row.set('lastFollowupOn', today());
        await m._row.save();
        report.sent.push(`Follow-up ${nFu + 1} → ${m.toName}`);
      } else {
        await db.add('Outbox', {
          id: uid(), resId: m.resId, oppId: m.oppId, toEmail: m.toEmail, toName: m.toName,
          subject: d.subject, body: d.body, type: 'followup', status: 'PENDING',
          createdOn: today(), sentOn: '', followups: String(nFu + 1), lastFollowupOn: '', replied: ''
        });
        m._row.set('followups', String(nFu + 1)); m._row.set('lastFollowupOn', today());
        await m._row.save();
        report.drafted.push(`Follow-up draft → ${m.toName} (awaiting approval)`);
      }
    } catch (e) { report.errors.push(`Follow-up failed (${m.toEmail}): ${e.message}`); }
  }
}

/* ---------- 6. REPLY DETECTION ---------- */
async function detectReplies(report) {
  const outbox = await db.all('Outbox');
  const users = await db.all('Users');
  const seen = new Set();
  async function scan(creds, items) {
    const known = [...new Set(items.filter(m => m.status === 'SENT' && m.toEmail).map(m => m.toEmail.toLowerCase()))];
    if (!known.length) return;
    const replies = await checkReplies(known, creds);
    for (const rep of replies) {
      const key = rep.from + '|' + rep.subject;
      if (seen.has(key)) continue; seen.add(key);
      for (const m of outbox.filter(x => x.toEmail.toLowerCase() === rep.from)) {
        if (m.replied !== 'yes') { m._row.set('replied', 'yes'); await m._row.save(); }
      }
      report.replies.push(`${rep.from} — "${rep.subject}"`);
    }
  }
  // Each connected researcher's own inbox
  for (const u of users) {
    const creds = userCreds(u);
    if (creds) await scan(creds, outbox.filter(m => m.resId === u.id));
  }
  // Global account for everything sent through it
  await scan(null, outbox.filter(m => !userCreds(users.find(x => x.id === m.resId))));
}

/* ---------- 7. DAILY DIGEST ---------- */
function approvalLinks(m, c) {
  if (!c.baseUrl) return '(set BASE_URL to enable one-tap links)';
  return `Approve: ${c.baseUrl}/approve/${m.id}?key=${c.approveKey}\n   Reject:  ${c.baseUrl}/reject/${m.id}?key=${c.approveKey}`;
}

async function sendDigest(report) {
  const c = cfg();
  const appUrl = c.baseUrl || '';
  const sec = (title, arr, fmt) => arr.length ? `\n== ${title} (${arr.length}) ==\n` + arr.map(fmt || (x => '• ' + x)).join('\n') + '\n' : '';
  const body =
`PostDocX daily report — ${today()}  (mode: ${c.autoSend ? 'AUTO-SEND' : 'APPROVAL'})
${sec('URGENT — needs you today', report.urgent)}${sec('Replies received', report.replies)}${sec('Conversation engine', report.conversations)}${sec('New verified positions', report.verified)}${sec('Re-scored after your document update', report.rescored)}${sec('New opportunities discovered', report.discovered)}${sec('Job openings found (Jobs section)', report.jobs)}${sec('Couple placement scenarios', report.couple)}${sec('Emails sent', report.sent)}${sec('Drafts created', report.drafted)}${sec('Awaiting your approval', report.awaiting, m => `• To ${m.toName} <${m.toEmail}> — "${m.subject}"\n   ${approvalLinks(m, c)}`)}${sec('Expired and closed', report.expired)}${sec('Documents the agent needs from you', report.docsNeeded)}${sec('Referee action needed', report.referees)}${sec('Fellowship calendar, deadlines within 3 months', report.fellowships)}${sec('Errors', report.errors)}
Duplicates blocked: ${report.dupes}
${report.cost || ''}
${appUrl ? 'Open your dashboard: ' + appUrl : 'Open the Google Sheet for full records.'}`;
  // Store the report for in-app viewing. NEVER email it to the user.
  try {
    const rows = await db.all('Settings');
    const r = rows.find(x => x.key === 'lastReport');
    const val = JSON.stringify({ at: new Date().toISOString(), body }).slice(0, 40000);
    if (r) { r._row.set('value', val); await r._row.save(); }
    else await db.add('Settings', { key: 'lastReport', value: val });
  } catch (e) {}
}



/* ---------- JOB DISCOVERY (Jobs section): separate engine, separate cap, postdoc budget untouched ---------- */
async function jobDiscover(r, report) {
  const prefs = String(r.jobPrefs || '').split(',').filter(Boolean);
  // Default ON: if the researcher has not chosen, search national + remote so jobs are always suggested
  const wantNational = prefs.length ? prefs.includes('national_job') : true;
  const wantRemote = prefs.length ? prefs.includes('remote_job') : true;
  if (!wantNational && !wantRemote) return;
  const cap = parseInt(process.env.MAX_JOB_DISCOVER_PER_RESEARCHER || '6');
  const scopes = [];
  if (wantNational) scopes.push('salaried professional and research roles in Islamabad and Rawalpindi Pakistan, plus elsewhere in Pakistan' + (r.jobLocations ? ' (preferred: ' + r.jobLocations + ')' : ''));
  if (wantRemote) scopes.push('fully remote roles hiring internationally (medical writing, pharmacovigilance, regulatory affairs, clinical research, scientific consulting)');
  let arr = [];
  try {
    const txt = await claude(
`${RULES}\n\n${profileBlock(r)}\n\nTASK: Search the web NOW (today: ${today()}) for currently-open JOB postings matching this PhD-level professional. Scope: ${scopes.join('; and ')}.\nQUALITY BAR: real, currently-open, paid positions from the employer's own site or a credible job board, that this PhD-qualified pharmacist and researcher could realistically fill (pharmacovigilance, regulatory affairs, medical affairs, clinical research, medical writing, pharma industry, hospital pharmacy leadership, academia, research). Include mid and senior roles. EXCLUDE only: unpaid, internships, obvious scams, expired, or roles with no application route. Aim for the MAXIMUM number of genuinely relevant positions up to the cap.${r.minSalary ? ' Minimum acceptable compensation: ' + r.minSalary + '.' : ''}\nFind up to ${cap} items. Respond with ONLY a JSON array. Each element:\n{"title":"","institution":"","country":"","city":"","url":"","deadline":"YYYY-MM-DD or empty","category":"national_job|remote_job","compensation":"if stated","contactEmail":"official application email if publicly listed else empty","summary":"1 sentence","fit":"1-2 sentences","matchScore":0-100}`,
      { system: 'You are PostDocX job scout. Return only strict JSON when asked.' });
    arr = parseJSON(txt); if (!Array.isArray(arr)) arr = [arr];
  } catch (e) { report.errors.push('Job search failed for ' + r.name + ': ' + e.message); return; }
  const existing = await db.all('Opportunities');
  const newRows = [];
  for (const x of arr) {
    if (!x.title || !x.institution) continue;
    if (isDate(x.deadline) && x.deadline < today()) continue;
    const trust = sourceTrust(x.url, x.institution);
    if (trust === 'blocked') continue;
    const dupKey = (r.id + '|' + x.institution + '|' + x.title).toLowerCase().replace(/\s+/g, ' ');
    if (existing.some(o => o.dupKey === dupKey) || newRows.some(n => n.dupKey === dupKey)) { report.dupes++; continue; }
    newRows.push({
      id: uid(), resId: r.id, title: x.title, institution: x.institution,
      country: [x.city, x.country].filter(Boolean).join(', '), pi: '', url: x.url || '',
      deadline: isDate(x.deadline) ? x.deadline : '', funding: x.compensation ? 'Salaried' : 'Funding TBC',
      status: 'NEEDS_VERIFICATION', matchScore: clamp(x.matchScore),
      note: [x.summary, x.fit, x.contactEmail ? 'Contact: ' + x.contactEmail : '', trust === 'aggregator' ? 'Aggregator listing, confirm original source' : ''].filter(Boolean).join(' | '),
      dupKey, addedOn: today(), verifiedOn: '', coupleKey: '',
      category: x.category === 'remote_job' ? 'remote_job' : 'national_job',
      level: 'Senior role', compensation: x.compensation || '', section: 'job'
    });
    report.jobs.push(`${x.title} at ${x.institution} (${clamp(x.matchScore)}/100) [${r.name}]`);
  }
  await db.addMany('Opportunities', newRows);
}
/* ---------- COUPLE DISCOVERY ---------- */
async function coupleDiscover(r1, r2, report) {
  const c = cfg();
  let arr = [];
  try {
    const txt = await claude(
`${RULES}\n\nRESEARCHER A:\n${profileBlock(r1)}\n\nRESEARCHER B:\n${profileBlock(r2)}\n\nThese two researchers are a couple seeking placement TOGETHER: same university, same institute, same city, or nearby institutions. One funded role plus one hostable or fellowship route is acceptable. Never sacrifice either researcher's genuine scientific fit just to force a pairing.\nSearch the web NOW (today: ${today()}) in these regions: ${c.regions}. Find up to 3 credible co-location scenarios. For each scenario output TWO items, one per researcher, sharing the same pairId.\nRespond with ONLY a JSON array. Each element:\n{"pairId":"short-city-tag","forResearcher":"A|B","title":"","institution":"","country":"","pi":"","url":"","deadline":"YYYY-MM-DD or empty","funding":"Fully funded|Partially funded|Hostable / self-funded|Grant-first","fit":"1-2 sentences","matchScore":0-100,"coupleNote":"why this city works for both"}`,
      { system: 'You are PostDocX couple placement intelligence. Return only strict JSON when asked.' });
    arr = parseJSON(txt);
    if (!Array.isArray(arr)) arr = [arr];
  } catch (e) { report.errors.push(`Couple discovery failed (${r1.name} + ${r2.name}): ${e.message}`); return; }

  const existing = await db.all('Opportunities');
  const newRows = [];
  for (const x of arr) {
    if (!x.title || !x.institution) continue;
    const r = x.forResearcher === 'B' ? r2 : r1;
    const dupKey = (r.id + '|' + x.institution + '|' + x.title).toLowerCase().replace(/\s+/g, ' ');
    if (existing.some(o => o.dupKey === dupKey) || newRows.some(n => n.dupKey === dupKey)) { report.dupes++; continue; }
    if (isDate(x.deadline) && x.deadline < today()) continue; // never admit an expired position
    const trust = sourceTrust(x.url, x.institution);
    if (trust === 'blocked') { report.errors.push('Blocked untrusted source: ' + x.institution); continue; }
    if (trust === 'trusted') x.fit = 'Official institutional domain. ' + (x.fit || '');
    if (trust === 'aggregator') x.fit = 'Aggregator listing, original source must be confirmed. ' + (x.fit || '');
    newRows.push({
      id: uid(), resId: r.id, title: x.title, institution: x.institution, country: x.country || '',
      pi: x.pi || '', url: x.url || '', deadline: isDate(x.deadline) ? x.deadline : '',
      funding: x.funding || 'Funding TBC', status: 'NEEDS_VERIFICATION',
      matchScore: clamp(x.matchScore),
      note: [x.fit, x.coupleNote ? 'Couple: ' + x.coupleNote : '', visaNote(x.country)].filter(Boolean).join(' | '),
      dupKey, addedOn: today(), verifiedOn: '', coupleKey: 'couple-' + [r1.id, r2.id].sort().join('-') + '-' + (x.pairId || 'x'), category: 'international_job', section: 'postdoc'
    });
    report.couple.push(`[${x.pairId || '?'}] ${r.name}: ${x.title} at ${x.institution} (${clamp(x.matchScore)}/100)`);
  }
  await db.addMany('Opportunities', newRows);
}

/* ---------- PROPOSAL ENGINE (on demand) ---------- */
/* ---------- render a Proposal to a professional PDF stored as a generated Document ---------- */
async function removePriorDraft(oppId, titlePrefix) {
  try {
    const props = await db.all('Proposals');
    for (const pr of props.filter(x => x.oppId === oppId && (x.title || '').startsWith(titlePrefix))) {
      try { await pr._row.delete(); } catch (e) {}
    }
  } catch (e) {}
}
async function renderProposalPdf(proposalId) {
  const storage = require('./storage');
  const PDFDocument = require('pdfkit');
  const pRow = (await db.all('Proposals')).find(x => x.id === proposalId);
  if (!pRow) return null;
  const u = (await db.all('Users')).find(x => x.id === pRow.resId) || {};
  const chunks = [];
  const pdf = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 68, right: 68 } });
  pdf.on('data', c => chunks.push(c));
  const done = new Promise(r => pdf.on('end', r));
  pdf.font('Helvetica-Bold').fontSize(15).text(u.name || '');
  if (u.title) pdf.font('Helvetica').fontSize(9.5).fillColor('#444444').text(u.title);
  pdf.moveDown(0.5).fillColor('#000000');
  pdf.font('Helvetica-Bold').fontSize(12).text(pRow.title.replace(/^(Tailored CV|Cover letter[^:]*|Concept note|Funding application|Interview brief|Two-body dossier): ?/i, ''));
  pdf.moveDown(0.7).font('Helvetica').fontSize(10.5).fillColor('#111111');
  for (const para of String(pRow.content).split(/\n\n+/)) {
    const line = para.trim(); if (!line) continue;
    const isHeading = line.length < 75 && !/[.:]$/.test(line) && (line === line.toUpperCase() || /^[A-Z][A-Za-z0-9 ,&()\/-]+$/.test(line)) && line.split(' ').length <= 9;
    if (isHeading) { pdf.moveDown(0.5).font('Helvetica-Bold').fontSize(11.5).fillColor('#000000').text(line.replace(/:$/, '')); pdf.moveDown(0.15).font('Helvetica').fontSize(10.5).fillColor('#1a1a1a'); }
    else pdf.text(line.replace(/\n/g, ' '), { align: 'justify', lineGap: 3 });
    pdf.moveDown(0.5);
  }
  pdf.end(); await done;
  const buf = Buffer.concat(chunks);
  const kind = /Tailored CV/i.test(pRow.title) ? 'CV (tailored)' : /Cover letter/i.test(pRow.title) ? 'Cover letter' : /Concept note/i.test(pRow.title) ? 'Concept note' : /Funding/i.test(pRow.title) ? 'Funding application' : 'Document';
  const fname = (u.name || 'Doc').replace(/\s+/g, '_') + '_' + kind.replace(/[^A-Za-z]/g, '') + '_' + today().replace(/-/g, '') + '.pdf';
  const f = await storage.put(fname, 'application/pdf', buf);
  await db.add('Documents', { id: uid(), resId: pRow.resId, type: kind + ' (PDF)', name: fname, url: '', attach: 'no', version: '', updatedOn: today(), note: 'Generated from: ' + pRow.title + ' | opp:' + (pRow.oppId||''), driveId: f.id, mime: 'application/pdf', size: String(buf.length) });
  return fname;
}

async function draftProposal(oppId) {
  await db.connect();
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp) throw new Error('Opportunity not found: ' + oppId);
  const r = (await db.all('Users')).find(x => x.id === opp.resId);
  if (!r) throw new Error('Researcher not found for opportunity');
  const txt = await claude(
`${RULES}\n\n${STYLE}\n\n${profileBlock(r)}\n\nTARGET: ${opp.title} at ${opp.institution}${opp.pi ? ', PI ' + opp.pi : ''}. Notes: ${opp.note}\n\nSearch the web for the PI's and group's work from the last three years, then write a research concept note of 700 to 900 words that this researcher could refine and send. Structure it as flowing prose under these plain headings: Background and rationale; Hypothesis and aims; Approach; Expected outcomes and impact; Fit and feasibility. Ground the science in what the host group actually publishes and in the applicant's real methods. Distinguish established evidence from reasonable inference. Do not fabricate preliminary data, collaborations or citations. Adapt the direction to THIS supervisor's specific current interests as shown in their recent papers, and draw on the applicant's real past experience and published work where it genuinely connects. The result should read like a careful senior researcher wrote it personally for this one laboratory, with nothing generic, nothing that could be sent to any other lab, and no phrasing that hints it was machine written.`,
    { maxTokens: 3000, premium: true });
  let content = noDashes(txt);
  // Independent reviewer improves the note SILENTLY. Its critique is never shown to the professor.
  try {
    const review = await gptReview(content, 'postdoctoral research concept note');
    if (review && review.trim()) {
      const revised = await claude(
`${STYLE}\n\nHere is a research concept note:\n\n${content}\n\nHere is private reviewer feedback on it:\n${review}\n\nRewrite the note incorporating the valid points, keeping it 700 to 900 words, in the researcher's own natural voice, grounded only in real facts already present. Return ONLY the improved note, no commentary, no headings like "revised", nothing about the review.`,
        { maxTokens: 3000, premium: true });
      if (revised && revised.trim().length > 200) content = noDashes(revised);
    }
  } catch (e) {}
  await removePriorDraft(oppId, 'Concept note:');
  const row = { id: uid(), resId: r.id, oppId, title: 'Concept note: ' + opp.title + ' (' + opp.institution + ')', status: 'DRAFT', content: content.slice(0, 45000), createdOn: today() };
  await db.add('Proposals', row);
  const owner = process.env.OWNER_EMAIL || process.env.GMAIL_USER;
  if (owner) {
  // (document is saved in the app; not emailed to the user)
  }
  await db.log('PROPOSAL', row.title);
  try { await renderProposalPdf(row.id); } catch (e) {}
  return row;
}



/* ---------- CASE ENGINE ---------- */
const STAGES = ['Discovered','Verified','Email prepared','Awaiting approval','Sent','Replied','In conversation','Interview','Closed'];
async function ensureCase(opp, stage) {
  const cases = await db.all('Cases');
  let c = cases.find(x => x.oppId === opp.id);
  if (!c) {
    let n = cases.length + 1;
    let caseNo = 'PDX-' + String(n).padStart(3, '0');
    while (cases.some(x => x.caseNo === caseNo)) { n++; caseNo = 'PDX-' + String(n).padStart(3, '0'); }
    caseNo = caseNo + '-' + uid().slice(0, 2).toUpperCase();
    await db.add('Cases', { id: uid(), caseNo, resId: opp.resId, oppId: opp.id, stage: stage || 'Discovered',
      status: 'ACTIVE', matchScore: opp.matchScore || '', coupleKey: opp.coupleKey || '',
      nextAction: '', outcome: '', createdOn: today(), updatedOn: today() });
    // Seed the case checklist as individually trackable tasks
    const cat = opp.category || 'international_job';
    const checklists = {
      international_job: [['Research fit analyzed', 'Done'], ['Supervisor identified', opp.pi ? 'Done' : 'Open'], ['Contact supervisor', 'Open'], ['Funding research', 'Open'], ['Application submitted', 'Open']],
      national_job: [['Eligibility checked', 'Open'], ['CV updated for this role', 'Open'], ['Application submitted', 'Open']],
      remote_job: [['Job analyzed', 'Done'], ['Cover letter prepared', 'Open'], ['Application submitted', 'Open']]
    };
    const existingTasks = await db.all('Tasks');
    if (!existingTasks.some(t => t.oppId === opp.id)) {
      await db.addMany('Tasks', (checklists[cat] || checklists.international_job).map(([title, status]) => ({
        id: uid(), resId: opp.resId, oppId: opp.id, category: cat, title, status, createdOn: today() })));
    }
    return (await db.all('Cases')).find(x => x.oppId === opp.id);
  }
  if (stage && STAGES.indexOf(stage) > STAGES.indexOf(c.stage)) {
    c._row.set('stage', stage); c._row.set('updatedOn', today()); await c._row.save();
  }
  return c;
}
async function caseStageByOpp(oppId, stage, nextAction, outcome) {
  const c = (await db.all('Cases')).find(x => x.oppId === oppId);
  if (!c) return;
  if (stage && STAGES.indexOf(stage) > STAGES.indexOf(c.stage)) c._row.set('stage', stage);
  if (nextAction !== undefined) c._row.set('nextAction', nextAction);
  if (outcome) { c._row.set('outcome', outcome); c._row.set('status', 'CLOSED'); }
  c._row.set('updatedOn', today());
  await c._row.save();
}

/* ---------- CONVERSATION ENGINE ----------
   Reads full reply bodies, classifies intent, drafts a contextual response.
   Auto mode sends routine responses itself; interview invitations, offers and
   anything involving commitments ALWAYS wait for the researcher, in every mode. */
const ALWAYS_HUMAN = ['interview', 'offer', 'legal', 'payment', 'unclear'];
async function conversationEngine(researchers, report) {
  const c = cfg();
  const outbox = await db.all('Outbox');
  const threads = await db.all('Threads');
  const opps = await db.all('Opportunities');
  let replyBudget = parseInt(process.env.MAX_REPLIES_PER_DAY || '10') -
    outbox.filter(m => m.type === 'reply' && m.sentOn === today()).length;

  async function handle(u, items) {
    const readCreds = imapCreds(u);
    const creds = userCreds(u); // used for autonomous sending below
    const known = [...new Set(items.filter(m => m.status === 'SENT' && m.toEmail).map(m => m.toEmail.toLowerCase()))];
    if (!known.length) return;
    let replies = [];
    try { replies = await checkReplies(known, readCreds); } catch (e) { return; }
    for (const rep of replies) {
      const dedupe = (rep.from + '|' + rep.subject + '|' + (rep.date || '')).slice(0, 180);
      if (threads.some(t => t.dedupe === dedupe)) continue;
      const m = items.filter(x => x.toEmail.toLowerCase() === rep.from).sort((a, b) => (b.sentOn || '') < (a.sentOn || '') ? -1 : 1)[0];
      if (!m) continue;
      if (m.replied !== 'yes') { m._row.set('replied', 'yes'); await m._row.save(); }
      const opp = opps.find(o => o.id === m.oppId);
      report.replies.push(`${rep.from} — "${rep.subject}"`);

      // Classify + draft in one call, grounded in the original outreach and the reply
      let d = null;
      try {
        const txt = await claude(
`${RULES}\n\n${STYLE}\n\n${profileBlock(u)}\n\nCONTEXT: ${u.name} previously wrote to ${m.toName} (${opp ? opp.institution : ''}) — subject "${m.subject}":\n---\n${m.body}\n---\n\nTHE SUPERVISOR HAS NOW REPLIED — subject "${rep.subject}":\n---\n${rep.text || '(body could not be read)'}\n---\n\nTasks:\n1. Classify the reply intent as exactly one of: positive_interest | info_request | proposal_request | no_funding | rejection | interview | offer | administrative | unclear.\n2. Draft the appropriate next email from ${u.name} following the reply's actual content. Rules per intent: info_request, answer precisely and offer the specific documents; proposal_request, say a tailored concept note follows within 2 days and summarize the core idea in 3 sentences; positive_interest, suggest a brief call${'${'}u.schedLink ? ' and share the researcher scheduling link ' + u.schedLink + ' so they pick any slot' : ' with 2-3 concrete time windows (Pakistan time, offer to adapt)'} and one sharp scientific question; no_funding, propose the most credible fellowship route for this host country; rejection, one warm gracious sentence thanking them and keeping the door open; interview or offer, draft enthusiastic confirmation ASKING NOTHING BINDING, the researcher will finalize personally; administrative, respond helpfully; unclear, draft a polite clarification.\n3. Say whether the CV should be attached (only if they asked for documents).\nRespond ONLY with JSON: {"intent":"","subject":"","body":"","attachCV":true|false}`,
          { search: false, maxTokens: 900 });
        d = parseJSON(txt);
        if (d) { d.subject = noDashes(d.subject); d.body = noDashes(d.body); }
      } catch (e) { report.errors.push('Reply drafting failed for ' + rep.from + ': ' + e.message); }

      const intent = d && d.intent ? d.intent : 'unclear';
      await db.add('Threads', { id: uid(), resId: u.id, oppId: m.oppId || '', outboxId: m.id,
        fromEmail: rep.from, subject: rep.subject, body: (rep.text || '').slice(0, 4000),
        intent, receivedOn: rep.date || today(), handled: 'no', dedupe });

      if (m.oppId) await caseStageByOpp(m.oppId,
        intent === 'interview' ? 'Interview' : 'Replied',
        intent === 'rejection' ? '' : 'Respond to supervisor',
        intent === 'rejection' ? 'Rejected by supervisor' : '');
      // #6 reply intent creates the matching task automatically
      if (m.oppId && (intent === 'info_request' || intent === 'proposal_request')) {
        const tset = await db.all('Tasks');
        const ttl = intent === 'proposal_request' ? 'Send concept note (supervisor asked)' : 'Send requested documents (supervisor asked)';
        if (!tset.some(t => t.oppId === m.oppId && t.title === ttl)) {
          await db.add('Tasks', { id: uid(), resId: u.id, oppId: m.oppId, category: 'international_job', title: ttl, status: 'Open', createdOn: today() });
        }
      }

      if (intent === 'interview' && m.oppId) {
        report.urgent.push(`INTERVIEW SIGNAL from ${m.toName} (${rep.from}) — briefing is being prepared`);
        interviewBrief(m.oppId).catch(() => {});
      }
      if (intent === 'offer' && m.oppId) {
        report.urgent.push(`OFFER SIGNAL from ${m.toName} (${rep.from}) — finalize personally; offer checklist added to your tasks`);
        const opp2 = opps.find(o => o.id === m.oppId);
        const tset = await db.all('Tasks');
        if (opp2 && !tset.some(t => t.oppId === m.oppId && t.title === 'Contract reviewed personally')) {
          await db.addMany('Tasks', ['Contract reviewed personally', 'Salary and benefits confirmed in writing',
            'Visa timeline started (' + (opp2.country || 'host country') + ')', 'Start date negotiated',
            'Relocation and family plan', 'Current commitments transition plan']
            .map(title => ({ id: uid(), resId: u.id, oppId: m.oppId, category: opp2.category || 'international_job', title, status: 'Open', createdOn: today() })));
        }
      }

      if (!d || !d.subject || !d.body) continue;
      const mustHuman = ALWAYS_HUMAN.includes(intent);
      const canAuto = c.autoSend && !mustHuman && replyBudget > 0;
      if (canAuto) {
        try {
          let attachments = [];
          if (d.attachCV) {
            const docs = await db.all('Documents');
            const cv = docs.find(x => x.resId === u.id && /cv/i.test(x.type) && x.driveId);
            if (cv) { try { attachments = [{ filename: cv.name || 'CV.pdf', content: await fileBuffer(cv.driveId) }]; } catch (e) {} }
          }
          await sendMail({ to: rep.from, subject: d.subject,
            text: d.body + `\n\nBest regards,\n${u.name}\n${u.title || ''}`,
            fromName: u.name, creds, replyTo: creds ? undefined : (u.email || undefined), attachments });
          await db.add('Outbox', { id: uid(), resId: u.id, oppId: m.oppId || '', toEmail: rep.from, toName: m.toName,
            subject: d.subject, body: d.body, type: 'reply', status: 'SENT', createdOn: today(),
            sentOn: today(), followups: '0', lastFollowupOn: '', replied: '' });
          replyBudget--;
          report.conversations.push(`Auto-replied to ${m.toName} (${intent}): "${d.subject}"`);
          if (m.oppId) await caseStageByOpp(m.oppId, 'In conversation', 'Awaiting supervisor');
        } catch (e) { report.errors.push('Auto-reply failed to ' + rep.from + ': ' + e.message); }
      } else {
        await db.add('Outbox', { id: uid(), resId: u.id, oppId: m.oppId || '', toEmail: rep.from, toName: m.toName,
          subject: d.subject, body: d.body, type: 'reply', status: 'PENDING', createdOn: today(),
          sentOn: '', followups: '0', lastFollowupOn: '', replied: '' });
        report.conversations.push(`Response drafted for ${m.toName} (${intent}) — awaiting your approval${mustHuman ? ' (always needs you: ' + intent + ')' : ''}`);
      }
    }
  }

  await Promise.allSettled(researchers.map(u => handle(u, outbox.filter(m => m.resId === u.id))));
}



/* ---------- PROFILE-CHANGE RESCORE: new documents automatically update existing matches ---------- */
async function rescorePending(report) {
  const rows = await db.all('Settings');
  const flag = rows.find(x => x.key === 'rescorePending');
  if (!flag || !flag.value) return;
  const resIds = String(flag.value).split(',').filter(Boolean);
  const users = await db.all('Users');
  const opps = await db.all('Opportunities');
  for (const resId of resIds.slice(0, 3)) {
    const u = users.find(x => x.id === resId);
    if (!u) continue;
    const targets = opps.filter(o => o.resId === resId &&
      ['NEEDS_VERIFICATION', 'VERIFIED'].includes(o.status) &&
      (o.section || 'postdoc') === 'postdoc').slice(0, 12);
    if (!targets.length) continue;
    try {
      const txt = await claude(
`${profileBlock(u)}\n\nThe researcher's profile was just UPDATED from newly uploaded documents. Re-score each position below for research fit against this updated profile (0-100, 65+ engages, 80+ strong). Judge only from the given details.\n${targets.map(o => o.id + ' :: ' + o.title + ' at ' + o.institution + ' :: ' + (o.note || '').slice(0, 200)).join('\n')}\nRespond ONLY with a JSON array: [{"id":"","score":0}]`,
        { search: false, maxTokens: 700 });
      const arr = parseJSON(txt);
      for (const r2 of (Array.isArray(arr) ? arr : [])) {
        const o = targets.find(x => x.id === r2.id);
        if (!o || !r2.score) continue;
        const oldScore = parseInt(o.matchScore) || 0;
        const ns = clamp(r2.score);
        if (Math.abs(ns - oldScore) >= 3) {
          o._row.set('matchScore', ns); await o._row.save();
          report.rescored.push(`${o.title} (${o.institution}): ${oldScore} -> ${ns}`);
          if (ns >= cfg().minEngage && o.status === 'VERIFIED') await ensureCase(o, 'Verified');
        }
      }
    } catch (e) { report.errors.push('Rescore failed: ' + e.message); }
  }
  flag._row.set('value', ''); await flag._row.save();
}
/* ---------- EXPIRY SWEEP: nothing past its deadline stays active ---------- */
async function expireSweep(report) {
  const opps = await db.all('Opportunities');
  for (const o of opps) {
    if (!isDate(o.deadline) || o.deadline >= today()) continue;
    if (o.status === 'EXPIRED') continue;
    o._row.set('status', 'EXPIRED');
    await o._row.save();
    await caseStageByOpp(o.id, 'Closed', '', 'Deadline passed ' + o.deadline);
    report.expired.push(`${o.title} — ${o.institution} (deadline ${o.deadline})`);
  }
}

/* ---------- DOCUMENT GATE: agent asks for missing documents on active cases ---------- */
const CORE_DOCS = ['CV', 'Research statement', 'Degree certificates', 'Transcripts'];
async function docGate(report) {
  const cases = (await db.all('Cases')).filter(c => c.status === 'ACTIVE');
  if (!cases.length) return;
  const docs = await db.all('Documents');
  const tasks = await db.all('Tasks');
  const byRes = {};
  for (const c of cases) (byRes[c.resId] = byRes[c.resId] || []).push(c);
  for (const resId of Object.keys(byRes)) {
    const have = new Set(docs.filter(d => d.resId === resId).map(d => d.type));
    const missing = CORE_DOCS.filter(t => !have.has(t));
    if (!missing.length) continue;
    const title = 'Upload missing documents: ' + missing.join(', ');
    if (!tasks.some(t => t.resId === resId && t.title === title && t.status !== 'Done')) {
      await db.add('Tasks', { id: uid(), resId, oppId: byRes[resId][0].oppId, category: 'international_job', title, status: 'Open', createdOn: today() });
    }
    report.docsNeeded.push(resId + ': applications will need ' + missing.join(', '));
  }
}
/* ---------- FELLOWSHIP CALENDAR ---------- */
const FELLOWSHIP_SEED = [
  { name: 'MSCA Postdoctoral Fellowships', funder: 'European Commission', typicalWindow: '09', url: 'https://marie-sklodowska-curie-actions.ec.europa.eu', regions: 'Europe', note: 'Call usually opens April, closes September. Host letter needed early.' },
  { name: 'Humboldt Research Fellowship', funder: 'Alexander von Humboldt Foundation', typicalWindow: 'rolling', url: 'https://www.humboldt-foundation.de', regions: 'Germany', note: 'Rolling, decisions 3x/year. 4-7 month lead time.' },
  { name: 'EMBO Postdoctoral Fellowships', funder: 'EMBO', typicalWindow: 'rolling', url: 'https://www.embo.org/funding/fellowships-grants-and-career-support/postdoctoral-fellowships/', regions: 'Europe + partners', note: 'Rolling. Life sciences. Host lab required.' },
  { name: 'HFSP Postdoctoral Fellowships', funder: 'Human Frontier Science Program', typicalWindow: '05', url: 'https://www.hfsp.org', regions: 'Global', note: 'Initiation ~March, deadline ~May. Must change field/country.' },
  { name: 'Newton International Fellowship', funder: 'Royal Society / British Academy', typicalWindow: '03', url: 'https://royalsociety.org', regions: 'UK', note: 'Usually closes March.' },
  { name: 'Swiss Government Excellence Scholarships', funder: 'FCS', typicalWindow: '11', url: 'https://www.sbfi.admin.ch', regions: 'Switzerland', note: 'Apply via Pakistani embassy channel, closes ~November.' },
  { name: 'JSPS Postdoctoral Fellowship', funder: 'JSPS', typicalWindow: '05', url: 'https://www.jsps.go.jp', regions: 'Japan', note: 'Two rounds/year via host institution.' },
  { name: 'Banting Postdoctoral Fellowships', funder: 'Government of Canada', typicalWindow: '09', url: 'https://banting.fellowships-bourses.gc.ca', regions: 'Canada', note: 'Deadline ~September, institution endorsement needed weeks earlier.' },
  { name: 'NIH Fogarty / K99 pathway options', funder: 'NIH', typicalWindow: '02', url: 'https://www.nih.gov', regions: 'USA', note: 'Cycle deadlines Feb/Jun/Oct. Requires US host lab first.' },
  { name: 'KAUST Global Postdoctoral Fellowship', funder: 'KAUST', typicalWindow: '10', url: 'https://www.kaust.edu.sa', regions: 'Saudi Arabia', note: 'Check current cycle; strong for couple placement on one campus.' }
];

const KEY_FELLOWSHIPS = [
  { name: 'MSCA Postdoctoral Fellowship 2026', funder: 'European Commission', typicalWindow: 'Deadline 2026-09-09', url: 'https://marie-sklodowska-curie-actions.ec.europa.eu', regions: 'Europe', note: 'TOP PRIORITY: fully funded 1-2y, host agreement needed WEEKS before deadline. Start host PI outreach immediately.' },
  { name: 'KAUST Global Fellowship (KGFP)', funder: 'KAUST', typicalWindow: 'Rolling / annual call', url: 'https://kgfp.kaust.edu.sa', regions: 'Saudi Arabia', note: 'Fully funded, generous salary, campus family housing, couple friendly. Strong fit for both researchers.' },
  { name: 'Banting Postdoctoral Fellowship', funder: 'Government of Canada', typicalWindow: 'Deadline mid September', url: 'https://banting.fellowships-bourses.gc.ca', regions: 'Canada', note: 'Institutional endorsement required, contact host institution 6-8 weeks ahead.' }
];
async function seedKeyFellowships() {
  const rows = await db.all('Fellowships');
  const missing = KEY_FELLOWSHIPS.filter(f => !rows.some(r => r.name === f.name));
  if (missing.length) await db.addMany('Fellowships', missing.map(f => ({ id: uid(), ...f })));
}

async function fellowshipReminders(report) {
  await seedKeyFellowships();
  // MSCA countdown: urgent line + a one-time host-shortlist task inside 60 days
  const mscaDeadline = '2026-09-09';
  const daysLeft = Math.ceil((new Date(mscaDeadline) - new Date()) / 86400000);
  if (daysLeft > 0 && daysLeft <= 60) {
    report.urgent.push('MSCA-PF 2026 deadline in ' + daysLeft + ' days (Sept 9). Host agreement takes weeks, host outreach must be live NOW.');
    const tasks = await db.all('Tasks');
    for (const u of (await db.all('Users')).filter(x => x.name && x.active !== 'no')) {
      const title = 'MSCA-PF: shortlist 3 host PIs and send host outreach';
      if (!tasks.some(t => t.resId === u.id && t.title === title)) {
        await db.add('Tasks', { id: uid(), resId: u.id, oppId: '', category: 'international_job', title, status: 'Open', createdOn: today() });
      }
    }
  }
  let rows = await db.all('Fellowships');
  if (!rows.length) {
    for (const f of FELLOWSHIP_SEED) await db.add('Fellowships', { id: uid(), ...f });
    rows = await db.all('Fellowships');
  }
  const month = new Date().getMonth() + 1;
  for (const f of rows) {
    const w = String(f.typicalWindow || '').trim();
    if (w === 'rolling') continue;
    const m = parseInt(w);
    if (!m) continue;
    let lead = m - month; if (lead < 0) lead += 12;
    if (lead <= 3) report.fellowships.push(`${f.name} (${f.funder}): typical deadline month ${w}. ${f.note} ${f.url}`);
  }
}

/* ---------- REFEREE COORDINATION ---------- */
async function refereeReminders(report) {
  const opps = (await db.all('Opportunities')).filter(o => {
    if (o.status !== 'VERIFIED' || !isDate(o.deadline)) return false;
    const d = Math.ceil((new Date(o.deadline + 'T23:59:59') - Date.now()) / 86400000);
    return d >= 0 && d <= 12;
  });
  if (!opps.length) return;
  const refs = await db.all('Referees');
  for (const o of opps) {
    const pending = refs.filter(x => x.resId === o.resId && x.status !== 'confirmed');
    if (pending.length) report.referees.push(`${o.title} (${o.institution}) closes ${o.deadline}: chase ${pending.map(x => x.name).join(', ')}`);
    else if (!refs.some(x => x.resId === o.resId)) report.referees.push(`${o.title} (${o.institution}) closes ${o.deadline}: no referees listed yet, add them to the Referees tab`);
  }
}

async function draftRefereeRequests(resId) {
  await db.connect();
  const r = (await db.all('Users')).find(x => x.id === resId);
  if (!r) throw new Error('Researcher not found');
  const refs = (await db.all('Referees')).filter(x => x.resId === resId && x.status !== 'confirmed' && x.email);
  let n = 0;
  for (const ref of refs) {
    const txt = await claude(
`${STYLE}\n\nWrite a short, warm, professional email (under 130 words) from ${r.name} (${r.title}) asking ${ref.name} (${ref.relationship || 'former supervisor'}) to serve as a reference for upcoming postdoctoral applications. Mention that specific requests with deadlines will follow, offer to share an updated CV, and thank them genuinely without gushing. Respond ONLY with JSON: {"subject":"","body":""}`,
      { search: false, maxTokens: 500 });
    const d = parseJSON(txt);
    d.subject = noDashes(d.subject); d.body = noDashes(d.body);
    await db.add('Outbox', {
      id: uid(), resId, oppId: '', toEmail: ref.email, toName: ref.name,
      subject: d.subject, body: d.body, type: 'referee', status: 'PENDING',
      createdOn: today(), sentOn: '', followups: '0', lastFollowupOn: '', replied: ''
    });
    n++;
  }
  return n;
}

/* ---------- INTERVIEW PREPARATION ---------- */
async function interviewBrief(oppId) {
  await db.connect();
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp) throw new Error('Opportunity not found: ' + oppId);
  const r = (await db.all('Users')).find(x => x.id === opp.resId);
  const txt = await claude(
`${RULES}\n\n${STYLE}\n\n${profileBlock(r)}\n\nINTERVIEW TARGET: ${opp.title} at ${opp.institution}${opp.pi ? ', PI ' + opp.pi : ''}. Notes: ${opp.note}\n\nSearch the web for the PI's and department's recent work, then prepare an interview briefing with these sections in plain prose: The lab right now (what they publish and where the group is heading); Your two minute research pitch tuned to this lab; Eight likely technical questions with strong short answers grounded in the applicant's real work; Four intelligent questions to ask them; Funding narrative (how the position or a fellowship route would be financed and what to say about it); Risks to prepare for. Keep it practical, specific and honest.`,
    { maxTokens: 3500, premium: true });
  const row = { id: uid(), resId: opp.resId, oppId, title: 'Interview briefing: ' + opp.title + ' (' + opp.institution + ')', status: 'READY', content: noDashes(txt).slice(0, 45000), createdOn: today() };
  await db.add('Proposals', row);
  const owner = process.env.OWNER_EMAIL || process.env.GMAIL_USER;
  // (document is saved in the app; not emailed to the user)
  await db.log('INTERVIEW_BRIEF', row.title);
  return row;
}

/* ---------- TWO-BODY COUPLE DOSSIER ---------- */
async function coupleDossier(oppId) {
  await db.connect();
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp) throw new Error('Opportunity not found: ' + oppId);
  const researchers = await db.all('Users');
  const r1 = researchers.find(x => x.id === opp.resId);
  const r2 = researchers.find(x => x.id === (r1 || {}).partnerId);
  if (!r1 || !r2) throw new Error('This opportunity is not linked to a couple (set partnerId).');
  const sibling = (await db.all('Opportunities')).find(o => o.coupleKey && o.coupleKey === opp.coupleKey && o.id !== opp.id);
  const txt = await claude(
`${RULES}\n\n${STYLE}\n\nRESEARCHER A:\n${profileBlock(r1)}\n\nRESEARCHER B:\n${profileBlock(r2)}\n\nTARGET: ${opp.title} at ${opp.institution}, ${opp.country}.${sibling ? ' Paired opportunity for the partner: ' + sibling.title + ' at ' + sibling.institution + '.' : ''} Notes: ${opp.note}\n\nWrite a two body dossier of 600 to 800 words that a department could circulate internally when considering a dual placement. Sections in plain prose: Who we are (one short paragraph each, real credentials only); Complementary research programme (how the two research lines genuinely reinforce each other, e.g. pharmacology and antimicrobial biomaterials meeting in implant associated infection and drug delivery); What each of us brings to this institution; Practicalities (funding routes for each, timing, relocation as a family). Search the web briefly to anchor the institutional context. Honest, warm, specific.`,
    { maxTokens: 3000, premium: true });
  const row = { id: uid(), resId: r1.id, oppId, title: 'Two-body dossier: ' + opp.institution, status: 'DRAFT', content: noDashes(txt).slice(0, 45000), createdOn: today() };
  await db.add('Proposals', row);
  const owner = process.env.OWNER_EMAIL || process.env.GMAIL_USER;
  // (document is saved in the app; not emailed to the user)
  await db.log('COUPLE_DOSSIER', row.title);
  return row;
}


/* ---------- OPPORTUNITY-SPECIFIC CV ---------- */
async function tailoredCV(oppId) {
  await db.connect();
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp) throw new Error('Opportunity not found: ' + oppId);
  const r = (await db.all('Users')).find(x => x.id === opp.resId);
  const docs = await db.all('Documents');
  const cv = docs.find(d => d.resId === r.id && /cv/i.test(d.type) && d.driveId);
  const blocks = [];
  if (cv) {
    try {
      const buf = await fileBuffer(cv.driveId);
      if (cv.mime === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
    } catch (e) {}
  }
  blocks.push({ type: 'text', text:
`${RULES}\n\n${STYLE}\n\nPROFILE:\n${profileBlock(r)}\n\nTARGET: ${opp.title} at ${opp.institution}${opp.pi ? ', PI ' + opp.pi : ''}. Notes: ${opp.note}\n\nUsing the master CV above${cv ? '' : ' (no CV file found, use the profile)'} and ONLY facts it actually contains, write an opportunity-specific CV as clean plain text ready to paste into a document: reorder experience so the most relevant research comes first, emphasize the techniques and publications this laboratory will care about, tighten or drop sections irrelevant to this position, and rewrite the opening research summary for this specific lab. Never add, inflate or invent anything. Keep standard academic CV sections.` });
  const txt = await claude(blocks, { search: false, maxTokens: 3000, premium: true });
  let cvOut = noDashes(txt);
  const rev = await gptReview(cvOut, 'opportunity-specific academic CV');
  if (rev) cvOut += '\n\n==== SECOND REVIEWER (independent model) ====\n' + noDashes(rev);
  const row = { id: uid(), resId: r.id, oppId, title: 'Tailored CV: ' + opp.title + ' (' + opp.institution + ')', status: 'DRAFT', content: cvOut.slice(0, 45000), createdOn: today() };
  await db.add('Proposals', row);
  const owner = r.email || process.env.OWNER_EMAIL;
  // (document is saved in the app; not emailed to the user)
  await db.log('TAILORED_CV', row.title);
  try { await renderProposalPdf(row.id); } catch (e) {}
  return row;
}




/* ---------- #4 SUPERVISOR PAPER CACHE (shared by outreach, dossier, interview) ---------- */
async function piInsight(piName, institution) {
  if (!piName) return null;
  const piKey = (piName + '|' + (institution || '')).toLowerCase().slice(0, 120);
  const cache = await db.all('PICache');
  const hit = cache.find(x => x.piKey === piKey);
  if (hit && hit.cachedOn && (Date.now() - new Date(hit.cachedOn + 'T00:00:00')) < 30 * 86400000) {
    return { papers: hit.papers, focus: hit.focus };
  }
  try {
    const txt = await claude(
`Search the web for ${piName}${institution ? ' at ' + institution : ''}. Return their 3 most recent relevant publications and current research focus. Respond ONLY with JSON: {"papers":"one per line: title, venue, year","focus":"2-3 sentences on current direction"}`,
      { searchUses: 3, maxTokens: 700 });
    const d = parseJSON(txt) || {};
    if (hit) { hit._row.set('papers', (d.papers || '').slice(0, 3000)); hit._row.set('focus', (d.focus || '').slice(0, 1500)); hit._row.set('cachedOn', today()); await hit._row.save(); }
    else await db.add('PICache', { piKey, name: piName, institution: institution || '', papers: (d.papers || '').slice(0, 3000), focus: (d.focus || '').slice(0, 1500), cachedOn: today() });
    return { papers: d.papers || '', focus: d.focus || '' };
  } catch (e) { return null; }
}

/* ---------- #7 READINESS: is a case fully prepared for its requirements? ---------- */
async function computeReadiness(opp) {
  let req = {}; try { req = JSON.parse(opp.requirements || '{}'); } catch (e) {}
  const needed = req.requiredDocuments || [];
  if (!needed.length) return { pct: opp.analyzedOn ? 100 : 0, ready: !!opp.analyzedOn, missing: [] };
  const docs = (await db.all('Documents')).filter(d => d.resId === opp.resId && /generated from/i.test(d.note || '') && (d.note || '').includes('opp:' + opp.id));
  const missingUser = req.missingFromUser || [];
  const haveGen = docs.length > 0;
  // ready when: analyzed, at least one generated doc exists, and nothing outstanding from the user
  const ready = !!opp.analyzedOn && haveGen; // CV + analysis is enough; missing extras are only suggestions
  const pct = Math.min(100, Math.round((( opp.analyzedOn ? 40 : 0) + (haveGen ? 40 : 0) + (missingUser.length === 0 ? 20 : 0))));
  return { pct, ready, missing: missingUser };
}
/* ---------- CASE DOSSIER: read the full posting, prepare A to Z, compute readiness ---------- */
async function analyzeCase(oppId) {
  await db.connect();
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp) throw new Error('Opportunity not found');
  const r = (await db.all('Users')).find(x => x.id === opp.resId) || {};
  const docs = (await db.all('Documents')).filter(d => d.resId === r.id);
  const haveTypes = [...new Set(docs.map(d => d.type))];
  let a = {};
  try {
    const txt = await claude(
`${RULES}\n\n${profileBlock(r)}\n\nRead the FULL requirements of this position by searching its official page and the supervisor or lab pages.\nPOSITION: ${opp.title} at ${opp.institution}${opp.pi ? ', PI ' + opp.pi : ''}. Country: ${opp.country}. URL: ${opp.url || 'search for it'}. Notes: ${opp.note || ''}\nThe applicant already has these document types on file: ${haveTypes.join(', ') || 'none yet'}.\n\nReturn a complete analysis. Respond ONLY with JSON:\n{"requiredDocuments":["exact documents this application requires"],"eligibility":["key eligibility criteria and whether the applicant plausibly meets each, one line each"],"missingFromUser":["documents or specific information the applicant must still provide, empty if none"],"stipend":"salary or stipend with currency and period if stated, else best public estimate labelled as estimate","duration":"contract length if stated","deadline":"YYYY-MM-DD or empty","chance":"Strong|Moderate|Long shot with one sentence why, grounded in real fit","supervisorFocus":"2-3 sentence summary of the PI current research focus from their recent work","nextSteps":["what the agent will do next for this case, concrete"],"whatToPrepare":["CV","Cover letter","Concept note","Funding narrative"]}`,
      { premium: true, search: true, searchUses: 6, maxTokens: 2200 });
    a = parseJSON(txt) || {};
  } catch (e) { throw new Error('Analysis failed: ' + e.message); }

  const set = (k, v) => { opp._row.set(k, typeof v === 'string' ? v.slice(0, 4000) : JSON.stringify(v || []).slice(0, 4000)); };
  set('requirements', { requiredDocuments: a.requiredDocuments || [], eligibility: a.eligibility || [], missingFromUser: a.missingFromUser || [], supervisorFocus: a.supervisorFocus || '' });
  set('stipend', a.stipend || ''); set('duration', a.duration || ''); set('chance', a.chance || '');
  set('nextSteps', a.nextSteps || []);
  if (a.deadline && isDate(a.deadline) && !opp.deadline) opp._row.set('deadline', a.deadline);
  await opp._row.save();

  const tasks = await db.all('Tasks');
  for (const miss of (a.missingFromUser || [])) {
    const ttl = 'Provide: ' + miss;
    if (!tasks.some(t => t.oppId === oppId && t.title === ttl)) {
      await db.add('Tasks', { id: uid(), resId: r.id, oppId, category: opp.category || 'international_job', title: 'Suggested: ' + miss, status: 'Open', createdOn: today() });
    }
  }

  opp._row.set('analyzedOn', today());
  const want = (a.whatToPrepare || ['CV']).map(x => x.toLowerCase());
  const isJob = (opp.section || 'postdoc') === 'job';
  const plan = ['CV'];
  if (isJob || want.some(w => /cover/.test(w))) plan.push('Cover letter');
  if (!isJob) plan.push('Concept note');
  if (want.some(w => /funding/.test(w))) plan.push('Funding narrative');
  opp._row.set('prepStatus', JSON.stringify({ plan: plan, done: [], startedAt: new Date().toISOString() }));
  opp._row.set('prepStartedAt', new Date().toISOString());
  opp._row.set('prepDone', 'no');
  await opp._row.save();

  const markDone = async (label) => {
    try {
      const o2 = (await db.all('Opportunities')).find(x => x.id === oppId);
      let ps = {};
      try { ps = JSON.parse(o2.prepStatus || '{}'); } catch (e) { ps = { plan: plan, done: [] }; }
      ps.done = [...new Set([...(ps.done || []), label])];
      o2._row.set('prepStatus', JSON.stringify(ps));
      await o2._row.save();
    } catch (e) {}
  };

  const jobs = [tailoredCV(oppId).then(() => markDone('CV')).catch(() => {})];
  if (plan.includes('Cover letter')) jobs.push(coverLetter(oppId).then(() => markDone('Cover letter')).catch(() => {}));
  if (plan.includes('Concept note')) jobs.push(draftProposal(oppId).then(() => markDone('Concept note')).catch(() => {}));
  if (plan.includes('Funding narrative')) jobs.push(fundingNarrative(oppId).then(() => markDone('Funding narrative')).catch(() => {}));
  await Promise.allSettled(jobs);
  try { const o3 = (await db.all('Opportunities')).find(x => x.id === oppId); o3._row.set('prepDone', 'yes'); await o3._row.save(); } catch (e) {}

  const rd = await computeReadiness((await db.all('Opportunities')).find(o => o.id === oppId));
  opp._row.set('readiness', JSON.stringify(rd)); await opp._row.save();
  await ensureCase(opp, rd.ready ? 'Email prepared' : 'Verified');
  await db.log('CASE_ANALYZED', opp.institution + ' | chance: ' + (a.chance || '').slice(0, 40));
  return a;
}

/* ---------- COVER LETTER (Jobs section): GPT-5.5 primary, Claude fallback, both grounded in the real profile ---------- */
async function coverLetter(oppId) {
  await db.connect();
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp) throw new Error('Opportunity not found: ' + oppId);
  const r = (await db.all('Users')).find(x => x.id === opp.resId);
  const prompt = `${RULES}\n\n${STYLE}\n\n${profileBlock(r)}\n\nTARGET ROLE: ${opp.title} at ${opp.institution}${opp.country ? ', ' + opp.country : ''}. Category: ${opp.category}. Notes: ${opp.note || ''}\n\nWrite a complete, ready-to-send cover letter (300 to 380 words) for this specific role. Open with why this organization and this role, connect the applicant's REAL experience and skills to the role's likely requirements, one short paragraph of concrete evidence (real publications, real systems built, real programmes run), close with clear availability. Use only facts from the profile. Plain professional prose, no dashes anywhere, no bullet lists.`;
  let txt = await gptDraft(prompt, 1200);
  let engine = 'GPT';
  if (!txt) { txt = await claude(prompt, { search: false, maxTokens: 1200, premium: true }); engine = 'Claude'; }
  const content = noDashes(txt);
  await removePriorDraft(oppId, 'Cover letter');
  const row = { id: uid(), resId: r.id, oppId, title: 'Cover letter (' + engine + '): ' + opp.title + ' (' + opp.institution + ')', status: 'DRAFT', content: content.slice(0, 45000), createdOn: today() };
  await db.add('Proposals', row);
  const owner = r.email || process.env.OWNER_EMAIL;
  // (document is saved in the app; not emailed to the user)
  await db.log('COVER_LETTER', row.title + ' via ' + engine);
  try { await renderProposalPdf(row.id); } catch (e) {}
  return row;
}

/* ---------- TARGET LAB MAP: curated shortlist of laboratories worth pursuing ---------- */
async function targetLabMap(resId) {
  await db.connect();
  const r = (await db.all('Users')).find(x => x.id === resId);
  if (!r) throw new Error('Researcher not found');
  const txt = await claude(
`${RULES}\n\n${profileBlock(r)}\n\nTASK: Search the web and build a TARGET LAB MAP for this researcher: 40-60 real, currently active laboratories and research groups worldwide whose work genuinely overlaps this profile. Regions: ${cfg().regions}. For each: PI name, lab or group, university, country, one line on the research overlap, and the official lab or profile URL. Prefer labs with recent funding or active recruitment. Group by region. Include a short final section: the 10 highest-priority labs to contact first and why. Plain text, clear headings, no dashes, no tables.`,
    { premium: true, searchUses: 8, maxTokens: 4000 });
  const row = { id: uid(), resId, oppId: '', title: 'Target lab map: ' + r.name + ' (' + today() + ')', status: 'DRAFT', content: noDashes(txt).slice(0, 45000), createdOn: today() };
  await db.add('Proposals', row);
  const owner = r.email || process.env.OWNER_EMAIL;
  // (document is saved in the app; not emailed to the user)
  await db.log('LAB_MAP', r.name);
  return row;
}

/* ---------- FUNDING APPLICATION NARRATIVE (fellowships, grants, scholarships) ---------- */
async function fundingNarrative(oppId) {
  await db.connect();
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp) throw new Error('Opportunity not found');
  const r = (await db.all('Users')).find(x => x.id === opp.resId);
  const txt = await claude(
`${RULES}\n\n${STYLE}\n\n${profileBlock(r)}\n\nThis is a FUNDING opportunity: ${opp.title} at ${opp.institution}. Notes: ${opp.note}\nSearch the web for this scheme's actual assessment criteria and required sections, then write a complete first-draft application narrative that a strong applicant would submit: motivation, research excellence with real evidence from the profile, proposed work aligned to the scheme's priorities, expected impact, and why this host or scheme fits. Follow the scheme's real structure where you can find it. Plain academic prose, no dashes, no AI phrasing.`,
    { premium: true, search: true, searchUses: 4, maxTokens: 3500 });
  await removePriorDraft(oppId, 'Funding application:');
  const row = { id: uid(), resId: r.id, oppId, title: 'Funding application: ' + opp.title + ' (' + opp.institution + ')', status: 'DRAFT', content: noDashes(txt).slice(0, 45000), createdOn: today() };
  await db.add('Proposals', row);
  const owner = r.email || process.env.OWNER_EMAIL;
  // (document is saved in the app; not emailed to the user)
  await db.log('FUNDING_NARRATIVE', row.title);
  try { await renderProposalPdf(row.id); } catch (e) {}
  return row;
}
/* ---------- WEEKLY STRATEGY REVIEW ---------- */
async function recheckOpenCases() {
  const notes = [];
  const cases = (await db.all('Cases')).filter(c => c.status === 'ACTIVE');
  const opps = await db.all('Opportunities');
  const targets = cases.map(c => opps.find(o => o.id === c.oppId))
    .filter(o => o && o.status === 'VERIFIED').slice(0, 10);
  await Promise.allSettled(targets.map(async o => {
    try {
      const txt = await claude(
`Check whether this job posting page is still live and accepting applications today (${today()}): ${o.url || (o.title + ' at ' + o.institution)}. Respond ONLY with JSON: {"live":true|false,"note":"1 sentence"}`,
        { searchUses: 2, maxTokens: 200 });
      const v = parseJSON(txt);
      if (v.live === false) {
        o._row.set('status', 'EXPIRED'); await o._row.save();
        await caseStageByOpp(o.id, 'Closed', '', 'Posting removed (weekly recheck)');
        notes.push(o.title + ' at ' + o.institution + ': posting gone, case closed');
      }
    } catch (e) {}
  }));
  return notes;
}

/* ---------- ORCID / SCHOLAR SYNC: read public profiles, keep the in-app profile current ---------- */
async function scholarSync(u) {
  const hasLinks = (u.orcid && u.orcid.length > 5) || /scholar\.google|orcid\.org|researchgate/i.test(u.links || '');
  if (!hasLinks) return u.name + ': no ORCID or Scholar link on file. Create them once (5 minutes each) and add the links in Profile; the agent then keeps everything synced weekly.';
  try {
    const txt = await claude(
`Read this researcher's PUBLIC academic profiles from the web. ORCID: ${u.orcid || 'not given'}. Links: ${u.links}. Name: ${u.name}.\nList their publications as currently shown on these public profiles, and note any mismatch (a paper visible on one profile but missing from the other).\nRespond ONLY with JSON: {"pubs":"one publication per line: title, journal, year","gaps":"mismatches between profiles, or empty","citations":"citation count or h-index if visible, else empty"}`,
      { searchUses: 3, maxTokens: 900 });
    const v = parseJSON(txt);
    if (v.pubs && v.pubs.length > 40) {
      const current = String(u.pubs || '');
      const fresh = v.pubs.split('\n').filter(line => line.length > 15 && !current.toLowerCase().includes(line.toLowerCase().slice(0, 40)));
      if (fresh.length) {
        u._row.set('pubs', (current + '\n' + fresh.join('\n')).trim().slice(0, 2000));
        await u._row.save();
      }
      return u.name + ': profiles read (' + (v.citations || 'citations n/a') + '). ' + (fresh.length ? fresh.length + ' new publication(s) synced into the profile. ' : 'Profile already current. ') + (v.gaps ? 'Gaps to fix by hand: ' + v.gaps : '');
    }
    return u.name + ': public profiles could not be read clearly this week.';
  } catch (e) { return u.name + ': profile sync failed, will retry next week.'; }
}

async function newsScan(u) {
  try {
    const txt = await claude(
`Search the web for THIS WEEK'S most relevant news for a researcher with this profile:\n${profileBlock(u)}\nFind 4-6 items: new postdoctoral fellowship calls or schemes, major new funding to laboratories in their field (ERC, NIH, Wellcome, DFG, Horizon), newly announced postdoc openings at strong labs, and policy changes affecting international postdocs. Prefer official university, lab and funder pages.\nRespond ONLY with JSON array: [{"headline":"","source":"","url":"","why":"one line on why it matters for this researcher"}]`,
      { searchUses: 5, maxTokens: 900 });
    const arr = parseJSON(txt);
    return (Array.isArray(arr) ? arr : []).slice(0, 6).map(x => `${x.headline} (${x.source}) ${x.url} :: ${x.why}`);
  } catch (e) { return []; }
}

async function weeklyReview() {
  await db.connect();
  const deadLinkNotes = await recheckOpenCases();
  const syncNotes = [];
  const newsLines = [];
  for (const u of (await db.all('Users')).filter(x => x.name)) {
    syncNotes.push(await scholarSync(u));
    const items = await newsScan(u);
    if (items.length) newsLines.push('For ' + u.name + ':\n' + items.map(x => '  - ' + x).join('\n'));
  }
  const researchers = (await db.all('Users')).filter(r => r.name);
  const opps = await db.all('Opportunities');
  const out = await db.all('Outbox');
  const sent = out.filter(m => m.status === 'SENT');
  const replied = sent.filter(m => m.replied === 'yes');
  const rejected = opps.filter(o => /REJECT/i.test(o.status));
  const byRegion = {};
  for (const o of opps.filter(x => x.status === 'VERIFIED')) byRegion[o.country || '?'] = (byRegion[o.country || '?'] || 0) + 1;
  const stats =
`Pipeline stats:\n` +
researchers.map(r => `- ${r.name}: ${opps.filter(o => o.resId === r.id).length} opportunities (${opps.filter(o => o.resId === r.id && o.status === 'VERIFIED').length} verified), ${sent.filter(m => m.resId === r.id).length} emails sent, ${replied.filter(m => m.resId === r.id).length} replies`).join('\n') +
`\nOverall reply rate: ${sent.length ? Math.round(100 * replied.length / sent.length) : 0}% (${replied.length}/${sent.length})` +
`\nVerified by country: ${Object.entries(byRegion).map(([k, v]) => k + ': ' + v).join(', ') || 'none yet'}` +
`\nRejected/expired: ${rejected.length}` + (rejected.length ? ' (' + rejected.slice(-5).map(o => o.institution).join(', ') + ')' : '') +
'\nWeekly recheck: ' + (deadLinkNotes.length ? deadLinkNotes.join('; ') : 'all open cases still live') +
'\nProfile sync: ' + syncNotes.join(' | ') +
(await (async () => {
  const opps = await db.all('Opportunities');
  const active = opps.filter(o => o.chance && o.status !== 'EXPIRED' && o.archived !== 'yes');
  const strong = active.filter(o => /strong/i.test(o.chance)).length;
  const mod = active.filter(o => /moderate/i.test(o.chance)).length;
  const long = active.filter(o => /long/i.test(o.chance)).length;
  return active.length ? '\n\nCHANCES ACROSS YOUR CASES: ' + strong + ' Strong, ' + mod + ' Moderate, ' + long + ' long shots. Focus your energy on the Strong ones.' : '';
})()) +
(newsLines.length ? '\n\nFUNDING AND POSTDOC NEWS THIS WEEK\n' + newsLines.join('\n') : '');
  const txt = await claude(
`${STYLE}\n\nYou are the weekly strategy reviewer of an academic career office running these researchers' postdoctoral search:\n\n${researchers.map(profileBlock).join('\n\n')}\n\n${stats}\n\nWrite a short weekly review (350 to 500 words) in plain prose: what is working, what is not, which region or approach deserves more effort next week, what the reply data suggests about outreach quality, one concrete publication move for each researcher that would strengthen applications in the next 90 days (a preprint, a short communication, a review, based on their real research lines), and one single most important action for the coming week. Be direct. If the data is too thin to conclude something, say so instead of inventing a pattern.`,
    { search: false, maxTokens: 1500, premium: true });
  const owner = process.env.OWNER_EMAIL || process.env.GMAIL_USER;
  // (document is saved in the app; not emailed to the user)
  await db.log('WEEKLY_REVIEW', today());
  return txt;
}

/* ---------- MAIN CYCLE ---------- */
let running = false;
async function runCycle(opts = {}) {
  if (running) return { skipped: 'already running' };
  running = true;
  const light = !!opts.light;
  const report = { discovered: [], verified: [], drafted: [], sent: [], awaiting: [], replies: [], errors: [], dupes: 0, couple: [], fellowships: [], referees: [], conversations: [], urgent: [], expired: [], jobs: [], docsNeeded: [], rescored: [], news: [] };
  try {
    await db.connect();
    const researchers = (await db.all('Users')).filter(r => r.active !== 'no' && r.name);
    if (!researchers.length) { report.errors.push('No registered researchers yet.'); }
    db.bustAll();
    await loadRuntimeMode();
    await rescorePending(report);
    try { await buildReminders(); } catch (e) {}
    await expireSweep(report);
    await conversationEngine(researchers, report);
    if (!light) {
      const jobs = researchers.map(r => discover(r, report));
      researchers.forEach(r => jobs.push(jobDiscover(r, report)));
      const donePairs = new Set();
      for (const r of researchers) {
        const p = researchers.find(x => x.id === r.partnerId);
        if (!p) continue;
        const pairKey = [r.id, p.id].sort().join('|');
        if (donePairs.has(pairKey)) continue;
        donePairs.add(pairKey);
        jobs.push(coupleDiscover(r, p, report));
      }
      await Promise.allSettled(jobs);
    }
    if (!light) { await verifyBatch(report); await draftOutreachBatch(researchers, report); }
    await sendBatch(researchers, report);
    await followups(researchers, report);
    await docGate(report);
    await fellowshipReminders(report);
    await refereeReminders(report);
    const hasContent = report.sent.length || report.replies.length || report.awaiting.length || report.discovered.length || report.verified.length || report.errors.length;
    if (!light || hasContent) await sendDigest(report);
    // Persist last-run stamp and summary for the UI freshness indicator
    try {
      const rows = await db.all('Settings');
      const stamp = { at: new Date().toISOString(), discovered: report.discovered.length, verified: report.verified.length, sent: report.sent.length, jobs: (report.jobs||[]).length, rescored: (report.rescored||[]).length };
      const r = rows.find(x => x.key === 'lastRun');
      if (r) { r._row.set('value', JSON.stringify(stamp)); await r._row.save(); }
      else await db.add('Settings', { key: 'lastRun', value: JSON.stringify(stamp) });
    } catch (e) {}
    const u = getUsage(true);
    const inR = parseFloat(process.env.COST_IN_PER_M || '3'), outR = parseFloat(process.env.COST_OUT_PER_M || '15');
    const est = (u.input / 1e6 * inR + u.output / 1e6 * outR);
    report.cost = `API usage this cycle: ${u.calls} calls, ${Math.round(u.input / 1000)}k in + ${Math.round(u.output / 1000)}k out tokens, roughly $${est.toFixed(2)} (estimate at blended rates).`;
    await db.log('CYCLE_DONE', JSON.stringify({ d: report.discovered.length, v: report.verified.length, s: report.sent.length, a: report.awaiting.length, tokens_in: u.input, tokens_out: u.output, est_usd: +est.toFixed(2) }));
  } catch (e) {
    report.errors.push('Cycle error: ' + e.message);
    await db.log('CYCLE_ERROR', e.message);
  }
  running = false;
  return report;
}

module.exports = { runCycle, cfg, draftProposal, interviewBrief, coupleDossier, weeklyReview, draftRefereeRequests, tailoredCV, coverLetter, setRuntimeMode, loadRuntimeMode, targetLabMap, fundingNarrative, sendOne, analyzeCase, piInsight, computeReadiness, buildReminders };
