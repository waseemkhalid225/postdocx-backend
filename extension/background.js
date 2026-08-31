// background.js — holds ONE pending package in session storage (cleared on browser
// close), opens the user's email provider compose. Never reads mail, never sends.
/* Compose URLs carry only the short fields. The full body is inserted into the compose
   window by the adapter: URL length limits were truncating prepared emails (~2,300
   characters) at 1,800, delivering drafts cut off mid-sentence. */
const SHORT_BODY = 1200;   // opening portion only, as a safety net if the adapter is slow
const COMPOSE = {
  gmail: (p) => 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(p.recipient) + '&su=' + encodeURIComponent(p.subject) + '&body=' + encodeURIComponent((p.body || '').slice(0, SHORT_BODY)),
  outlook: (p) => 'https://outlook.live.com/mail/0/deeplink/compose?to=' + encodeURIComponent(p.recipient) + '&subject=' + encodeURIComponent(p.subject) + '&body=' + encodeURIComponent((p.body || '').slice(0, SHORT_BODY)),
  yahoo: (p) => 'https://compose.mail.yahoo.com/?to=' + encodeURIComponent(p.recipient) + '&subject=' + encodeURIComponent(p.subject) + '&body=' + encodeURIComponent((p.body || '').slice(0, SHORT_BODY))
};
/* PORTAL AUTOPILOT (opt-in, per site).
   The site asks to open an application portal. We request permission for THAT ONE
   origin, open it, and inject the filler once the page has loaded. The user grants the
   permission explicitly in Chrome's own dialog, and the filler still never submits,
   never touches CAPTCHA/OTP/passwords, and never attaches files. */
const _pendingFill = new Map();   // tabId -> true
const _refills = new Map();       // tabId -> { n, t } refill rate limiting

function originPatternFor(url) {
  try { const u = new URL(url); if (u.protocol !== 'https:') return null; return u.origin + '/*'; }
  catch (e) { return null; }
}

async function openPortalAndFill(url, sendResponse) {
  const pattern = originPatternFor(url);
  if (!pattern) { sendResponse && sendResponse({ ok: false, reason: 'bad_url' }); return; }
  chrome.permissions.request({ origins: [pattern] }, granted => {
    if (!granted) {
      // Still open the portal; the user can fill manually via the popup button.
      chrome.tabs.create({ url });
      sendResponse && sendResponse({ ok: true, autofill: false });
      return;
    }
    chrome.tabs.create({ url }, tab => {
      if (tab && tab.id != null) _pendingFill.set(tab.id, true);
      sendResponse && sendResponse({ ok: true, autofill: true });
    });
  });
}

// When a tab we were asked to autofill finishes loading, inject the filler once.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'complete' || !_pendingFill.get(tabId)) return;
  _pendingFill.delete(tabId);
  chrome.scripting.executeScript({ target: { tabId }, files: ['filler.js'] }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => _pendingFill.delete(tabId));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Open the official portal for a chosen case and fill it automatically (with consent).
  if (msg && msg.type === 'FF_OPEN_PORTAL' && msg.url) {
    const okOrigin = sender.url && /^https:\/\/(www\.)?foriforeign\.com\//.test(sender.url);
    if (!okOrigin) return;
    openPortalAndFill(msg.url, sendResponse);
    return true;  // keep the message channel open for the async response
  }
  // "Fill next page" from the overlay: re-inject the filler into the SAME tab the
  // user is on. Same activeTab-granted tab only — no new permissions, no navigation.
  if (msg && msg.type === 'FFX_REFILL' && sender.tab && sender.tab.id != null) {
    // Rate limit: at most 10 refills per tab per minute. Protects the host site from
    // any accidental loop and keeps behaviour indistinguishable from a human clicking.
    const id = sender.tab.id, now = Date.now();
    const rec = _refills.get(id) || { n: 0, t: now };
    if (now - rec.t > 60000) { rec.n = 0; rec.t = now; }
    rec.n++; _refills.set(id, rec);
    if (_refills.size > 200) _refills.clear();
    if (rec.n > 10) return;
    setTimeout(() => chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, files: ['filler.js'] }).catch(() => {}), 400);
    return;
  }
  if (!msg || msg.type !== 'FF_APPLY' || !msg.pkg) return;
  // origin validation: only accept packages from foriforeign.com pages
  const okOrigin = sender.url && /^https:\/\/(www\.)?foriforeign\.com\//.test(sender.url);
  if (!okOrigin) return;
  const pkg = msg.pkg;
  if (Number(pkg.exp) < Date.now()) return; // expired package
  chrome.storage.session.set({ ff_pending: { pkg, ts: Date.now() } }, () => {
    chrome.storage.sync.get({ provider: 'gmail' }, ({ provider }) => {
      const mk = COMPOSE[provider] || COMPOSE.gmail;
      chrome.tabs.create({ url: mk(pkg) });
    });
  });
});
