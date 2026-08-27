// lib/oblog.js — structured logging + centralized error capture (observability core).
// Every log line is JSON (machine-parseable); every error lands in error_log for the admin dashboard.
const { admin } = require('./supa');
function slog(area, msg, extra) { try { console.log(JSON.stringify({ t: new Date().toISOString(), area, msg, ...extra })); } catch (e) {} }
async function errlog(area, err, { requestId, userId, detail } = {}) {
  const message = String((err && err.message) || err).slice(0, 300);
  slog(area, 'ERROR: ' + message, { requestId, userId });
  try { await admin().from('error_log').insert({ request_id: requestId || null, area, user_id: userId || null, message, detail: (detail || '').slice(0, 500) }); } catch (e) {}
}
module.exports = { slog, errlog };
