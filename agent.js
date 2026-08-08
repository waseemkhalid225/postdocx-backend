// lib/agent.js — the PostDocX daily cycle
const { claude, parseJSON } = require('./anthropic');
const db = require('./sheets');
const { sendMail, checkReplies } = require('./mailer');

const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const clamp = n => Math.max(0, Math.min(100, parseInt(n) || 0));

const STYLE = `Writing style, mandatory: write in the natural voice of an experienced researcher, first person where appropriate. Plain, precise, confident academic English. Vary sentence length and rhythm. Never use em dashes or en dashes anywhere; use commas, colons or a new sentence instead. Avoid formulaic phrasing such as "delve", "moreover", "furthermore", "in conclusion", "cutting-edge", "novel insights", "paradigm". No bullet points inside prose. No padding, no symmetrical three-part sentences, no generic openings. Every factual claim must come from the researcher's real profile or from literature you actually found.`;

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

const RULES = `Core rules: only real, currently-open opportunities from credible primary sources; never invent institutions, PIs, emails, URLs, deadlines or publications; mark anything unconfirmed as needing verification; never misrepresent the applicant; optimize for fit quality, not volume.`;

function profileBlock(r) {
  return `RESEARCHER: ${r.name} — ${r.title}\nEMAIL: ${r.email}\nFIELD: ${r.field}\nMETHODS: ${r.methods}\nPUBLICATIONS: ${r.pubs}\nPREFERENCES: ${r.prefs}\nLINKS: ${r.links || 'n/a'}`;
}

function cfg() {
  return {
    autoSend: (process.env.SEND_MODE || 'approval').toLowerCase() === 'auto',
    maxEmailsPerDay: parseInt(process.env.MAX_EMAILS_PER_DAY || '5'),
    maxDiscover: parseInt(process.env.MAX_DISCOVER_PER_RESEARCHER || '5'),
    maxVerify: parseInt(process.env.MAX_VERIFY_PER_RUN || '6'),
    followupDays: parseInt(process.env.FOLLOWUP_DAYS || '8'),
    maxFollowups: parseInt(process.env.MAX_FOLLOWUPS || '2'),
    regions: process.env.REGIONS || 'Europe (EU country-by-country + UK), USA, Canada, Gulf (UAE, Saudi Arabia, Qatar)',
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
`${RULES}\n\n${profileBlock(r)}\n\nTASK: Search the web NOW (today: ${today()}) for currently-open postdoctoral positions, fellowships or credible hostable routes matching this researcher. Regions: ${c.regions}.\nFind up to ${c.maxDiscover} real, active items. Prefer the original institutional advertisement. Include the PI's publicly listed institutional email ONLY if you actually found it on an official page — never guess an email.\nRespond with ONLY a JSON array. Each element:\n{"title":"","institution":"","country":"","pi":"","piEmail":"","url":"","deadline":"YYYY-MM-DD or empty","funding":"Fully funded|Partially funded|Hostable / self-funded|Grant-first","summary":"1 sentence","fit":"1-2 sentences","momentum":"note if the PI or department recently won a major grant (ERC, NIH, Wellcome, DFG etc), else empty","matchScore":0-100}`,
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
      dupKey, addedOn: today(), verifiedOn: ''
    });
    report.discovered.push(`${x.title} — ${x.institution} (${clamp(x.matchScore)}/100) [${r.name}]`);
  }
}

