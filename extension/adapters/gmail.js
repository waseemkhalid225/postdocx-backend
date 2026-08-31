// gmail.js — Gmail compose adapter. Attaches the prepared documents by fetching the
// short-lived signed URLs and dropping them into the compose window. Never reads
// mail, never presses Send.
(async function () {
  const { ff_pending } = await chrome.storage.session.get('ff_pending');
  if (!ff_pending || Date.now() - ff_pending.ts > 15 * 60 * 1000) return;
  const pkg = ff_pending.pkg;
  // wait for a compose window
  const waitFor = (sel, ms) => new Promise((res) => {
    const t0 = Date.now();
    (function look() {
      const el = document.querySelector(sel);
      if (el) return res(el);
      if (Date.now() - t0 > ms) return res(null);
      setTimeout(look, 400);
    })();
  });
  const compose = await waitFor('div[aria-label="Message Body"], div[g_editable="true"]', 25000);
  if (!compose) return;

  /* Insert the COMPLETE prepared body. The URL parameter can only carry an opening
     portion before hitting browser URL limits, so the full text is written here.
     Plain text with real line breaks, exactly as prepared. Nothing is sent. */
  try {
    const full = String(pkg.body || '');
    const current = (compose.innerText || '').trim();
    if (full && full.length > current.length) {
      compose.innerHTML = '';
      full.split('\n').forEach(line => {
        const div = document.createElement('div');
        if (line.trim() === '') div.appendChild(document.createElement('br'));
        else div.textContent = line;
        compose.appendChild(div);
      });
      compose.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } catch (e) {}
  // fetch prepared documents as files
  const files = []; const failed = [];
  for (const a of (pkg.attachments || [])) {
    try {
      const r = await fetch(a.url.startsWith('http') ? a.url : 'https://foriforeign.com' + a.url);
      if (!r.ok) { failed.push(a.filename + ' (' + r.status + ')'); continue; }
      const blob = await r.blob();
      // Use the real type from the response: forcing application/pdf corrupted any
      // Word or image file the applicant uploaded.
      files.push(new File([blob], a.filename, { type: blob.type || 'application/octet-stream' }));
    } catch (e) { failed.push(a.filename); }
  }
  if (files.length) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    const target = compose.closest('div[role="dialog"]') || compose;
    ['dragenter', 'dragover', 'drop'].forEach(type => {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
  }
  banner(files.length
    ? ('ForiForeign: ' + files.length + ' document(s) attached' + (failed.length ? ', ' + failed.length + ' could not be fetched' : '') + '. Review everything, then press Send yourself.')
    : ('ForiForeign: could not attach automatically' + (failed.length ? ' (' + failed.slice(0,2).join(', ') + ')' : '') + '. Download your documents from the case and attach them, then press Send.'));
  chrome.storage.session.remove('ff_pending');
  function banner(text) {
    const b = document.createElement('div');
    b.textContent = text;
    b.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#0a1832;color:#eef4ff;border:1px solid #F1C40F;border-radius:12px;padding:10px 18px;z-index:99999;font:600 13px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 9000);
  }
})();
