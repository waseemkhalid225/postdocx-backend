// lib/drive.js
// Private document storage in Google Drive using the Google service account.

const { google } = require('googleapis');
const stream = require('stream');

let driveClient = null;

function drive() {
  if (driveClient) return driveClient;

  const email = process.env.GOOGLE_SERVICE_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!email) {
    throw new Error('GOOGLE_SERVICE_EMAIL is missing');
  }

  if (!privateKey) {
    throw new Error('GOOGLE_PRIVATE_KEY is missing');
  }

  if (!process.env.DRIVE_FOLDER_ID) {
    throw new Error('DRIVE_FOLDER_ID is missing');
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  driveClient = google.drive({
    version: 'v3',
    auth
  });

  return driveClient;
}

async function uploadBuffer(name, mimeType, buffer) {
  const body = new stream.PassThrough();
  body.end(buffer);

  const res = await drive().files.create({
    requestBody: {
      name,
      parents: [process.env.DRIVE_FOLDER_ID]
    },
    media: {
      mimeType,
      body
    },
    fields: 'id,name,size,mimeType'
  });

  return res.data;
}

async function getBuffer(fileId) {
  const res = await drive().files.get(
    {
      fileId,
      alt: 'media'
    },
    {
      responseType: 'arraybuffer'
    }
  );

  return Buffer.from(res.data);
}

async function getMeta(fileId) {
  const res = await drive().files.get({
    fileId,
    fields: 'id,name,mimeType,size'
  });

  return res.data;
}

async function remove(fileId) {
  try {
    await drive().files.delete({
      fileId
    });
  } catch (e) {
    // File may already be deleted.
  }
}

module.exports = {
  uploadBuffer,
  getBuffer,
  getMeta,
  remove
};
