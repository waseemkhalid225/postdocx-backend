const { google } = require('googleapis');
const stream = require('stream');

let driveClient = null;

function drive() {
  if (driveClient) return driveClient;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID is missing');
  }

  if (!clientSecret) {
    throw new Error('GOOGLE_OAUTH_CLIENT_SECRET is missing');
  }

  if (!refreshToken) {
    throw new Error(
      'GOOGLE_OAUTH_REFRESH_TOKEN is missing. Connect Google Drive first.'
    );
  }

  if (!process.env.DRIVE_FOLDER_ID) {
    throw new Error('DRIVE_FOLDER_ID is missing');
  }

  const auth = new google.auth.OAuth2(
    clientId,
    clientSecret,
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      'https://postdocx-backend-production.up.railway.app/auth/google/callback'
  );

  auth.setCredentials({
    refresh_token: refreshToken
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
    fields: 'id,name,size,mimeType,parents'
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
    fields: 'id,name,mimeType,size,parents,webViewLink'
  });

  return res.data;
}

async function remove(fileId) {
  try {
    await drive().files.delete({
      fileId
    });
  } catch (e) {
    if (e.code !== 404) throw e;
  }
}

module.exports = {
  uploadBuffer,
  getBuffer,
  getMeta,
  remove
};
