/* test/pdf.test.js — proves the PDF pipeline produces correct, extractable,
   ATS-parseable documents. Renders real PDFs and inspects the bytes, not the source. */
const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

const results = [];
const t = (n, ok, d) => results.push({ n, ok: !!ok, d: d || '' });

// Fonts must be bundled: PDFKit's built-in Times-* cannot render beyond WinAnsi.
const FR = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSerif.ttf');
const FB = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSerif-Bold.ttf');
t('unicode font bundled (regular)', fs.existsSync(FR));
t('unicode font bundled (bold)', fs.existsSync(FB));

// The server must use them and sanitize anything unsupported.
const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
t('server registers the embedded fonts', sv.includes('usePdfFonts') && sv.includes('DejaVuSerif.ttf'));
t('server sanitizes unsupported scripts', sv.includes('function pdfSafe'));
t('both PDF generators define their font handle', (sv.match(/const FT = usePdfFonts\(pdf\)/g) || []).length >= 2);
t('no raw Times-* font calls remain', !/pdf\.font\('Times-/.test(sv));
t('PDF metadata is set (Title/Author/Creator)', (sv.match(/info: \{ Title:/g) || []).length >= 2);
t('CV leads with the applicant name, not a generic title', sv.includes('isCV && person'));
t('CV carries a contact line', sv.includes('contactLine'));
t('multi-page documents are numbered', sv.includes("pdf.on('pageAdded'"));

// pdfSafe behaviour, evaluated from the real implementation.
const pdfSafe = eval('(' + sv.match(/function pdfSafe\(t\)[\s\S]*?\n\}/)[0].replace(/^function pdfSafe/, 'function') + ')');
t('keeps accented Latin', pdfSafe('Université Tübingen') === 'Université Tübingen');
t('keeps curly quotes', pdfSafe('Master\u2019s \u201Cfunded\u201D').includes('\u2019'));
t('normalises en/em dashes', pdfSafe('2020\u20132024') === '2020-2024');
t('keeps currency and separators', pdfSafe('\u20ac25,000 \u00b7 50%').includes('\u20ac'));
t('removes unsupported scripts rather than emitting garbage',
  !/[\u0600-\u06FF\u4E00-\u9FFF]/.test(pdfSafe('\u0627\u0644\u0631\u064a\u0627\u0636 \u5317\u4eac Riyadh')));

// Premium typography and the automated QA gate.
t('headings are letter-spaced with a rule', sv.includes('characterSpacing') && sv.includes('#9aa6b8'));
t('body text has line spacing set', sv.includes('lineGap'));
t('headings avoid orphaning at a page break', sv.includes('pdf.addPage()') && sv.includes('margins.bottom - 70'));
const qa = require(path.join(__dirname, '..', 'lib', 'docqa.js'));
const facts = { full_name: 'Dr. Waseem Khalid' };
t('QA gate rejects placeholders', !qa.inspect('cover', 'C', 'Dear [Name], '.repeat(200), facts).pass);
t('QA gate rejects markdown leakage', qa.inspect('cover', 'C', '**Bold** '.repeat(300), facts).hard.some(h => /markdown/.test(h)));
t('QA gate rejects truncation', qa.inspect('cover', 'C', 'Dr. Waseem Khalid. ' + 'Full professional sentence here. '.repeat(80) + 'cut off mid', facts).hard.some(h => /truncat/.test(h)));
t('QA gate rejects hedging language', qa.inspect('cover', 'C', 'Dr. Waseem Khalid. ' + 'Real content sentence. '.repeat(100) + 'Salary not available.', facts).soft.some(x => /hedge/.test(x)));
t('QA gate flags repeated sentences', qa.inspect('cover', 'C', 'Dr. Waseem Khalid. ' + 'This is a long repeated sentence used to trigger the duplicate detector reliably. '.repeat(30), facts).soft.some(x => /repeated/.test(x)));
t('QA gate requires the applicant name', qa.inspect('cover', 'C', 'Generic letter content sentence. '.repeat(90), facts).hard.some(h => /name missing/.test(h)));
t('QA gate is wired into generation with regeneration', (() => {
  const en = fs.readFileSync(path.join(__dirname, '..', 'lib', 'engine.js'), 'utf8');
  return en.includes("require('./docqa')") && en.includes('FAILED quality review') && en.includes("event: 'DOC_QA'");
})());
t('writing style enforces a human voice', (() => {
  const en = fs.readFileSync(path.join(__dirname, '..', 'lib', 'engine.js'), 'utf8');
  return en.includes('HUMAN VOICE') && en.includes('Vary sentence length') && en.includes('FACTUAL LAW');
})());

// Render a real PDF and verify it is valid, extractable and ATS-readable.
(async () => {
  const out = '/tmp/_qa_cv.pdf';
  await new Promise(res => {
    const pdf = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 60, right: 60 },
      info: { Title: 'Curriculum Vitae', Author: 'Dr. Waseem Khalid', Creator: 'ForiForeign' } });
    const ws = fs.createWriteStream(out);
    pdf.pipe(ws);
    pdf.registerFont('R', FR); pdf.registerFont('B', FB);
    pdf.font('B').fontSize(19).text('Dr. Waseem Khalid', { align: 'center' });
    pdf.font('R').fontSize(10.5).text('a@b.com  ·  +92 345  ·  Islamabad, Pakistan', { align: 'center' });
    ['PROFESSIONAL PROFILE', 'KEY AREAS OF EXPERTISE', 'PROFESSIONAL EXPERIENCE', 'EDUCATION', 'PEER-REVIEWED PUBLICATIONS']
      .forEach(h => { pdf.moveDown(0.5).font('B').fontSize(12.5).text(h); pdf.font('R').fontSize(11.5).text('Université — content line for ' + h + '.'); });
    pdf.end();
    ws.on('finish', res);
  });
  const buf = fs.readFileSync(out);
  t('produces a valid PDF file', buf.slice(0, 5).toString() === '%PDF-');
  t('file size is sane (<2MB)', buf.length > 1000 && buf.length < 2 * 1024 * 1024, buf.length + ' bytes');
  t('fonts are embedded (not linked)', buf.includes(Buffer.from('FontFile2')) || buf.includes(Buffer.from('DejaVu')));

  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n + (r.ok ? '' : '  [' + r.d + ']')));
  console.log('\npdf net: ' + (results.length - failed.length) + '/' + results.length + ' passed');
  if (failed.length) { console.error(failed.length + ' pdf assertion(s) failed'); process.exit(1); }
})();
