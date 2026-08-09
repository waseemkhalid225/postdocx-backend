// lib/storage.js — document byte storage.
// Backends: 'volume' (default: persistent disk / Railway Volume) or 'supabase'.
// Google Drive is no longer used for uploads because Google removed storage
// quota from service accounts (storageQuotaExceeded on personal My Drive).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const BACKEND = (process.env.STORAGE_BACKEND || (process.env.SUPABASE_URL ? 'supabase' : 'volume')).toLowerCase();
const DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data');
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SB_BUCKET = process.env.SUPABASE_BUCKET || 'postdocx';

function safeName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
}

/* ---------- volume backend ---------- */
async function ensureDir() {
  await fsp.mkdir(DIR, { recursive: true });
}
async function volPut(name, buffer) {
  await ensureDir();
  const id = 'fs:' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + '-' + safeName(name);
  await fsp.writeFile(path.join(DIR, id.slice(3)), buffer);
  return { id, size: buffer.length };
}
async function volGet(id) {
  return fsp.readFile(path.join(DIR, id.replace(/^fs:/, '')));
}
async function volRemove(id) {
  try { await fsp.unlink(path.join(DIR, id.replace(/^fs:/, ''))); } catch (e) {}
}

/* ---------- supabase backend ---------- */
function sbHeaders() {
  return { authorization: 'Bearer ' + SB_KEY, apikey: SB_KEY };
}
async function sbPut(name, mime, buffer) {
  const key = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + '-' + safeName(name);
  const res = await fetch(SB_URL + '/storage/v1/object/' + SB_BUCKET + '/' + key, {
    method: 'POST',
    headers: { ...sbHeaders(), 'content-type': mime || 'application/octet-stream', 'x-upsert': 'true' },
    body: buffer
  });
  if (!res.ok) throw new Error('Supabase upload ' + res.status + ': ' + (await res.text()).slice(0, 150) + '. Check SUPABASE_URL, SUPABASE_SERVICE_KEY and that bucket "' + SB_BUCKET + '" exists.');
  return { id: 'sb:' + key, size: buffer.length };
}
async function sbGet(id) {
  const res = await fetch(SB_URL + '/storage/v1/object/' + SB_BUCKET + '/' + id.replace(/^sb:/, ''), { headers: sbHeaders() });
  if (!res.ok) throw new Error('Supabase download ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}
async function sbRemove(id) {
  try {
    await fetch(SB_URL + '/storage/v1/object/' + SB_BUCKET + '/' + id.replace(/^sb:/, ''), { method: 'DELETE', headers: sbHeaders() });
  } catch (e) {}
}

/* ---------- unified interface (id prefix routes reads, so old ids keep working after a backend switch) ---------- */
async function put(name, mime, buffer) {
  if (BACKEND === 'supabase') return sbPut(name, mime, buffer);
  return volPut(name, buffer);
}
async function get(id) {
  if (String(id).startsWith('sb:')) return sbGet(id);
  if (String(id).startsWith('fs:')) return volGet(id);
  throw new Error('Unknown storage id');
}
async function remove(id) {
  if (String(id).startsWith('sb:')) return sbRemove(id);
  if (String(id).startsWith('fs:')) return volRemove(id);
}
function isStorageId(id) { return /^(fs|sb):/.test(String(id || '')); }

/* ---------- health probe ---------- */
async function probe() {
  const out = { backend: BACKEND === 'supabase' ? 'Supabase bucket "' + SB_BUCKET + '"' : 'Persistent volume at ' + DIR, ok: false, note: '' };
  try {
    const test = await put('healthcheck.txt', 'text/plain', Buffer.from('ok ' + Date.now()));
    const back = await get(test.id);
    await remove(test.id);
    out.ok = back.toString().startsWith('ok ');
    out.note = out.ok ? 'Write, read and delete all working' : 'Round-trip mismatch';
    if (BACKEND !== 'supabase' && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_DIR) {
      out.note += '. WARNING: no Railway Volume detected, files will be LOST on redeploy. Attach a Volume to the service (mount path /data) or set Supabase variables.';
      out.ok = false;
    }
  } catch (e) { out.note = String(e.message).slice(0, 250); }
  return out;
}

module.exports = { put, get, remove, isStorageId, probe };