/* ---------- 2. VERIFY ---------- */
async function verifyBatch(report) {
  const c = cfg();
  const opps = (await db.all('Opportunities'))
    .filter(o => o.status === 'NEEDS_VERIFICATION')
    .sort((a, b) => (parseInt(b.matchScore) || 0) - (parseInt(a.matchScore) || 0))
    .slice(0, c.maxVerify);
  for (const o of opps) {
    try {
      const txt = await claude(
`${RULES}\n\nSearch the web to verify whether this position is REAL and CURRENTLY ACTIVE today (${today()}):\nTitle: ${o.title}\nInstitution: ${o.institution}\nURL: ${o.url || 'unknown'}\nRespond ONLY with JSON: {"verified":true|false|"unclear","deadline":"YYYY-MM-DD or empty","contactEmail":"official application/PI email if publicly listed, else empty","note":"1-2 sentences"}`);
      const v = parseJSON(txt);
      o._row.set('status', v.verified === true ? 'VERIFIED' : v.verified === false ? 'EXPIRED' : 'NEEDS_VERIFICATION');
      if (isDate(v.deadline)) o._row.set('deadline', v.deadline);
      if (v.contactEmail && /@/.test(v.contactEmail)) o._row.set('note', (o.note + ' | Contact: ' + v.contactEmail).slice(0, 900));
      o._row.set('verifiedOn', today());
      await o._row.save();
      report.verified.push(`${o.title} — ${o.institution}: ${v.verified === true ? 'ACTIVE ✓' : v.verified === false ? 'expired ✗' : 'unclear'}`);
    } catch (e) { report.errors.push(`Verify failed (${o.institution}): ${e.message}`); }
  }
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
    o.status === 'VERIFIED' && (parseInt(o.matchScore) || 0) >= 80 &&
    !outbox.some(m => m.oppId === o.id));
  for (const o of targets.slice(0, 4)) {
    const r = researchers.find(x => x.id === o.resId);
    if (!r) continue;
    const toEmail = extractEmail(o.note);
    try {
      const txt = await claude(
`${RULES}\n\n${profileBlock(r)}\n\nVERIFIED OPPORTUNITY: ${o.title} at ${o.institution}${o.pi ? ', PI ' + o.pi : ''}. Notes: ${o.note}\n\n${STYLE}\n\nDraft a short, highly personalized first-contact email (under 170 words). Lead with the supervisor's current scientific problem; reference genuine recent work only (search the web to confirm); identify one concrete research gap; connect the applicant's real methods; suggest a funding route if relevant; one low-friction closing request. No flattery, no invented facts.${learn}\nRespond ONLY with JSON: {"subject":"","body":""}`);
      const d = parseJSON(txt);
      if (!d.subject || !d.body) throw new Error('empty draft');
      await db.add('Outbox', {
        id: uid(), resId: r.id, oppId: o.id, toEmail, toName: o.pi || o.institution,
        subject: d.subject, body: d.body, type: 'outreach',
        status: toEmail ? 'PENDING' : 'NO_EMAIL', createdOn: today(),
        sentOn: '', followups: '0', lastFollowupOn: '', replied: ''
      });
      report.drafted.push(`${o.pi || o.institution} — "${d.subject}" ${toEmail ? '' : '(no public email found — add manually in Outbox)'}`);
    } catch (e) { report.errors.push(`Draft failed (${o.institution}): ${e.message}`); }
  }
}

/* ---------- 4. SEND or QUEUE ---------- */
async function sendBatch(researchers, report) {
  const c = cfg();
  const outbox = await db.all('Outbox');
  const sentToday = outbox.filter(m => m.sentOn === today()).length;
  let budget = Math.max(0, c.maxEmailsPerDay - sentToday);
  const ready = outbox.filter(m => (m.status === 'PENDING' || m.status === 'APPROVED') && m.toEmail);
  for (const m of ready) {
    const mustApprove = !c.autoSend && m.status !== 'APPROVED';
    if (mustApprove) { report.awaiting.push(m); continue; }
    if (budget <= 0) { report.awaiting.push(m); continue; }
    const r = researchers.find(x => x.id === m.resId) || {};
    try {
      let attachments = [];
      if (m.type === 'outreach') {
        const docs = await db.all('Documents');
        const cv = docs.find(d => d.resId === m.resId && /cv/i.test(d.type) && d.attach === 'yes' && d.url);
        if (cv) attachments = [{ filename: (cv.name || 'CV') + '.pdf', path: cv.url }];
      }
      await sendMail({
        to: m.toEmail, subject: m.subject,
        text: m.body + `\n\nBest regards,\n${r.name || ''}\n${r.title || ''}${r.email ? '\n' + r.email : ''}`,
        fromName: r.name, attachments
      });
      m._row.set('status', 'SENT'); m._row.set('sentOn', today());
      await m._row.save();
      budget--;
      report.sent.push(`${m.toName} <${m.toEmail}> — "${m.subject}"`);
      await db.log('EMAIL_SENT', `${m.toEmail} | ${m.subject}`);
    } catch (e) { report.errors.push(`Send failed (${m.toEmail}): ${e.message}`); }
  }
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
  const known = [...new Set(outbox.filter(m => m.status === 'SENT' && m.toEmail).map(m => m.toEmail.toLowerCase()))];
  const replies = await checkReplies(known);
  for (const rep of replies) {
    for (const m of outbox.filter(x => x.toEmail.toLowerCase() === rep.from)) {
      if (m.replied !== 'yes') { m._row.set('replied', 'yes'); await m._row.save(); }
    }
    report.replies.push(`${rep.from} — "${rep.subject}"`);
  }
}

