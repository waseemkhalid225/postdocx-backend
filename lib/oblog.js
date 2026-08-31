// lib/oblog.js — structured logging + centralized error capture (observability core).
// Every log line is JSON (machine-parseable); every error lands in error_log for the admin dashboard.
const { admin } = require('./supa');
function slog(area, msg, extra) { try { console.log(JSON.stringify({ t: new Date().toISOString(), area, msg, ...extra })); } catch (e) {} }
// Optional external error tracking: set ERROR_WEBHOOK_URL in Railway (Sentry, Slack,
// Better Stack or any endpoint accepting JSON). Failures here never affect the request.
let _lastSent = 0;
function shipError(area, err, meta) {
  try {
    const url = process.env.ERROR_WEBHOOK_URL;
    if (!url) return;
    // Simple throttle so a burst cannot flood the sink.
    if (Date.now() - _lastSent < 2000) return;
    _lastSent = Date.now();
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        service: 'foriforeign',
        build: process.env.FF_BUILD || '',
        area: String(area || ''),
        message: String((err && err.message) || err || '').slice(0, 500),
        stack: String((err && err.stack) || '').slice(0, 2000),
        meta: meta || {},
        at: new Date().toISOString()
      })
    }).catch(() => {});
  } catch (e) {}
}
async function errlog(area, err, { requestId, userId, detail } = {}) {
  try { shipError(area, err, { requestId, userId }); } catch (e) {}
  const message = String((err && err.message) || err).slice(0, 300);
  slog(area, 'ERROR: ' + message, { requestId, userId });
  try { await admin().from('error_log').insert({ request_id: requestId || null, area, user_id: userId || null, message, detail: (detail || '').slice(0, 500) }); } catch (e) {}
}
module.exports = { slog, errlog };
