// lib/drive.js — private document storage in Google Drive.
// Uses the IDENTICAL auth construction as lib/sheets.js (which is proven working),
// via google-auth-library JWT passed into googleapis.
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const stream = require('stream');

let driveClient = null;
function drive() {
  if (driveClient) return driveClient;
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

// Translate raw Google errors into instructions a person can act on
function explain(e) {
  const msg = String((e && e.message) || e);
  const code = e && (e.code || (e.response && e.response.status));
  if (code === 401 || /missing required authentication/i.test(msg))
    return 'Google rejected the service account sign-in for Drive. Fix: (1) in console.cloud.google.com open the SAME project and enable the "Google Drive API" (it is separate from the Sheets API), (2) in Railway check GOOGLE_PRIVATE_KEY has no surrounding quote characters and keeps the \\n sequences exactly as in the JSON file.';
  if (/has not been used|is disabled/i.test(msg))
    return 'The Google Drive API is not enabled for your project. Open console.cloud.google.com, select the same project as your service account, search "Google Drive API", press Enable, wait 2 minutes, retry.';
  if (/storage quota|storageQuotaExceeded/i.test(msg))
    return 'Google no longer gives service accounts their own storage. Fix: create the PostDocX folder inside a Shared Drive (Google Workspace) and share it with the service account, or tell me and I will switch file storage to a different backend.';
  if (code === 404 || /File not found/i.test(msg))
    return 'DRIVE_FOLDER_ID is wrong or the folder is not shared with the service account. Open the folder in Drive, Share, add ' + (process.env.GOOGLE_SERVICE_EMAIL || 'the service account email') + ' as Editor, and copy the ID from the folder URL (the part after /folders/).';
  if (code === 403)
    return 'Drive refused access (403): share the folder with ' + (process.env.GOOGLE_SERVICE_EMAIL || 'the service account email') + ' as Editor. Raw: ' + msg.slice(0, 120);
  return msg.slice(0, 200);
}

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
  const res = await drive().files.get({ fileId, fields: 'id, name, mimeType, size', supportsAllDrives: true });
  return res.data;
}

async function remove(fileId) {
  try { await drive().files.delete({ fileId, supportsAllDrives: true }); } catch (e) { /* already gone */ }
}

// Health probes for the diagnostics endpoint
async function probe() {
  const out = { auth: { ok: false, note: '' }, folder: { ok: false, note: '' } };
  try {
    await drive().about.get({ fields: 'user' });
    out.auth = { ok: true, note: 'Drive API reachable, service account authenticated' };
  } catch (e) { out.auth = { ok: false, note: explain(e) }; return out; }
  if (!process.env.DRIVE_FOLDER_ID) { out.folder = { ok: false, note: 'DRIVE_FOLDER_ID variable is not set in Railway.' }; return out; }
  try {
    const m = await getMeta(process.env.DRIVE_FOLDER_ID);
    out.folder = { ok: true, note: 'Folder "' + m.name + '" accessible' };
  } catch (e) { out.folder = { ok: false, note: e.message }; }
  return out;
}

// Copy the entire PostDocX Sheet into the Drive folder as a dated backup; keep the last 8.
// Spreadsheets are Docs-native files, so backups use no storage quota.
async function backupSheet() {
  const sheetId = process.env.SHEET_ID;
  const folder = process.env.DRIVE_FOLDER_ID;
  if (!sheetId) throw new Error('SHEET_ID not set');
  const name = 'PostDocX-Backup-' + new Date().toISOString().slice(0, 10);
  await drive().files.copy({
    fileId: sheetId,
    requestBody: { name, parents: folder ? [folder] : undefined },
    supportsAllDrives: true
  });
  // prune old backups beyond the newest 8
  const list = await drive().files.list({
    q: "name contains 'PostDocX-Backup-' and trashed = false" + (folder ? " and '" + folder + "' in parents" : ''),
    fields: 'files(id, name)', pageSize: 50, supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  const backups = (list.data.files || []).sort((a, b) => a.name < b.name ? 1 : -1);
  for (const f of backups.slice(8)) { try { await drive().files.delete({ fileId: f.id, supportsAllDrives: true }); } catch (e) {} }
  return name;
}

module.exports = { uploadBuffer, getBuffer, getMeta, remove, probe, backupSheet };
