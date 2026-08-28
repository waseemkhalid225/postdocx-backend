// background.js — holds ONE pending package in session storage (cleared on browser
// close), opens the user's email provider compose. Never reads mail, never sends.
const COMPOSE = {
  gmail: (p) => 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(p.recipient) + '&su=' + encodeURIComponent(p.subject) + '&body=' + encodeURIComponent((p.body || '').slice(0, 1800)),
  outlook: (p) => 'https://outlook.live.com/mail/0/deeplink/compose?to=' + encodeURIComponent(p.recipient) + '&subject=' + encodeURIComponent(p.subject) + '&body=' + encodeURIComponent((p.body || '').slice(0, 1800)),
  yahoo: (p) => 'https://compose.mail.yahoo.com/?to=' + encodeURIComponent(p.recipient) + '&subject=' + encodeURIComponent(p.subject) + '&body=' + encodeURIComponent((p.body || '').slice(0, 1800))
};
chrome.runtime.onMessage.addListener((msg, sender) => {
  // "Fill next page" from the overlay: re-inject the filler into the SAME tab the
  // user is on. Same activeTab-granted tab only — no new permissions, no navigation.
  if (msg && msg.type === 'FFX_REFILL' && sender.tab && sender.tab.id != null) {
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
