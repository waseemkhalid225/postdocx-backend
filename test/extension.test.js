/* test/extension.test.js — validates the browser extension without a browser.
   Checks manifest correctness, permission minimalism, safety guarantees in the filler,
   DOM/script ordering in the popup, and that no secret or wildcard origin is used. */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'extension');
const read = f => fs.readFileSync(path.join(D, f), 'utf8');

const results = [];
const t = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail || '' });

// ---- manifest ----
const mf = JSON.parse(read('manifest.json'));
t('manifest v3', mf.manifest_version === 3);
t('has name and version', !!mf.name && /^\d+\.\d+\.\d+$/.test(mf.version || ''));
t('minimal permissions only', JSON.stringify((mf.permissions || []).sort()) === JSON.stringify(['activeTab', 'scripting', 'storage']));
t('no broad host permission (<all_urls> / https://*/*)',
  !(mf.host_permissions || []).some(h => h === '<all_urls>' || h === 'https://*/*'));
t('declares popup action', !!(mf.action && mf.action.default_popup));
t('service worker declared', !!(mf.background && mf.background.service_worker));
for (const f of [mf.background.service_worker, mf.action.default_popup].concat(
  (mf.content_scripts || []).flatMap(c => c.js || []))) {
  t('referenced file exists: ' + f, fs.existsSync(path.join(D, f)));
}
for (const k of Object.keys(mf.icons || {})) t('icon exists: ' + k, fs.existsSync(path.join(D, mf.icons[k])));

// ---- popup wiring (this caught a real dead-button bug) ----
const popup = read('popup.html');
t('popup script loads AFTER its controls exist',
  popup.indexOf('<script src="popup.js">') > popup.indexOf('id="ffFill"'));
const pjs = read('popup.js');
t('popup binds the fill button', pjs.includes("getElementById('ffFill')") && pjs.includes('addEventListener'));
t('popup injects the filler script', pjs.includes('executeScript') && pjs.includes("files: ['filler.js']"));

