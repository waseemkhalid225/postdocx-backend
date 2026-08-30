// lib/cvtheme.js — Theme-preserving CV tailoring.
// When the user's ORIGINAL CV is a .docx, we edit that file's own document.xml
// in place: fonts, colours, styles, layout are the user's, untouched. We only
// (a) apply safe text substitutions the writer proposes, and (b) append a new
// professionally-formatted section for opportunity-specific additions, reusing
// the document's existing paragraph/run styles so it blends in.
//
// If anything at all is uncertain, callers fall back to the normal generated CV.

const AdmZip = require('adm-zip');

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Pull the visible plain text out of document.xml (for the AI to reason over).
function docxText(buffer) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) return '';
  const xml = entry.getData().toString('utf8');
  return xml
    .replace(/<w:tab[^>]*\/>/g, ' ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

// Find the dominant paragraph+run style in the body so appended content matches.
function sampleStyle(xml) {
  const pPr = (xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [])[0] || '';
  const rPr = (xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [])[0] || '';
  // A heading tends to be bold; try to grab a bold rPr for section titles.
  const boldRpr = (xml.match(/<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*?<w:b\/>[\s\S]*?<\/w:rPr>/) || [])[0] || '<w:rPr><w:b/></w:rPr>';
  return { pPr, rPr, boldRpr };
}

function makePara(text, rPr, pPr) {
  return '<w:p>' + (pPr || '') + '<w:r>' + (rPr || '') + '<w:t xml:space="preserve">' + xmlEscape(text) + '</w:t></w:r></w:p>';
}

// Build the appended, theme-matched section. additions = [{heading, lines:[]}]
function buildAdditionsXml(additions, style) {
  let out = '';
  // spacer
  out += makePara('', style.rPr, style.pPr);
  for (const sec of additions) {
    if (sec.heading) out += makePara(String(sec.heading).toUpperCase(), style.boldRpr, style.pPr);
    for (const ln of (sec.lines || [])) out += makePara(String(ln), style.rPr, style.pPr);
  }
  return out;
}

/**
 * Produce a themed .docx buffer from the user's original .docx.
 * @param originalBuffer Buffer of the user's uploaded .docx
 * @param edits { replacements?: [{find,replace}], additions?: [{heading,lines}] }
 * @returns Buffer of the new .docx, or null if it cannot be done safely.
 */
function tailorDocx(originalBuffer, edits = {}) {
  try {
    const zip = new AdmZip(originalBuffer);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) return null;
    let xml = entry.getData().toString('utf8');
    const bodyClose = xml.lastIndexOf('</w:body>');
    if (bodyClose < 0) return null;

    // (a) safe literal text replacements (only inside <w:t> runs, exact visible text)
    for (const r of (edits.replacements || [])) {
      if (!r || !r.find || r.replace == null) continue;
      const find = xmlEscape(r.find), repl = xmlEscape(r.replace);
      // replace only within <w:t> ... </w:t> to avoid corrupting markup
      xml = xml.replace(/(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g, (m, a, txt, b) =>
        a + txt.split(find).join(repl) + b);
    }

    // (b) append theme-matched additions before </w:body> (but before sectPr if present)
    let additionsXml = '';
    if ((edits.additions || []).length) {
      additionsXml = buildAdditionsXml(edits.additions, sampleStyle(xml));
    }
    if (additionsXml) {
      const sectPr = xml.lastIndexOf('<w:sectPr');
      const insertAt = (sectPr > -1 && sectPr < bodyClose) ? sectPr : bodyClose;
      xml = xml.slice(0, insertAt) + additionsXml + xml.slice(insertAt);
    }

    zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
    return zip.toBuffer();
  } catch (e) {
    return null;
  }
}

module.exports = { docxText, tailorDocx };
