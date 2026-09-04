// ForiForeign browser worker (R6500). Runs OUTSIDE the API: polls the platform for due portal-watch jobs, signs in with
// the person's own consented credentials, reads status, fills forms from a server-issued plan, and STOPS at payment,
// captcha, declarations, signatures and the final submit, telling the person their presence is needed.
// ENV: FF_BASE (https://foriforeign.com), BROWSER_WORKER_TOKEN (same as on the API), HEADLESS (true), POLL_SECONDS (60)
const { chromium } = require('playwright');
const BASE = process.env.FF_BASE || 'https://foriforeign.com', TOKEN = process.env.BROWSER_WORKER_TOKEN, HEADLESS = process.env.HEADLESS !== 'false', POLL = Number(process.env.POLL_SECONDS) || 60;
if (!TOKEN) { console.error('BROWSER_WORKER_TOKEN missing'); process.exit(1); }
const api = async (path, body) => { const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-worker-token': TOKEN }, body: body ? JSON.stringify(body) : undefined }); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + (await r.text()).slice(0, 200)); return r.json(); };
const STOP = /captcha|i am not a robot|card number|cvv|expiry|pay now|make payment|declaration|i declare|signature|sign here|submit application|final submit/i;
async function runJob(job) {
  const browser = await chromium.launch({ headless: HEADLESS }); const ctx = await browser.newContext({ locale: 'en-GB' }); const page = await ctx.newPage(); const out = { status_text: '', screenshot: null, needs_person: null, filled: 0 };
  try { await page.goto(job.login_url || job.portal_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (job.username && job.password) { const u = await page.$('input[type="email"], input[name*="user" i], input[name*="email" i], input[id*="user" i]'); const p = await page.$('input[type="password"]'); if (u && p) { await u.fill(job.username); await p.fill(job.password); await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), p.press('Enter')]); await page.waitForTimeout(3000); } }
    const body = (await page.textContent('body').catch(() => '')) || '';
    if (/verification code|one-time|2fa|two-factor|authenticat/i.test(body) && /code/i.test(body)) { out.needs_person = 'a sign-in code was requested by the portal'; }
    out.status_text = body.replace(/\s+/g, ' ').slice(0, 6000);
    if (!out.needs_person && /upload|submit/.test(job.scope || '') && job.fill) {
      const fields = await page.$$eval('input,select,textarea', els => els.filter(e => e.type !== 'hidden' && e.type !== 'password').map(e => ({ label: (e.labels && e.labels[0] && e.labels[0].innerText) || e.placeholder || e.getAttribute('aria-label') || e.name || e.id, name: e.name, id: e.id, type: e.type })).filter(f => f.label).slice(0, 120));
      if (fields.length) { const plan = await api('/api/portal/' + job.connection_id + '/fill-plan', { fields }); for (const p of (plan.plan || [])) { if (!p.value || p.needs_person || Number(p.confidence) < 0.8) continue; const f = fields.find(x => x.label === p.field); if (!f) continue; const sel = f.id ? '#' + CSS.escape(f.id) : f.name ? '[name="' + f.name + '"]' : null; if (!sel) continue; try { const el = await page.$(sel); if (el) { if (f.type === 'checkbox' || f.type === 'radio') continue; await el.fill(String(p.value)); out.filled++; } } catch (e) {} }
        if (plan.notify_sent || STOP.test(body)) out.needs_person = out.needs_person || 'the next step (payment, declaration, captcha or final submit) must be done by you'; }
    }
    if (STOP.test(body) && !out.needs_person) out.needs_person = 'the page shows a payment, declaration, captcha or final-submit step';
    out.screenshot = (await page.screenshot({ fullPage: false })).toString('base64');
  } catch (e) { out.error = String(e.message).slice(0, 300); } finally { await browser.close().catch(() => {}); }
  return out;
}
async function loop() { for (;;) { try { const d = await api('/api/portal/worker/next'); for (const job of (d.jobs || [])) { const r = await runJob(job); await api('/api/portal/worker/report', { run_id: job.run_id, connection_id: job.connection_id, result: r }); if (r.needs_person) await api('/api/portal/' + job.connection_id + '/needs-you', { why: r.needs_person }); console.log(new Date().toISOString(), job.portal_name, r.error ? 'error ' + r.error : 'ok filled=' + r.filled + (r.needs_person ? ' needs person' : '')); } } catch (e) { console.error('worker', e.message); } await new Promise(r => setTimeout(r, POLL * 1000)); } }
loop();
