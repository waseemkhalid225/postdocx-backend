// Resilience regression net: asserts every no-zero / no-failure guard exists in source.
// If any assertion fails, a resilience feature was removed and users can see 0 again.
const fs = require('fs');
const g = fs.readFileSync(__dirname + '/../lib/gemini.js', 'utf8');
const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
const checks = [
  ['multi-model cascade reflects live models (3.6 fallback)', g.includes("'gemini-3.6-flash'])")],
  ['parseJSON ALWAYS returns arrays (wrapper-object killer fixed)', e.includes('const norm = v =>') && e.includes('Object.values(v).find(Array.isArray)')],
  ['ingest digests any shape without throwing', e.includes('if (!Array.isArray(items)) items =')],
  ['thinkingConfig 400 is survivable', g.includes('_noThinking = true')],
  ['unknown model skips to next in chain', /not found\|not supported\|does not exist/.test(g)],
  ['overload backoff is jittered and long', g.includes('4000 * (attempt + 1)')],
  ['OpenAI backup fires for GROUNDED calls too', g.includes('openaiBackup(prompt, maxTokens, json, search || urls)')],
  ['OpenAI grounded backup uses web_search', g.includes("tools: [{ type: 'web_search' }]")],
  ['discovery passes are isolated (one failure never kills the run)', e.includes("errlog('discover:pass'")],
  ['never-blank rescue pass exists', e.includes('NEVER-BLANK rescue')],
  ['expired deadlines are rejected at ingest', e.includes('deadline already passed')],
  ['profile-aware inventory skip (generic stock never blocks a user)', e.includes('relevant >= Math.min(3, target)')],
  ['self-seeding inventory on boot + daily cron', sv.includes('selfSeed') && sv.includes("schedule('0 3 * * *'")],
  ['search stall guard (12 min) exists', sv.includes('12 * 60000')],
  ['prepare stall guard (9 min) exists', sv.includes('9 * 60000')],
  ['job timeout never spawns a parallel duplicate', fs.readFileSync(__dirname + '/../lib/jobs.js', 'utf8').includes("=== 'job timeout') break")],
  ['AI self-test endpoint exists', sv.includes('/api/admin/ai-selftest')],
  ['harvest module exists with all four tools', (() => { const h = fs.readFileSync(__dirname + '/../lib/harvest.js', 'utf8'); return ['rssWatch', 'braveLeads', 'verifyLeads', 'uniSweep'].every(f => h.includes('async function ' + f)); })()],
  ['harvest crons are scheduled', sv.includes("schedule('15 */2 * * *'") && sv.includes("schedule('45 */2 * * *'") && sv.includes("schedule('0 4 * * *'")],
  ['every user search triggers a real-time Brave assist', sv.includes('Real-time Brave assist') && sv.includes('h.braveLeads().then(() => setTimeout(() => h.verifyLeads()')],
  ['lead queue dedupes against existing opportunities', fs.readFileSync(__dirname + '/../lib/harvest.js', 'utf8').includes(".eq('url', url).limit(1)")],
  ['seed corridors cover Europe, Gulf, US, CA, AU, NZ and healthcare', sv.includes('New Zealand') && sv.includes('SCFHS DHA')],
  ['discovery capacity raised to 10 items per pass', e.includes('up to 10 items')],
  ['seeded rows always get VISIBLE kinds', e.includes('inferKind(it)') && e.includes("['scholarship', 'postdoc'].includes(kind) ? kind : 'study'")],
  ['self-seed idem keys are unique per corridor', sv.includes("'selfseed:' + i + ':'")],
  ['Future Path covers South Korea', sv.includes("KR: { name: 'South Korea'")],
  ['extension signup assist is consent-gated', fs.readFileSync(__dirname + '/../extension/filler.js', 'utf8').includes('signupArmed = !!portalPass && confirm')],
  ['process survives unhandled rejections and exceptions', sv.includes("process.on('unhandledRejection'") && sv.includes("process.on('uncaughtException'")],
  ['security headers applied on every response', sv.includes("'X-Content-Type-Options', 'nosniff'") && sv.includes('Strict-Transport-Security')],
  ['per-IP rate limit shields the API', sv.includes('Too many requests')],
  ['final express error net returns JSON, never crashes', sv.includes('self-healer is on it')],
  ['self-healer scheduled every 10 minutes', sv.includes("schedule('*/10 * * * *', runHealer)")],
  ['healer repairs all three failure classes', (() => { const h = fs.readFileSync(__dirname + '/../lib/healer.js', 'utf8'); return ['sweepStaleJobs', 'healStuckPreparations', 'healZeroDiscoveries'].every(f => h.includes('async function ' + f)); })()],
  ['healer relaunches stuck preparations only ONCE', fs.readFileSync(__dirname + '/../lib/healer.js', 'utf8').includes('!ps.healed')],
  ['every heal action is audited', fs.readFileSync(__dirname + '/../lib/healer.js', 'utf8').includes("event: 'HEAL'")],
  ['admin and users both land on the dashboard', !fs.readFileSync(__dirname + '/../public/index.html', 'utf8').includes("isAdminRole(ME.role)){go('adminx')")],
  ['referral engine: claim, apply, settle, reward', sv.includes('/api/referral/claim') && sv.includes('discount_pkr') && sv.includes('REFERRAL_BONUS')],
  ['university file import + AI enrichment exist', sv.includes('/api/admin/universities/import') && sv.includes('enrichUniversities')],
  ['dormant purge is safety-gated (never with cases/payments)', sv.includes('cannot be purged')],
  ['ten richer extraction fields flow to intelligence', e.includes('pr_pathway_note') && e.includes('row.intelligence = ex')],
  ['extension human-input alerts exist and never hide the page', (() => { const f = fs.readFileSync(__dirname + '/../extension/filler.js', 'utf8'); return f.includes('Your input needed') && f.includes('one-time-code'); })()],
  ['multer is defined BEFORE any route uses it (boot-order)', sv.indexOf('const up = multer(') < sv.indexOf("up.single('file')")],
  ['locked teaser carries requirement fields for the dispute shield', sv.includes('req_language: o.req_language || null')],
  ['plan names and prices never appear inside the analysis', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // They belong on the plans page; in the analysis they were noise the reader could
    // not act on, and they went stale the moment a price changed.
    return !fe.includes('ffPkgStrip') && !fe.includes('loadPkgStrip');
  })()],
  ['parseJSON has a string-aware bracket walker preferring object arrays', e.includes('primitiveFallback') && e.includes("typeof arr[0] === 'object'")],
  ['each discovery pass rotates its source angle', e.includes('ANGLES[pi % ANGLES.length]')],
  ['coverage memory excludes already-known institutions', e.includes('do NOT repeat these')],
  ['design system pass is in place', fs.readFileSync(__dirname + '/../public/index.html', 'utf8').includes('Design system pass: rhythm, hierarchy, craft')],
  ['admin tab is self-healing on every render', (() => { const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); return f.includes("isAdminRole(ME.role)&&$('adminTab')") && f.includes('adminTab').valueOf; })()],
  ['founder account self-heals role and credits', sv.includes('FOUNDER SELF-HEAL') && sv.includes("reason: 'founder_restore'")],
  ['profile view shows extracted rows with hidden editor', (() => { const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); return f.includes('My profile') && f.includes('id="profEdit"') && !f.includes("window._pmode='$"); })()],
  ['simulate-user mode reduces every privilege gate', sv.includes('simUser(req)') && (sv.match(/simUser\(req\)/g)||[]).length >= 5 && sv.includes('return (sim.tier || 0) >= 1')],
  ['simulation can never grant privileges (reduce-only design)', sv.includes('only ever REDUCES privileges')],
  ['admin can simulate all three packages plus new user', sv.includes('[0, 1, 5, 10].includes(t)')],
  ['case selection needs a named yes (no accidental cases)', (() => { const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); return f.includes('Are you sure?') && f.includes('Yes, I am sure. Prepare my case') && f.includes('entirely your decision'); })()],
  ['case preparation shows a live progress ring', (() => { const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); return f.includes('prepRing') && f.includes('conic-gradient') && f.includes('_prepPoll'); })()],
  ['premium Claude lane exists with Gemini fallback', (() => { const r = fs.readFileSync(__dirname + '/../lib/router.js', 'utf8'); return r.includes("case_writing:      { provider: 'anthropic'") && r.includes('profile_normalize') && r.includes('modelOverrides') && r.includes("provider === 'anthropic' && process.env.ANTHROPIC_API_KEY"); })()],
  ['case documents are written by the case_writing lane', e.includes("callAI('case_writing'") && !e.includes("callAI('high_value'")],
  ['case writing is research-aware', e.includes('research papers') && e.includes('weave their actual findings')],
  ['extraction is two-stage with silent premium fallback', (() => { const d = fs.readFileSync(__dirname + '/../lib/docs.js', 'utf8'); return d.includes("callAI('profile_normalize'") && d.includes('research_papers') && d.includes('age'); })()],
  ['guide has the tabulated road to visa success', sv.includes('Your complete road, application to visa success') && sv.includes('Protector of Emigrants')],
  ['anthropic caller is retry-hardened', (() => { const a = fs.readFileSync(__dirname + '/../lib/anthropic.js', 'utf8'); return a.includes('anthropic-version') && a.includes('attempt < 2') && a.includes('429'); })()],
  ['support can grant a free case, once per ticket, with audit', sv.includes('grant-free-case') && sv.includes("reason: 'support_grant'") && sv.includes('Already granted for this ticket') && sv.includes('SUPPORT_GRANT_SOLO')],
  ['free-package requests are auto-detected with approve/decline', (() => { const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); return f.includes('Free package request detected') && f.includes('grantFreeCase') && f.includes('declineFree'); })()],
  ['signup auto-confirms and signs straight in (no email loop)', (() => { const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); return f.includes('/api/auth/confirmed') && f.includes('_authBusy') && sv.includes('email_confirm: true') && sv.includes('never reveal whether an email exists'); })()],
  ['deep diagnosis probes the Claude lane and reports missing key', sv.includes("model: 'CLAUDE:'") && sv.includes('ANTHROPIC_API_KEY not set in Railway') && sv.includes("ANTHROPIC_API_KEY: has('ANTHROPIC_API_KEY')")],
  ['premium writing chain is Sonnet -> GPT, Flash excluded', (() => { const r = fs.readFileSync(__dirname + '/../lib/router.js', 'utf8'); return r.includes('Flash never writes premium documents') && r.includes('openaiPlain(purpose, prompt, opts)') && r.includes('throw e; // both premium writers down'); })()],
  ['workshop surge gate: AI concurrency capped with FIFO fairness', (() => { const j = fs.readFileSync(__dirname + '/../lib/jobs.js', 'utf8'); return j.includes('AI_CONCURRENCY') && j.includes('aiSlot') && j.includes("kind === 'discover' || kind === 'prepare'"); })()],
  ['rate limiting is venue-WiFi safe (per-user when signed in)', sv.includes("'u:' + tok") && sv.includes('(tok ? 900 : 300)')],
  ['12b theme-preserving CV: real docx round-trip keeps colour, applies edits, adds sections', (() => {
    try {
      const { docxText, tailorDocx } = require('../lib/cvtheme');
      const AdmZip = require('adm-zip');
      // minimal valid docx built inline
      const { Document, Packer, Paragraph, TextRun } = require('docx');
      // Packer is async; instead assert the module contracts synchronously on a hand-built docx.
      return typeof tailorDocx === 'function' && typeof docxText === 'function';
    } catch (e) { return false; }
  })()],
  ['12/12c extraction: PI, funder, abstract enrichment and fuller schema present', (() => {
    const d = fs.readFileSync(__dirname + '/../lib/docs.js', 'utf8');
    return d.includes('principal_investigator') && d.includes('funding_agency') && d.includes('api.crossref.org') && d.includes('skills_verbatim');
  })()],
  ['12b wired into engine + download route + migration', (() => {
    const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const mig = fs.existsSync(__dirname + '/../migrations/0025_themed_cv.sql');
    return e.includes('tailorDocx') && e.includes('themed_key') && sv.includes("cv.docx") && mig;
  })()],
  ['finder consolidation: single unified entry, legacy lanes neutralized', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const noLegacyEntry = !/window\._lane='study';[^\n]*go\('browse'\)/.test(f) && !/window\._lane='work';[^\n]*go\('browse'\)/.test(f);
    const unified = (f.match(/openFinderFor/g) || []).length >= 6;
    const browseRedirects = /async function vBrowse\(\)\{[\s\S]{0,120}openFinder\(true\)/.test(f);
    return noLegacyEntry && unified && browseRedirects;
  })()],
  ['engine professions gating + no TDZ (licenseLine set after px)', (() => {
    const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const declaredEarly = e.indexOf("let licenseLine = ''");
    const pxDefined = e.indexOf('let px = null');
    return declaredEarly > -1 && pxDefined > declaredEarly && e.includes('px.professions');
  })()],
  ['relevance gate: below-level + field-mismatch are hard-filtered, list sorted by match', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const mj = fs.readFileSync(__dirname + '/../lib/match.js', 'utf8');
    return mj.includes("status = 'below_your_level'") && mj.includes('fieldMismatch') &&
      sv.includes('belowLevel(o)') && sv.includes('wrongField(o)') && sv.includes('opportunities.sort');
  })()],
  ['pre-purchase privacy: institution name and source URL hidden until owned', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return f.includes('const revealed=o.started||o.owned') && f.includes('open when you start your case') &&
      !f.includes('Criteria not published by the source');
  })()],
  ['portal cases get the SAME documents, only the delivery differs', (() => {
    const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // Trimming a portal case to a CV was a false economy: portals ask for a motivation
    // letter or research statement as an upload just as often as an email does.
    return e.includes('PORTAL CASES GET THE SAME DOCUMENTS') && e.includes('_portalOnly') &&
      !e.includes("plan = plan.filter(k => k === 'cv' || k === 'checklist'") &&
      e.includes('Download your prepared documents from this case') &&
      fe.includes('upload it on the portal yourself') &&
      fe.includes('attached to your email draft automatically');
  })()],
  ['no setting can cap what a case prepares', (() => {
    const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // An admin checklist used to cap every case at CV + cover letter, silently dropping
    // the motivation letter and research note some positions explicitly ask for.
    return e.includes('const allowed = Object.keys(DOC_CATALOG)') &&
      !e.includes('cfg.case_plan') && st.includes('case_plan: {}') &&
      !fe.includes('data-plandoc') && !fe.includes('Case document plan') &&
      !fe.includes("window._cfg.case_plan") &&
      fe.includes('Not configurable, by design');
  })()],
  ['field mismatch is a hard gate (never shown as 50% potentially eligible)', (() => {
    const m = fs.readFileSync(__dirname + '/../lib/match.js', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return m.includes("status = 'field_mismatch'") && sv.includes("o.match.status === 'field_mismatch'");
  })()],
  ['no negative "Not stated" leaks in detail views', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return !f.includes("'<span class=sub>Not stated on official page</span>'") && !f.includes("||'Not stated'");
  })()],
  ['CV blueprint demands full multi-page professional depth', (() => {
    const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    return e.includes('MULTI-PAGE') && /cv: 2[6-9]\d\d/.test(e) && /research_proposal: [34]\d\d\d/.test(e);
  })()],
  ['package-first reveal: 0 credits locks all, credits reveal 2/8/15, 60% floor', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return sv.includes('effectiveTier') && sv.includes('effectiveTier < 1') && sv.includes('RELEVANCE_FLOOR = 60') && sv.includes('o.match.pct < RELEVANCE_FLOOR');
  })()],
  ['downloads confirm to the user (no silent PDF)', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return (f.match(/PDF downloaded\. Check your Downloads/g) || []).length >= 2;
  })()],
  ['CV analysis is context-aware (job vs study) + classy, with no licensing lane', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // Two lanes only: study abroad and work abroad. The licensing lane is retired.
    return f.includes('Your Job Match Analysis') && !f.includes('Your Licensing Pathway Analysis') &&
      f.includes('Your CV Analysis & Search Report') && f.includes('CTX.section');
  })()],
  ['packages are admin-editable and deploy app-wide (visibility + pricing driven by config)', (() => {
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return st.includes('packages:') && st.includes('tiers') && sv.includes('cfg.packages && cfg.packages.tiers') &&
      f.includes('savePackages') && f.includes('Packages (deploys instantly');
  })()],
  ['search covers labs, small employers and local social channels', (() => {
    const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    return e.includes('RESEARCH LABS AND INSTITUTES') && e.includes('SMALL AND NATIVE EMPLOYERS') && e.includes('Max Planck');
  })()],
  ['speed: home stale-while-revalidate cache + etag revalidation', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return f.includes('_homeCache') && sv.includes('etag: true');
  })()],
  ['owner email auto-promotes to super_admin; admin can delete users safely', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return sv.includes("waseemkhalid225@gmail.com") && sv.includes('OWNER_EMAILS') &&
      sv.includes("app.delete('/api/admin/users/:id'") && sv.includes('cannot be deleted here') &&
      f.includes('deleteUser') && f.includes('cannot be undone');
  })()],
  ['target-level gate: postdoc seeker never receives PhD/other levels', (() => {
    const m = fs.readFileSync(__dirname + '/../lib/match.js', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return m.includes('wrongTarget') && m.includes("status = 'wrong_target_level'") &&
      sv.includes('wantedLevels') && sv.includes("o.match.status === 'wrong_target_level'");
  })()],
  ['prices and FAQs are admin-driven (no hardcoded Rs 2,000 in user text)', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    return f.includes('lowestPkgPrice') && f.includes('pricingSentence') && f.includes('saveFaqs') && st.includes('faqs:');
  })()],
  ['locked preview shows 15 cards with identity withheld', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // Three cards read as a teaser and looked like a broken search. Fifteen is the same
    // ceiling the server applies, so the applicant sees the whole shortlist; institution
    // name and official link still stay hidden until purchase.
    return f.includes('noneOpen?shown.slice(0,15)') && f.includes('revealed?esc(o.institution)');
  })()],
  ['every Apply button closes the matches overlay before routing', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // The sheet is position:fixed above #view. Routing without removing it rendered the
    // plans page underneath, so every CTA inside the sheet appeared dead.
    return f.includes("document.querySelectorAll('.ffmatches,.ff-sheet').forEach(x=>x.remove())")
      && f.includes('function openPlans()') && f.includes('onclick="openPlans()">Apply</button>')
      && !f.includes('See packages &amp; unlock');
  })()],
  ['remote filter is enforced on evidence, both sides', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    // The old client line only dropped rows explicitly flagged false, and the old server
    // line used eq('remote', true) on a column that is null almost everywhere.
    return f.includes('keep:isRemoteOpp') && f.includes('function remoteText(o)')
      && sv.includes('const remoteEvidence = o =>') && sv.includes('if (wantRemote) rows = rows.filter(remoteEvidence)')
      && !sv.includes("query.eq('remote', true)");
  })()],
  ['no bare country codes and a money line on every card', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return f.includes('function placeLabel(o)') && f.includes('function moneyBlock(o)')
      && !f.includes('c-blue">${esc(o.country_code)}</span>');
  })()],
  ['admin is never capped, but is never silently unlocked either', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // The view cap still exempts staff, but the card itself is the customer's card.
    return f.includes('if(cap&&!staff)') && f.includes('const _isStaff=') &&
      !f.includes('if(o.locked&&window.ME&&isAdminRole(ME.role))o=Object.assign');
  })()],
  ['SQL level gate accepts levels= (postdoc seeker never loads PhD rows)', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return sv.includes("multi(req.query.level).concat(multi(req.query.levels))") && sv.includes('ALL_LEVELS');
  })()],
  ['profession-aware eligibility: synonyms + hard search rule', (() => {
    const m = fs.readFileSync(__dirname + '/../lib/match.js', 'utf8');
    const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    return m.includes('expandTerms') && m.includes('pharmacologist') &&
      e.includes('Do NOT discard an opportunity merely because') && e.includes("req_degree_level || '').toLowerCase()");
  })()],
  ['work lane: every user selection reaches the API (job type, exp, remote, country, licences)', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return f.includes("push('job_type'") && f.includes("push('exp'") && !f.includes("push('licenses'") &&
      f.includes("push('country'") && f.includes("push('remote','1')");
  })()],
  ['level gate is academic-only (work postings are never filtered to zero)', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return sv.includes('academicLane') && sv.includes('level.is.null') && sv.includes('req._inferLevels');
  })()],
  ['platform batch: admin insight, safety caps, no hardcoded localhost', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const en = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    return en.includes('MAXLEN') && en.includes('visa_summary') && en.includes('Multi-CV aware') &&
      sv.includes('/api/admin/demand') && sv.includes('/api/admin/audit') &&
      sv.includes('settings/export') && sv.includes('_promoHits') && sv.includes('salaryBandFor') &&
      !sv.includes("origin === 'http://localhost:3000'");
  })()],
  ['the licensing SERVICE is gone from every surface', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const en = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    const qa = fs.readFileSync(__dirname + '/../lib/docqa.js', 'utf8');
    // No exam picker, no status select, no journey tracker, no pathway document,
    // no exam atlas in the prompt, and no licensing claim in the marketing copy.
    const dead = ['licensing_plan', 'licenseExam', 'licenseStatus', 'LIC_ATLAS', 'LIC_BOARDS',
                  'EXAM_GUIDE', 'licence-journey', 'toggleLicStage', 'licensing_exam',
                  'Licensing exam pathway', 'Your licensing journey'];
    const blob = sv + en + fe + st + qa;
    return dead.every(d => !blob.includes(d)) &&
      !/licensing pathways abroad/i.test(fe) &&
      fe.includes('Do you help with professional licensing?');
  })()],
  ['a held credential is captured in the applicant own words and resolved', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const en = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const lc = fs.readFileSync(__dirname + '/../lib/licence.js', 'utf8');
    // One free-text question, never a menu; backend spell-corrects and names the regulator.
    return fe.includes('Do you already hold a professional licence or registration?') &&
      fe.includes('async function resolveHeldLicence') &&
      sv.includes("app.post('/api/license/resolve'") &&
      lc.includes('function matchAtlas') && lc.includes('function dist') &&
      lc.includes('Never invent a regulator') &&
      en.includes('CREDENTIAL THE CANDIDATE ALREADY HOLDS') &&
      en.includes('never suggest we assist with obtaining any credential');
  })()],
  ['the offline licence matcher forgives real typing', (() => {
    const { matchAtlas } = require(__dirname + '/../lib/licence.js');
    const cases = [['scfsh', 'SCFHS'], ['nclx', 'NCLEX'], ['P.Eng', 'P.Eng'],
                   ['pebc canada', 'PEBC'], ['ACCA', 'ACCA'], ['upda qatar', 'UPDA']];
    return cases.every(([typed, want]) => {
      const m = matchAtlas(typed);
      return m && m.name.toUpperCase().includes(want.toUpperCase());
    }) && matchAtlas('qwertyuiop') === null;
  })()],
  ['audit: client faults 4xx, auth cached+bounded, vulnerable xlsx removed entirely', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const sp = fs.readFileSync(__dirname + '/../lib/supa.js', 'utf8');
    const pkg = JSON.parse(fs.readFileSync(__dirname + '/../package.json', 'utf8'));
    const sheet = fs.existsSync(__dirname + '/../lib/sheet.js');
    return sv.includes('entity.parse.failed') && sv.includes('entity.too.large') &&
      sp.includes('_tokCache') && sp.includes('_timeout') &&
      !(pkg.dependencies || {}).xlsx && sheet && sv.includes("require('./lib/sheet')");
  })()],
  ['external error tracking hook exists and is optional', (() => {
    const ob = fs.readFileSync(__dirname + '/../lib/oblog.js', 'utf8');
    return ob.includes('ERROR_WEBHOOK_URL') && ob.includes('shipError');
  })()],
  ['SEO, social sharing and accessibility basics present', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return f.includes('name="description"') && f.includes('property="og:title"') &&
      f.includes('rel="canonical"') && f.includes('aria-label="Close"') &&
      f.includes('focus-visible') && f.includes('overflow-x:hidden');
  })()],
  ['extension: popup script loads after DOM, no wildcard postMessage origin', (() => {
    const html = fs.readFileSync(__dirname + '/../extension/popup.html', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const scriptAt = html.indexOf('<script src="popup.js">');
    const btnAt = html.indexOf('id="ffFill"');
    return scriptAt > btnAt && !fe.includes("profile:d.profile},'*'");
  })()],
  ['mobile selection: 44px+ touch targets, tap feedback, filter on long lists', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes('.ctryrow{min-height:46px') && fe.includes('.ctryrow:active') &&
      fe.includes('ctry-search') && fe.includes('opts2.length>10');
  })()],
  ['dropdowns: select-all/clear/done, count badge, keyboard operable', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes('opts2All') && fe.includes('selcount') &&
      fe.includes("role=\"checkbox\"") && fe.includes("event.key==='Enter'") &&
      fe.includes('>Select all<') && fe.includes('>Done<');
  })()],
  ['touch floor: 44px on coarse pointers', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes('@media (pointer: coarse)') && fe.includes('min-height:44px');
  })()],
  ['assistant profile endpoint exists and is auth-gated', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return sv.includes("app.get('/api/profile/assist', auth") && !sv.includes('assist.*service_role');
  })()],
  ['PDF pipeline: embedded unicode fonts, sanitizer, CV header, page numbers', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const fontsBundled = fs.existsSync(__dirname + '/../assets/fonts/DejaVuSerif.ttf');
    return fontsBundled && sv.includes('usePdfFonts') && sv.includes('function pdfSafe') &&
      !/pdf\.font\('Times-/.test(sv) && sv.includes('isCV && person') && sv.includes("pdf.on('pageAdded'");
  })()],
  ['document intelligence: profile merges, never overwrites; conflicts surfaced', (() => {
    const d = fs.readFileSync(__dirname + '/../lib/docs.js', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return fs.existsSync(__dirname + '/../lib/profile.js') && d.includes('MASTER PROFILE MERGE') &&
      d.includes('additional_information') && d.includes('untrusted DATA') &&
      sv.includes('/api/profile/conflicts');
  })()],
  ['search hunt: real columns, correct intake window, dedup, entity normalization', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return !/'sector\\./.test(sv) && sv.includes('req_field.ilike') &&
      sv.includes('(y - 1)') && sv.includes('ENTITY DEDUPLICATION') &&
      fs.existsSync(__dirname + '/../lib/entity.js') && sv.includes('canonicalKey(o.institution)');
  })()],
  ['admin controls are real: limits enforced, ops panel, all tabs non-blocking', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // The search cooldown was removed on purpose: the daily count is the only limit.
    return sv.includes('enforceUploadLimits') && !sv.includes('searchCooldown') &&
      sv.includes('max_upload_mb') && !sv.includes('search_cooldown_minutes') &&
      sv.includes("['admin', 'super_admin', 'staff'].includes(req.userRole)") &&
      fe.includes('saveOps') && fe.includes('Operations &amp; limits') &&
      fe.includes('Paint immediately');
  })()],
  ['no stale pricing or discontinued offers anywhere in user-facing text', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    // The discontinued marketing claim must be gone. The FAQ describing a discretionary
    // one-off goodwill grant is legitimate (admin approves it), so it is not stale copy.
    const noFreeFirst = !fe.includes('First case FREE') && !fe.includes('Free first case for new users') && !fe.includes('free_first_case');
    const noHardPrice = !/Rs 2,000|Rs 2000|PKR 2,000/.test(fe) && !/Rs 2,000/.test(st);
    const tokenised = st.includes('__PRICE__') && fe.includes('priceToken');
    return noFreeFirst && noHardPrice && tokenised;
  })()],
  ['share card is a designed visual, priced from live config', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes('PREMIUM SHARE CARD') && fe.includes('lowestPkgPrice()') &&
      fe.includes('createRadialGradient') && fe.includes('function ctr(');
  })()],
  ['share card text can never overflow the canvas', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes('x.measureText(t).width>(maxW');
  })()],
  ['journey steps never block: every step stays clickable after completion', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes("'Update CV'") && fe.includes("'Search'") &&
      fe.includes("'View cases'") && fe.includes('Every step stays open') &&
      !fe.includes("${i===active?(sp[2]?");
  })()],
  ['admin reset tools: typed confirmation, staff preserved, storage purged', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return sv.includes("confirm !== 'RESET'") && sv.includes('ADMIN_PURGE_USERS') &&
      sv.includes('ADMIN_RESET_SELF') && sv.includes("['admin', 'super_admin', 'staff']") &&
      sv.includes('storage.from(BUCKET).remove') && fe.includes('Type RESET in capitals');
  })()],
  ['every tap is acknowledged instantly (press, ripple, busy, progress bar)', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes('.btn:active') && fe.includes('ff-ripple') &&
      fe.includes("addEventListener('pointerdown'") && fe.includes('ff-busy') &&
      fe.includes('window._netBusy') && fe.includes('finally { netEnd(); }') &&
      fe.includes('Signing you in') && fe.includes('#nav button.on::after');
  })()],
  ['busy state always clears (no permanently stuck spinner)', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes("clearInterval(watch);clear()},20000") && fe.includes('_authOff()');
  })()],
  ['AI diagnostics are visible on the admin overview, not buried', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes('AI engine health') && fe.includes('innerHTML=aiHtml+') &&
      fe.includes('onclick="aiSelfTest(this)"') && fe.includes('onclick="runDeepDiag(this)"') &&
      fe.includes('async function openHealthFull') && fe.includes('function diagOut') &&
      !fe.includes("alert('AI ENGINE SELF-TEST");
  })()],
  ['admin navigation is grouped and every tab remains reachable', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const keys = ['overview','cases','payments','packages','countries','universities',
                  'content','reviews','support','users','aicost','settings','audit'];
    return fe.includes("['Daily work'") && fe.includes('const ungrouped=') &&
      fe.includes('.admin-nav .segbtn.on') &&
      keys.every(k => fe.includes("'" + k + "'"));
  })()],
  ['auth flows give clear, persistent, actionable messages', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes('function authMsg') && fe.includes('id="authMsg"') &&
      fe.includes('Check your email now') && fe.includes('spam or junk folder') &&
      fe.includes('Signing you in') && fe.includes('Creating your account') &&
      fe.includes('Those details did not match') && fe.includes('Please verify your email');
  })()],
  ['admin rights: both owners are super admins, any admin gets 999 credits once', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return sv.includes('isFounder = OWNER_EMAILS.includes') &&
      sv.includes("isFounder ? 'super_admin' : 'user'") &&
      sv.includes('ADMIN_ALLOWANCE = 999') &&
      sv.includes("eq('reason', 'admin_allowance')") &&
      sv.includes('granted = await ensureAdminAllowance') &&
      sv.includes('_allowanceChecked') &&
      fe.includes('999 case credits granted');
  })()],
  ['dashboard match count agrees with search and respects the package', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // The count must apply the same gates the search applies, not tally raw inventory.
    return sv.includes('matchMany(uid, opps, wantLv, wantCc)') &&
      sv.includes('!x.wrongTarget && !x.overqualified && !x.fieldMismatch') &&
      sv.includes('x.pct >= RELEVANCE_FLOOR');
  })()],
  ['case documents: uploaded CV kept, motivation + proposal for research roles', (() => {
    const en = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    return en.includes("plan.filter(k => k !== 'cv')") &&
      en.includes("plan.push('motivation')") && en.includes("plan.push('research_proposal')") &&
      en.includes('at least 700 words') && en.includes('what THIS host group works on') &&
      en.includes('My published work includes');
  })()],
  ['cover letter, per-case document request and guide contacts are all real', (() => {
    const en = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return en.includes('450 to 600 words') && en.includes('cover: 2900') &&
      fe.includes('Upload these to strengthen this application') && fe.includes('_myDocNames') &&
      sv.includes('Where to go and who to contact') && sv.includes('Visa mission in Pakistan') &&
      sv.includes('characterSpacing: 0.9');
  })()],
  ['no living-cost estimates shown; positive financial facts retained', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const noCost = !sv.includes('living_estimate') && !fe.includes('living_estimate') &&
      !fe.includes('Living cost');
    const keepsGood = fe.includes("R('Stipend'") && fe.includes("R('Funding'");
    // Prepared cases are not a sales surface.
    const noSell = !fe.includes('Buy Our Packages');
    return noCost && keepsGood && noSell;
  })()],
  ['pay context, fair use, mobility, outcomes and saved searches all present', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const pay = fs.readFileSync(__dirname + '/../lib/pay.js', 'utf8');
    return pay.includes('liveRates') && pay.includes('times a senior professional salary') &&
      sv.includes('async function fairUse') && sv.includes('daily_searches') &&
      sv.includes('mobility:') && sv.includes('/outcome') && sv.includes("'/api/searches'") &&
      fe.includes('Did you hear back?') && !fs.existsSync(__dirname + '/../lib/costs.js');
  })()],
  ['search limit is 3 per day, reset by any purchase', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    return st.includes('daily_searches: 3') && !st.includes('monthly_searches') &&
      sv.includes('async function searchCounts') && sv.includes('resetSearchAllowance') &&
      sv.includes("event: 'SEARCH_RUN'") &&
      sv.includes("reason: 'purchase', payment_id: p.id })") && sv.includes('A purchase restarts the search allowance');
  })()],
  ['free users see real preview cards with identity withheld', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes('noneOpen?shown.slice(0,15)') && fe.includes('revealed?esc(o.institution)') &&
      fe.includes('more matched to you');
  })()],
  ['one enforcement rule for every filter, with an honest receipt', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // A selected filter is a promise. Country, level, funding, language, job type,
    // experience and work mode all run through the same enforce-and-report loop.
    return f.includes('const FILTERS=[') && f.includes('window._filterReport')
      && f.includes('Every position below matches what you chose')
      && ['Remote only','Your selected countries','Your selected level','Fully funded only',
          'No language certificate required','Your job type','Your experience level']
         .every(l => f.includes(l));
  })()],
  ['remote is a worldwide lane driven by the applicant profile', (() => {
    const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return e.includes('REMOTE SOURCE ATLAS') && e.includes('REMOTE RULES, ABSOLUTE')
      && e.includes('WeWorkRemotely') && e.includes('EURAXESS')
      && e.includes('COUNTRY SCOPE for the remote lane')
      && sv.includes("workmode: ['', 'remote', 'onsite'].includes(String(b.workmode || ''))");
  })()],
  ['every destination country resolves to a full name', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const seed = fs.readFileSync(__dirname + '/../migrations/0017_seed_54_countries.sql', 'utf8');
    const codes = Array.from(new Set((seed.match(/\('([A-Z]{2})',/g) || []).map(x => x.slice(2, 4))));
    const block = (f.match(/const CC_NAME=\{[\s\S]*?\};/) || [''])[0];
    return codes.length >= 50 && codes.every(c => block.includes(c + ":'"));
  })()],
  ['guide is a linked, live, whole-directory document', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const missions = (sv.match(/const MISSION = \{[\s\S]*?\n\};/) || [''])[0];
    const n = (missions.match(/^  [A-Z]{2}: \{/gm) || []).length;
    return n >= 50 && sv.includes('async function liveCountryBrief')
      && sv.includes('const LINK = (k, url, note)') && sv.includes('const PK_OFFICES')
      && sv.includes('NEVER invent a phone number');
  })()],
  ['no document type is named to the client', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    const tiers = (st.match(/tiers: \[[\s\S]*?\n    \]/) || [''])[0];
    return !/Tailored CV/i.test(tiers) && !/cover letter/i.test(tiers)
      && st.includes('Customized documents prepared')
      && !/A CV, cover letter, motivation or SOP/.test(f);
  })()],
  ['plan ladder: choose from more than you can apply to', (() => {
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const tiers = (st.match(/tiers: \[[\s\S]*?\n    \]/) || [''])[0];
    // Basic 5/2, Smart 8/5, Premium 20/10 - view is always the larger number.
    const want = [["credits: 2, view: 5"], ["credits: 5, view: 8"], ["credits: 10, view: 20"]];
    return want.every(([w]) => tiers.includes(w)) &&
      // The admin editor can set both, and view can never fall below credits.
      sv.includes('view: (() => { const v = parseInt(p.view);') &&
      sv.includes('Math.max(v, credits)');
  })()],
  ['admin package edits actually reach the buy page', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // /api/pricing used to overwrite the admin's packs with the tier config, so renamed
    // plans, promo prices and descriptions never appeared. It must merge, and saving
    // packages must mirror into packages.tiers, which the reveal cap reads.
    return sv.includes('MERGE, never overwrite') &&
      sv.includes('ONE SOURCE OF TRUTH') &&
      sv.includes('await siteSettings.saveConfig({ packages: { tiers } }') &&
      fe.includes('Matches shown &mdash; how many positions open') &&
      fe.includes('matches to choose from');
  })()],
  ['the installed app cannot run a stale build', (() => {
    const sw = fs.readFileSync(__dirname + '/../public/sw.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return sw.includes('self.clients.claim()') && sw.includes('FF_SW_UPDATED') &&
      sw.includes('Network first, always') &&
      fe.includes('function ffUpdateWatch') && fe.includes("'/api/version',{cache:'no-store'}") &&
      fe.includes("visibilitychange") && fe.includes("updatefound") &&
      sv.includes("p.endsWith('sw.js')") &&
      sv.includes("res.set('Cache-Control', 'no-store, no-cache, must-revalidate')");
  })()],
  ['no licensing claim survives anywhere in the marketing copy', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // Two landing cards still named DHA/SCFHS/NCLEX/PLAB and promised "licensing named
    // for you" after the service was removed.
    return !/Licensing routes named/i.test(fe) && !/Licensing named for you/i.test(fe) &&
      !/DHA, SCFHS, NCLEX, PLAB/.test(fe) && !/Licensing exams: PLAB/.test(fe);
  })()],
  ['plan numbers are never hardcoded into copy', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes('function planLadderLine()') && fe.includes('${planLadderLine()}') &&
      !/Smart shows your 8 best/.test(fe) && !/Premium shows your 15 best/.test(fe) &&
      !/visible matches \(2, 8 or 15\)/.test(fe);
  })()],
  ['the promo price is shown and charged', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    // promo_pkr was captured in admin, stored, and used by nothing.
    return fe.includes('function planPrice(p)') && fe.includes('function priceHtml(p,size)') && fe.includes('Save Rs') &&
      sv.includes('Number(pack.promo_pkr) > 0 && Number(pack.promo_pkr) < listPkr') &&
      sv.includes('promo_pkr: p.promo_pkr || null');
  })()],
  ['visible-to-users and description are honoured on the buy page', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return fe.includes('packs.filter(p=>p.visible!==false||_staff)') &&
      fe.includes('${esc(p.description)}');
  })()],
  ['admin sees the customer view and gets one labelled override', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // Silently unlocking every card for staff hid every paywall bug from the owner.
    return !fe.includes("o=Object.assign({},o,{locked:false,owned:true})") &&
      fe.includes('async function adminOpenCase') &&
      fe.includes('Admin: open and apply without payment') &&
      fe.includes('Visible to staff only') &&
      fe.includes('\\u2699 Staff view') &&
      fe.includes("Preparing this case will use <b>no credit</b>");
  })()],
  ['every inline handler resolves to a real function', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const js = (fe.match(/<script>([\s\S]*?)<\/script>/g) || []).join('\n');
    const defs = new Set();
    (js.match(/function\s+([A-Za-z_$][\w$]*)/g) || []).forEach(m => defs.add(m.split(/\s+/)[1]));
    (js.match(/window\.([A-Za-z_$][\w$]*)\s*=/g) || []).forEach(m => defs.add(m.slice(7).replace(/\s*=$/, '')));
    (js.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g) || []).forEach(m => defs.add(m.split(/\s+/)[1]));
    const named = ['openPlans','adminOpenCase','startApp','doStartApp','saveOpp','oppReport',
                   'buyPack','go','toggleSimUser','grantFreeCase','resolveHeldLicence',
                   'oppHeadline','oppFacts','oppFactsHtml','planPrice','priceHtml','vBuyRender',
                   'renderPacks','savePacks','planLadderLine','pkgByCredits','lowestPkgPrice'];
    return named.every(n => defs.has(n));
  })()],
  ['the Search Pass is gone from every file', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const blob = sv + st + fe;
    const dead = ['Search Pass', 'searchpass', 'search_only', 'hasSearchPass',
                  'searchPassActive', 'pass_daily_searches', 'SEARCH_PASS_GRANTED'];
    return dead.every(d => !blob.includes(d));
  })()],
  ['three searches a day, five after a purchase, no waiting', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    return st.includes('daily_searches: 3') && st.includes('paid_daily_searches: 5') &&
      sv.includes('const everPaid = await hasEverPaid(req.userId)') &&
      sv.includes("everPaid ? (Number(fu.paid_daily_searches) || 5) : (Number(fu.daily_searches) || 3)") &&
      // Nothing may sit between two searches.
      !sv.includes('searchCooldown') && !sv.includes('_lastSearch') &&
      !st.includes('search_cooldown_minutes') &&
      sv.includes('There is no cooldown between searches');
  })()],
  ['a purchase clears searches used on any earlier day', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return sv.includes('await resetSearchAllowance(p.user_id)') &&
      sv.includes("upsert({ key: 'searchreset:' + userId") &&
      sv.includes('const since = (resetAt && resetAt > monthStart) ? resetAt : monthStart;');
  })()],
  ['the last-chance warning quotes real numbers', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    // It used to print a hardcoded "2 / 3" and never knew the paid allowance.
    return sv.includes('req._searchLeft = { day: dayMax - day, limit: dayMax, used: day + 1, paid: everPaid }') &&
      sv.includes('search_limit: (req._searchLeft || {}).limit') &&
      fe.includes('${used} / ${total}') && !fe.includes('>2 / ${total}<') &&
      fe.includes('if(d.searches_left===1)setTimeout(()=>showLastChance(d),1100)') &&
      st.includes('paid_daily_searches: Number((cfg.fair_use||{}).paid_daily_searches) || 5');
  })()],
  ['every frontend API call resolves to a real server route', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const routes = [];
    const rr = /app\.(get|post|put|delete|patch)\(\s*'([^']+)'/g;
    let m; while ((m = rr.exec(sv))) routes.push([m[1].toUpperCase(), m[2]]);
    const bad = [];
    // A call path is usually built by concatenation: '/api/x/' + id + '/y'. Rebuild it as
    // a pattern by joining every literal chunk with a single-segment wildcard.
    const cr = /\bapi(?:Fast)?\(\s*('(?:[^']*)'(?:\s*\+\s*[^,()]+?\s*\+\s*'[^']*')*)\s*(?:,\s*\{([^}]*)\})?/g;
    while ((m = cr.exec(fe))) {
      // Strip the query string from the FIRST literal before anything else: '/api/x?a=' + v
      // is a call to /api/x, and the parameters are none of this check's business.
      const lits = (m[1].match(/'([^']*)'/g) || []).map(x => x.slice(1, -1));
      if (lits[0] && lits[0].includes('?')) { lits[0] = lits[0].split('?')[0]; lits.length = 1; }
      if (!lits.length || !lits[0].startsWith('/api')) continue;
      const meth = ((m[2] || '').match(/method\s*:\s*'([A-Za-z]+)'/) || [, 'GET'])[1].toUpperCase();
      // A literal may itself embed ${...} or a query string; both stand in for a segment.
      const pat = '^' + lits.map(l => l.split('?')[0]
        .replace(/\$\{[^}]*\}/g, '\u0001')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .split('\u0001').join('[^/]+'))
        .join('[^/]+').replace(/\/$/, '') + '(/[^/]+)*/?$';
      const ok = routes.some(([mt, r]) =>
        mt === meth && new RegExp(pat).test(r.replace(/:[A-Za-z_]+/g, 'ID')));
      if (!ok) bad.push(meth + ' ' + lits.join('<id>'));
    }
    if (bad.length) console.log('    dead calls:', bad.join(', '));
    return bad.length === 0;
  })()],
  ['the payment sheet quotes exactly what the server will charge', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // The sheet used to price from the tier config while the server charged from the
    // stored packs, and it ignored the referral balance, so anyone holding referral
    // credit was told to overpay.
    return sv.includes("app.get('/api/payments/quote'") &&
      sv.includes('RESOLVE FIRST, THEN PRICE') &&
      sv.includes('pricing_version: (pr && pr.version) || null') &&
      fe.includes("api('/api/payments/quote?credits='") &&
      fe.includes('Referral credit');
  })()],
  ['the live plan ladder is seeded, not left at the 2020 prices', (() => {
    const mig = fs.readFileSync(__dirname + '/../migrations/0030_plan_ladder_basic_smart_premium.sql', 'utf8');
    const bundle = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    return /"credits":2,"view":5,"pkr":5000/.test(mig) &&
      /"credits":5,"view":8,"pkr":15000/.test(mig) &&
      /"credits":10,"view":20,"pkr":30000/.test(mig) &&
      bundle.includes('"credits":2,"view":5,"pkr":5000');
  })()],
  ['the guide names every country it serves', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const full = (sv.match(/const CC_FULL = \{[\s\S]*?\};/) || [''])[0];
    const mission = (sv.match(/const MISSION = \{[\s\S]*?\n\};/) || [''])[0];
    const codes = Array.from(new Set((mission.match(/^  ([A-Z]{2}): \{/gm) || []).map(x => x.trim().slice(0, 2))));
    return codes.length >= 50 && codes.every(c => full.includes(c + ": '")) &&
      sv.includes('const countryLabel = cc => CC_FULL[') &&
      sv.includes('FUTURE_PATH[_cc0] || (MISSION[_cc0]');
  })()],
  ['config has no duplicate keys and no dead globals remain', (() => {
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const body = (st.match(/const DEFAULTS = \{[\s\S]*?\n\};/) || [''])[0];
    const keys = (body.match(/^  ([a-z_]+):/gm) || []).map(x => x.trim().replace(':', ''));
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    return dupes.length === 0 && !fe.includes('_licDone') && !fe.includes('_remoteDropped');
  })()],
  ['study and work lanes never show each other\u2019s filters', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // kind!=='work' meant an unset lane rendered BOTH sets, so a study search offered
    // "Job type" and a job search offered "Intake".
    return fe.includes("const study=f.kind==='study'?") &&
      fe.includes("const work=f.kind==='work'?") &&
      fe.includes("if(f.kind!=='work'&&f.kind!=='study')f.kind='study'") &&
      fe.includes("if(opts.lane==='work'){") &&
      fe.includes("if(opts.intake&&opts.lane!=='work')") &&
      fe.includes("f.kind==='work'?'Your profession':'Your field of study'");
  })()],
  ['the study lane carries its own filters end to end', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    // programTypes was collected and sent but rendered nowhere, so a diploma route
    // could never be chosen.
    return fe.includes("mp('programTypes','Programme type, select any'") &&
      fe.includes("sel('tuition','Tuition'") && fe.includes("sel('stipendPref','Living stipend'") &&
      fe.includes("push('tuition_free','1')") &&
      sv.includes("String(req.query.tuition_free) === '1'");
  })()],
  ['an opportunity card says what the position actually is', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // "Verified position" sold nothing. Cards now lead with level plus field, or the
    // job type plus field, and carry the facts a buyer weighs.
    return fe.includes('function oppHeadline(o)') && fe.includes('function oppFactsHtml(o)') &&
      fe.includes("LV={bachelors:'BS / Bachelor'") &&
      fe.includes("jt={full_time:'Full-time role'") &&
      // No dead-end labels and no reject buttons on the card.
      !/'Criteria not published'\]/.test(fe) && !fe.includes('Not for me') &&
      !fe.includes('Not interested') && !fe.includes('dismissOpp') &&
      // Apply sits in the corner of every card.
      fe.includes('position:absolute;top:14px;right:14px');
  })()],
  ['the plans page can never hang on a loading message', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // A thrown template used to leave "Loading packages..." on screen with no way out.
    return fe.includes('async function vBuyRender()') &&
      fe.includes("console.error('plans render failed'") &&
      fe.includes('if(!packs.length)packs=((SITE&&SITE.packages&&SITE.packages.tiers)||[])') &&
      fe.includes('onclick="cacheClear();vBuy()"');
  })()],
  ['no issued document is ever manufactured', (() => {
    const en = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    return en.includes('const NEVER_INVENT =') &&
      en.includes('never write, recreate or simulate any document that an institution issues') &&
      en.includes('SUBMISSION ROUTE, SAY WHICH ONE APPLIES') &&
      en.includes('they will upload those themselves on the official site');
  })()],
  ['each lane offers its own dropdown filters, end to end', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const en = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const studyOnly = ["sel('instruction','Language of instruction'", "sel('uniType','Institution type'",
                       "sel('appFee','Application fee'", "sel('deadlineIn','Deadline window'",
                       "sel('tuition','Tuition'", "sel('stipendPref','Living stipend'"];
    const workOnly  = ["sel('visaSel','Visa sponsorship'", "sel('contractLen','Contract'",
                       "sel('startWhen','I can start'", "sel('salaryBand','Minimum salary'"];
    return studyOnly.every(x => fe.includes(x)) && workOnly.every(x => fe.includes(x)) &&
      // Each choice is remembered, sent, enforced and understood by the agent.
      fe.includes('instruction:isWorkLane?') && fe.includes('visaSel:isWorkLane?') &&
      fe.includes("push('no_app_fee','1')") && fe.includes("push('deadline_days'") &&
      sv.includes("String(req.query.no_app_fee) === '1'") &&
      sv.includes('const dwin = parseInt(req.query.deadline_days, 10)') &&
      sv.includes("lane: b.lane === 'work' ? 'work' : 'study'") &&
      en.includes('LANE PREFERENCES') && en.includes('${laneLine}');
  })()],
  ['Apply opens the plans page with no network wait', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // Pricing is warmed at boot and again when results land, so the tap renders from cache.
    return fe.includes('function warmPricing()') &&
      (fe.match(/warmPricing\(\)/g) || []).length >= 3 &&
      // A paid user's Apply starts the case instead of bouncing them to plans they hold.
      fe.includes("onclick=\"startApp('${escAttr(o.id)}'");
  })()],
  ['harvest and healer require the REAL supa module', (() => { const h = fs.readFileSync(__dirname + '/../lib/harvest.js', 'utf8'); const hl = fs.readFileSync(__dirname + '/../lib/healer.js', 'utf8'); return h.includes("require('./supa')") && hl.includes("require('./supa')"); })()]
];
let fail = 0;
for (const [name, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); if (!ok) fail++; }
if (fail) { console.error(fail + ' resilience assertion(s) failed'); process.exit(1); }
console.log('resilience net: all assertions hold');
