// lib/drive.js — private document storage in Google Drive via the same service account
// Files stay private to the service account; the backend streams them to signed-in users
// and attaches them to outgoing emails. Requires DRIVE_FOLDER_ID shared with the
// service account email as Editor.
const { google } = require('googleapis');
const stream = require('stream');

let driveClient = null;
function drive() {
  if (driveClient) return driveClient;
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_EMAIL, null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/drive']
  );
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

async function uploadBuffer(name, mimeType, buffer) {
  const body = new stream.PassThrough();
  body.end(buffer);
  const res = await drive().files.create({
    requestBody: { name, parents: process.env.DRIVE_FOLDER_ID ? [process.env.DRIVE_FOLDER_ID] : undefined },
    media: { mimeType, body },
    fields: 'id, name, size, mimeType'
  });
  return res.data; // { id, name, size, mimeType }
}

async function getBuffer(fileId) {
  const res = await drive().files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

async function getMeta(fileId) {
  const res = await drive().files.get({ fileId, fields: 'id, name, mimeType, size' });
  return res.data;
}

async function remove(fileId) {
  try { await drive().files.delete({ fileId }); } catch (e) { /* already gone */ }
}

module.exports = { uploadBuffer, getBuffer, getMeta, remove };
