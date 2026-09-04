// tools/build-sql.js — assembles ALL_MIGRATIONS_run_in_order.sql from migrations/*.sql in order and, after every
// "create table if not exists", emits "add column if not exists" for each column of that definition. Tables that already
// exist in an older shape (the original app, a previous build) therefore always gain the columns the platform expects.
const fs = require('fs'); const path = require('path');
const dir = path.join(__dirname, '..', 'migrations'); const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const TYPES = 'text|uuid|jsonb|timestamptz|timestamp|date|boolean|numeric(?:\\([^)]*\\))?|integer|int|bigserial|bigint|smallint|serial|text\\[\\]|double precision|real';
function guards(body, table) {
  const out = []; const cleaned = body.replace(/--[^\n]*/g, '');
  // split top-level by commas not inside parentheses
  const parts = []; let depth = 0, cur = '';
  for (const ch of cleaned) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
  parts.push(cur);
  for (const p of parts) { const m = p.trim().match(new RegExp('^([a-z_]+)\\s+(' + TYPES + ')(.*)$', 's')); if (!m) continue; const col = m[1], type = m[2]; if (col === 'id' || /primary key/i.test(m[3])) continue; const def = (m[3].match(/default\s+([^\s,]+(?:\([^)]*\))?(?:::[a-z\[\]]+)?)/i) || [])[1]; const notnull = /not null/i.test(m[3]) && def; out.push(`alter table if exists public.${table} add column if not exists ${col} ${type}${def ? ' default ' + def : ''}${notnull ? ' not null' : ''};`); }
  return out.join('\n');
}
let all = ''; for (const f of files) { let s = fs.readFileSync(path.join(dir, f), 'utf8'); s = s.replace(/create table if not exists public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/g, (whole, t, body) => whole + '\n' + guards(body, t)); all += '-- ===== ' + f + ' =====\n' + s.trim() + '\n\n'; }
fs.writeFileSync(path.join(__dirname, '..', 'ALL_MIGRATIONS_run_in_order.sql'), all); console.log('built from', files.length, 'files,', Math.round(all.length / 1024), 'KB');
