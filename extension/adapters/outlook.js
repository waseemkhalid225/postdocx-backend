// outlook.js — Outlook / Microsoft 365 compose adapter. Same rules: attach only,
// user presses Send. Nothing is read from the mailbox.
(async function () {
  const { ff_pending } = await chrome.storage.session.get('ff_pending');
  if (!ff_pending || Date.now() - ff_pending.ts > 15 * 60 * 1000) return;
  const pkg = ff_pending.pkg;
  const waitFor = (sel, ms) => new Promise((res) => {
    const t0 = Date.now();
    (function look() {
      const el = document.querySelector(sel);
      if (el) return res(el);
      if (Date.now() - t0 > ms) return res(null);
      setTimeout(look, 400);
    })();
  });
  const compose = await waitFor('div[role="textbox"][aria-label], div[contenteditable="true"]', 25000);
  if (!compose) return;

  /* Insert the COMPLETE prepared body (URL parameters truncate long emails). */
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
    ['dragenter', 'dragover', 'drop'].forEach(type => {
      compose.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
  }
  const b = document.createElement('div');
  b.textContent = files.length
    ? 'ForiForeign: ' + files.length + ' document(s) attached. Review, then press Send yourself.'
    : 'ForiForeign: email prepared. Attach your downloaded documents, review, then press Send.';
  b.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#0a1832;color:#eef4ff;border:1px solid #F1C40F;border-radius:12px;padding:10px 18px;z-index:99999;font:600 13px system-ui';
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 9000);
  chrome.storage.session.remove('ff_pending');
})();
