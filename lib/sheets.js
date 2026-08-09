// lib/sheets.js — Google Sheets as the PostDocX database
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const SCHEMA = {
  Users: ['id','name','email','passHash','role','title','field','methods','pubs','prefs','links','orcid','nationality','phone','smtpEmail','encPass','emailConnected','partnerId','active','createdOn','jobPrefs','minSalary'],
  Researchers: ['id','name','title','email','field','methods','pubs','prefs','links','active','partnerId'],
  Opportunities: ['id','resId','title','institution','country','pi','url','deadline','funding','status','matchScore','note','dupKey','addedOn','verifiedOn','coupleKey','category','level','compensation'],
  Supervisors: ['id','resId','name','institution','country','email','themes','opening','stage','note'],
  Outbox: ['id','resId','oppId','toEmail','toName','subject','body','type','status','createdOn','sentOn','followups','lastFollowupOn','replied'],
  Proposals: ['id','resId','oppId','title','status','content','createdOn'],
  Referees: ['id','resId','name','email','relationship','status','note'],
  Documents: ['id','resId','type','name','url','attach','version','updatedOn','note','driveId','mime','size'],
  Fellowships: ['id','name','funder','typicalWindow','url','regions','note'],
  Cases: ['id','caseNo','resId','oppId','stage','status','matchScore','coupleKey','nextAction','outcome','createdOn','updatedOn'],
  Threads: ['id','resId','oppId','outboxId','fromEmail','subject','body','intent','receivedOn','handled','dedupe'],
  Tasks: ['id','resId','oppId','category','title','status','createdOn'],
  Log: ['ts','event','detail']
};

let doc = null;

async function connect() {
  if (doc) return doc;
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  doc = new GoogleSpreadsheet(process.env.SHEET_ID, auth);
  await doc.loadInfo();
  // Ensure all tabs + headers exist
  for (const [title, headers] of Object.entries(SCHEMA)) {
    let sheet = doc.sheetsByTitle[title];
    if (!sheet) sheet = await doc.addSheet({ title, headerValues: headers });
    else {
      try { await sheet.loadHeaderRow(); } catch (e) { await sheet.setHeaderRow(headers); }
      if (!sheet.headerValues || sheet.headerValues.length < headers.length) await sheet.setHeaderRow(headers);
    }
  }
  return doc;
}

// Read cache: within a cycle the same tab is read many times; one fetch per 20s is enough.
const cache = {};
function bust(tab) { delete cache[tab]; }
function bustAll() { for (const k of Object.keys(cache)) delete cache[k]; }

async function rows(tab) {
  await connect();
  const c = cache[tab];
  if (c && Date.now() - c.t < 20000) return c.v;
  const v = await doc.sheetsByTitle[tab].getRows();
  cache[tab] = { t: Date.now(), v };
  return v;
}

async function add(tab, obj) {
  await connect();
  bust(tab);
  return doc.sheetsByTitle[tab].addRow(obj);
}

// One API call for many rows instead of one call per row
async function addMany(tab, objs) {
  if (!objs.length) return [];
  await connect();
  bust(tab);
  return doc.sheetsByTitle[tab].addRows(objs);
}

// Read a row object into a plain object
function val(row, key) { return row.get(key) || ''; }
function toObj(row, tab) {
  const o = {};
  for (const k of SCHEMA[tab]) o[k] = val(row, k);
  o._row = row;
  return o;
}

async function all(tab) { return (await rows(tab)).map(r => toObj(r, tab)); }

async function log(event, detail) {
  try { await add('Log', { ts: new Date().toISOString(), event, detail: String(detail).slice(0, 400) }); }
  catch (e) { console.error('log fail', e.message); }
}

module.exports = { connect, all, add, addMany, bust, bustAll, log, SCHEMA };