/* ---------- 7. DAILY DIGEST ---------- */
function approvalLinks(m, c) {
  if (!c.baseUrl) return '(set BASE_URL to enable one-tap links)';
  return `Approve: ${c.baseUrl}/approve/${m.id}?key=${c.approveKey}\n   Reject:  ${c.baseUrl}/reject/${m.id}?key=${c.approveKey}`;
}

async function sendDigest(report) {
  const c = cfg();
  const owner = process.env.OWNER_EMAIL || process.env.GMAIL_USER;
  if (!owner) return;
  const sec = (title, arr, fmt) => arr.length ? `\n== ${title} (${arr.length}) ==\n` + arr.map(fmt || (x => '• ' + x)).join('\n') + '\n' : '';
  const body =
`PostDocX daily report — ${today()}  (mode: ${c.autoSend ? 'AUTO-SEND' : 'APPROVAL'})
${sec('Replies received — action needed', report.replies)}${sec('New verified positions', report.verified)}${sec('New opportunities discovered', report.discovered)}${sec('Couple placement scenarios', report.couple)}${sec('Emails sent', report.sent)}${sec('Drafts created', report.drafted)}${sec('Awaiting your approval', report.awaiting, m => `• To ${m.toName} <${m.toEmail}> — "${m.subject}"\n   ${approvalLinks(m, c)}`)}${sec('Referee action needed', report.referees)}${sec('Fellowship calendar, deadlines within 3 months', report.fellowships)}${sec('Errors', report.errors)}
Duplicates blocked: ${report.dupes}
Open the Google Sheet for full records.`;
  try { await sendMail({ to: owner, subject: `PostDocX report ${today()} — ${report.sent.length} sent, ${report.awaiting.length} awaiting approval`, text: body }); }
  catch (e) { console.error('Digest failed:', e.message); }
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
  for (const x of arr) {
    if (!x.title || !x.institution) continue;
    const r = x.forResearcher === 'B' ? r2 : r1;
    const dupKey = (r.id + '|' + x.institution + '|' + x.title).toLowerCase().replace(/\s+/g, ' ');
    if (existing.some(o => o.dupKey === dupKey)) { report.dupes++; continue; }
    await db.add('Opportunities', {
      id: uid(), resId: r.id, title: x.title, institution: x.institution, country: x.country || '',
      pi: x.pi || '', url: x.url || '', deadline: isDate(x.deadline) ? x.deadline : '',
      funding: x.funding || 'Funding TBC', status: 'NEEDS_VERIFICATION',
      matchScore: clamp(x.matchScore),
      note: [x.fit, x.coupleNote ? 'Couple: ' + x.coupleNote : '', visaNote(x.country)].filter(Boolean).join(' | '),
      dupKey, addedOn: today(), verifiedOn: '', coupleKey: 'couple-' + [r1.id, r2.id].sort().join('-') + '-' + (x.pairId || 'x')
    });
    report.couple.push(`[${x.pairId || '?'}] ${r.name}: ${x.title} at ${x.institution} (${clamp(x.matchScore)}/100)`);
  }
}

