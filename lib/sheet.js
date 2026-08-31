// lib/sheet.js — dependency-free spreadsheet reading.
// Replaces the `xlsx` package, which carries unfixed prototype-pollution and ReDoS
// advisories. We read .xlsx by unzipping the OOXML ourselves (adm-zip is already a
// dependency) and .csv with a proper RFC-4180 parser. No eval, no prototype writes.

const AdmZip = require('adm-zip');

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

// Parse CSV/TSV respecting quotes, escaped quotes and embedded newlines.
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const d = delimiter || (text.indexOf('\t') > -1 && text.indexOf(',') === -1 ? '\t' : ',');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === d) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Read the first worksheet of an .xlsx buffer into rows of strings.
function readXlsxRows(buffer) {
  const zip = new AdmZip(buffer);
  const sstEntry = zip.getEntry('xl/sharedStrings.xml');
  const shared = [];
  if (sstEntry) {
    const xml = sstEntry.getData().toString('utf8');
    // Each <si> may contain multiple <t> runs; join them.
    const items = xml.match(/<si\b[\s\S]*?<\/si>/g) || [];
    for (const si of items) {
      const parts = (si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [])
        .map(t => decodeXmlEntities(t.replace(/<t\b[^>]*>/, '').replace(/<\/t>/, '')));
      shared.push(parts.join(''));
    }
  }
  // Find the first sheet part.
  const sheetEntry = zip.getEntry('xl/worksheets/sheet1.xml')
    || zip.getEntries().find(e => /^xl\/worksheets\/.*\.xml$/.test(e.entryName));
  if (!sheetEntry) return [];
  const sx = sheetEntry.getData().toString('utf8');

  const colIndex = ref => {
    const m = String(ref || '').match(/^([A-Z]+)/);
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  const rows = [];
  const rowMatches = sx.match(/<row\b[\s\S]*?<\/row>/g) || [];
  for (const r of rowMatches) {
    const cells = r.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) || [];
    const out = [];
    for (const c of cells) {
      const ref = (c.match(/ r="([A-Z]+\d+)"/) || [])[1];
      const type = (c.match(/ t="([^"]+)"/) || [])[1];
      let val = '';
      if (type === 'inlineStr') {
        val = (c.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [])
          .map(t => decodeXmlEntities(t.replace(/<t\b[^>]*>/, '').replace(/<\/t>/, ''))).join('');
      } else {
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (v != null) {
          if (type === 's') { const idx = parseInt(v, 10); val = shared[idx] != null ? shared[idx] : ''; }
          else val = decodeXmlEntities(v);
        }
      }
      const at = ref ? colIndex(ref) : out.length;
      while (out.length < at) out.push('');
      out[at] = val;
    }
    rows.push(out);
  }
  return rows;
}

/** Read rows from a buffer for the given file extension. Returns array of string arrays. */
function readRows(buffer, ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'csv' || e === 'tsv' || e === 'txt') return parseDelimited(buffer.toString('utf8'));
  if (e === 'xlsx' || e === 'xlsm') return readXlsxRows(buffer);
  if (e === 'xls') throw new Error('Legacy .xls is not supported. Please save as .xlsx or .csv.');
  return [];
}

module.exports = { readRows, parseDelimited, readXlsxRows };
