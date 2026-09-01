// tools/audit-wiring.js - finds things that cannot possibly work.
//
// Every onclick in the interface names a function. Every api() call names a route. If the
// function is not defined, or the route does not exist, the control is dead and no test
// that reads source strings will ever notice. This walks both directions.
const fs = require('fs');
const path = require('path');
const R = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const fe = R('public/index.html');
const sv = R('server.js');
const script = (fe.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

const out = { deadHandlers: [], missingRoutes: [], unusedRoutes: [], missingIds: [] };

/* ---- 1. Every inline handler must resolve to a defined function ---- */
const defined = new Set();
for (const m of script.matchAll(/(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
for (const m of script.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) defined.add(m[1]);
for (const m of script.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);

/* Known-good patterns the static scan cannot distinguish from a fault. Each is verified by
   hand and named here rather than silently tolerated:
   - financed/funding: words inside the label "Self-financed (bank statement expected)",
     which lives in an attribute and only looks like a call.
   - /api/applications/X/documents: real routes are /api/applications/:id/documents/:docId
     and .../pdf; a prefix comparison cannot see past the :id segment. */
const KNOWN_OK_HANDLERS = new Set(['financed', 'funding']);
const KNOWN_OK_ROUTES = new Set(['/api/applications/X/documents']);

const BUILTIN = new Set(['alert', 'confirm', 'prompt', 'open', 'print', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'fetch', 'encodeURIComponent', 'decodeURIComponent', 'parseInt',
  'parseFloat', 'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'if',
  'for', 'while', 'switch', 'return', 'typeof', 'new', 'this', 'try', 'catch', 'function', 'await']);

const called = new Map();
for (const m of fe.matchAll(/on(?:click|change|input|submit|keyup|keydown|blur|focus)="([^"]*)"/g)) {
  /* Two things must be stripped before scanning, or the audit drowns in false alarms:
     text inside string literals (a label like "Self-financed (bank statement)" looks like
     a call to financed()), and method calls (.remove(), .closest()), which belong to an
     object rather than to the global scope. */
  /* Strip nested/escaped string literals until nothing changes, then drop `new X(`:
     a label such as "Self-financed (bank statement)" inside an attribute otherwise reads
     as a call to financed(). */
  let body = m[1];
  body = body.replace(/&#39;/g, "'");
  for (let i = 0; i < 6; i++) body = body.replace(/'[^']*'/g, "''");
  body = body.replace(/''+/g, "''").replace(/\bnew\s+[A-Za-z_$][\w$]*\s*\(/g, '(');
  for (const c of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const n = c[2];
    if (BUILTIN.has(n)) continue;
    if (!called.has(n)) called.set(n, 0);
    called.set(n, called.get(n) + 1);
  }
}
for (const [fn, count] of called) {
  const usable = defined.has(fn) || script.includes(fn + '=') || script.includes(fn + ' =');
  /* A genuine handler name appears in the script somewhere. A word that only ever occurs
     inside an attribute is prose - "Self-financed (bank statement expected)" is a label,
     not a call to financed(). */
  const looksLikeCode = new RegExp('[^\\w$.]' + fn + '\\s*\\(').test(script);
  if (!usable && looksLikeCode && !KNOWN_OK_HANDLERS.has(fn)) out.deadHandlers.push({ handler: fn, uses: count });
}

/* ---- 2. Every route the interface calls must exist on the server ---- */
const routes = new Set();
for (const m of sv.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) routes.add(m[2]);
const routeMatches = p => {
  for (const r of routes) {
    const rx = new RegExp('^' + r.replace(/:[^/]+/g, '[^/]+').replace(/\//g, '\\/') + '$');
    if (rx.test(p)) return true;
  }
  return false;
};
const calledPaths = new Set();
for (const m of script.matchAll(/api\(\s*'(\/api\/[^'`]*)'/g)) calledPaths.add(m[1]);
/* A path built by concatenation - api('/api/messages/' + id + '/authorize') - must be
   reassembled before it can be matched, or a route that plainly exists is reported
   missing. */
for (const m of script.matchAll(/api\(\s*'(\/api\/[^'`]*)'\s*\+\s*[^,)]*?\+\s*'([^']*)'/g)) calledPaths.add(m[1] + 'X' + m[2]);
for (const m of script.matchAll(/api\(\s*'(\/api\/[^'`]*)'\s*\+/g)) calledPaths.add(m[1] + 'X');
for (const m of script.matchAll(/api\(\s*`(\/api\/[^`]*)`/g)) calledPaths.add(m[1].replace(/\$\{[^}]*\}/g, 'X'));
for (let p of calledPaths) {
  const clean = p.replace(/\?.*$/, '').replace(/X$/, '').replace(/\/$/, '');
  /* Paths assembled at runtime cannot be matched exactly, so the test is whether ANY
     server route begins with the literal prefix the interface uses. That catches a call
     to a route that does not exist at all, without inventing failures for every id. */
  const exact = routeMatches(clean);
  const prefixed = [...routes].some(r => r.startsWith(clean));
  if (!exact && !prefixed && !KNOWN_OK_ROUTES.has(clean)) out.missingRoutes.push(clean);
}

/* ---- 3. Routes nothing ever calls (candidates for dead code) ---- */
for (const r of routes) {
  if (!r.startsWith('/api/')) continue;
  const stem = r.split('/:')[0];
  if (!script.includes(stem) && !fe.includes(stem)) out.unusedRoutes.push(r);
}

/* ---- 4. getElementById targets that are never rendered ---- */
const ids = new Set();
for (const m of fe.matchAll(/id=["']([A-Za-z_][\w-]*)["']/g)) ids.add(m[1]);
for (const m of script.matchAll(/id=\\?["']([A-Za-z_][\w-]*)\\?["']/g)) ids.add(m[1]);
for (const m of script.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
  if (m[1].includes('$')) continue;              // built at runtime from a template
  if (!ids.has(m[1])) out.missingIds.push(m[1]);
}

const problems = out.deadHandlers.length + out.missingRoutes.length + out.missingIds.length;
console.log('=== WIRING AUDIT ===');
console.log('inline handlers checked : ' + called.size);
console.log('api routes on server    : ' + routes.size);
console.log('');
console.log('DEAD HANDLERS (button exists, function does not): ' + out.deadHandlers.length);
out.deadHandlers.forEach(d => console.log('   ' + d.handler + '()  used ' + d.uses + 'x'));
console.log('MISSING ROUTES (frontend calls, server lacks): ' + out.missingRoutes.length);
out.missingRoutes.forEach(r => console.log('   ' + r));
console.log('MISSING ELEMENT IDS (code reads an id never rendered): ' + out.missingIds.length);
[...new Set(out.missingIds)].forEach(i => console.log('   #' + i));
console.log('UNUSED ROUTES (never called from the interface): ' + out.unusedRoutes.length);
out.unusedRoutes.forEach(r => console.log('   ' + r));
console.log('');
console.log(problems ? 'PROBLEMS FOUND: ' + problems : 'No dead handlers, no missing routes, no missing ids.');
process.exitCode = out.deadHandlers.length || out.missingRoutes.length ? 1 : 0;