/* ---------- PROPOSAL ENGINE (on demand) ---------- */
async function draftProposal(oppId) {
  await db.connect();
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp) throw new Error('Opportunity not found: ' + oppId);
  const r = (await db.all('Researchers')).find(x => x.id === opp.resId);
  if (!r) throw new Error('Researcher not found for opportunity');
  const txt = await claude(
`${RULES}\n\n${STYLE}\n\n${profileBlock(r)}\n\nTARGET: ${opp.title} at ${opp.institution}${opp.pi ? ', PI ' + opp.pi : ''}. Notes: ${opp.note}\n\nSearch the web for the PI's and group's work from the last three years, then write a research concept note of 700 to 900 words that this researcher could refine and send. Structure it as flowing prose under these plain headings: Background and rationale; Hypothesis and aims; Approach; Expected outcomes and impact; Fit and feasibility. Ground the science in what the host group actually publishes and in the applicant's real methods. Distinguish established evidence from reasonable inference. Do not fabricate preliminary data, collaborations or citations. The result should read like a careful senior researcher wrote it for this one laboratory.`,
    { maxTokens: 3000 });
  const row = { id: uid(), resId: r.id, oppId, title: 'Concept note: ' + opp.title + ' (' + opp.institution + ')', status: 'DRAFT', content: txt.slice(0, 45000), createdOn: today() };
  await db.add('Proposals', row);
  const owner = process.env.OWNER_EMAIL || process.env.GMAIL_USER;
  if (owner) {
    try { await sendMail({ to: owner, subject: 'PostDocX concept note: ' + opp.institution + ' (' + r.name + ')', text: txt + '\n\n(This draft is stored in the Proposals tab. Review and edit it as the author before any use.)' }); } catch (e) {}
  }
  await db.log('PROPOSAL', row.title);
  return row;
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

async function fellowshipReminders(report) {
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
  const r = (await db.all('Researchers')).find(x => x.id === resId);
  if (!r) throw new Error('Researcher not found');
  const refs = (await db.all('Referees')).filter(x => x.resId === resId && x.status !== 'confirmed' && x.email);
  let n = 0;
  for (const ref of refs) {
    const txt = await claude(
`${STYLE}\n\nWrite a short, warm, professional email (under 130 words) from ${r.name} (${r.title}) asking ${ref.name} (${ref.relationship || 'former supervisor'}) to serve as a reference for upcoming postdoctoral applications. Mention that specific requests with deadlines will follow, offer to share an updated CV, and thank them genuinely without gushing. Respond ONLY with JSON: {"subject":"","body":""}`,
      { search: false, maxTokens: 500 });
    const d = parseJSON(txt);
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
  const r = (await db.all('Researchers')).find(x => x.id === opp.resId);
  const txt = await claude(
`${RULES}\n\n${STYLE}\n\n${profileBlock(r)}\n\nINTERVIEW TARGET: ${opp.title} at ${opp.institution}${opp.pi ? ', PI ' + opp.pi : ''}. Notes: ${opp.note}\n\nSearch the web for the PI's and department's recent work, then prepare an interview briefing with these sections in plain prose: The lab right now (what they publish and where the group is heading); Your two minute research pitch tuned to this lab; Eight likely technical questions with strong short answers grounded in the applicant's real work; Four intelligent questions to ask them; Funding narrative (how the position or a fellowship route would be financed and what to say about it); Risks to prepare for. Keep it practical, specific and honest.`,
    { maxTokens: 3500 });
  const row = { id: uid(), resId: opp.resId, oppId, title: 'Interview briefing: ' + opp.title + ' (' + opp.institution + ')', status: 'READY', content: txt.slice(0, 45000), createdOn: today() };
  await db.add('Proposals', row);
  const owner = process.env.OWNER_EMAIL || process.env.GMAIL_USER;
  if (owner) { try { await sendMail({ to: owner, subject: 'Interview briefing: ' + opp.institution + ' (' + (r ? r.name : '') + ')', text: txt }); } catch (e) {} }
  await db.log('INTERVIEW_BRIEF', row.title);
  return row;
}

/* ---------- TWO-BODY COUPLE DOSSIER ---------- */
async function coupleDossier(oppId) {
  await db.connect();
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp) throw new Error('Opportunity not found: ' + oppId);
  const researchers = await db.all('Researchers');
  const r1 = researchers.find(x => x.id === opp.resId);
  const r2 = researchers.find(x => x.id === (r1 || {}).partnerId);
  if (!r1 || !r2) throw new Error('This opportunity is not linked to a couple (set partnerId).');
  const sibling = (await db.all('Opportunities')).find(o => o.coupleKey && o.coupleKey === opp.coupleKey && o.id !== opp.id);
  const txt = await claude(
`${RULES}\n\n${STYLE}\n\nRESEARCHER A:\n${profileBlock(r1)}\n\nRESEARCHER B:\n${profileBlock(r2)}\n\nTARGET: ${opp.title} at ${opp.institution}, ${opp.country}.${sibling ? ' Paired opportunity for the partner: ' + sibling.title + ' at ' + sibling.institution + '.' : ''} Notes: ${opp.note}\n\nWrite a two body dossier of 600 to 800 words that a department could circulate internally when considering a dual placement. Sections in plain prose: Who we are (one short paragraph each, real credentials only); Complementary research programme (how the two research lines genuinely reinforce each other, e.g. pharmacology and antimicrobial biomaterials meeting in implant associated infection and drug delivery); What each of us brings to this institution; Practicalities (funding routes for each, timing, relocation as a family). Search the web briefly to anchor the institutional context. Honest, warm, specific.`,
    { maxTokens: 3000 });
  const row = { id: uid(), resId: r1.id, oppId, title: 'Two-body dossier: ' + opp.institution, status: 'DRAFT', content: txt.slice(0, 45000), createdOn: today() };
  await db.add('Proposals', row);
  const owner = process.env.OWNER_EMAIL || process.env.GMAIL_USER;
  if (owner) { try { await sendMail({ to: owner, subject: 'Two-body dossier: ' + opp.institution, text: txt }); } catch (e) {} }
  await db.log('COUPLE_DOSSIER', row.title);
  return row;
}

