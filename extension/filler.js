// ForiForeign Form Filler v1.2 — deterministic autofill of the CURRENT page's form
// from the user's own FF profile, like a password manager.
// HARD RULES: never clicks submit, never solves CAPTCHAs, never touches passwords,
// payment or OTP fields, never auto-attaches files. Human checkpoints for everything else.
(async () => {
  // Re-run safe: remove any previous overlay/markers before filling again (multi-step forms).
  document.querySelectorAll('.ffx-box,.ffx-badge').forEach(x => x.remove());

  const { ffProfile } = await chrome.storage.local.get('ffProfile');
  if (!ffProfile) { alert('Open your ForiForeign case and press APPLY once first — that loads your profile into the assistant.'); return; }
  const P = ffProfile;

  const MAP = [
    [/first.?name|given.?name|forename/i, (P.full_name || '').split(' ')[0]],
    [/last.?name|sur.?name|family/i, (P.full_name || '').split(' ').slice(1).join(' ')],
    [/full.?name|^name$|applicant.?name|your.?name/i, P.full_name],
    [/e.?mail/i, P.email],
    [/phone|mobile|contact.?number|whatsapp/i, P.phone],
    [/nationality|citizen/i, 'Pakistani'],
    [/country.?of.?(residence|origin)|^country/i, 'Pakistan'],
    [/city|town/i, P.city || ''],
    [/address/i, P.address || ''],
    [/university|institution|college|alma/i, P.last_institution || ''],
    [/degree|qualification/i, P.degree_level || ''],
    [/field|major|subject|discipline|program(?!ming)/i, P.field || ''],
    [/gpa|cgpa|grade/i, P.cgpa || ''],
    [/years.?of.?experience|experience.?\(?years/i, P.experience_years || ''],
    [/ielts|toefl|language.?(score|test)|english.?prof/i, P.language_scores || ''],
    [/linkedin/i, P.linkedin || '']
  ];
  const SKIP = /password|captcha|card.?number|cvv|iban|otp|verification.?code|payment|pin\b/i;

  // React/Vue-safe value setter: frameworks ignore plain .value writes; use the
  // native prototype setter and fire real events so controlled inputs accept the fill.
  const setValue = (el, val) => {
    try {
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set) d.set.call(el, val); else el.value = val;
    } catch (e) { el.value = val; }
    ['input', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  };

  const label = el => (el.labels && el.labels[0] && el.labels[0].textContent || '') + ' ' +
    (el.placeholder || '') + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('aria-label') || '');

  let filled = 0; const pending = []; let badgeN = 0;
  const badge = (el, color) => {
    badgeN++;
    try {
      const b = document.createElement('div'); b.className = 'ffx-badge'; b.textContent = badgeN;
      b.style.cssText = 'position:absolute;z-index:2147483646;background:' + color + ';color:#04101f;font:700 11px Arial;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.4)';
      const r = el.getBoundingClientRect();
      b.style.left = (window.scrollX + Math.max(0, r.left - 22)) + 'px';
      b.style.top = (window.scrollY + r.top) + 'px';
      document.body.appendChild(b);
    } catch (e) {}
    return badgeN;
  };

  document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select').forEach(el => {
    const L = label(el);
    if (SKIP.test(L) || el.type === 'password' || el.value) return;
    for (const [re, val] of MAP) {
      if (re.test(L) && val) {
        if (el.tagName === 'SELECT') {
          const opt = [...el.options].find(o => o.textContent.toLowerCase().includes(String(val).toLowerCase().slice(0, 8)));
          if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
          else break;
        } else setValue(el, val);
        el.style.outline = '2px solid #00D4FF'; filled++; return;
      }
    }
    // A field we could not fill: mark it, remember it, make it one tap away.
    if (L.trim().length > 2) {
      el.style.outline = '2px solid #F5B841';
      const n = badge(el, '#F5B841');
      pending.push({ n, el, text: L.replace(/\s+/g, ' ').trim().slice(0, 55) });
    }
  });

  // File inputs: attachments are ALWAYS a human checkpoint — the assistant marks
  // them, sequences them (highest qualification first), and waits for the user.
  const DEGREE_ORDER = ['phd', 'doctorate', 'master', 'msc', 'ma', 'bachelor', 'bsc', 'ba', 'cv', 'resume', 'cover', 'transcript', 'hssc', 'intermediate', 'matric', 'ssc'];
  const files = [...document.querySelectorAll('input[type=file]')].map(el => {
    el.style.outline = '2px dashed #2dd4bf';
    const n = badge(el, '#2dd4bf');
    return { n, el, text: label(el).replace(/\s+/g, ' ').trim().slice(0, 55) };
  }).sort((a, b) => {
    const ai = DEGREE_ORDER.findIndex(d => a.text.toLowerCase().includes(d));
    const bi = DEGREE_ORDER.findIndex(d => b.text.toLowerCase().includes(d));
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  // Guidance overlay: what was done, what YOU still do, one tap jumps to each item.
  const jump = el => { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); const o = el.style.outline; el.style.outline = '3px solid #fff'; setTimeout(() => el.style.outline = o, 900); } catch (e) {} };
  const box = document.createElement('div'); box.className = 'ffx-box';
  box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;width:330px;max-height:80vh;overflow:auto;background:rgba(8,18,35,.97);color:#fff;border:1px solid #00D4FF;border-radius:14px;padding:16px;font:13px/1.5 Arial;box-shadow:0 12px 40px rgba(0,0,0,.5)';
  box.innerHTML = '<b style="color:#00D4FF">ForiForeign filled ' + filled + ' field' + (filled === 1 ? '' : 's') + ' ✓</b>'
    + (pending.length ? '<div style="margin-top:8px"><b style="color:#F5B841">Complete these yourself (tap to jump):</b><div id="ffxPend"></div></div>' : '')
    + (files.length ? '<div style="margin-top:8px"><b style="color:#2dd4bf">Attach documents here (tap to jump), in this order:</b><div id="ffxFiles"></div><div style="color:#9DB8E4;margin-top:4px">Select the matching file you downloaded from your ForiForeign case. Highest degree first.</div></div>' : '')
    + '<div style="margin-top:10px;color:#9DB8E4">Review every field, then press the portal\'s own <b style="color:#fff">Submit</b> button yourself. ForiForeign never submits, never solves CAPTCHAs, never touches passwords or payments.</div>'
    + '<div style="margin-top:10px;display:flex;gap:8px">'
    + '<button id="ffxAgain" style="background:transparent;color:#00D4FF;border:1px solid #00D4FF;border-radius:8px;padding:7px 12px;cursor:pointer;font-weight:700">Fill next page</button>'
    + '<button id="ffxClose" style="background:#1683FF;color:#fff;border:0;border-radius:8px;padding:7px 14px;cursor:pointer;font-weight:700">Got it</button></div>';
  document.body.appendChild(box);
  const li = (arr, id) => { const host = box.querySelector(id); if (!host) return; arr.slice(0, 10).forEach(it => { const r = document.createElement('div'); r.textContent = it.n + '. ' + it.text; r.style.cssText = 'cursor:pointer;padding:2px 0;border-bottom:1px solid rgba(140,178,255,.15)'; r.onclick = () => jump(it.el); host.appendChild(r); }); };
  li(pending, '#ffxPend'); li(files, '#ffxFiles');
  box.querySelector('#ffxClose').onclick = () => { box.remove(); document.querySelectorAll('.ffx-badge').forEach(x => x.remove()); };
  box.querySelector('#ffxAgain').onclick = () => { box.remove(); document.querySelectorAll('.ffx-badge').forEach(x => x.remove()); chrome.runtime.sendMessage({ type: 'FFX_REFILL' }); };
})();