// ---- filler safety guarantees ----
const filler = read('filler.js');
const bg = read('background.js');
t('never auto-submits a form', !/\.submit\(\)/.test(filler) && !/type=["']?submit["']?\]\)\.click\(\)/.test(filler));
for (const secret of ['password', 'captcha', 'cvv', 'otp', 'iban', 'pin']) {
  t('skips sensitive field: ' + secret, new RegExp(secret, 'i').test(filler.match(/const SKIP =[^\n]*/)[0]));
}
t('file inputs are marked, not set programmatically', !/\.files\s*=/.test(filler));
t('reads profile from extension storage only', filler.includes('chrome.storage.local.get'));
t('handles a missing profile gracefully', /if \(!ffProfile\)/.test(filler));
t('fills licence number fields', /licen\[cs\]e\.\?\(no\|number\|id\)|license_number/.test(filler));

// ---- bridge / origin safety ----
const bridge = read('bridge.js');
t('bridge checks message origin', bridge.includes('e.origin !== location.origin') || bridge.includes('ev.origin'));
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
t('app never posts the profile with a wildcard origin', !app.includes("profile:d.profile},'*'"));
t('app pushes profile on assistant handshake', app.includes("api('/api/profile/assist')"));

// ---- portal autopilot: open the official site and fill it, lawfully ----
t('optional host permissions declared (per-site consent)',
  (mf.optional_host_permissions || []).includes('https://*/*'));
t('no broad host permission granted by default',
  !(mf.host_permissions || []).includes('https://*/*') && !(mf.host_permissions || []).includes('<all_urls>'));
t('worker requests permission before touching a portal', bg.includes('chrome.permissions.request'));
t('worker only accepts portal intents from foriforeign.com', /foriforeign\\?\.com/.test(bg));
t('worker opens the portal tab', bg.includes('chrome.tabs.create({ url }'));
t('worker injects the filler after page load', bg.includes('chrome.tabs.onUpdated') && bg.includes("files: ['filler.js']"));
t('pending-fill map is cleaned up on tab close', bg.includes('onRemoved'));
t('bridge relays the portal intent', read('bridge.js').includes('FF_OPEN_PORTAL'));
t('app has an assisted-portal handler with fallback',
  app.includes('openPortalAssisted') && app.includes("window.open(url,'_blank')"));
t('autopilot still never submits', !/\.submit\(\)/.test(filler));

// ---- autofill accuracy: never fill someone else's field, never guess identifiers ----
const NOT_MINE = new RegExp(filler.match(/const NOT_MINE = \/(.+?)\/i;/)[1], 'i');
const NEVER_GUESS = new RegExp(filler.match(/const NEVER_GUESS = \/(.+?)\/i;/)[1], 'i');
const thirdPartyCases = ['Referee Email', 'Supervisor Email', 'Employer Email', 'Emergency Contact Phone',
  'Company Address', 'Institution Address', 'Employer City', 'Next of Kin Address', 'Referee Phone'];
thirdPartyCases.forEach(l => t('third-party field guarded: ' + l, NOT_MINE.test(l)));
const identifierCases = ['Passport Number', 'Date of Birth', 'Issue Date', 'Expiry Date',
  'Application Number', 'National ID', 'CNIC'];
identifierCases.forEach(l => t('identifier never guessed: ' + l, NEVER_GUESS.test(l)));
t('own fields are still fillable (no over-blocking)',
  !NOT_MINE.test('Email Address') && !NOT_MINE.test('Mobile Number') && !NOT_MINE.test('Residential Address'));
t('confidence gates run before matching', filler.includes('const thirdParty = NOT_MINE.test(L)'));
t('unfilled fields explain WHY', filler.includes("'not your own detail'") && filler.includes("'needs your exact value'"));

// ---- loop / rate-limit safety ----
t('concurrency guard prevents double injection', filler.includes('__ffxRunning'));
t('per-page fill cap exists', filler.includes('__ffxFills') && /__ffxFills > \d+/.test(filler));
t('refill rate limiting in worker', bg.includes('_refills') && /rec\.n > \d+/.test(bg));
t('no continuous page scanning (no interval/observer)',
  !/setInterval|MutationObserver/.test(filler));

// ---- EMAIL MODE: draft + documents into the user's own compose window ----
const adapters = ['gmail', 'outlook', 'yahoo'];
adapters.forEach(name => {
  const a = read('adapters/' + name + '.js');
  t(name + ': waits for the compose window', a.includes('waitFor'));
  t(name + ': writes the FULL prepared body (no truncation)', a.includes('full.length > current.length'));
  t(name + ': fetches the prepared documents', a.includes('fetch(a.url'));
  t(name + ': attaches via DataTransfer drop', a.includes('DataTransfer') && a.includes('drop'));
  t(name + ': never presses Send', !/querySelector\([^)]*send[^)]*\)\.click\(\)/i.test(a));
  t(name + ': tells the user to review and send', /press Send yourself|press Send/.test(a));
  t(name + ': clears the pending package after use', a.includes("session.remove('ff_pending')"));
  t(name + ': registered as a content script',
    (mf.content_scripts || []).some(c => (c.js || []).includes('adapters/' + name + '.js')));
});
t('every provider offered in the popup has an adapter', (() => {
  const offered = [...popup.matchAll(/<option value="([a-z0-9]+)"/g)].map(m => m[1]);
  return offered.every(p => fs.existsSync(path.join(D, 'adapters', p + '.js')));
})());
t('compose URL carries only a short opening body (URL limits)', bg.includes('SHORT_BODY'));
t('package expiry is enforced before compose', bg.includes('pkg.exp'));
t('package held in session storage only (cleared on browser close)', bg.includes('chrome.storage.session.set'));

// ---- no secrets anywhere in the extension ----
const all = fs.readdirSync(D).filter(f => f.endsWith('.js')).map(read).join('\n');
t('no API keys or tokens embedded', !/sk-[A-Za-z0-9]{12}|AIzaSy[A-Za-z0-9]{10}|service_role/.test(all));

const failed = results.filter(r => !r.ok);
results.forEach(r => console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '  [' + r.detail + ']')));
console.log('\nextension net: ' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) { console.error(failed.length + ' extension assertion(s) failed'); process.exit(1); }
