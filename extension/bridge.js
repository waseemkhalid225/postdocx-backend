// bridge.js — runs ONLY on foriforeign.com. Receives one application package the
// user explicitly chose (APPLY), passes it to the background worker. Reads nothing else.
(function () {
  // announce presence so the site shows the one-click path
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'FF_ASSIST_PING') {
      window.postMessage({ type: 'FF_ASSIST_HELLO', v: '1.0.0' }, location.origin);
    }
    if (e.data.type === 'FF_APPLY' && e.data.pkg) {
      chrome.runtime.sendMessage({ type: 'FF_APPLY', pkg: e.data.pkg, sig: e.data.sig, origin: location.origin });
    }
  });
  window.postMessage({ type: 'FF_ASSIST_HELLO', v: '1.0.0' }, location.origin);
})();
