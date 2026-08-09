// lib/drive.js — Google Drive storage with precise, safe diagnostics.
// Never logs or returns private key material. Surfaces Google's real error codes.
const { google } = require('googleapis');
const crypto = require('crypto');
const stream = require('stream');

/* ---------- credential resolution (items 1-6) ---------- */
function resolveCreds() {
  // Support both common variable names
  const email = process.env.GOOGLE_SERVICE_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || '';
  let raw = process.env.GOOGLE_PRIVATE_KEY || '';
  const hadQuotes = /^["']/.test(raw) || /["']$/.test(raw.trim());
  // strip accidental surrounding quotes (Railway keeps them literally)
  let key = raw.trim().replace(/^["']+/, '').replace(/["']+$/, '');
  const hasEscapedNewlines = key.includes('\\n');
  key = key.replace(/\\n/g, '\n');
  return { email, key, hadQuotes, hasEscapedNewlines };
}

function keyDiagnostics() {
  const { email, key, hadQuotes, hasEscapedNewlines } = resolveCreds();
  let parses = false;
  try { crypto.createPrivateKey(key); parses = true; } catch (e) { /* malformed */ }
  return {
    projectId: process.env.GOOGLE_PROJECT_ID || '(GOOGLE_PROJECT_ID not set, optional)',
    serviceEmail: email || '(MISSING: set GOOGLE_SERVICE_EMAIL or GOOGLE_CLIENT_EMAIL)',
    keyPresent: !!key,
    hasBeginMarker: key.includes('-----BEGIN PRIVATE KEY-----'),
    hasEndMarker: key.includes('-----END PRIVATE KEY-----'),
    hadSurroundingQuotes: hadQuotes,
    hadEscapedNewlines: hasEscapedNewlines,
    keyParses: parses
  };
}

/* ---------- client (items 7-8) ---------- */
let driveClient = null;
let authClient = null;
function drive() {
  if (driveClient) return driveClient;
  const { email, key } = resolveCreds();
  const d = keyDiagnostics();
  // Safe startup log: shape only, never the key
  console.log('[drive] init:', JSON.stringify(d));
  // CRITICAL: build the credential from googleapis' OWN bundled auth library.
  // Mixing the standalone google-auth-library with googleapis fails an internal
  // type check and requests go out with NO token (the classic 401
  // "missing required authentication credential"). This construction cannot mismatch.
  const ga = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  authClient = ga;
  driveClient = google.drive({ version: 'v3', auth: ga });
  return driveClient;
}

/* ---------- error translation: real code first, guidance second (item: never mask) ---------- */
function explain(e) {
  const status = e && (e.code || (e.response && e.response.status)) || '';
  let gErr = '';
  try {
    const data = e.response && e.response.data;
    if (data) {
      if (typeof data.error === 'string') gErr = data.error + (data.error_description ? ': ' + data.error_description : '');
      else if (data.error && data.error.message) gErr = (data.error.code || '') + ' ' + data.error.message +
        (data.error.errors && data.error.errors[0] ? ' [' + data.error.errors[0].reason + ']' : '');
    }
  } catch (x) {}
  const raw = ('Google error ' + status + ': ' + (gErr || String(e && e.message || e))).slice(0, 300);

  const d = keyDiagnostics();
  let hint = '';
  if (!d.serviceEmail || d.serviceEmail.startsWith('(MISSING')) hint = 'Service account email variable is missing (set GOOGLE_SERVICE_EMAIL).';
  else if (!d.keyPresent) hint = 'GOOGLE_PRIVATE_KEY is empty.';
  else if (!d.hasBeginMarker || !d.hasEndMarker) hint = 'Key is missing BEGIN/END PRIVATE KEY markers, re-copy the full private_key value from the JSON file.';
  else if (!d.keyParses) hint = 'Key does not parse (malformed), re-paste it keeping the \\n sequences and no surrounding quotes.';
  else if (/invalid_grant/i.test(raw)) hint = 'invalid_grant usually means the key was deleted/rotated in Google Cloud or the server clock is skewed. Create a fresh key for the service account.';
  else if (/invalid_client/i.test(raw)) hint = 'invalid_client means the service account email does not match this key. Both must come from the same JSON file.';
  else if (/accessNotConfigured|has not been used|is disabled/i.test(raw)) hint = 'The Google Drive API is disabled for this project. Enable it in console.cloud.google.com for the SAME project as the service account.';
  else if (/storageQuotaExceeded|storage quota/i.test(raw)) hint = 'Service accounts have no storage quota for binary files. Use a Shared Drive folder, or ask to switch storage backend.';
  else if (String(status) === '404' || /notFound|File not found/i.test(raw)) hint = 'DRIVE_FOLDER_ID is wrong or the folder is not shared with ' + d.serviceEmail + '.';
  else if (String(status) === '403' || /insufficientPermissions|forbidden/i.test(raw)) hint = 'Share the folder with ' + d.serviceEmail + ' as Editor.';
  else if (String(status) === '401' || /missing required authentication/i.test(raw)) hint = 'Token was not attached: check the key diagnostics in Admin > Diagnose.';
  return raw + (hint ? ' | Fix: ' + hint : '');
}

/* ---------- operations ---------- */
async function uploadBuffer(name, mimeType, buffer) {
  const body = new stream.PassThrough();
  body.end(buffer);
  try {
    const res = await drive().files.create({
      requestBody: { name, parents: process.env.DRIVE_FOLDER_ID ? [process.env.DRIVE_FOLDER_ID] : undefined },
      media: { mimeType, body },
      fields: 'id, name, size, mimeType',
      supportsAllDrives: true
    });
    return res.data;
  } catch (e) { throw new Error(explain(e)); }
}

async function getBuffer(fileId) {
  try {
    const res = await drive().files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  } catch (e) { throw new Error(explain(e)); }
}

async function getMeta(fileId) {
  try {
    const res = await drive().files.get({ fileId, fields: 'id, name, mimeType, size', supportsAllDrives: true });
    return res.data;
  } catch (e) { throw new Error(explain(e)); }
}

async function remove(fileId) {
  try { await drive().files.delete({ fileId, supportsAllDrives: true }); } catch (e) { /* already gone */ }
}

async function backupSheet() {
  const sheetId = process.env.SHEET_ID;
  const folder = process.env.DRIVE_FOLDER_ID;
  if (!sheetId) throw new Error('SHEET_ID not set');
  const name = 'PostDocX-Backup-' + new Date().toISOString().slice(0, 10);
  try {
    await drive().files.copy({ fileId: sheetId, requestBody: { name, parents: folder ? [folder] : undefined }, supportsAllDrives: true });
    const list = await drive().files.list({
      q: "name contains 'PostDocX-Backup-' and trashed = false" + (folder ? " and '" + folder + "' in parents" : ''),
      fields: 'files(id, name)', pageSize: 50, supportsAllDrives: true, includeItemsFromAllDrives: true
    });
    const backups = (list.data.files || []).sort((a, b) => a.name < b.name ? 1 : -1);
    for (const f of backups.slice(8)) { try { await drive().files.delete({ fileId: f.id, supportsAllDrives: true }); } catch (e) {} }
    return name;
  } catch (e) { throw new Error(explain(e)); }
}

/* ---------- diagnostics probe (items 9-10 + token test) ---------- */
async function probe() {
  const out = { keyShape: keyDiagnostics(), token: { ok: false, note: '' }, api: { ok: false, note: '' }, folder: { ok: false, note: '' } };
  try {
    drive(); // init clients
    const client = await authClient.getClient();
    const tok = await client.getAccessToken(); // token fetch only: isolates credential problems from API problems
    out.token = { ok: !!(tok && tok.token), note: (tok && tok.token) ? 'OAuth token obtained, credentials are valid' : 'No token returned' };
    if (!tok || !tok.token) return out;
  } catch (e) { out.token = { ok: false, note: explain(e) }; return out; }
  try {
    await drive().about.get({ fields: 'user' });
    out.api = { ok: true, note: 'Drive API reachable and enabled' };
  } catch (e) { out.api = { ok: false, note: explain(e) }; return out; }
  if (!process.env.DRIVE_FOLDER_ID) { out.folder = { ok: false, note: 'DRIVE_FOLDER_ID variable is not set.' }; return out; }
  try {
    const m = await getMeta(process.env.DRIVE_FOLDER_ID);
    out.folder = { ok: true, note: 'Folder "' + m.name + '" accessible by the service account' };
  } catch (e) { out.folder = { ok: false, note: e.message }; }
  return out;
}

module.exports = { uploadBuffer, getBuffer, getMeta, remove, probe, backupSheet, keyDiagnostics };
