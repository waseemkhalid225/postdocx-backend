// lib/sheets.js
// Google Sheets database for PostDocX

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const SCHEMA = {
  Users: ['id','name','email','passHash','role','title','field','methods','pubs','prefs','links','orcid','nationality','phone','smtpEmail','encPass','emailConnected','partnerId','active','createdOn','jobPrefs','minSalary','jobLocations','schedLink','gmailRefresh','gmailAddr'],
  Researchers: ['id','name','title','email','field','methods','pubs','prefs','links','active','partnerId'],
  Opportunities: ['id','resId','title','institution','country','pi','url','deadline','funding','status','matchScore','note','dupKey','addedOn','verifiedOn','coupleKey','category','level','compensation','section','requirements','stipend','duration','chance','nextSteps','analyzedOn','readiness','archived','prepStatus','prepStartedAt','prepDone','parentOppId','contact','noEmail','perks','excludeDocs'],
  Supervisors: ['id','resId','name','institution','country','email','themes','opening','stage','note'],
  Outbox: ['id','resId','oppId','toEmail','toName','subject','body','type','status','createdOn','sentOn','followups','lastFollowupOn','replied'],
  Proposals: ['id','resId','oppId','title','status','content','createdOn'],
  Referees: ['id','resId','name','email','relationship','status','note'],
  Documents: ['id','resId','type','name','url','attach','version','updatedOn','note','driveId','mime','size'],
  Fellowships: ['id','name','funder','typicalWindow','url','regions','note'],
  Cases: ['id','caseNo','resId','oppId','stage','status','matchScore','coupleKey','nextAction','outcome','createdOn','updatedOn'],
  Threads: ['id','resId','oppId','outboxId','fromEmail','subject','body','intent','receivedOn','handled','dedupe'],
  Tasks: ['id','resId','oppId','category','title','status','createdOn'],
  Settings: ['key','value'],
  PICache: ['piKey','name','institution','papers','focus','cachedOn'],
  Reminders: ['id','resId','oppId','kind','dueOn','note','status','createdOn'],
  Log: ['ts','event','detail']
};

let doc = null;
let auth = null;

async function connect() {
  if (doc) return doc;

  const email = process.env.GOOGLE_SERVICE_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY || '';
  const sheetId = process.env.SHEET_ID;

  if (!email) {
    throw new Error('GOOGLE_SERVICE_EMAIL is missing in Railway Variables');
  }

  if (!key) {
    throw new Error('GOOGLE_PRIVATE_KEY is missing in Railway Variables');
  }

  if (!sheetId) {
    throw new Error('SHEET_ID is missing in Railway Variables');
  }

  // Railway may store the key with literal \n characters.
  key = key.replace(/\\n/g, '\n').trim();

  if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('GOOGLE_PRIVATE_KEY is not a valid private key');
  }

  if (!key.includes('-----END PRIVATE KEY-----')) {
    throw new Error('GOOGLE_PRIVATE_KEY is incomplete');
  }

  auth = new JWT({
    email,
    key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });

  // Explicitly obtain the Google access token.
  // This prevents requests being sent without authentication.
  await auth.authorize();

  doc = new GoogleSpreadsheet(sheetId, auth);

  // Load the spreadsheet using the authenticated client.
  await doc.loadInfo();

  // Make sure every required tab exists.
  for (const [title, headers] of Object.entries(SCHEMA)) {
    let sheet = doc.sheetsByTitle[title];

    if (!sheet) {
      sheet = await doc.addSheet({
        title,
        headerValues: headers
      });
      continue;
    }

    try {
      await sheet.loadHeaderRow();
    } catch (e) {
      await sheet.setHeaderRow(headers);
      continue;
    }

    if (
      !sheet.headerValues ||
      sheet.headerValues.length < headers.length
    ) {
      await sheet.setHeaderRow(headers);
    }
  }

  return doc;
}


// Cache sheet reads for 20 seconds.
const cache = {};

function bust(tab) {
  delete cache[tab];
}

function bustAll() {
  for (const k of Object.keys(cache)) {
    delete cache[k];
  }
}

async function rows(tab) {
  await connect();

  const c = cache[tab];

  if (c && Date.now() - c.t < 20000) {
    return c.v;
  }

  const sheet = doc.sheetsByTitle[tab];

  if (!sheet) {
    throw new Error(`Google Sheet tab "${tab}" does not exist`);
  }

  const v = await sheet.getRows();

  cache[tab] = {
    t: Date.now(),
    v
  };

  return v;
}

async function add(tab, obj) {
  await connect();

  bust(tab);

  const sheet = doc.sheetsByTitle[tab];

  if (!sheet) {
    throw new Error(`Google Sheet tab "${tab}" does not exist`);
  }

  return sheet.addRow(obj);
}

async function addMany(tab, objs) {
  if (!objs || !objs.length) {
    return [];
  }

  await connect();

  bust(tab);

  const sheet = doc.sheetsByTitle[tab];

  if (!sheet) {
    throw new Error(`Google Sheet tab "${tab}" does not exist`);
  }

  return sheet.addRows(objs);
}

function val(row, key) {
  try {
    return row.get(key) || '';
  } catch (e) {
    return '';
  }
}

function toObj(row, tab) {
  const o = {};

  for (const k of SCHEMA[tab]) {
    o[k] = val(row, k);
  }

  o._row = row;

  return o;
}

async function all(tab) {
  return (await rows(tab)).map(
    r => toObj(r, tab)
  );
}

async function log(event, detail) {
  try {
    await add('Log', {
      ts: new Date().toISOString(),
      event,
      detail: String(detail || '').slice(0, 400)
    });
  } catch (e) {
    console.error('Google Sheets log failed:', e.message);
  }
}

module.exports = {
  connect,
  all,
  add,
  addMany,
  bust,
  bustAll,
  log,
  SCHEMA
};
