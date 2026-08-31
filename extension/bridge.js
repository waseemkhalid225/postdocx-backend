// bridge.js — runs ONLY on foriforeign.com. Receives one application package the
// user explicitly chose (APPLY), passes it to the background worker. Reads nothing else.
(function () {
  // announce presence so the site shows the one-click path
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'FF_ASSIST_PING') {
      window.postMessage({ type: 'FF_ASSIST_HELLO', v: '1.0.0' }, location.origin);
    }
    if (e.data.type === 'FF_OPEN_PORTAL' && e.data.url) {
      // Ask the worker to request permission for that portal, open it and fill it.
      chrome.runtime.sendMessage({ type: 'FF_OPEN_PORTAL', url: e.data.url }, resp => {
        window.postMessage({ type: 'FF_PORTAL_RESULT', ok: !!(resp && resp.ok), autofill: !!(resp && resp.autofill) }, location.origin);
      });
    }
    if (e.data.type === 'FF_APPLY' && e.data.pkg) {
      chrome.runtime.sendMessage({ type: 'FF_APPLY', pkg: e.data.pkg, sig: e.data.sig, origin: location.origin });
    }
  });
  window.postMessage({ type: 'FF_ASSIST_HELLO', v: '1.0.0' }, location.origin);
})();

window.addEventListener('message', ev => {
  const d = ev.data || {};
  if (d.type === 'FF_PROFILE' && d.profile) chrome.storage.local.set({ ffProfile: d.profile });
});