/* test/e2e.test.js — boots the REAL server and exercises it over HTTP.
   Catches integration failures that static checks cannot: routing, auth gates,
   error handling, security headers and malformed input.
   Run: node test/e2e.test.js                                                    */
const { spawn } = require('child_process');
const PORT = process.env.E2E_PORT || 3999;
const BASE = 'http://localhost:' + PORT;

const env = Object.assign({}, process.env, {
  SUPABASE_URL: 'https://stub.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'stub',
  SUPABASE_ANON_KEY: 'stub', GEMINI_API_KEY: 'stub', PORT: String(PORT), FF_E2E: '1'
});

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
async function req(path, opts = {}) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(BASE + path, Object.assign({ signal: ctl.signal }, opts));
    let body = null; try { body = await r.text(); } catch (e) {}
    return { status: r.status, headers: r.headers, body };
  } catch (e) { return { status: 0, error: e.message }; }
  finally { clearTimeout(tm); }
}

(async () => {
  const srv = spawn('node', [__dirname + '/../server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverErrors = '';
  srv.stderr.on('data', d => { serverErrors += String(d); });
  await wait(3500);

  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); };

  // 1. Public endpoints respond
  for (const p of ['/health', '/api/version', '/api/config', '/api/app-info', '/robots.txt', '/manifest.json']) {
    const r = await req(p);
    check('public ' + p + ' returns 200', r.status === 200, 'got ' + r.status);
  }

  // 2. Protected endpoints reject anonymous access
  for (const p of ['/api/home', '/api/me', '/api/applications', '/api/admin/users',
                   '/api/admin/settings', '/api/licence-journey', '/api/salary-intel',
                   '/api/admin/inventory', '/api/admin/demand', '/api/admin/audit']) {
    const r = await req(p);
    check('auth gate ' + p, r.status === 401, 'got ' + r.status);
  }

  // 3. Forged token is rejected (no privilege escalation)
  const forged = await req('/api/admin/users', { headers: { authorization: 'Bearer forged.token.value' } });
  check('forged admin token rejected', forged.status === 401, 'got ' + forged.status);

  // 4. Client faults return 4xx, never 5xx
  const badJson = await req('/api/payments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
  check('malformed JSON -> 400', badJson.status === 400, 'got ' + badJson.status);
  check('malformed JSON has a readable message', /could not be read/.test(badJson.body || ''), badJson.body);

  // 5. Unknown routes and traversal
  check('unknown route -> 404', (await req('/api/does-not-exist')).status === 404);
  check('path traversal blocked', [400, 403, 404].includes((await req('/public/../server.js')).status));

  // 6. Injection attempts do not 500
  const sqli = await req("/api/opportunities?country=%27%3BDROP%20TABLE%20users%3B--");
  check('SQLi attempt does not 500', sqli.status !== 500, 'got ' + sqli.status);
  const xss = await req('/api/opportunities?q=%3Cscript%3Ealert(1)%3C/script%3E');
  check('XSS attempt does not 500', xss.status !== 500, 'got ' + xss.status);

  // 7. Security headers on the app shell
  const root = await req('/');
  for (const h of ['x-frame-options', 'x-content-type-options', 'referrer-policy', 'strict-transport-security']) {
    check('security header ' + h, !!root.headers.get(h), 'missing');
  }

  // 8. SEO / social metadata present in the shell
  check('meta description present', /name="description"/.test(root.body || ''));
  check('open graph present', /property="og:title"/.test(root.body || ''));

  // 9. Server stayed healthy through all of the above
  check('server still healthy after hostile input', (await req('/health')).status === 200);
  check('no unhandled crashes in stderr', !/unhandledRejection|TypeError|ReferenceError/.test(serverErrors), serverErrors.slice(0, 200));

  srv.kill();
  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '  [' + r.detail + ']')));
  console.log('\ne2e net: ' + (results.length - failed.length) + '/' + results.length + ' passed');
  if (failed.length) { console.error(failed.length + ' e2e assertion(s) failed'); process.exit(1); }
  process.exit(0);
})();