/* ---------- WEEKLY STRATEGY REVIEW ---------- */
async function weeklyReview() {
  await db.connect();
  const researchers = (await db.all('Researchers')).filter(r => r.name);
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
`\nRejected/expired: ${rejected.length}` + (rejected.length ? ' (' + rejected.slice(-5).map(o => o.institution).join(', ') + ')' : '');
  const txt = await claude(
`${STYLE}\n\nYou are the weekly strategy reviewer of an academic career office running these researchers' postdoctoral search:\n\n${researchers.map(profileBlock).join('\n\n')}\n\n${stats}\n\nWrite a short weekly review (350 to 500 words) in plain prose: what is working, what is not, which region or approach deserves more effort next week, what the reply data suggests about outreach quality, one concrete publication move for each researcher that would strengthen applications in the next 90 days (a preprint, a short communication, a review, based on their real research lines), and one single most important action for the coming week. Be direct. If the data is too thin to conclude something, say so instead of inventing a pattern.`,
    { search: false, maxTokens: 1500 });
  const owner = process.env.OWNER_EMAIL || process.env.GMAIL_USER;
  if (owner) { try { await sendMail({ to: owner, subject: 'PostDocX weekly strategy review, ' + today(), text: txt }); } catch (e) {} }
  await db.log('WEEKLY_REVIEW', today());
  return txt;
}

/* ---------- MAIN CYCLE ---------- */
let running = false;
async function runCycle(opts = {}) {
  if (running) return { skipped: 'already running' };
  running = true;
  const light = !!opts.light;
  const report = { discovered: [], verified: [], drafted: [], sent: [], awaiting: [], replies: [], errors: [], dupes: 0, couple: [], fellowships: [], referees: [] };
  try {
    await db.connect();
    const researchers = (await db.all('Researchers')).filter(r => r.active !== 'no' && r.name);
    if (!researchers.length) { report.errors.push('No researchers in the Researchers sheet.'); }
    await detectReplies(report);
    if (!light) for (const r of researchers) await discover(r, report);
    const donePairs = new Set();
    for (const r of researchers) {
      const p = researchers.find(x => x.id === r.partnerId);
      if (!p) continue;
      const pairKey = [r.id, p.id].sort().join('|');
      if (donePairs.has(pairKey)) continue;
      donePairs.add(pairKey);
      if (!light) await coupleDiscover(r, p, report);
    }
    if (!light) { await verifyBatch(report); await draftOutreachBatch(researchers, report); }
    await sendBatch(researchers, report);
    await followups(researchers, report);
    await fellowshipReminders(report);
    await refereeReminders(report);
    const hasContent = report.sent.length || report.replies.length || report.awaiting.length || report.discovered.length || report.verified.length || report.errors.length;
    if (!light || hasContent) await sendDigest(report);
    await db.log('CYCLE_DONE', JSON.stringify({ d: report.discovered.length, v: report.verified.length, s: report.sent.length, a: report.awaiting.length }));
  } catch (e) {
    report.errors.push('Cycle error: ' + e.message);
    await db.log('CYCLE_ERROR', e.message);
  }
  running = false;
  return report;
}

module.exports = { runCycle, cfg, draftProposal, interviewBrief, coupleDossier, weeklyReview, draftRefereeRequests };
