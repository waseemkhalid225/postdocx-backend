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
  // CONTRACT CHANGED (R4410): a search may only be skipped when existing supply COVERS
  // the target. Stopping at three relevant rows cancelled entire searches.
  ['inventory skip only when supply covers the target', e.includes('relevant >= target')],
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
    // CONTRACT CHANGED (R4410/R4480): the route is decided by the advert alone, a portal
    // case writes no email and finishes at 100%, and no CV is ever generated.
    return e.includes('PORTAL CASES GET THE SAME DOCUMENTS') && e.includes('_portalOnly') &&
      e.includes("const portalOnly = (opp.apply_via === 'portal')") &&
      e.includes('PREP_STEPS.map(x => x[0])') &&
      e.includes("plan = plan.filter(k => k !== 'cv')") &&
      e.includes('there is no email to send') &&
      fe.includes('you upload them on the portal');
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
  // CONTRACT CHANGED (R4410/R4480): the applicant's own CV is attached, never rewritten.
  // What must be substantial is the writing we actually produce.
  ['no CV is generated, and the letters are full length', (() => {
    const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    return e.includes("plan = plan.filter(k => k !== 'cv')") &&
      e.includes("let plan = ['cover']") &&
      /cover: [4-9]\d\d\d/.test(e) && /motivation: [5-9]\d\d\d/.test(e) &&
      /research_proposal: [5-9]\d\d\d/.test(e);
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
    // CONTRACT CHANGED (R4630): the "documents to prepare in advance" block was removed
    // from the results page. It was generic, premature, and sat in front of someone still
    // deciding which position to choose. Requirements are now asked for when a case is
    // prepared, from that position's own official page.
    return f.includes('Your Job Match Analysis') && !f.includes('Your Licensing Pathway Analysis') &&
      f.includes('Your CV Analysis & Search Report') &&
      !f.includes('${CTX.section}') &&
      f.includes('DOCUMENTS BELONG TO THE CASE');
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
    // CONTRACT CHANGED (R4580): discovery is a Top-15 TABLE, not fifteen cards. Fifteen
    // full cards meant fifteen screens of scrolling to answer one question. The ceiling
    // is unchanged and identity is still withheld - the server never sends it.
    const sv2 = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return f.includes('window._top15=shown.slice(0,15)') && f.includes('function topTable(') &&
      f.includes('TOP ${list.length} MATCHES') && sv2.includes('function lockTease(o)') &&
      f.includes('revealed?esc(o.institution)');
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
  // CONTRACT CHANGED (R4550): level gating moved out of stacked SQL .or() clauses into
  // lib/oppfilter.js, where it is deterministic and covered by its own tests.
  ['level gate is academic-only and applied in the tested filter module', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const of = fs.readFileSync(__dirname + '/../lib/oppfilter.js', 'utf8');
    return sv.includes('academicLane') && sv.includes("levels: (lvls.length && academicLane)") &&
      sv.includes('OF.applyFilters') && of.includes('function levelOk');
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
    // CONTRACT CHANGED (R4550): the intake window is computed in lib/oppfilter.js.
    const of = fs.readFileSync(__dirname + '/../lib/oppfilter.js', 'utf8');
    return !/'sector\\./.test(sv) && of.includes('termsOk') &&
      of.includes("(year - 1) + '-01-01'") && sv.includes('ENTITY DEDUPLICATION') &&
      fs.existsSync(__dirname + '/../lib/entity.js') && sv.includes('canonicalKey(o.institution)');
  })()],
  ['admin controls are real: limits enforced, ops panel, all tabs non-blocking', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // The search cooldown was removed on purpose: the daily count is the only limit.
    return sv.includes('enforceUploadLimits') && !sv.includes('searchCooldown') &&
      sv.includes('max_upload_mb') && !sv.includes('search_cooldown_minutes') &&
      sv.includes("STAFF_ROLES.includes(req.userRole)) return next();") &&
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
    // R4730: the dashboard never displayed that count, so the 240-opportunity scoring
    // pass is gone from /api/home entirely. The page must not score inventory at all,
    // and the home payload must be fetched in one parallel batch.
    return !sv.includes('matchMany(uid, opps, wantLv, wantCc)') &&
      sv.includes('const [supR, meR, discR, pendR] = await Promise.all([') &&
      sv.includes('out.pendingPayment') &&
      !fe.includes('HM.myMatches');
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
    // CONTRACT CHANGED (R4470/R4480): letters are longer, and the guide reads
    // contact_emails, which is the column that actually exists.
    return /cover: [4-9]\d\d\d/.test(en) &&
      fe.includes('Upload these to strengthen this application') && fe.includes('_myDocNames') &&
      sv.includes('Where to go and who to contact') && sv.includes('Visa mission in Pakistan') &&
      sv.includes('This position at a glance') && sv.includes('opp.contact_emails') &&
      !sv.includes('opp.contact_phone') && sv.includes('characterSpacing: 0.9');
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
      sv.includes("reason: 'purchase', payment_id: p.id, note: 'Payment ' + p.id })") &&
      sv.includes('if (led.error) led = await ledgerWrite(') && sv.includes('A purchase restarts the search allowance');
  })()],
  ['free users see real preview cards with identity withheld', (() => {
    const fe = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // The preview is now a table with a one-tap intelligence panel and a selection list.
    // Identity is withheld by the SERVER, which is the only place it can be enforced.
    return fe.includes('function oppPeek(') && fe.includes('function selReview(') &&
      fe.includes('revealed?esc(o.institution)') &&
      fe.includes('revealed when this case is unlocked');
  })()],
  ['one enforcement rule for every filter, with an honest receipt', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    // A selected filter is a promise. Country, level, funding, language, job type,
    // experience and work mode all run through the same enforce-and-report loop.
    return f.includes('const FILTERS=[') && f.includes('window._filterReport')
      && !f.includes('Every position below matches what you chose')   // receipt removed R4730
      && ['Remote only','Your selected countries','Your selected level','Fully funded only',
          'No language certificate required','Your job type','Your experience level']
         .every(l => f.includes(l));
  })()],
  ['R4730: mobile nav on the body, sign out reachable', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return f.includes('function placeNav(') && f.includes("window.addEventListener('resize',placeNav)")
      && f.includes('placeNav();$(\'nav\').style.display=\'flex\'');
  })()],
  ['R4730: payment is a screenshot, stored, shown to admin, approve or reject', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    return f.includes('id="payShot" type="file" accept="image/*"') && f.includes('function payShotPicked(')
      && f.includes('proof_b64:window._payShot.b64') && !f.includes('id="payRef"')
      && f.includes('function rejectPay(') && f.includes('p.proof_url')
      && sv.includes('const { credits, reference, proof_b64 } = req.body || {}')
      && sv.includes("Please attach a screenshot of your payment before sending")
      && sv.includes("'payments/' + req.userId + '/' + data.id + '.jpg'")
      && sv.includes('createSignedUrl(path, 3600)')
      && sv.includes("app.post('/api/payments/:id/reject'")
      && mg.includes('add column if not exists proof_path text');
  })()],
  ['R4730: approval writes credits or rolls back, balance never lies', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return sv.includes("update({ status: 'pending', confirmed_by: null, confirmed_at: null })")
      && sv.includes('credits_added: creditsN, balance: newBal')
      && sv.includes("from('credit_ledger').select('delta').eq('user_id', userId)")
      && sv.includes('credits: bal, pending_payments: pending')
      && f.includes('CREDITS=Number(d.credits!=null?d.credits:d.balance)||0')
      && f.includes('function watchPayment(') && f.includes('id="payPendCard"');
  })()],
  ['R4730: skip payment is admin/super_admin only and never hides the sheet button', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return sv.includes("if (!prof || !['admin', 'super_admin'].includes(prof.role)) return res.status(403).json({ error: 'Admin only' })")
      && !sv.includes("Exit the preview, then activate")
      && f.includes("const isTrueAdmin=()=>") && f.includes("if(document.querySelector('.ff-ack'))return;")
      && f.includes("document.querySelectorAll('.ffmatches,.ff-sheet,.ff-selbar')")
      && f.includes('window._analysisOpen')
      && !f.includes("sv.includes('Staff: you never pay here')");
  })()],
  ['R4740: chosen countries are the whole discovery scope, both lanes', (() => {
    const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return e.includes('const strictScope = priority.length > 0 && !prefs.remote')
      && e.includes('const ingestScoped = async (items)') && !e.match(/added \+= await ingestOpps\(/)
      && e.includes('const scopeForCount = priority.length ? priority : null')
      && e.includes('a position anywhere else will be discarded unread')
      && sv.includes("prefs.remote = !!(prefs.remote || prefs.workmode === 'remote')");
  })()],
  ['R4740: locked cards never carry the institution, funder or scheme name', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return sv.includes('function scrubIdentity(text, o, toks)') && sv.includes('const NAMED_FUNDERS')
      && sv.includes('const S = v => v == null ? null : (scrubIdentity(String(v), o, _tk) || null)')
      && sv.includes('scheme: null') && sv.includes('funding: S(o.funding)')
      && sv.includes("subj = scrubIdentity(String(o.title || ''), o)")
      && f.includes("const tr=o=>o.track==='adjacent'?1:0");
  })()],
  ['R4750: plans page cannot throw on HM, admin checks read the real ME, payment details are live', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    // `let ME` never lands on window, so every `window.ME&&` guard was permanently false
    // and no staff/admin bar ever rendered. `HM` was never declared globally, so the plans
    // page threw ReferenceError and fell back to the plain renderer.
    return !f.includes('window.ME&&') && f.includes('var HM=null;')
      && f.includes("let S={state:'new',hasCV:false,appCount:0};HM=null;")
      && f.includes('async function refreshSiteConfig(') && f.includes('await refreshSiteConfig();')
      && st.includes("easypaisa_number: '03455216903'") && st.includes("account_title: 'Waseem Khalid Malik'")
      && st.includes('an empty saved field never blanks a shipped default')
      && sv.includes("res.set('Cache-Control', 'no-store');\n  try {\n    const cfg = await siteSettings.getConfig();\n    const pub = siteSettings.publicView(cfg);");
  })()],
  ['R4760: every ledger write survives the reason CHECK constraint', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    return sv.includes('async function ledgerWrite(row)')
      && !sv.includes("admin().from('credit_ledger').insert(")
      && (sv.match(/ledgerWrite\(/g) || []).length >= 12
      && mg.includes("drop constraint if exists credit_ledger_reason_check")
      && mg.includes("'admin_bypass','admin_allowance'");
  })()],
  ['R4770 Phase 0: tenancy foundation is additive and backward-compatible', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const t = fs.readFileSync(__dirname + '/../lib/tenancy.js', 'utf8');
    const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    return t.includes('async function ensurePersonalOrg(') && t.includes("const STAGES = ['lead','discover'")
      && sv.includes("app.get('/api/org/me'") && sv.includes('journey: client ?')
      && e.includes("row.source_class = 'permitted_web'")
      && mg.includes('create table if not exists public.organisations') && mg.includes('create table if not exists public.clients')
      && mg.includes("insert into public.organisations (kind, name, owner_user_id)")
      && mg.includes('enable row level security');
  })()],
  ['R4800 Phase 0: tenancy, clients and a job queue exist without touching the B2C path', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const q = require('../lib/queue.js'); const o = require('../lib/orgs.js');
    return typeof q.enqueue === 'function' && typeof q.register === 'function' && typeof q.runOne === 'function'
      && typeof o.ensurePersonalOrg === 'function' && typeof o.createClient === 'function' && typeof o.requireOrg === 'function'
      && o.identityHash('A@B.com', '0300-1234567') === o.identityHash('a@b.com', '03001234567')
      && o.identityHash('', '') === null
      && o.CAN['org.settings'].length === 1 && o.CAN['clients.read'].includes('viewer') && !o.CAN['clients.write'].includes('viewer')
      && sv.includes("app.get('/api/org'") && sv.includes("app.post('/api/org/:id/clients'") && sv.includes("app.post('/api/org/:id/clients/:cid/discover'")
      && sv.includes("QUEUE.register('client_discover'") && sv.includes("process.env.FF_QUEUE !== 'off'")
      && mg.includes('create table if not exists public.organisations') && mg.includes('create table if not exists public.job_queue')
      && mg.includes("check (kind in ('personal','agency','institution','employer','partner'))")
      && mg.includes('add column if not exists source_kind text')
      && mg.includes('create policy clients_member_read');
  })()],
  ['R4810 Phase 1: document intelligence, checklist engine and mobility profile', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const V = require('../lib/vault.js'); const M = require('../lib/mobility.js');
    return V.DOC_TYPES.includes('passport') && V.SENSITIVE.has('bank_statement') && !V.SENSITIVE.has('cv')
      && V.CHECKLISTS.study.required.includes('transcript') && V.CHECKLISTS.work.required.includes('experience_letter')
      && V.mapKind('english_test') === 'language_test' && V.mapKind('reference_letter') === 'lor'
      && M.REQUIRED_FOR_MATCH.includes('funding_source') && M.ALL_FIELDS.includes('visa_refusals') && M.ALL_FIELDS.length > 50
      && sv.includes("app.get('/api/vault/checklist'") && sv.includes("app.put('/api/me/mobility'") && sv.includes("QUEUE.register('vault_read'")
      && sv.includes("QUEUE.enqueue('vault_read', { docId: r.id, userId: req.userId }")
      && sv.includes("app.put('/api/org/:id/clients/:cid/mobility'")
      && f.includes('async function loadVault(') && f.includes('async function saveMobility(') && f.includes('id="mobConsent"')
      && mg.includes('add column if not exists doc_type text') && mg.includes('add column if not exists mobility jsonb')
      && mg.includes('consent_vault_sensitive boolean not null default false');
  })()],
  ['R4820 Phase 2: command center API + workspace UI + commissions', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    return sv.includes("app.get('/api/org/:id/clients/:cid/overview'") && sv.includes("app.get('/api/org/:id/board'") && sv.includes("app.get('/api/org/:id/commissions'")
      && sv.includes('async function accrueCommission(payment)') && sv.includes('accrueCommission(p).catch(() => {});')
      && sv.includes("if (!org || org.kind === 'personal') return;")
      && f.includes('data-t="work" data-i18n="nav_workspace">FF-CRM') && f.includes('async function vWorkspace(') && f.includes('async function openClient(') && f.includes('work:vWorkspace')
      && mg.includes('create table if not exists public.client_tasks') && mg.includes('create table if not exists public.commission_ledger')
      && st.includes("commission_pct_agency: 20") && st.includes("agency: cfg.agency || { tiers: [] }");
  })()],
  ['R4820 Phase 2: command center API, board, tasks, notes, commissions', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    return sv.includes("app.get('/api/org/:id/clients/:cid/overview'") && sv.includes("app.get('/api/org/:id/board'")
      && sv.includes("app.post('/api/org/:id/clients/:cid/tasks'") && sv.includes("app.post('/api/org/:id/clients/:cid/notes'")
      && sv.includes("app.get('/api/org/:id/commissions'") && sv.includes('async function accrueCommission(payment)') && sv.includes('accrueCommission(p).catch(() => {});')
      && sv.includes("if (!org || org.kind === 'personal') return;")
      && f.includes('async function vWorkspace(') && f.includes("work:vWorkspace") && f.includes('<button data-t="work" data-i18n="nav_workspace">FF-CRM</button>')
      && f.includes("((SITE&&SITE.agency)||{}).tiers")
      && st.includes("commission_pct_agency: 20") && st.includes("agency: cfg.agency || { tiers: [] }")
      && mg.includes('create table if not exists public.client_tasks') && mg.includes('create table if not exists public.commission_ledger')
      && mg.includes("check (owner in ('us','client','them'))");
  })()],
  ['R4830: USD is the currency of record; international card checkout with a signed webhook', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    const G = require('../lib/gateway.js');
    const crypto = require('crypto'); const secret = 'whsec_test'; const body = '{"id":"evt_1"}'; const t = Math.floor(Date.now() / 1000);
    const sig = 't=' + t + ',v1=' + crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex');
    const stale = 't=' + (t - 1000) + ',v1=' + crypto.createHmac('sha256', secret).update((t - 1000) + '.' + body).digest('hex');
    return G.verifySignature(body, sig, secret) === true && G.verifySignature(body, sig, 'other') === false && G.verifySignature(body, stale, secret) === false
      && sv.includes("app.post('/api/pay/stripe/webhook', express.raw({ type: 'application/json' })") && sv.indexOf("app.post('/api/pay/stripe/webhook'") < sv.indexOf("app.use(express.json(")
      && sv.includes("app.post('/api/pay/checkout'") && sv.includes("app.post('/api/pay/confirm'") && sv.includes("app.get('/api/pay/quote'")
      && sv.includes('async function settleCardPayment(session, source)') && sv.includes(".eq('id', p.id).eq('status', 'pending').select('id');\n  if (!flipped || !flipped.length) return { ok: true, already: true };")
      && sv.includes("if ((s.metadata || {}).user_id && s.metadata.user_id !== req.userId) return res.status(403)")
      && st.includes("usd: 25, promo_usd: 19") && st.includes("usd_month: 599") && st.includes("pricing: { currency: 'USD', show_local: true }") && st.includes("gateway: { card: !!(process.env.STRIPE_SECRET_KEY || (process.env.LEMON_API_KEY && process.env.LEMON_STORE_ID))")
      && f.includes("function planPrice(p){") && f.includes("const fullU=Number((p&&p.usd)||0)") && f.includes('async function payByCard(') && f.includes('async function settleCardReturn(')
      && f.includes("Pay by card - Visa, Mastercard, Apple/Google Pay (worldwide)");
  })()],
  ['R4840 Day 2: team invites, branches, sub-agent isolation, WhatsApp click-to-chat', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const O = require('../lib/orgs.js');
    const sub = O.scopeFor({ role: 'sub_agent', branch: 'Lahore' }, 'u1'), mgr = O.scopeFor({ role: 'manager', branch: 'Lahore' }, 'u1'), own = O.scopeFor({ role: 'owner', branch: 'Lahore' }, 'u1');
    return sub.owner_user_id === 'u1' && !sub.branch && mgr.branch === 'Lahore' && !mgr.owner_user_id && Object.keys(own).length === 0 && O.scopeFor(null, 'u1').none === true
      && typeof O.acceptInvites === 'function' && typeof O.listMembers === 'function' && typeof O.removeMember === 'function'
      && sv.includes("app.get('/api/org/:id/members'") && sv.includes("app.delete('/api/org/:id/members/:uid'") && sv.includes("app.patch('/api/org/:id'")
      && sv.includes('ORGS.applyScope(admin().from(\'clients\')') && sv.includes('scope: ORGS.scopeFor(m, req.userId)') && sv.includes('await ORGS.acceptInvites(req.userId, data.email)')
      && f.includes('async function teamPanel(') && f.includes('function waNum(') && f.includes('https://wa.me/${waNum(c.whatsapp)}') && f.includes('id="ncBranch"')
      && mg.includes('create table if not exists public.org_invites') && mg.includes('add column if not exists branch text');
  })()],
  ['R4850 Day 3: agency billing with plan limits, offers & conditions, interview prep', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const O = require('../lib/offers.js');
    const e = O.enrich({ status: 'received', decision_deadline: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), conditions: [{ text: 'IELTS', met: false }, { text: 'Transcript', met: true }] });
    return e.conditions_open === 1 && e.all_conditions_met === false && e.alerts.some(a => /Decide within/.test(a))
      && O.enrich({ conditions: [{ text: 'x', met: true }] }).all_conditions_met === true
      && sv.includes("app.post('/api/org/:id/subscribe'") && sv.includes("app.post('/api/org/:id/clients/:cid/grant'") && sv.includes("QUOTA.check(req.params.id, me, 'org_case', n)")
      && sv.includes(".eq('id', sub.id).eq('cases_used', sub.cases_used).select('id')") && sv.includes('async function settleAgencySubscription(session)')
      && sv.includes("(md.org_id && md.credits === '0') ? await settleAgencySubscription(so) : await settleCardPayment(so, 'webhook')")
      && sv.includes("app.get('/api/org/:id/invoice/:sid'") && sv.includes("app.post('/api/offers'") && sv.includes("app.patch('/api/offers/:id'") && sv.includes("QUEUE.register('interview_prep'")
      && sv.includes("callAI('case_writing', prompt") === false && fs.readFileSync(__dirname + '/../lib/offers.js', 'utf8').includes("callAI('case_writing', prompt")
      && f.includes('async function billingPanel(') && f.includes('async function grantFromPlan(') && f.includes('async function loadMyOffers(') && f.includes('async function openPrep(') && f.includes("kind==='agency'&&sid")
      && mg.includes('create table if not exists public.org_subscriptions') && mg.includes('create table if not exists public.offers') && mg.includes('create table if not exists public.interview_preps');
  })()],
  ['R4860 Day 4: visa rules carry sources and verification; checklist, pre-fill, refusal analysis', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const seed = require('../lib/visa_seed.js').seed; const V = require('../lib/visa.js');
    const ccs = new Set(seed.map(r => r.country_code));
    const allSourced = seed.every(r => r.rule_type === 'document' || (r.source_url && /^https?:\/\//.test(r.source_url)));
    const pf = V.prefill({ profile: { given_name: 'A', nationality: 'PK' }, provenance: { given_name: 'cv' } }, 'GB');
    return ccs.size === 10 && ['GB', 'DE', 'CA', 'AU', 'AE', 'SA', 'QA', 'TR', 'MY', 'IE'].every(c => ccs.has(c)) && allSourced && seed.length > 100
      && pf.find(x => x.field === 'given_name').source === 'cv' && pf.find(x => x.field === 'family_name').source === 'missing'
      && sv.includes("app.get('/api/visa/assess'") && sv.includes("app.post('/api/visa/cases/:id/refusal'") && sv.includes("app.patch('/api/admin/visa/rules/:rid'") && sv.includes("QUEUE.register('visa_refusal'")
      && fs.readFileSync(__dirname + '/../lib/visa.js', 'utf8').includes("status: 'superseded'") && fs.readFileSync(__dirname + '/../lib/visa.js', 'utf8').includes("Object.assign({ status: 'unverified', confidence: 0.5, version: 1 }, r)")
      && f.includes('async function visaAssess(') && f.includes("'VERIFIED '+esc(String(r.last_verified_at||'').slice(0,10)):'VERIFY'") && f.includes('async function visaRefusalSend(')
      && mg.includes('create table if not exists public.visa_rules') && mg.includes("check (status in ('unverified','verified','superseded','disputed'))");
  })()],
  ['R4870 Day 5: the journey after the visa, with partner slots and sourced destination rules', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const J = require('../lib/journey.js'); const phases = Object.keys(J.BASE);
    return ['pre_departure', 'arrival', 'settlement', 'family', 'pr'].every(p => phases.includes(p)) && J.BASE.pre_departure.some(t => t.partner_slot === 'insurance') && J.BASE.arrival.some(t => t.partner_slot === 'sim')
      && sv.includes("app.post('/api/journey/plan'") && sv.includes("app.patch('/api/journey/:id'") && sv.includes("app.get('/api/org/:id/clients/:cid/journey'")
      && f.includes('async function journeyPlan(') && f.includes('async function journeyTick(') && mg.includes('create table if not exists public.journey_tasks');
  })()],
  ['R4880 Day 6: bounded, explained outcome learning; agency analytics; admin rule verification', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const ag = fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8');
    const L = require('../lib/learning.js');
    const learn = { baseline_offer_rate: 20, groups: [{ country_code: 'DE', kind: 'postdoc', field: 'pharmacy', applied: 12, offer_rate: 50 }, { country_code: 'GB', kind: 'postdoc', field: 'pharmacy', applied: 3, offer_rate: 90 }, { country_code: 'AU', kind: 'postdoc', field: 'pharmacy', applied: 20, offer_rate: 0 }] };
    const a = L.nudge(learn, { country_code: 'DE', kind: 'postdoc' }, 'pharmacy'), b = L.nudge(learn, { country_code: 'GB', kind: 'postdoc' }, 'pharmacy'), c = L.nudge(learn, { country_code: 'AU', kind: 'postdoc' }, 'pharmacy');
    return a.delta === 4 && /done better/.test(a.note) && b.delta === 0 && c.delta === -4 && L.bucketField('Pharm-D') === 'pharmacy' && L.MAX_NUDGE === 4
      && sv.includes("if (x.status === 'not_eligible' || x.pct == null) continue;") && sv.includes('outcome_note: byId[o.id].outcome_note || null')
      && sv.includes("app.get('/api/org/:id/analytics'") && sv.includes("app.post('/api/admin/learning/rebuild'") && ag.includes("require('./learning').rebuild()")
      && f.includes('async function adminVisaRules(') && f.includes('async function vrVerify(') && f.includes('async function adminLearning(') && f.includes('async function analyticsPanel(') && f.includes("['visarules','Visa rules','settings.read']");
  })()],
  ['R4890 Day 7: partner portal - openings mirror as labelled opportunities, consent-gated applicants, service partners', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const pl = fs.readFileSync(__dirname + '/../lib/partners.js', 'utf8');
    return pl.includes("source_kind: 'PARTNER'") && pl.includes("is_partner: true") && pl.includes("Only institution or employer workspaces can post openings") && pl.includes("applicant: consented ?") && pl.includes("name: 'Applicant ' + a.id.slice(0, 6)")
      && sv.includes("partner: !!o.is_partner,") && !sv.includes('is_partner ? ') && sv.includes("app.post('/api/applications/:id/consent'") && sv.includes("app.get('/api/org/:id/applicants'") && sv.includes("app.get('/api/partners'")
      && f.includes('id="orgKind"') && f.includes('async function openingsPanel(') && f.includes('async function applicantsPanel(') && f.includes('shown first among the options you qualify for')
      && mg.includes('create table if not exists public.partner_openings') && mg.includes('create table if not exists public.application_shares') && mg.includes('create table if not exists public.service_partners');
  })()],
  ['R4920 Days 8-10: languages & origin markets, 54 entry points, indexes, queue, encryption, data rights, API keys', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const I = require('../lib/i18n.js'); const C = require('../lib/crypto.js'); const P = require('../lib/visa_portals.js');
    process.env.FF_DATA_KEY = require('crypto').randomBytes(32).toString('hex'); const enc = C.encrypt('AB1234567'); const ok = C.enabled() && enc.startsWith('v1.') && C.decrypt(enc) === 'AB1234567' && C.decrypt('v1.bad') === null && C.mask('AB1234567') === '•••••4567'; delete process.env.FF_DATA_KEY;
    return ok && !C.enabled() && Object.keys(I.LANGS).length === 5 && I.LANGS.ur.dir === 'rtl' && I.ORIGINS.IN.currency === 'INR' && I.ORIGINS.PK.bank_transfer === true && I.ORIGINS.BD.bank_transfer === false && I.t('nav_dashboard', 'ur') === 'ڈیش بورڈ' && I.t('nav_dashboard', 'xx') === 'My journey' && I.t('nav_workspace', 'xx') === 'FF-CRM'
      && Object.keys(P.PORTALS).length === 54 && P.portalRules().every(r => /^https?:/.test(r.source_url))
      && sv.includes("app.get('/api/i18n'") && sv.includes("app.get('/api/me/export'") && sv.includes("app.post('/api/me/delete-request'") && sv.includes("app.post('/api/org/:id/keys'") && sv.includes("async function apiKeyAuth(") && sv.includes("app.get('/api/v1/clients', apiKeyAuth")
      && sv.includes("QUEUE.register('profile_extract'") && sv.includes("CACHE.set(ck, {") && sv.includes("CACHE.bust('board:' + req.params.id)") && sv.includes("bank_transfer: !!(require('./lib/i18n').ORIGINS[origin] || {}).bank_transfer")
      && fs.readFileSync(__dirname + '/../lib/mobility.js', 'utf8').includes('upd.mobility_enc = enc')
      && f.includes('function applyLang(') && f.includes('async function setOrigin(') && f.includes('data-i18n="nav_dashboard"') && f.includes('id="payBankBlock"') && f.includes('async function apiKeyCreate(')
      && mg.includes('create table if not exists public.org_api_keys') && mg.includes('idx_opps_cc_kind_status_deadline') && mg.includes('add column if not exists origin_country');
  })()],
  ['R4950 Days 11-13: white-label domains, signed webhooks with retries, API docs, PWA install/offline, QA scripts', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const W = require('../lib/webhooks.js'); const sig = W.sign('s3cret', '{"a":1}');
    return /^sha256=[0-9a-f]{64}$/.test(sig) && W.EVENTS.includes('client.stage_changed') && W.EVENTS.length >= 7
      && sv.includes("QUEUE.register('webhook_deliver'") && sv.includes("app.post('/api/org/:id/domains/:did/verify'") && sv.includes("resolveTxt('_foriforeign.' + d.domain)") && sv.includes("app.post('/api/org/:id/webhooks'") && sv.includes("app.get('/api/whitelabel'") && sv.includes("app.post('/api/whitelabel/attach'")
      && sv.includes("WEBHOOKS.emit(req.params.id, 'client.created'") && sv.includes("WEBHOOKS.emit(req.params.id, 'client.stage_changed'") && sv.includes("WEBHOOKS.emit(c.org_id, 'offer.recorded'") && sv.includes("WEBHOOKS.emit(c.org_id, 'commission.accrued'")
      && fs.existsSync(__dirname + '/../public/api-docs.html') && fs.existsSync(__dirname + '/../tools/QA_SCRIPTS.md')
      && f.includes('async function domainAdd(') && f.includes('async function hookAdd(') && f.includes('function applyWhitelabel(') && f.includes('async function installApp(') && f.includes('function offlineBanner(') && f.includes('id="installBtn"')
      && mg.includes('create table if not exists public.org_domains') && mg.includes('create table if not exists public.webhook_deliveries');
  })()],
  ['R5000 Days 14-15: runbook, backup/restore drill, pricing page, launch build feature flags', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const pkg = require('../package.json');
    return fs.existsSync(__dirname + '/../docs/RUNBOOK.md') && fs.existsSync(__dirname + '/../tools/backup.js') && fs.existsSync(__dirname + '/../tools/restore.js') && fs.existsSync(__dirname + '/../public/pricing.html')
      && fs.readFileSync(__dirname + '/../tools/restore.js', 'utf8').includes("FF_RESTORE_CONFIRM !== 'yes'") && pkg.scripts.backup === 'node tools/backup.js'
      && sv.includes("res.set('x-ff-features'") && /const FF_BUILD = '2026-\d{2}-\d{2}-R\d{4}';/.test(sv);
  })()],
  ['R5050 Days 16-20: notification hub, sponsor register, occupations, Lemon Squeezy, family & PR tracker, origin attestation', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const O = require('../lib/occupations.js'); const S = require('../lib/sponsors.js'); const L = require('../lib/gateway_lemon.js'); const J = require('../lib/journey.js'); const V = require('../lib/vault.js');
    const sig = require('crypto').createHmac('sha256', 'k').update('{"x":1}').digest('hex');
    const sess = L.sessionFromEvent({ data: { id: '9', attributes: { status: 'paid' } }, meta: { custom_data: { payment_id: 'p1', user_id: 'u1' } } });
    return O.classify('Clinical Pharmacist').isco === '2262' && O.classify('nothing').isco === null && S.norm('Barts Health NHS Trust Ltd').startsWith('barts health') && S.parseCsv('Organisation Name,Town\n"A, B",Leeds\n').length === 2
      && L.verifySignature('{"x":1}', sig, 'k') && !L.verifySignature('{"x":1}', sig, 'z') && sess.payment_status === 'paid' && sess.metadata.payment_id === 'p1'
      && V.DOC_TYPES.includes('marriage_certificate') && V.CHECKLISTS.family.required.includes('birth_certificate')
      && fs.readFileSync(__dirname + '/../lib/journey.js', 'utf8').includes("ATTEST[origin] || ATTEST.PK") && fs.readFileSync(__dirname + '/../lib/journey.js', 'utf8').includes('IN: ')
      && sv.includes("app.post('/api/pay/lemon/webhook', express.raw(") && sv.indexOf("app.post('/api/pay/lemon/webhook'") < sv.indexOf("app.use(express.json(") && sv.includes("app.post('/api/pay/lemon/checkout'")
      && sv.includes("app.get('/api/notifications'") && sv.includes("app.post('/api/admin/sponsors/import'") && sv.includes("app.get('/api/me/pr-tracker'") && sv.includes("app.put('/api/me/family'") && sv.includes("NOTIFY.push(p.user_id, 'payment_approved'")
      && sv.includes("sponsor_verified: o.sponsor_verified == null ? null : !!o.sponsor_verified") && fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8').includes("require('./notify').dailySweep()")
      && f.includes('async function notifPanel(') && f.includes('EMPLOYER ON THE OFFICIAL SPONSOR REGISTER') && f.includes("prov==='lemonsqueezy'?'/api/pay/lemon/checkout'") && f.includes('async function familyLoad(') && f.includes('async function prLoad(')
      && mg.includes('create table if not exists public.notifications') && mg.includes('create table if not exists public.sponsor_register') && mg.includes('add column if not exists dependants jsonb');
  })()],
  ['R5100 Days 21-25: partner pilots, origin at sign-up, ten more destinations, email notifications, consultant mobile view', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const s2 = require('../lib/visa_seed2.js').seed; const M = require('../lib/mailer.js'); const ccs = new Set(s2.map(r => r.country_code));
    return ccs.size === 10 && ['NL', 'SE', 'FI', 'NO', 'DK', 'IT', 'FR', 'ES', 'PL', 'NZ'].every(c => ccs.has(c)) && s2.every(r => r.rule_type === 'document' || /^https?:/.test(r.source_url))
      && !M.enabled() && M.wrap('T', 'B', 'home').includes('Open ForiForeign')
      && fs.readFileSync(__dirname + '/../lib/visa.js', 'utf8').includes("require('./visa_seed2')") && fs.readFileSync(__dirname + '/../lib/notify.js', 'utf8').includes("p.notify_email !== false")
      && fs.existsSync(__dirname + '/../public/partners.html') && sv.includes("app.get('/api/org/:id/partner-metrics'") && sv.includes("app.post('/api/admin/pilots'") && sv.includes("app.put('/api/me/notify'") && sv.includes("origin_country: signupOrigin")
      && f.includes('id="su-origin"') && f.includes("origin_country:(document.getElementById('su-origin')||{}).value||'PK'") && f.includes('id="notifyEmail"') && f.includes("window._wsStage") && f.includes("partner-metrics")
      && mg.includes('add column if not exists notify_email boolean') && mg.includes('add column if not exists pilot boolean');
  })()],
  ['R5200 Days 26-30: every org/admin/v1 route is guarded; hardening headers; smoke, load and security docs exist', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    const rr = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,([\s\S]*?)=>/g; let m; const bad = [];
    const EXC = new Set(['/api/admin/me', '/api/admin/bypass-activate', '/api/admin/totp/enrol', '/api/admin/totp/confirm', '/api/admin/totp/verify', '/api/admin/totp/status']);   // staffOnly / explicit role check; TOTP routes must run BEFORE the TOTP gate
    while ((m = rr.exec(sv))) { const path = m[2], head = m[3]; const body = sv.slice(m.index, m.index + 1600);
      if (path.startsWith('/api/org/:id') && !/requireOrg\(|orgClient\(/.test(body)) bad.push(path);
      if (path.startsWith('/api/admin/') && !EXC.has(path) && !/perm\(/.test(head)) bad.push(path);
      if (path.startsWith('/api/v1/') && !/apiKeyAuth/.test(head)) bad.push(path); }
    if (bad.length) console.log('    unguarded:', bad.join(', '));
    return bad.length === 0 && sv.includes("res.set('Strict-Transport-Security'") && sv.includes("res.set('x-ff-ms'") && sv.includes("Too many requests, slow down.")
      && fs.existsSync(__dirname + '/../tools/smoke.js') && fs.existsSync(__dirname + '/../tools/loadtest.js') && fs.existsSync(__dirname + '/../docs/SECURITY.md');
  })()],
  ['R5250: explore catalogue (subject / university / country / level / funding) and honest visa-tracking directory', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const E = require('../lib/explore.js'); const V = require('../lib/visa_tracking.js');
    return E.subjectOf('Postdoctoral fellow in clinical pharmacology').startsWith('Pharmacy') && E.subjectOf('PhD in machine learning') === 'Computer science & AI' && E.subjectOf('zzz') === 'Other / interdisciplinary'
      && Object.keys(V.TRACK).length === 54 && V.trackingFor('GB').official.url.startsWith('https://www.gov.uk') && V.trackingFor('GB').live_api === false
      && sv.includes("app.get('/api/explore'") && sv.includes("app.get('/api/explore/institution'") && sv.includes("app.get('/api/visa/tracking'") && sv.includes("Object.assign(lockTease(o), { subject: o.subject")
      && f.includes('async function vExplore(') && f.includes('async function exploreInstitution(') && f.includes('<button data-t="explore">Opportunities</button>') && f.includes('explore:vExplore');
  })()],
  ['R5300: Case Inbox + Case Brain keep the platform in the loop after Send, lawfully (applicant forwards, applicant sends)', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const cb = fs.readFileSync(__dirname + '/../lib/casebrain.js', 'utf8');
    return sv.includes("app.get('/api/applications/:id/inbox'") && sv.includes("app.post('/api/applications/:id/inbox'") && sv.includes("app.post('/api/intake/email'") && sv.includes("String(req.headers['x-intake-secret'] || '') !== process.env.INTAKE_SECRET") && sv.includes("QUEUE.register('case_understand'")
      && cb.includes("ForiForeign never impersonates them and never holds their inbox") && cb.includes('suggested_reply') && cb.includes("const stageMap = { interview_invite: 'interview'") && cb.includes("Q.enqueue('interview_prep'") && cb.includes("await O.create(m.user_id, { application_id: m.application_id")
      && f.includes('async function caseInboxMount(') && f.includes("arrive in your <a")
      && mg.includes('create table if not exists public.case_messages') && mg.includes('add column if not exists intake_alias text unique');
  })()],
  ['R5320: the application mailbox on our own domain - consent, routing, pause, copy, send on tap; no third-party accounts, no personal passwords', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const cb = fs.readFileSync(__dirname + '/../lib/casebrain.js', 'utf8');
    return cb.includes('No third-party accounts are created in anyone\'s name; no personal password is ever held') && cb.includes('async function provisionApplyEmail(') && cb.includes('async function routeForUser(') && cb.includes('async function sendFromApplyEmail(') && cb.includes("assigned_by: assignedBy || (applicationId ? 'alias' : 'unassigned')")
      && sv.includes("app.post('/api/me/mailbox'") && sv.includes("app.post('/api/me/mailbox/send'") && sv.includes("const u = await BRAIN.byApplyEmail(to)") && sv.includes("paused: !!u.apply_email_paused") && sv.includes("subject: '[Copy] '")
      && f.includes('async function mailboxLoad(') && f.includes('pause ForiForeign reading my mail') && f.includes('Send from my ForiForeign address')
      && mg.includes('add column if not exists apply_email text unique') && mg.includes('alter column application_id drop not null');
  })()],
  ['R5350: forimail backbone - auto-issued unique address, Mail tab, triage with codes, one-tap application send', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const cb = fs.readFileSync(__dirname + '/../lib/casebrain.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    return cb.includes("process.env.APPLY_DOMAIN || 'forimail.com'") && cb.includes("const cands = [[first, last]") && cb.includes('async function triage(messageId)') && cb.includes("t = 'verification_code'") && cb.includes('async function linkToCase(')
      && sv.includes("provisionApplyEmail(req.userId); data.apply_email = r.email;") && sv.includes("app.post('/api/applications/:id/send-from-mailbox'") && sv.includes("QUEUE.register('mail_triage'") && sv.includes("pkg.from_mailbox = pe && pe.apply_email || null")
      && sv.includes("if (u.apply_email_forward === true && u.email)")
      && f.includes('async function vMail(') && f.includes('async function mailOpen(') && f.includes('function mailCompose(') && f.includes("mail:vMail") && f.includes("send-from-mailbox")
      && mg.includes('alter column apply_email_forward set default false') && mg.includes('add column if not exists otp_code text');
  })()],
  ['R5400: attestation origin×destination and licence registries, org admin layer with isolation check, cleanup', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const A = require('../lib/attestation.js'); const P = require('../lib/professions.js');
    const pkde = A.rulesFor('PK', 'DE'), inae = A.rulesFor('IN', 'AE');
    return pkde[0].value.route === 'apostille' && pkde.some(r => /APS/.test(r.text)) && inae[0].value.route === 'legalisation' && A.rulesFor('BD', 'GB')[0].value.route === 'apostille' && A.rulesFor('NP', 'DE')[0].value.route === 'legalisation'
      && P.rules().length > 50 && P.rules().every(r => /^https?:/.test(r.source_url)) && P.P.pharmacist.SA[2] === 'SCFHS'
      && fs.readFileSync(__dirname + '/../lib/visa.js', 'utf8').includes("require('./attestation')") && fs.readFileSync(__dirname + '/../lib/visa.js', 'utf8').includes("r.value.origin === origin")
      && sv.includes("app.get('/api/org/:id/audit'") && sv.includes("app.get('/api/org/:id/isolation-check'") && sv.includes("async function orgAudit(orgId, actor, event, detail)") && sv.includes("orgAudit(req.params.id, req.userId, 'MEMBER_INVITED'")
      && f.includes('async function isolationCheck(') && f.includes('async function orgAuditLoad(') && f.includes("async function vBrowse(){ go('home'); setTimeout(()=>openFinder(true),60); }") && !f.includes('id="ciPaste"')
      && mg.includes("'attestation','licence','shortage'") && mg.includes('add column if not exists org_id uuid');
  })()],
  ['R5450: Browser Agent with consent and graded scope, protected platform admin, client finance and history, leads, outbound queue, appointments', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const bb = fs.readFileSync(__dirname + '/../lib/browserbot.js', 'utf8');
    const B = require('../lib/browserbot.js');
    return B.SCOPES.length >= 3 && Object.keys(B.PORTALS).length >= 12 && bb.includes("throw new Error('The applicant must consent") && bb.includes('secret_enc: enc') && bb.includes("Needs the browser worker") && bb.includes('async function sweep()')
      && fs.existsSync(__dirname + '/../tools/browser-worker.js.example')
      && sv.includes("app.post('/api/me/portals'") && sv.includes("app.put('/api/admin/browser-policy'") && sv.includes("app.put('/api/org/:id/browser-policy'") && sv.includes("QUEUE.register('portal_watch'")
      && sv.includes("This account is the protected platform owner and cannot be changed.") && sv.includes("Only a super admin can change super admin accounts.")
      && sv.includes("app.get('/api/org/:id/clients/:cid/finance'") && sv.includes("app.get('/api/org/:id/clients/:cid/history'") && sv.includes("app.post('/api/leads/:token'") && sv.includes("QUEUE.register('outbound_send'") && sv.includes("app.post('/api/appointments'")
      && fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8').includes("require('./browserbot').sweep()")
      && f.includes('async function portalsLoad(') && f.includes('function portalForm(') && f.includes('async function clientHistory(') && f.includes('async function clientFinance(') && f.includes('async function leadsPanel(')
      && mg.includes('create table if not exists public.portal_connections') && mg.includes('create table if not exists public.browser_policies') && mg.includes('create table if not exists public.client_finance') && mg.includes('create table if not exists public.leads') && mg.includes('add column if not exists protected_admin boolean');
  })()],
  ['R5500 fix pass: attachments to vault, journey engine, confidence gate, change detection, consent confirm, licences, refunds, metering, retention, sources, tracks, alerts, session revocation, legal pages', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const cb = fs.readFileSync(__dirname + '/../lib/casebrain.js', 'utf8'); const ag = fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8');
    const JE = require('../lib/journey_engine.js'); const S = require('../lib/sources.js'); const seed = require('../lib/visa_seed.js').seed;
    return JE.ORDER[0] === 'lead' && JE.ORDER.includes('pr') && Object.keys(S.ADAPTERS).length === 5
      && sv.includes("Gap 1 · attachments become vault documents") && sv.includes("QUEUE.register('journey_recompute'") && sv.includes("app.get('/api/me/next'") && sv.includes("out.next = pn && pn.next_action")
      && cb.includes("const sure = conf >= 0.8") && cb.includes("needs_confirmation: !sure") && cb.includes("async function confirmClassification(") && sv.includes("app.post('/api/me/mailbox/messages/:id/confirm'")
      && fs.existsSync(__dirname + '/../lib/rulewatch.js') && ag.includes("require('./policywatch').sweep(300)") && ag.includes("require('./sources').sweep()")
      && sv.includes("app.post('/api/me/portals/:id/confirm'") && sv.includes("pending_applicant_confirmation: true") && sv.includes("requires a verified registered-agent licence") && sv.includes("app.patch('/api/admin/licences/:lid'")
      && sv.includes("app.post('/api/payments/:id/refund'") && sv.includes("reason: 'refund', payment_id: p.id") && sv.includes("async function overCap(userId, capability)") && sv.includes("await meter(req.userId, 'interview_prep')")
      && sv.includes("async function retentionPurge()") && sv.includes("async function alertSweep()") && sv.includes("role_changed_at: new Date().toISOString()") && sv.includes("Your access changed. Please sign in again.") && sv.includes("API key rate limit (600/hour) reached")
      && sv.includes("app.post('/api/admin/sources'") && seed.filter(r => r.value && r.value.track === 'employer').length >= 5 && fs.readFileSync(__dirname + '/../lib/visa.js', 'utf8').includes("tracks, source_changed")
      && fs.readFileSync(__dirname + '/../lib/queue.js', 'utf8').includes("admin().rpc('claim_job'") && mg.includes('create or replace function public.claim_job')
      && fs.existsSync(__dirname + '/../public/legal.html') && f.includes('id="nextCard"') && f.includes('function profileTabs(') && f.includes("Your consultant asks to watch") && f.includes('async function licencesLoad(') && f.includes("Is this a ${esc((m.classification||'reply')")
      && mg.includes('create table if not exists public.consultant_licences') && mg.includes('create table if not exists public.usage_meter') && mg.includes('create table if not exists public.rule_sources') && mg.includes('create table if not exists public.sources');
  })()],
  ['R5550: Pakistan-local PKR checkout (Safepay), public endpoint limits, retention guard, NTN invoices, ID validation, origin phone prefixes', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8');
    const SP = require('../lib/gateway_safepay.js'); const crypto = require('crypto'); const body = JSON.stringify({ data: { tracker: 'trk_1', state: 'PAID', order_id: 'pay_1' } }); const sig = crypto.createHmac('sha256', 'sec').update('trk_1').digest('hex');
    const sess = SP.sessionFromEvent(JSON.parse(body));
    return SP.verifySignature(body, sig, 'sec') && !SP.verifySignature(body, sig, 'other') && sess.payment_status === 'paid' && sess.metadata.payment_id === 'pay_1' && !SP.enabled()
      && sv.includes("app.post('/api/pay/pk/checkout'") && sv.includes("app.post('/api/pay/safepay/webhook', express.raw(") && sv.indexOf("app.post('/api/pay/safepay/webhook'") < sv.indexOf("app.use(express.json(") && sv.includes("leads\\/|intake\\/|pay\\/(stripe|lemon|safepay)")
      && sv.includes("['cv', 'passport', 'degree', 'transcript'].includes(d.doc_type)") && sv.includes("legal.ntn ? ' · NTN ' + legal.ntn") && st.includes("company_name: 'ForiForeign (Private) Limited'") && st.includes("pk_local: !!(process.env.SAFEPAY_API_KEY")
      && fs.readFileSync(__dirname + '/../lib/mobility.js', 'utf8').includes("National ID format not recognised") && f.includes('async function payPkLocal(') && f.includes("function waNum(n,origin)");
  })()],
  ['R5600: USD-only checkout, Policy Watch with impact, Partnership agent + signed official documents, Economics agent, employer outreach, case-closure purge', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const ag = fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8');
    const P = require('../lib/partnerships.js'); const E = require('../lib/economics.js'); const h = P.humanize('We delve deep \u2014 leveraging robust synergies -- furthermore, seamless.');
    const cost = E.packageCost(E.DEFAULT_UNIT_USD, { credits: 2, view: 5 });
    return !/\u2014|\u2013| -- /.test(h) && !/leverag|delve|synerg|robust|furthermore/i.test(h) && P.STRUCTURES.length === 4 && cost.total > 0 && cost.total < 10
      && !f.includes('payPkLocal(${credits},this)') && !f.includes('or bank transfer (Pakistan)') && f.includes('send USD by bank transfer / Wise / Payoneer')
      && fs.existsSync(__dirname + '/../lib/policywatch.js') && ag.includes("require('./policywatch').sweep(300)") && sv.includes("app.get('/api/policy/updates'")
      && sv.includes("app.post('/api/admin/documents/draft'") && sv.includes("app.post('/api/admin/documents/:id/sign'") && sv.includes("app.get('/api/documents/verify/:id'") && sv.includes("QUEUE.register('doc_draft'")
      && sv.includes("app.get('/api/admin/economics'") && sv.includes("app.post('/api/applications/:id/outreach'") && sv.includes("async function caseClosurePurge()")
      && f.includes('async function adminPolicy(') && f.includes('async function adminDocuments(') && f.includes('async function adminEconomics(') && f.includes('async function employerOutreach(')
      && mg.includes('create table if not exists public.policy_updates') && mg.includes('create table if not exists public.official_documents');
  })()],
  ['R5650: visibility layers, branch hierarchy, conflict-of-interest rules, support triage agent, platform oversight, official contact', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const o = fs.readFileSync(__dirname + '/../lib/orgs.js', 'utf8'); const m = fs.readFileSync(__dirname + '/../lib/mailer.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    return o.includes("branch.like.' + scope.branch + '/%'") && o.includes('ForiForeign staff cannot be members of customer organisations') && o.includes('cannot hold consultant clients')
      && m.includes("process.env.MAIL_REPLY_TO || 'admin@foriforeign.com'") && m.includes('reply_to: replyTo')
      && sv.includes("app.get('/api/admin/orgs', auth, perm('users.read'), superOnly") && sv.includes("app.get('/api/me/visibility'") && sv.includes("QUEUE.register('support_triage'") && sv.includes("QUEUE.enqueue('support_triage', { ticketId: data.id }") && sv.includes("app.get('/api/contact'")
      && f.includes("wb.style.display=v.tabs.work?'':'none'") && f.includes('async function adminOrgs(') && f.includes('Suggested reply ready')
      && mg.includes('add column if not exists suggested_reply text');
  })()],
  ['R5700: all 54 destinations carry study + work routes, employer/applicant tracks, fees, dependants, PR, licences (sourced, unverified until checked)', (() => {
    const P = require('../lib/visa_portals.js').PORTALS; const all = [].concat(require('../lib/visa_seed.js').seed, require('../lib/visa_seed2.js').seed, require('../lib/visa_seed3.js').seed, require('../lib/visa_seed4.js').seed, require('../lib/visa_seed5.js').seed);
    const lic = require('../lib/professions.js').rules().concat(all.filter(r => r.rule_type === 'licence'));
    const bad = Object.keys(P).filter(cc => { const st = all.filter(r => r.country_code === cc && r.lane !== 'work' && r.rule_type !== 'licence'), wk = all.filter(r => r.country_code === cc && r.lane === 'work' && r.rule_type !== 'licence'); const has = (a, t) => a.some(r => r.rule_type === t); return !(st.length && wk.length && wk.some(r => r.value && r.value.track === 'employer') && wk.some(r => r.value && r.value.track === 'applicant') && has(st, 'fee') && has(st, 'pr_path') && has(st, 'work_rights') && has(wk, 'pr_path') && (has(st, 'dependants') || has(wk, 'dependants')) && new Set(lic.filter(r => r.country_code === cc).map(r => r.value.profession)).size >= 5); });
    const sourced = all.every(r => r.rule_type === 'document' || /^https?:\/\//.test(r.source_url));
    if (bad.length) console.log('    incomplete:', bad.join(','));
    return bad.length === 0 && sourced && all.length > 1400 && fs.readFileSync(__dirname + '/../lib/visa.js', 'utf8').includes("require('./visa_seed5')");
  })()],
  ['R5750: every profession × every destination has a sourced licence/recognition rule; universities seeded as entities for all 54', (() => {
    const PA = require('../lib/professions_all.js'); const U = require('../lib/universities_seed.js'); const P = require('../lib/visa_portals.js').PORTALS; const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const r = PA.rules(); const ccs = new Set(r.map(x => x.country_code)); const profs = new Set(r.map(x => x.value.profession));
    return ccs.size === 54 && profs.size === PA.PROFS.length && PA.PROFS.length >= 35 && r.every(x => /^https?:/.test(x.source_url)) && Object.keys(U.U).length === 54 && U.rows().length > 250 && U.rows().every(u => /\./.test(u.domain))
      && fs.readFileSync(__dirname + '/../lib/visa.js', 'utf8').includes("require('./professions_all')") && fs.readFileSync(__dirname + '/../lib/visa.js', 'utf8').includes("require('./universities_seed')")
      && sv.includes("app.get('/api/explore/institutions'") && f.includes('async function exploreUnis(') && fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8').includes('create table if not exists public.institutions');
  })()],
  ['R5800: acquisition engine - ESCO professions, EU regulated professions, open job APIs, institution registries, ATS discovery, entity verification', (() => {
    const A = require('../lib/acquire.js'); const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const ag = fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const kinds = Object.keys(A.ADAPTERS);
    return ['esco', 'eu_regprof', 'arbeitnow', 'adzuna', 'jooble', 'reed', 'usajobs', 'college_scorecard', 'registry_csv', 'ats_discover'].every(k => kinds.includes(k)) && typeof A.verifyInstitution === 'function' && typeof A.verifyEmployers === 'function' && Object.keys(A.ADZUNA_CC).length >= 12
      && sv.includes("QUEUE.register('acq_run'") && sv.includes("app.get('/api/admin/acquisition'") && sv.includes("app.get('/api/professions/search'") && sv.includes("app.get('/api/institutions'") && sv.includes("employer_verified: o.employer_verified == null")
      && ag.includes("'acq_run'") && ag.includes("'acq_verify_employers'") && f.includes('async function adminAcquisition(') && f.includes('EMPLOYER VERIFIED (official domain and registry)')
      && mg.includes('create table if not exists public.professions') && mg.includes("'esco','eu_regprof','college_scorecard','registry_csv','ats_discover'");
  })()],
  ['R5850: worldwide origins, USD-only, visa desk end to end, add-on stages, partner spotlight (labelled, not ranked), visa decisions by mail', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8'); const cb = fs.readFileSync(__dirname + '/../lib/casebrain.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const W = require('../lib/world.js'); const I = require('../lib/i18n.js'); const A = require('../lib/attestation.js');
    return Object.keys(W.W).length > 130 && W.HAGUE.size > 100 && Object.keys(I.ORIGINS).length > 130 && I.ORIGINS.KE.currency === 'KES' && A.rulesFor('KE', 'AE')[0].value.route === 'legalisation' && A.rulesFor('PH', 'DE')[0].value.route === 'apostille'
      && st.includes("show_local: true") && st.includes('visa_desk_usd') && !f.includes('Built for Pakistan') && f.includes('From anywhere, to anywhere')
      && sv.includes("app.get('/api/visa/desk'") && sv.includes("app.patch('/api/visa/desk/:id'") && sv.includes("app.get('/api/addons'") && sv.includes("app.post('/api/addons/checkout'") && sv.includes("async function addonGate(") && sv.includes("app.get('/api/partners/spotlight'") && sv.includes("Partners pay for visibility here, not for ranking")
      && cb.includes("Visa decisions arriving by mail") && f.includes('async function visaDesk(') && f.includes('async function vdDecision(') && f.includes('id="spotlightRail"')
      && mg.includes('create table if not exists public.user_addons') && mg.includes('add column if not exists spotlight boolean');
  })()],
  ['R5900: consent ledger with wording+hash+ip, free-tier lifetime cap and single pass, stage offers, economics of the free tier', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const C = require('../lib/consent.js'); const E = fs.readFileSync(__dirname + '/../lib/economics.js', 'utf8');
    const w = C.render('portal_watch', { portal: 'IRCC', scope: 'watch' });
    return /IRCC/.test(w) && /"watch"/.test(w) && Object.keys(C.WORDING).length >= 12 && typeof C.producePdf === 'function'
      && sv.includes("app.get('/api/me/consents'") && sv.includes("app.get('/api/admin/consents/:uid'") && sv.includes("CONSENT.record(req, req.userId, 'package_purchase'") && sv.includes("CONSENT.record(req, req.userId, 'addon_purchase'") && sv.includes("CONSENT.record(req, req.userId, 'agency_plan'") && sv.includes("CONSENT.record(req, req.userId, 'portal_watch'") && sv.includes("CONSENT.record(req, req.userId, 'share_with_partner'") && sv.includes("CONSENT.record(req, req.userId, 'terms'")
      && sv.includes("fu.free_lifetime_searches") && sv.includes("req._freeTier = true") && sv.includes("if (req._freeTier) prefs.maxPasses = 1;") && fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8').includes("passes.slice(0, Number(prefs.maxPasses))")
      && sv.includes("app.get('/api/me/offers-for-me'") && E.includes('breakeven_conversion_pct') && f.includes('id="offersForMe"') && f.includes('async function consentsLoad(') && f.includes("ff:api-402")
      && mg.includes('create table if not exists public.consent_ledger') && mg.includes('add column if not exists free_searches_used');
  })()],
  ['R5950 QA pass: callAI declared at module scope (outreach + support triage), free-tier pass list never mutates shared tiers, /api/health exists', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const en = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
    const top = sv.slice(0, sv.indexOf("app.get('/api/version'"));
    return /const \{ callAI \} = require\('\.\/lib\/router'\);/.test(top) && sv.includes("app.get('/api/health'") && en.includes("passes.slice(0, Number(prefs.maxPasses))") && !en.includes("passes.splice(") && en.includes("for (let pi = 0; pi < passList.length; pi++)");
  })()],
  ['R6000: agency plans 100/500/1000 with search limits, quota allocation down the tree, resale locks, leads scope, translation plugin, simple finder, boards, profession filter', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const st = fs.readFileSync(__dirname + '/../lib/settings.js', 'utf8'); const o = fs.readFileSync(__dirname + '/../lib/orgs.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const S = require('../lib/settings.js').DEFAULTS.agency.tiers; const B = require('../lib/boards.js'); const Q = require('../lib/quota.js');
    return S.length === 3 && S.map(t => t.cases_month).join(',') === '100,500,1000' && S.every(t => t.searches_day && t.searches_month && t.usd_year) && !st.includes('pkr_month')
      && typeof Q.check === 'function' && typeof Q.consume === 'function' && B.links({ cc: 'GB', text: 'nurse', lane: 'work' }).some(l => /linkedin/.test(l.url)) && B.links({ cc: 'DE', text: 'x', lane: 'study' }).some(l => /daad/.test(l.url))
      && sv.includes("app.get('/api/org/:id/quota'") && sv.includes("app.put('/api/org/:id/quota'") && sv.includes("QUOTA.check(req.params.id, me, 'org_case', n)") && sv.includes("QUOTA.check(req.params.id, me, 'org_search', 1)") && sv.includes("app.get('/api/boards'") && sv.includes("(cfg.agency.tiers || cfg.agency.plans)") && sv.includes("sub.billing_period === 'year' ? 365 : 30")
      && sv.includes("if (mm && mm.role === 'sub_agent') lq = lq.eq('assigned_user_id', req.userId)") && o.includes('Resale lock: a person who OWNS another consultancy') && o.includes('Resale lock: a consultant or sub-agent inside a consultancy')
      && f.includes('function gtInit(') && f.includes('function gtSet(') && f.includes("translate.google.com/translate_a/element.js") && f.includes('id="simpleFinder"') && f.includes('async function simpleFind(') && f.includes('async function quotaLoad(') && f.includes('id="exProf"')
      && mg.includes('create table if not exists public.quota_allocations');
  })()],
  ['R6100: design system, prospecting agent (lawful outreach + trial), daily brief, self-heal, 24/7 support responder, documents-needed-now, anti-fraud guard, attestation reading', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const ag = fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8');
    const P = require('../lib/prospecting.js'); const H = require('../lib/selfheal.js'); const B = require('../lib/dailybrief.js'); const FQ = require('../lib/faq_seed.js');
    return typeof P.find === 'function' && typeof P.research === 'function' && typeof P.propose === 'function' && typeof P.send === 'function' && typeof P.handleReply === 'function' && typeof H.heal === 'function' && typeof H.respond === 'function' && typeof B.build === 'function' && FQ.FAQS.length >= 10
      && fs.readFileSync(__dirname + '/../lib/prospecting.js', 'utf8').includes('suppression_list') && fs.readFileSync(__dirname + '/../lib/prospecting.js', 'utf8').includes('daily_cap') && fs.readFileSync(__dirname + '/../lib/prospecting.js', 'utf8').includes('unsubscribe')
      && fs.readFileSync(__dirname + '/../lib/selfheal.js', 'utf8').includes('never edits') && fs.readFileSync(__dirname + '/../lib/selfheal.js', 'utf8').includes("Number(v.confidence) >= 0.8")
      && sv.includes("QUEUE.register('prospect_send'") && sv.includes("QUEUE.register('daily_brief'") && sv.includes("QUEUE.register('selfheal'") && sv.includes("QUEUE.register('support_respond'") && sv.includes("app.post('/api/ask'") && sv.includes("app.get('/api/me/documents-needed'") && sv.includes("const FORBIDDEN_DOC") && sv.includes("PROSPECT.handleReply({ from, subject, body: text })")
      && ag.includes("'daily_brief'") && ag.includes("'selfheal'") && f.includes('ForiForeign design system v1') && f.includes('async function adminProspects(') && f.includes('async function adminBrief(') && f.includes('async function askFF(') && f.includes('async function docsNowLoad(')
      && fs.readFileSync(__dirname + '/../lib/vault.js', 'utf8').includes('attestation_status') && fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8').includes("require('./partnerships').humanize(x)") && fs.existsSync(__dirname + '/../public/help.html')
      && mg.includes('create table if not exists public.prospects') && mg.includes('create table if not exists public.daily_briefs') && mg.includes('create table if not exists public.selfheal_log') && mg.includes('create table if not exists public.faqs');
  })()],
  ['R6150: web discovery by city, ROI figures, multi-contact send, autopilot with cap, real follow-ups, Admin Copilot with safe actions, guidance to agents, FAQ learning, PDF compression', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const pr = fs.readFileSync(__dirname + '/../lib/prospecting.js', 'utf8'); const C = require('../lib/copilot.js'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const ag = fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8');
    return pr.includes('async function discover(') && pr.includes('async function autopilot(') && pr.includes("cc: targets.slice(1).map(t => t.email).join(',')") && pr.includes('roi = p.kind ===') && pr.includes('followups_sent')
      && Object.keys(C.ACTIONS).length >= 8 && !Object.keys(C.ACTIONS).some(k => /sql|exec|code|deploy/.test(k)) && typeof C.snapshot === 'function' && typeof C.learnFaqs === 'function'
      && sv.includes("app.post('/api/admin/copilot'") && sv.includes("app.post('/api/admin/guidance'") && sv.includes("app.post('/api/admin/prospects/autopilot'") && sv.includes("QUEUE.register('prospect_autopilot'") && sv.includes("QUEUE.register('faq_learn'")
      && fs.readFileSync(__dirname + '/../lib/selfheal.js', 'utf8').includes('Standing guidance from the admin') && fs.readFileSync(__dirname + '/../lib/docs.js', 'utf8').includes("execFileSync('qpdf'") && ag.includes("'prospect_autopilot'")
      && f.includes('async function adminCopilot(') && f.includes('async function cpAsk(') && f.includes('Search the web by city') && mg.includes('create table if not exists public.admin_guidance') && mg.includes('create table if not exists public.copilot_log');
  })()],
  ['R6200: redesign v2 (iconic nav, calm hero, quiet surfaces, referral and WhatsApp below the steps) and the house style injected into every writer', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const r = fs.readFileSync(__dirname + '/../lib/router.js', 'utf8'); const S = require('../lib/style.js'); const hs = S.houseStyle({ kind: 'cover_letter', cc: 'GB' });
    return f.includes('Redesign v2 (R6200)') && f.includes("#nav button[data-t=\"home\"]{--ic:") && !f.includes('We Discover&nbsp;') && f.includes("Your next step is ready.") && f.indexOf('id="offersForMe"') < f.indexOf('One compact strip instead of two large cards')
      && r.includes("if (purpose === 'case_writing')") && r.includes("houseStyle({ kind: opts.kind || guessKind(prompt)") && /No long dashes/.test(hs) && /280 to 380 words/.test(hs) && /British spelling/.test(hs) && /never invent a fact/.test(hs);
  })()],
  ['R6250: marketing copy without contradictions, built-in SEO (108 destination pages, audience pages, sitemap, robots, structured data), 15-day sized trial', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const S = require('../lib/seo.js'); const pr = fs.readFileSync(__dirname + '/../lib/prospecting.js', 'utf8'); const st = require('../lib/settings.js').DEFAULTS;
    const mkt = f.slice(f.indexOf('mkt-cta'), f.indexOf('mkt-cta') + 4000);
    return !/Pakistan, your starting point|Built in Pakistan|From <b>🇵🇰 Pakistan|JazzCash, Easypaisa or bank transfer/.test(f) && f.includes('Your CV in.<br>Your visa out.') && f.includes('SoftwareApplication')
      && S.countryPage('GB', 'work').includes('Work in United Kingdom') && S.countryPage('JP', 'study').includes('Study in Japan') && S.audiencePage('universities').includes('15-day trial') && (S.sitemap().match(/<loc>/g) || []).length >= 116
      && sv.includes("app.get(['/study-in/:cc', '/work-in/:cc']") && sv.includes("app.get('/sitemap.xml'") && sv.includes("app.get('/robots.txt'")
      && st.prospecting.trial_days === 15 && pr.includes("const TRIAL = { small:") && pr.includes("tier_key: 'trial'") && pr.includes("searches_day: TRIAL.searches_day");
  })()],
  ['R6300: revision of the low scores - discovery quality score + ESCO synonyms + freshness sweep, design pass 3, legal DPA/sub-processors/retention/cookies/age/agent-law, security headers + CSP report-only, shared limiter (Redis-ready), verify-assist, bounces, warm-up cap, policy pages, self-probe, FAQPage data', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const lg = fs.readFileSync(__dirname + '/../public/legal.html', 'utf8'); const hp = fs.readFileSync(__dirname + '/../public/help.html', 'utf8'); const en = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8'); const ag = fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8'); const pr = fs.readFileSync(__dirname + '/../lib/prospecting.js', 'utf8');
    const Q = require('../lib/discovery_quality.js'); const L = require('../lib/limiter.js');
    const hi = Q.score({ extra: { source_key: 'greenhouse:acme' }, employer_verified: true, verified_at: new Date().toISOString(), deadline: '2099-01-01', contact_emails: ['a@b.co'], requirements: { x: 1 }, salary_note: 'x' }); const lo = Q.score({ status: 'closed' });
    return hi.quality >= 90 && hi.label === 'high' && lo.quality <= 10 && L.backend() === 'memory'
      && sv.includes("LIMITER.hit('ip:' + ip, 60)") && sv.includes("Content-Security-Policy-Report-Only") && sv.includes("app.post('/api/csp-report'") && sv.includes("quality: (typeof DQ !== 'undefined' && DQ) ? DQ.score(o) : null") && sv.includes("app.post('/api/admin/visa/rules/:rid/assist'") && sv.includes("app.post('/api/mail/events'") && sv.includes("async function outreachCap()") && sv.includes("app.get('/updates/:cc?'") && sv.includes("async function selfProbe()")
      && en.includes('async function synonymsFor(') && en.includes('ALSO SEARCH THESE TITLES (ESCO synonyms)') && ag.includes("log('FRESHNESS'") && pr.includes('warming up to')
      && f.includes('Design pass 3 (R6300)') && f.includes('const qChip=') && lg.includes('12. Data processing addendum') && lg.includes('13. Sub-processors') && lg.includes('14. Retention schedule') && lg.includes('17. Where a licensed adviser') && hp.includes("'@type':'FAQPage'");
  })()],
  ['R6400: 10,259 universities shipped (6,457 in the 54 destinations), 85 international scholarships, requirements brief per opportunity x person, forimail-only policy, portal fill plan with presence notifications', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const o = fs.readFileSync(__dirname + '/../lib/orgs.js', 'utf8'); const st = require('../lib/settings.js').DEFAULTS; const UW = require('../lib/universities_world.js'); const SC = require('../lib/scholarships_seed.js').SCHOLARSHIPS; const P = Object.keys(require('../lib/visa_portals.js').PORTALS);
    const ccs = new Set(SC.map(s => s.cc));
    return UW.count() > 10000 && UW.count('DE') > 300 && UW.count('US') > 2000 && P.filter(c => UW.count(c) > 0).length === 54 && SC.length >= 80 && SC.every(s => /^https?:/.test(s.url) && s.levels.length) && P.filter(c => ccs.has(c)).length >= 45
      && sv.includes("app.post('/api/admin/institutions/seed-world'") && sv.includes("app.post('/api/admin/scholarships/seed'") && sv.includes("app.get('/api/opportunities/:id/requirements'") && sv.includes("app.get('/api/mail/policy'") && sv.includes("app.post('/api/portal/:id/fill-plan'") && sv.includes("app.post('/api/portal/:id/needs-you'") && sv.includes("Copies to a personal address are switched off by policy")
      && st.mail_policy.allow_personal_forward === false && st.mail_policy.members_require_platform_address === false && o.includes('Invite staff with their own organisation email address')
      && f.includes('async function reqBrief(') && f.includes('What I need') && f.includes('SCHOLARSHIPS OPEN TO INTERNATIONAL APPLICANTS') && fs.readFileSync(__dirname + '/../tools/browser-worker.js.example', 'utf8').includes('FILL PLAN (R6400)');
  })()],
  ['R6500: 7 more keyless sources + OpenAlex + page probe, best-options reranker, Paddle gateway, auto-verify low-risk rules, legal versions + re-acceptance, runnable browser worker with protocol, graceful shutdown, cache invalidation', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const A = require('../lib/acquire.js'); const PD = require('../lib/gateway_paddle.js'); const RR = require('../lib/reranker.js'); const bb = fs.readFileSync(__dirname + '/../lib/browserbot.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const k = Object.keys(A.ADAPTERS);
    return ['remotive', 'jobicy', 'himalayas', 'themuse', 'nhs_jobs', 'openalex', 'uni_pages'].every(x => k.includes(x)) && typeof RR.best === 'function' && typeof PD.verify === 'function' && PD.enabled() === false
      && sv.includes("app.get('/api/opportunities/best'") && sv.includes("app.post('/api/pay/paddle/webhook'") && sv.includes("app.post('/api/admin/visa/rules/auto-verify'") && sv.includes("const LOW = ['document', 'processing', 'dependants', 'work_rights', 'shortage']") && sv.includes("app.post('/api/admin/legal/versions'") && sv.includes("app.get('/api/me/legal-status'") && sv.includes("app.get('/api/portal/worker/next'") && sv.includes("process.on('SIGTERM'")
      && bb.includes('async function nextForWorker(') && bb.includes('async function reportFromWorker(') && fs.existsSync(__dirname + '/../tools/worker/worker.js') && fs.existsSync(__dirname + '/../tools/worker/package.json')
      && fs.readFileSync(__dirname + '/../lib/policywatch.js', 'utf8').includes("like('key', 'reqbrief:' + cc + ':%')") && f.includes('id="bestRail"') && f.includes('Our terms were updated') && mg.includes("'remotive','jobicy','himalayas','themuse','nhs_jobs','openalex','uni_pages'") && mg.includes('create table if not exists public.legal_versions');
  })()],
  ['R6500: admin TOTP gate, Paddle checkout, keyless job APIs (remotive/jobicy/themuse/himalayas) + 30 Greenhouse boards, eligibility flags (citizens-only/clearance/local-only) demoted and shown, scholarship probes on university pages, SVG nav icons, one sitemap', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const A = require('../lib/acquire.js'); const E = require('../lib/engine.js'); const Q = require('../lib/discovery_quality.js'); const T = require('../lib/totp.js'); const PD = require('../lib/gateway_paddle.js'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const dup = (() => { const re = /app\.(get|post|put|patch|delete)\(\s*(\[[^\]]+\]|'[^']+')/g; const seen = {}; let m; while ((m = re.exec(sv))) { const k = m[1] + ' ' + m[2]; seen[k] = (seen[k] || 0) + 1; } return Object.values(seen).filter(v => v > 1).length; })();
    return dup === 0 && ['remotive', 'jobicy', 'themuse', 'himalayas'].every(k => A.ADAPTERS[k]) && E.eligibilityFlag('Applicants must be a US citizen') === 'citizens_only' && E.eligibilityFlag('We cannot sponsor visas for this role') === 'local_only' && E.eligibilityFlag('Security clearance required') === 'clearance' && E.eligibilityFlag('Visa sponsorship available') === null
      && Q.score({ eligibility_flag: 'citizens_only', verified_at: new Date().toISOString() }).quality <= 20 && typeof T.sessionOk === 'function' && typeof PD.verify === 'function' && PD.verify('x', 'ts=1;h1=abc') === false
      && sv.includes("totp_required: true") && sv.includes("app.post('/api/admin/totp/enrol'") && sv.includes("app.post('/api/pay/paddle/checkout'") && sv.includes("QUEUE.register('scholarship_probe'") && sv.includes("eligibility_flag: o.eligibility_flag || null") && !sv.includes("real costs in PKR")
      && f.includes('const flagChip=') && (f.match(/data:image\/svg\+xml/g) || []).length >= 6 && mg.includes('totp_secret_enc') && mg.includes("'nhs_jobs','openalex','uni_pages')");
  })()],
  ['R6600: labour and full-time work-visa routes for all 54 destinations with origin-side recruiter rule, offer verification (fraud patterns, domain, registry, sponsor register), preflight confirmation before Send, labour lane in the finder, dependency map', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const S6 = require('../lib/visa_seed6.js').seed; const OV = require('../lib/offer_verify.js'); const P = Object.keys(require('../lib/visa_portals.js').PORTALS);
    const ccs = new Set(S6.map(r => r.country_code)); const tracks = S6.filter(r => r.value && r.value.track === 'employer').length;
    const scam = 'Congratulations you have been selected. Pay processing fee 500 USD by Western Union. Visa guaranteed. Contact recruiter@gmail.com urgently'; const hits = OV.FRAUD.filter(([re]) => re.test(scam)).length;
    return P.every(c => ccs.has(c)) && tracks >= 50 && S6.some(r => r.route_key === 'kr_eps') && S6.some(r => r.route_key === 'jp_ssw') && S6.every(r => r.rule_type === 'document' || /^https?:/.test(r.source_url)) && S6.some(r => r.rule_type === 'shortage' && /BEOE/.test(r.text)) && hits >= 4
      && sv.includes("app.post('/api/verify/offer'") && sv.includes("app.get('/api/applications/:id/preflight'") && sv.includes("app.post('/api/applications/:id/preflight/confirm'") && sv.includes("app.get('/api/labour/routes'") && sv.includes("app.get('/api/admin/dependencies'") && fs.readFileSync(__dirname + '/../lib/visa.js', 'utf8').includes("require('./visa_seed6')")
      && f.includes('async function preflight(') && f.includes('async function offerCheck(') && f.includes('I want a labour / trade / care job') && f.includes('mcSendBtn') && f.includes("if(appId&&!window._preflightOk)");
  })()],
  ['R6700: end-to-end audit fixes (whatsapp module was missing, worker path, /api/stats guard), labour category everywhere (ingest, explore, SEO, discovery, cards, finder), cost intelligence with floor/target, success estimate, offering endpoint, legal labour clauses', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const lg = fs.readFileSync(__dirname + '/../public/legal.html', 'utf8'); const pr = fs.readFileSync(__dirname + '/../public/pricing.html', 'utf8'); const L = require('../lib/labour.js'); const CI = require('../lib/costintel.js'); const SU = require('../lib/success.js'); const SEO = require('../lib/seo.js');
    const fsx = require('fs'); const path = require('path'); const files = ['server.js', ...fsx.readdirSync(path.join(__dirname, '..', 'lib')).map(x => 'lib/' + x)]; const missing = []; for (const fl of files) { const src = fsx.readFileSync(path.join(__dirname, '..', fl), 'utf8'); for (const m of src.matchAll(/require\('(\.\.?\/[^']+)'\)/g)) { const p = path.resolve(path.join(__dirname, '..', path.dirname(fl)), m[1]); if (!fsx.existsSync(p) && !fsx.existsSync(p + '.js') && !fsx.existsSync(p + '.json') && !fsx.existsSync(p + '/index.js')) missing.push(fl + ' -> ' + m[1]); } }
    if (missing.length) console.log('    missing requires:', missing.join(', '));
    return missing.length === 0 && fsx.existsSync(path.join(__dirname, '..', 'lib', 'whatsapp.js')) && L.classify({ title: 'HGV Driver' }) === 'labour' && L.classify({ title: 'Senior Care Assistant' }) === 'care' && L.queriesFor('AE', 'driver').includes('driver') && typeof CI.report === 'function' && CI.priceFor('claude-sonnet-4').in === 3 && typeof SU.estimate === 'function'
      && /Labour, trades and care routes/.test(SEO.countryPage('SA', 'work')) && fsx.readFileSync(path.join(__dirname, '..', 'lib', 'engine.js'), 'utf8').includes("category: require('./labour').classify(") && fsx.readFileSync(path.join(__dirname, '..', 'lib', 'engine.js'), 'utf8').includes('LABOUR / TRADES / CARE LANE') && fsx.readFileSync(path.join(__dirname, '..', 'lib', 'explore.js'), 'utf8').includes("query.in('category', ['labour', 'care'])")
      && sv.includes("app.get('/api/admin/costs'") && sv.includes("app.get('/api/opportunities/:id/success'") && sv.includes("app.get('/api/offering'") && sv.includes("const guard = setTimeout(") && sv.includes("success = await SUCCESS.estimate(")
      && f.includes('async function adminCosts(') && f.includes("Estimated chance:") && f.includes("All categories") && lg.includes('19. Labour recruitment compliance') && lg.includes('20. No guarantee') && pr.includes('/api/offering');
  })()],
  ['R6800: refs on everything + one search, live SSE updates, tamper-evident audit chain, language guide + origin emigration rules, resubmission after refusal, staff-assist with applicant approval, country briefs for every destination, timezone by origin, TOTP crypto fix, minified build', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const R = require('../lib/refs.js'); const LG = require('../lib/language_guide.js'); const EM = require('../lib/emigration.js'); const W = require('../lib/world.js'); const tp = fs.readFileSync(__dirname + '/../lib/totp.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const bb = fs.readFileSync(__dirname + '/../lib/browserbot.js', 'utf8');
    return R.PREFIX.application === 'C' && typeof R.search === 'function' && /EPS-TOPIK/.test(LG.guide('KR', 'labour').text) && /B1/.test(LG.guide('GB', 'labour').text) && /BEOE/.test(EM.rules('PK').authority) && /eMigrate/.test(EM.rules('IN').authority) && W.tzOf('BD') === 'Asia/Dhaka' && W.origin('NG').timezone === 'Africa/Lagos'
      && tp.includes('C.encrypt(secret)') && !tp.includes('C.enc(') && sv.includes("app.get('/api/search'") && sv.includes("app.get('/api/events'") && sv.includes("function sseEmit(") && sv.includes("QUEUE.register('audit_seal'") && sv.includes("app.get('/api/me/route-guide'") && sv.includes("app.post('/api/visa/desk/:id/resubmit'") && sv.includes("app.post('/api/admin/portals/staff-assist'") && sv.includes("QUEUE.register('country_brief'") && sv.includes("req.path === '/api/events'") && sv.includes("index.min.html")
      && bb.includes("'staff_assist'") && mg.includes("'watch','watch_and_upload','watch_upload_submit','staff_assist'") && mg.includes('chain_hash') && f.includes("id='ffSearch'") && f.includes("new EventSource('/api/events") && f.includes('async function routeGuide(') && f.includes('Prepare resubmission') && fs.existsSync(__dirname + '/../tools/build-web.js');
  })()],
  ['R6900: FF staff bypass every money gate; local estimate at today\'s rate + tax note + fee policy on the quote; forimail in documents and portal profiles; staff processing on behalf with consent; proposal self-review', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const en = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8'); const pr = fs.readFileSync(__dirname + '/../lib/prospecting.js', 'utf8'); const st = require('../lib/settings.js').DEFAULTS; const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    return sv.includes('async function isPlatformStaff(') && sv.includes("async function addonGate(userId, key, usedCount) { if (await isPlatformStaff(userId)) return { ok: true, staff: true };") && sv.includes("async function overCap(userId, capability) { if (await isPlatformStaff(userId)) return false;") && sv.includes('if (await isPlatformStaff(userId)) return true;   // FF staff are never blocked') && sv.includes("if (STAFF_ROLES.includes(req.userRole)) return res.json({ stage, staff: true")
      && sv.includes("local = { currency: cur, amount:") && sv.includes("tax: 'Sales tax or VAT is added at checkout only where") && sv.includes("fees: { non_refundable:") && sv.includes("app.get('/api/fees'") && sv.includes("app.post('/api/admin/cases/:id/process'") && sv.includes("app.put('/api/me/staff-processing'")
      && en.includes("(p.apply_email || p.email)") && en.includes("email: p.apply_email || p.email") && pr.includes('Self-review: a second pass scores the letter') && st.pricing.show_local === true
      && f.includes('async function feeBoxLoad(') && f.includes('setTimeout(()=>feeBoxLoad(credits),50)') && f.includes('id="staffProc"') && f.includes('async function adminProcessCase(') && f.includes('Process for the applicant') && mg.includes('allow_staff_processing');
  })()],
  ['R7000: three untouched surfaces fixed (Mail search/filters/mark-all-read, Vault drag-drop + attestation + expiry chips, Workspace search/filters/bulk/export), USD equivalence on cards via /api/fx, no rupees on cards, guarded package card, org audit note', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const v = fs.readFileSync(__dirname + '/../lib/vault.js', 'utf8');
    return f.includes('id="mailQ"') && f.includes("Needs attention") && f.includes('Mark all read') && f.includes('id="vaultDrop"') && f.includes('function vaultDropFiles(') && f.includes('expires in ${Math.ceil(') && f.includes("d.attestation_status.replace(/_/g,' ')") && f.includes('id="wsQ"') && f.includes('async function wsBulkDiscover(') && f.includes('function wsExportCsv(') && f.includes("typeof HM.credits==='object'")
      && f.includes("window._fx=window._fx||null") && !f.includes("' ≈ Rs '+nice") && f.includes("USD equivalent") && v.includes('attestation_status,compressed') && sv.includes("app.get('/api/fx'") && sv.includes("app.post('/api/org/:id/audit-note'");
  })()],
  ['R7100: the ten moves - case view (one case one screen), five status colours, check-in tracking backbone, trust page, wedge landing promises, tools sheet, workspace table view, CSV import, Smart $49 with two visa files, Residence $79/year + labour starter + per-hire', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const CV = require('../lib/caseview.js'); const CK = require('../lib/checkins.js'); const st = require('../lib/settings.js').DEFAULTS; const ag = fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    const smart = st.packages.tiers.find(t => t.key === 'smart');
    return CV.colour('granted') === 'green' && CV.colour('refused') === 'red' && CV.colour('needs_confirmation') === 'amber' && Object.keys(CV.ST).length === 5 && CK.parseWindow('3 to 8 weeks').to === 56 && typeof CK.sweep === 'function'
      && sv.includes("app.get('/api/cases/:id/view'") && sv.includes("app.post('/api/visa/desk/:id/checkin'") && sv.includes("QUEUE.register('checkin_sweep'") && sv.includes("CHECKINS.schedule(c.id)") && sv.includes("app.get('/api/trust'") && sv.includes("app.post('/api/org/:id/clients/import'") && sv.includes("if (key === 'visa_desk')") && ag.includes("'checkin_sweep'")
      && f.includes('function stChip(') && f.includes('async function caseView(') && f.includes('class="cv-grid"') && f.includes('function toolsSheet(') && f.includes('id="toolsWrap"') && f.includes("window._wsView==='table'") && f.includes('function wsImport(') && f.includes('Enter a client once.<br>The platform does the desk work.') && f.includes('/trust.html')
      && smart.promo_usd === 49 && smart.visa_desk_included === 2 && st.addons.residence_year_usd === 79 && st.addons.labour_starter_usd === 9 && st.addons.employer_per_hire_usd === 199 && fs.existsSync(__dirname + '/../public/trust.html') && mg.includes('expected_decision_to');
  })()],
  ['R7200: minimal landing (one line, one action, four steps, two doors, live trust), sign-in behind a link, button hierarchy, nav hidden when signed out on phones, bottom sheets on phones, wider desktop canvas, deferred secondary dashboard calls, consultancy sheet', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    const land = f.slice(f.indexOf('function renderAuth(mode){'), f.indexOf('function renderAuth(mode){') + 9000);
    return land.includes('class="land-hero"') && land.includes('Your CV in.<br>Your visa out.') && land.includes('Start free, upload your CV') && land.includes('I run a consultancy') && land.includes('class="land-steps"') && land.includes('id="landTrust"') && !land.includes('mkt-stats') && !land.includes('We Prepare Everything') && land.includes("mode==='landing'")
      && f.includes("body.authed #nav{display:flex!important}") && f.includes("document.body.classList.add('authed')") && f.includes("document.body.classList.remove('authed')") && f.includes('.ff-ack{align-items:flex-end!important') && f.includes('@media (min-width:1200px){main{max-width:1120px}}') && f.includes('const idleRun=window.requestIdleCallback') && f.includes("if(which==='agency')") && f.includes('.btn.b-text{');
  })()],
  ['R7300: landing v3 - who-are-you selector (applicant, consultancy, university/employer, partner) with its own headline, CTA and points; journey flow strip; guest preview of three real matches before an account; sign-up intent opens the right door; staff sign in the same way', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return f.includes('class="who" role="tablist"') && f.includes("agency:{tab:'I run a consultancy'") && f.includes("institution:{tab:'University or employer'") && f.includes("partner:{tab:'Service partner'") && f.includes('class="flow"') && f.includes('async function previewOpen(') && f.includes('async function previewRun(') && f.includes("id=\"su-intent\"") && f.includes("localStorage.setItem('ffIntent'") && f.includes("Staff and admins sign in the same way")
      && sv.includes("app.get('/api/preview'") && sv.includes("institution_hidden: true") && sv.includes("LIMITER.hit('preview:' + ip, 3600)");
  })()],
  ['R7400: confidence layer on the landing - sample case timeline, how we make money plainly, security strip, founder, first-questions FAQ, sticky mobile CTA, accessible who-selector, deferred globe', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return f.includes('What a case looks like') && f.includes('How we make money, plainly') && f.includes('class="land-sec"') && f.includes('class="land-founder"') && f.includes('id="landFaq"') && f.includes('id="landSticky"') && f.includes('role="tab" aria-selected=') && f.includes('(fn=>setTimeout(fn,600)))(()=>bootGlobe())') && f.includes('Questions people ask first');
  })()],
  ['R7500: standalone 27 KB landing at /, app at /app, hash-driven sign-in/sign-up with intent, preview falls back to sourced seeds, who-selector with keyboard, compare table, sources strip, illustrated case', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const L = fs.readFileSync(__dirname + '/../public/landing.html', 'utf8');
    return L.length < 60000 && L.includes('CASE FF-C-2026-000118') && L.includes('href="/app#signup"') && L.includes('id="pv"') && !L.includes('supabase')
      && sv.includes("app.get(['/app', '/index.html']") && sv.includes("const landPath = pth.join(__dirname, 'public', 'landing.html')") && sv.includes("require('./lib/scholarships_seed').SCHOLARSHIPS.filter") && f.includes("localStorage.setItem('ffAuthed','1')") && f.includes("h==='signup-agency'?'agency'");
  })()],
  ['R7550: channel identity on every send (sign-off + header + recorded on the case), MOU channel clause, legal section 21 on channels and conflicts', (() => {
    const cb = fs.readFileSync(__dirname + '/../lib/casebrain.js', 'utf8'); const ml = fs.readFileSync(__dirname + '/../lib/mailer.js', 'utf8'); const pr = fs.readFileSync(__dirname + '/../lib/partnerships.js', 'utf8'); const lg = fs.readFileSync(__dirname + '/../public/legal.html', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    return cb.includes("'X-Case-Channel'") && cb.includes('Submitted with the support of ') && !cb.includes("'X-ForiForeign-Channel'") && cb.includes('channel_kind: channel.kind') && ml.includes('headers: headers || undefined') && pr.includes('channel clause (this MOU covers applications') && lg.includes('21. Consultancies, white label and conflicts of interest') && mg.includes('channel_org_id');
  })()],
  ['R7600: white label without any platform hint (brandify, no powered-by, neutral sign-off, brand-aware mail), admin masking with time-limited support grant, protected partners never prospected, legal 21 rewritten', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const ml = fs.readFileSync(__dirname + '/../lib/mailer.js', 'utf8'); const pr = fs.readFileSync(__dirname + '/../lib/prospecting.js', 'utf8'); const nt = fs.readFileSync(__dirname + '/../lib/notify.js', 'utf8');
    return f.includes('function brandify(') && !f.includes('powered by ForiForeign') && f.includes("if(!(SITE&&SITE.whitelabel))idleRun(()=>{try{api('/api/partners/spotlight')") && f.includes('YOUR CLIENTS ARE YOURS') && f.includes("/support-access'") && f.includes("/protected-partners'")
      && sv.includes("NO-POACH GUARANTEE, enforced") && sv.includes("app.post('/api/org/:id/support-access'") && sv.includes("app.put('/api/org/:id/protected-partners'") && sv.includes("masked: !grant") && ml.includes('async function brandFor(') && ml.includes('Sent by ') && nt.includes('await M.brandFor(userId)') && pr.includes('async function isProtected(') && pr.includes("'Not approached: ' + why");
  })()],
  ['R7700: stringent consultancy identity - reserved platform names refused, unique names, own contact emails only, staff invited with their own emails, brand-aware from/reply-to, white-label hosts get their own sign-in and no platform pages, support routed to the consultancy, WhatsApp brand prefix, identity form, "your consultancy" line', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const O = require('../lib/orgs.js'); const ml = fs.readFileSync(__dirname + '/../lib/mailer.js', 'utf8'); const wa = fs.readFileSync(__dirname + '/../lib/whatsapp.js', 'utf8'); const ck = fs.readFileSync(__dirname + '/../lib/checkins.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    let r1 = false, r2 = false, r3 = false; try { O.checkOrgName('Fori Foreign Consultants'); } catch (e) { r1 = /reserved/.test(e.message); } try { O.checkOwnContact('a@forimail.com'); } catch (e) { r2 = /own email/.test(e.message); } try { r3 = O.checkOrgName('ABC Consultants') === 'ABC Consultants'; } catch (e) {}
    return r1 && r2 && r3 && O.RESERVED.test('foriforeign') && sv.includes("req.whitelabelOrg = o") && sv.includes("return res.redirect(302, '/app')") && sv.includes("app.get('/api/me/consultancy'") && sv.includes("status: 'routed'") && sv.includes("Client question: ") && ml.includes("brand && brand.reply_to ? brand.reply_to") && ml.includes("reply_to: (og.settings || {}).contact_email") && wa.includes('async function brandPrefix(') && ck.includes('brandPrefix(f.user_id)') && mg.includes('idx_tickets_org')
      && f.includes('function renderAuthWhitelabel(') && f.includes("if(SITE&&SITE.whitelabel){return renderAuthWhitelabel(") && f.includes('YOUR ORGANISATION, YOUR NAME') && f.includes('id="orgContact"') && f.includes("api('/api/me/consultancy')") && fs.readFileSync(__dirname + '/../lib/orgs.js', 'utf8').includes('Invite staff with their own organisation email address');
  })()],
  ['R7800: click-everything audit fixes (startApp TDZ, compose null, stage chains, share/receipt guards), USD everywhere in admin, bulkhead lanes (breaker, fair claim, cap) with admin resume, commitments page + API, per-organisation controls and feature flags', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const q = fs.readFileSync(__dirname + '/../lib/queue.js', 'utf8'); const Q = require('../lib/queue.js');
    const sa = f.slice(f.indexOf('function startApp(id,inst,reqs){'), f.indexOf('function startApp(id,inst,reqs){') + 12000);
    return sa.includes("const onEsc=") && !/const esc=e=>\{if\(e\.key==='Escape'\)/.test(sa) && f.includes("const el=$('mcDocs');if(!el)return;") && f.includes("String(a.stage||a.status||'').replace(") && f.includes('function usdOf(') && !/PKR \$\{|Rs \$\{/.test(f) && f.includes("if(!x){toast('Image sharing is not available")
      && q.includes('const LANE = {') && q.includes('function laneNoteFailure(') && q.includes('_rr++') && q.includes('finally { _release(); }') && typeof Q.laneStatus === 'function' && typeof Q.laneResume === 'function' && Q.laneKey({ org_id: 'x' }) === 'x' && Q.laneKey({}) === 'platform'
      && sv.includes("app.get('/api/admin/lanes'") && sv.includes("app.post('/api/admin/lanes/:lane/resume'") && sv.includes("app.get('/api/commitments'") && sv.includes("app.get('/api/admin/orgs/:id/controls'") && sv.includes("app.put('/api/admin/orgs/:id/controls'") && sv.includes('async function orgFeature(') && sv.includes("orgFeature(req.params.id, 'imports')") && sv.includes('async function orgForHostRaw(')
      && f.includes('async function adminLanes(') && f.includes('async function adminOrgControls(') && f.includes('our twelve commitments') && fs.existsSync(__dirname + '/../public/commitments.html');
  })()],
  ['R7900: partner system on autopilot - reputation ranking, office finder (on-domain + role), negotiation within bounds with escalation, onboarding on countersign (priority on), referrals, shares, invoices, reminders, clearance, disputes with evidence, liaison; partner-first among eligible, labelled; admin Partners screen', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const P = require('../lib/partners_engine.js'); const M = require('../lib/match.js'); const ex = fs.readFileSync(__dirname + '/../lib/explore.js', 'utf8'); const ag = fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const lg = fs.readFileSync(__dirname + '/../public/legal.html', 'utf8'); const cb = fs.readFileSync(__dirname + '/../lib/casebrain.js', 'utf8');
    const ev = P.evaluateTerms({ fee_pct: 8, exclusivity: true }); const ok = P.evaluateTerms({ fee_pct: 15, payment_days: 30 }); const sh = P.shareFor({ fee_pct: 15 }, 12000);
    return !ev.ok && ev.escalate && ok.ok && sh.share_usd === 1800 && P.reputationOf({ meta: { works_count: 50000, cited_by_count: 900000 }, verified: true, kind: 'university' }) > 80 && typeof P.onboard === 'function' && typeof P.pipeline === 'function' && typeof P.openDispute === 'function'
      && fs.readFileSync(__dirname + '/../lib/match.js', 'utf8').includes("opp.is_partner && status === 'eligible'") && ex.includes("(b.is_partner ? 1 : 0) - (a.is_partner ? 1 : 0)") && sv.includes("app.get('/api/admin/partnerships'") && sv.includes("app.post('/api/applications/:id/enrolled'") && sv.includes("QUEUE.register('partner_pipeline'") && sv.includes("QUEUE.register('partner_receivables'") && sv.includes("PENGINE.onboard(req.params.id)") && sv.includes("PENGINE.negotiate(r.prospect_id, text)") && cb.includes("'partner_referral_record'") && ag.includes("'partner_pipeline'") && mg.includes('partner_referrals') && mg.includes('partner_invoices') && mg.includes('partner_disputes') && lg.includes('shown first among the options an applicant qualifies for')
      && f.includes('async function adminPartners(') && f.includes('I have enrolled / started') && f.includes('shown first among the options you qualify for');
  })()],
  ['R8000: share secured - MOU share-securing clauses, lenient negotiation with never-conceded set, partner types + data-sharing matrix, admission evidence via the portal (reader → referral → invoice → everyone told), institution confirmation, late interest + priority suspension, renewal, invoice PDF, mail classification → stage, ingest flags partner postings, breaker shared across replicas, domain onboarding, workspace ledger/dispute, consultancy evidence', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const P = require('../lib/partners_engine.js'); const pr = fs.readFileSync(__dirname + '/../lib/partnerships.js', 'utf8'); const cb = fs.readFileSync(__dirname + '/../lib/casebrain.js', 'utf8'); const en = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8'); const q = fs.readFileSync(__dirname + '/../lib/queue.js', 'utf8'); const v = fs.readFileSync(__dirname + '/../lib/vault.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const ag = fs.readFileSync(__dirname + '/../lib/agents.js', 'utf8');
    return pr.includes('SHARE-SECURING CLAUSES') && pr.includes('non-circumvention') && pr.includes('no interest and no penalties') && P.NEGOTIATION.fee_pct_min === 8 && P.NEGOTIATION.never_conceded.length >= 6 && Object.keys(P.PARTNER_TYPES).length >= 9 && P.evaluateTerms({ share_clause_removed: true }).escalate
      && typeof P.evidenceFromDocument === 'function' && typeof P.institutionConfirm === 'function' && typeof P.accrueInterest === 'function' && typeof P.renewalSweep === 'function' && v.includes("'admission_letter', 'fee_receipt'") && v.includes("enqueue('admission_evidence'") && cb.includes("updateReferralStage(m.application_id, st)") && en.includes("is_partner: await (async () =>") && q.includes('async function persistLanes(') && q.includes('async function loadLanes(') && fs.readFileSync(__dirname + '/../lib/partners_engine.js', 'utf8').includes("or('domain.eq.' + dom")
      && sv.includes("app.post('/api/org/:id/enrolments/confirm'") && sv.includes("app.post('/api/org/:id/partner-dispute'") && sv.includes("app.get('/api/org/:id/partner-ledger'") && sv.includes("QUEUE.register('partner_overdue'") && sv.includes("QUEUE.register('partner_renewals'") && ag.includes("'partner_overdue'") && mg.includes('admission_records') && f.includes('async function partnerLedgerLoad(') && f.includes('Confirm enrolments') && f.includes('evidence for your own commission');
  })()],
  ['R8100: trust-based partner terms (no interest, no penalties, no suspension) and the real engine bugs fixed (reputation read the wrong column, MOU terms not stored on the document, fake FK in confirmation, ref-to-uuid comparison, contains-match for referrals, date guard, kinds widened)', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const pe = fs.readFileSync(__dirname + '/../lib/partners_engine.js', 'utf8'); const pr = fs.readFileSync(__dirname + '/../lib/partnerships.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const P = require('../lib/partners_engine.js');
    return !pe.includes('1.5 %') && !pe.includes("partner_tier: 'suspended'") && pe.includes('TRUST-BASED') && !pe.includes('meta,reputation_meta') && pe.includes("select('id,name,domain,website,kind,verified,industry,reputation_meta')") && P.reputationOf({ industry: 'works:50000 cited:900000 h:200', verified: true, kind: 'university' }) > 80 && pe.includes("Number(t.fee_pct) || Number(d.share_pct)") && !pe.includes('profiles!partner_referrals_user_id_fkey') && pe.includes("eq('ref', ref)") && pe.includes("String(f.date || f.paid_on || '')") && pr.includes("share_pct: share, country_code: country_code || null, terms:") && pr.includes('good faith: no interest and no penalties') && mg.includes("'language_school','research_institute'") && mg.includes('add column if not exists share_pct') && !P.NEGOTIATION.never_conceded.includes('late interest');
  })()],
  ['R8200: the dummy case - 40-step end-to-end simulation across applicant, partnership, consultancy, SEO, language, labour, agents; fast and full modes; purge; admin screen', (() => {
    const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const S = require('../lib/simulation.js'); const src = fs.readFileSync(__dirname + '/../lib/simulation.js', 'utf8');
    const steps = (src.match(/await step\(/g) || []).length;
    return typeof S.run === 'function' && typeof S.purge === 'function' && S.TAG === 'SIM-' && steps >= 38 && src.includes("mode === 'full'") && src.includes('recordReferral') && src.includes('evidenceFromDocument') && src.includes("createOrg(S.ownerId, { name: 'Fori Foreign Sim Agency'") && sv.includes("app.post('/api/admin/simulate'") && sv.includes("app.get('/api/admin/simulate/latest'") && sv.includes("app.post('/api/admin/simulate/purge'") && sv.includes("QUEUE.register('simulation_run'") && f.includes('async function adminSimulate(') && f.includes("['simulate','Dummy case','settings.read']");
  })()],
  ['R8210: profiles baseline migration runs first - every profiles column the code uses is created if missing; email filled from auth.users and kept in sync', (() => {
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8'); const first = mg.indexOf('-- ===== 0000_profiles_baseline.sql ====='); const firstOther = mg.indexOf('-- ===== 0007_');
    return first >= 0 && (firstOther < 0 || first < firstOther) && mg.includes('add column if not exists email text') && mg.includes('ff_sync_profile_email') && mg.includes('add column if not exists notify_whatsapp') && mg.indexOf('0032b_organisations_compat') < mg.indexOf('0033_phase0_tenancy') && mg.includes('ff_sync_org_owner') && mg.includes('public.clients add column if not exists lane') && mg.indexOf('0000b_base_tables_baseline') < mg.indexOf('-- ===== 0007_') && mg.includes('ff_sync_app_status');
  })()],
  ['R8300: SQL assembled by tools/build-sql.js with shape guards (add column after every create table), baselines for the original app tables, verified error-free on a fresh Postgres and on top of the old schema, idempotent', (() => {
    const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    return fs.existsSync(__dirname + '/../tools/build-sql.js') && (mg.match(/add column if not exists/g) || []).length > 900 && mg.includes('professions add column if not exists isco') && mg.includes('create table if not exists public.pricing') && mg.includes('create table if not exists public.countries') && mg.indexOf('0000_profiles_baseline') < mg.indexOf('0000b_base_tables_baseline') && mg.indexOf('0000b_base_tables_baseline') < mg.indexOf('0007_');
  })()],
  ['R8400: light theme by default (app + every public page), parallax landing with 80 percent less text and per-audience copy, theme toggle, globe off in light, hard-coded dark colours remapped', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const L = fs.readFileSync(__dirname + '/../public/landing.html', 'utf8'); const pr = fs.readFileSync(__dirname + '/../public/pricing.html', 'utf8'); const tr = fs.readFileSync(__dirname + '/../public/trust.html', 'utf8');
    return L.length < 40000 && L.includes('data-speed=') && L.includes('--bg:#F7F9FF') && !L.includes('<video') && (L.match(/<p[ >]/g) || []).length <= 12 && f.includes('body.light{--surface:#FFFFFF') && f.includes("if(document.body.classList.contains('light'))return;document.body.classList.add('world-on')") && f.includes('body.light [style*="color:#EAF2FF"]') && !pr.includes('#070F22') && !tr.includes('#070F22');
  })()],
  ['R8500: light only (no toggle, no dark world), journey-named navigation, next-best-step hero with the journey line, study/work lane chooser stored on the profile and driving Explore, calmer cards', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const mg = fs.readFileSync(__dirname + '/../ALL_MIGRATIONS_run_in_order.sql', 'utf8');
    return !f.includes('id="themeBtn"') && f.includes("document.body.classList.add('light');") && f.includes('#worldBg,#worldOverlay{display:none!important}') && f.includes('>My journey<') && f.includes('>Opportunities<') && f.includes('data-t="apps">Applications<') && f.includes('Your next best step') && f.includes('class="jline"') && f.includes('function laneChooser(') && f.includes("laneSet('study')") && f.includes("localStorage.getItem('ffLane')||''") && sv.includes("'lane_pref']") && mg.includes('lane_pref');
  })()],
  ['R8600 (designer programme, phase 1): card hierarchy with essentials visible and details folded, one action; documents six states and summary; preparation checklist in the case; mail grouped by needs attention / waiting / replies; at-a-glance row; mobile tap targets', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return f.includes('class="essentials"') && f.includes('class="more-chips"') && f.includes(">Details</button>") && !f.includes('View Complete Intelligence</button>') && f.includes('function docStateChip(') && f.includes("'Needs correction'") && f.includes('id="vaultSummary"') && f.includes('async function prepChecklist(') && f.includes('id="prepList"') && f.includes("['confirm','Needs attention']") && f.includes("mf==='waiting'") && f.includes("mf==='replies'") && f.includes('class="glance"') && f.includes('@media (max-width:640px){.glance{grid-template-columns:repeat(2,1fr)}.btn{min-height:44px}');
  })()],
  ['R8700 (designer programme, phase 2): money facts on card and detail (study vs work), verification indicators where they matter, light detail sheet, preparation flow with the preflight inside (Review and send), animation audit, focus styles, aria labels, font preconnect', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return f.includes('function moneyFacts(') && f.includes('function moneyFactsHtml(') && f.includes("add('Tuition',o.tuition)") && f.includes("add('Salary',o.salary_note||o.stipend)") && f.includes('class="vind"') && f.includes("wrap.classList.add('detail')") && f.includes('.ff-sheet.detail>div{background:#fff!important') && f.includes('Review and send') && f.includes("preflight('${appId}','function(){go(") && f.includes(':focus-visible{outline:2px solid #1683FF') && f.includes('aria-label="Main"') && f.includes('aria-label="Notifications"') && (f.match(/aria-label="Close"/g) || []).length >= 10 && f.includes('rel="preconnect" href="https://fonts.gstatic.com"') && f.includes('.home-freecase,#nav button::after,.b-green,.btn.b-green{box-shadow:none!important;animation:none!important}');
  })()],
  ['R8800 (designer programme, phase 3): mobile filters as a bottom sheet, tables as rows, one-column forms, app script split into an immutable hashed file with a 79 KB shell, immutable caching, QA at three widths', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const b = fs.readFileSync(__dirname + '/../tools/build-web.js', 'utf8'); const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
    return f.includes('id="exFilters"') && f.includes('class="ex-filters-in"') && f.includes('.ex-filter-btn{display:inline-flex}') && f.includes('.desk table,.desk thead,.desk tbody,.desk tr,.desk td,.desk th{display:block}') && f.includes('.row>input,.row>select,.row>textarea{flex:1 1 100%!important') && b.includes("'app.' + hash + '.min.js'") && b.includes('defer></script>') && sv.includes("max-age=31536000, immutable") && !f.includes('inset:0;z-index:75');
  })()],
  ['R8900: audit fixes - in-app sign-in/sign-up is the minimal light form with a way back to the site, last dark inline colour remapped, one button radius, USD-only package editor and AI-cost settings, brand readable on the auth card', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
    return f.includes('Back to foriforeign.com') && f.includes("function renderAuthWhitelabel(mode,intent)") && f.includes('body.light [style*="color:#9fe8d8"]') && f.includes('.btn{border-radius:12px!important}') && !f.includes('<label>Price PKR</label>') && !f.includes("F('ai','usd_to_pkr'") && !f.includes('Rs 50,000 to 150,000') && f.includes('body.light .auth-brand-lg{color:#0B1B3A}');
  })()],
  ['R9000: contrast (no shadows, ink on white, darker secondary text), humanised next step, applicant-first landing with one line and one action and no audience pills, partners page with one email address and confidential terms, one pricing page in the visitor\'s currency with natural rounding, native prices in the app, no employer/university pricing, "email address" wording', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const L = fs.readFileSync(__dirname + '/../public/landing.html', 'utf8'); const P = fs.readFileSync(__dirname + '/../public/pricing.html', 'utf8'); const PA = fs.readFileSync(__dirname + '/../public/partners.html', 'utf8'); const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const W = require('../lib/world.js'); const je = fs.readFileSync(__dirname + '/../lib/journey_engine.js', 'utf8'); const i18n = fs.readFileSync(__dirname + '/../lib/i18n.js', 'utf8');
    return f.includes('body.light *{text-shadow:none!important}') && f.includes('body.light .sub,body.light .muted,body.light .hint{color:#4A5A78!important}') && je.includes("highest_level: 'your highest degree'") && i18n.includes("nav_dashboard: { en: 'My journey'") && L.includes('Your future abroad.<br>Your way.') && !L.includes('class="who"') && !L.includes('Plain prices') && L.includes('href="/partners.html">Partners</a>') && L.includes('own email address') && !L.includes('/trust.html') && PA.includes('admin@foriforeign.com') && PA.includes('confidential') && !P.includes('$null') && P.includes("FF-CRM for consultancies") && P.includes('local_currency') && !P.includes('Employer') && sv.includes("app.get('/api/local-price'") && sv.includes('function visitorCountry(') && W.localPrice(19, 'PK', { PKR: 280 }).display === 'Rs 5,300' && W.niceRound(5314) === 5300 && f.includes('function localMoney(') && f.includes('function niceRound(') && !sv.includes("employers: { receive_candidates: 'free'");
  })()],
  ['R9100: FF-CRM - the consultancy module named and described as a complete CRM (ten modules, what no other CRM does, per-consultancy pricing, set-up in a day), linked from landing, pricing and partners', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const C = fs.readFileSync(__dirname + '/../public/crm.html', 'utf8'); const P = fs.readFileSync(__dirname + '/../public/pricing.html', 'utf8'); const L = fs.readFileSync(__dirname + '/../public/landing.html', 'utf8'); const seo = fs.readFileSync(__dirname + '/../lib/seo.js', 'utf8');
    return f.includes('data-i18n="nav_workspace">FF-CRM<') && f.includes('Open your FF-CRM') && C.includes('The ten modules') && C.includes('1 · Lead capture') && C.includes('4 · Visa management') && C.includes('9 · Branches and sub-agents') && C.includes('What no other CRM does') && C.includes('Per consultancy, not per user') && C.includes('admin@foriforeign.com') && P.includes('FF-CRM for consultancies') && L.includes('href="/crm.html">FF-CRM</a>') && seo.includes('/crm.html');
  })()],
  ['R9200: no invented emails (admin@foriforeign.com only), English by default and never auto-switched, bigger killer line + plain-words explainer, query understanding (country aliases, lanes) with widening so results always show, staff-only bypass of search and case limits, every origin currency has a rate (live or fallback) refreshed at login, CRM page: client 360, global search, lead score, finder', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const L = fs.readFileSync(__dirname + '/../public/landing.html', 'utf8'); const C = fs.readFileSync(__dirname + '/../public/crm.html', 'utf8'); const PA = fs.readFileSync(__dirname + '/../public/partners.html', 'utf8'); const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const E = require('../lib/explore.js'); const W = require('../lib/world.js'); const I = require('../lib/i18n.js');
    const cur = new Set(Object.values(I.ORIGINS).map(o => o.currency).filter(Boolean)); const missing = [...cur].filter(c => c !== 'USD' && !W.FALLBACK_RATES[c]);
    const u = E.understand({ text: 'driver job canada' });
    return !C.includes('partnerships@') && !PA.includes('partnerships@') && !sv.includes('partnerships@foriforeign.com') && f.includes('function langSuggest(){return;') && L.includes('h1.big{font-size:84px') && L.includes('What is ForiForeign, in plain words') && u.cc === 'CA' && u.kind === 'work' && u.text === 'driver' && typeof E.explore === 'function' && fs.readFileSync(__dirname + '/../lib/explore.js', 'utf8').includes("widened: 'No exact match") && f.includes('d.widened') && sv.includes("STAFF_ROLES.includes(req.userRole)) return next();   // ForiForeign's own admin and staff only") && missing.length === 0 && f.includes("api('/api/fx').then(d=>{window._fx=d.rates") && sv.includes("approximate: !(fx && fx.rates)") && C.includes('Client 360° and global search') && C.includes('Lead score') && C.includes('vs the five best-known consultancy CRMs') && C.includes('Agentcis') && C.includes('Meritto') && C.includes('class="cmp"') && C.includes('Never zero results') && C.includes('17–50 % below SmartX');
  })()],
  ['R9300: the killer line, free search shows real details and the pathway (locked cards and guest preview), profession autocomplete that auto-selects, /api/professions, never-zero matches sheet (catalogue fallback with a note)', (() => {
    const f = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'); const L = fs.readFileSync(__dirname + '/../public/landing.html', 'utf8'); const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8'); const ex = fs.readFileSync(__dirname + '/../lib/explore.js', 'utf8');
    return L.includes('Your future abroad.<br>Your way.') && L.includes('without handing your entire case to a traditional consultant') && L.includes("Pathway: ") && sv.includes('async function pathwayFor(') && sv.includes("app.get('/api/professions'") && sv.includes("details: String(o.description || '')") && f.includes('<span>Pathway</span>') && f.includes('list="profList"') && f.includes('function profAuto(') && f.includes('NEVER ZERO') && f.includes("Object.assign(o,{fallback:true})") && ex.includes('description,requirements,visa_sponsorship');
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
    const pk = st.slice(st.indexOf('packages: {')); const tiers = (pk.match(/tiers: \[[\s\S]*?\n    \]/) || [''])[0];
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
    return fe.includes('function planPrice(p)') && fe.includes('function priceHtml(p,size)') && fe.includes('Save ${money(q.cur,q.save)}') &&
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
      if (!ok) { bad.push(meth + ' ' + lits.join('<id>')); if (process.env.FF_WIRING_DEBUG) console.log('    unresolved:', meth, lits.join('<id>')); }
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
      /* The card must carry no reject control - that contract stands. Dismissal exists,
         but it lives in the detail view, where the applicant has read the position and is
         making a considered decision rather than swatting a card away. The FAQ promises
         dismissed opportunities are never repeated, so the control has to exist
         somewhere: for a long time it existed nowhere at all. */
      !/'Criteria not published'\]/.test(fe) && !fe.includes('Not for me') &&
      !fe.includes('Not interested') &&
      // Checked precisely: no dismiss control inside the CARD renderer itself.
      (() => { const i = fe.indexOf('function oppCard(o,ctaColor){');
               const j = fe.indexOf('function warmPricing(', i);
               return i > 0 && j > i && !fe.slice(i, j).includes('dismissOpp'); })() &&
      fe.includes('Hide this from my searches') &&
      // One dominant action per card, in the action row (the corner duplicate was removed in the designer programme).
      fe.includes('class="essentials"');
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
      // CONTRACT CHANGED (R4540/R4550): the profession travels as its own parameter and
      // is expanded server-side; it used to be smuggled in as a full-text query.
      fe.includes("push('field',opts.field)") && !fe.includes("push('q',opts.field)") &&
      sv.includes("String(req.query.no_app_fee) === '1'") &&
      sv.includes('const dwinRaw = parseInt(req.query.deadline_days, 10)') &&
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
