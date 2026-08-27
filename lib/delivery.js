// lib/delivery.js — ApplicationDeliveryProvider abstraction (spec #23).
//
// The AI/application engine only ever produces an ApplicationPackage. HOW that package
// reaches the user's email is decided by a delivery provider. Today the only provider is
// the ForiForeign Apply Assistant (browser extension) with a universal web fallback.
// Tomorrow a Browser Agent, Desktop Agent, or provider-specific adapter can be added here
// WITHOUT touching the engine, the package format, or the frontend contract.
//
// A provider is a small descriptor: an id, a label, whether it is currently available
// (driven by admin settings), and the capabilities it supports. The frontend asks
// `listProviders(settings)` and picks the first available one; the package itself is
// always identical and provider-independent.

const PROVIDERS = [
  {
    id: 'apply_assistant',
    label: 'ForiForeign Apply Assistant',
    kind: 'browser_extension',
    // auto-attach works on Gmail + Outlook web compose
    capabilities: { prefill: true, autoAttach: ['gmail', 'outlook'], autoSend: false },
    available: (s) => (s.apply_assistant || {}).enabled !== false
  },
  {
    id: 'web_fallback',
    label: 'Open in your email',
    kind: 'web',
    // always works, every browser; user attaches downloaded documents
    capabilities: { prefill: true, autoAttach: [], autoSend: false },
    available: () => true
  }
  // Future: { id:'browser_agent', kind:'agent', ... }, { id:'desktop_agent', ... }
];

function listProviders(settings) {
  const s = settings || {};
  return PROVIDERS.filter(p => {
    try { return p.available(s); } catch (e) { return false; }
  }).map(p => ({ id: p.id, label: p.label, kind: p.kind, capabilities: p.capabilities }));
}

// The delivery layer NEVER sends. It only decides how the package is placed in the user's
// own compose window. autoSend is always false by contract — the user presses Send.
function assertNeverAutoSends() {
  return PROVIDERS.every(p => p.capabilities.autoSend === false);
}

module.exports = { PROVIDERS, listProviders, assertNeverAutoSends };
