// tools/restore.js — restore ONE table from a backup file by upsert (never deletes).
// Usage: FF_RESTORE_CONFIRM=yes node tools/restore.js backups/ff-2026-09-03.json profiles
const fs = require('fs'); const { admin } = require('../lib/supa');
(async () => {
  if (process.env.FF_RESTORE_CONFIRM !== 'yes') { console.error('Refusing: set FF_RESTORE_CONFIRM=yes'); process.exit(2); }
  const [file, table] = process.argv.slice(2); if (!file || !table) { console.error('usage: restore.js <file> <table>'); process.exit(2); }
  const b = JSON.parse(fs.readFileSync(file, 'utf8')); const rows = b.tables[table]; if (!Array.isArray(rows)) { console.error('no such table in backup'); process.exit(2); }
  let n = 0; for (let i = 0; i < rows.length; i += 500) { const { error } = await admin().from(table).upsert(rows.slice(i, i + 500)); if (error) { console.error('batch', i, error.message); process.exit(1); } n += Math.min(500, rows.length - i); console.log(table, n, '/', rows.length); }
  console.log('restored', table, n, 'rows from', b.at);
})().catch(e => { console.error(e); process.exit(1); });
