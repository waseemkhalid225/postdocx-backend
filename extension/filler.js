// ForiForeign Form Filler — Phase 2/3.
// Deterministic autofill of the CURRENT page's form from the user's own FF profile,
// like a password manager. Highlights what it filled, overlays guidance for the rest.
// HARD RULES: never clicks submit, never solves CAPTCHAs, never touches passwords/payment.
(async () => {
  const { ffProfile } = await chrome.storage.local.get('ffProfile');
  if (!ffProfile) { alert('Open your ForiForeign case and press APPLY once first — that loads your profile into the assistant.'); return; }
  const P = ffProfile;
  const MAP = [
    [/first.?name|given.?name/i, (P.full_name || '').split(' ')[0]],
    [/last.?name|sur.?name|family/i, (P.full_name || '').split(' ').slice(1).join(' ')],
    [/full.?name|^name$|applicant.?name/i, P.full_name],
    [/e.?mail/i, P.email],
    [/phone|mobile|contact.?number|whatsapp/i, P.phone],
    [/nationality|citizen/i, 'Pakistani'],
    [/country.?of.?(residence|origin)|^country/i, 'Pakistan'],
    [/city/i, P.city || ''],
    [/address/i, P.address || ''],
    [/university|institution|college/i, P.last_institution || ''],
    [/degree|qualification/i, P.degree_level || ''],
    [/field|major|subject|discipline|program/i, P.field || ''],
    [/gpa|cgpa|grade/i, P.cgpa || ''],
    [/experience|years.?of/i, P.experience_years || ''],
    [/ielts|toefl|language.?(score|test)|english.?prof/i, P.language_scores || ''],
    [/linkedin/i, P.linkedin || ''],
  ];
  const SKIP = /password|captcha|card|cvv|iban|otp|verification.?code|payment/i;
  let filled = 0; const pending = [];
  const label = el => (el.labels && el.labels[0] && el.labels[0].textContent || '') + ' ' + (el.placeholder || '') + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('aria-label') || '');
  document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select').forEach(el => {
    const L = label(el);
    if (SKIP.test(L) || el.type === 'password' || el.value) return;
    for (const [re, val] of MAP) {
      if (re.test(L) && val) {
        if (el.tagName === 'SELECT') {
          const opt = [...el.options].find(o => o.textContent.toLowerCase().includes(String(val).toLowerCase().slice(0, 8)));
          if (opt) { el.value = opt.value; } else break;
        } else el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        el.style.outline = '2px solid #00D4FF'; filled++; return;
      }
    }
    if (L.trim().length > 2) pending.push(L.replace(/\s+/g, ' ').trim().slice(0, 60));
  });
  // Document sequencing: highest qualification first (PhD > Masters > Bachelors > others).
  const DEGREE_ORDER = ['phd','doctorate','master','msc','ma','bachelor','bsc','ba','hssc','intermediate','matric','ssc'];
  const fileInputs = [...document.querySelectorAll('input[type=file]')];
  const files = fileInputs.map(el => label(el).replace(/\s+/g, ' ').trim().slice(0, 60))
    .sort((a,b)=>{const ai=DEGREE_ORDER.findIndex(d=>a.toLowerCase().includes(d));const bi=DEGREE_ORDER.findIndex(d=>b.toLowerCase().includes(d));return (ai<0?99:ai)-(bi<0?99:bi)});
  // Phase 3: guidance overlay — what's done, what YOU still do. You press Submit.
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;width:320px;background:rgba(8,18,35,.97);color:#fff;border:1px solid #00D4FF;border-radius:14px;padding:16px;font:13px/1.5 Arial;box-shadow:0 12px 40px rgba(0,0,0,.5)';
  box.innerHTML = '<b style="color:#00D4FF">ForiForeign filled ' + filled + ' field' + (filled === 1 ? '' : 's') + ' ✓</b>'
    + (pending.length ? '<div style="margin-top:8px"><b>Please complete yourself:</b><br>' + pending.slice(0, 8).map(x => '• ' + x).join('<br>') + '</div>' : '')
    + (files.length ? '<div style="margin-top:8px"><b>Attach these documents in this order:</b><br>' + files.slice(0, 8).map((x,i) => (i+1) + '. ' + x).join('<br>') + '<br><span style="color:#9DB8E4">Open each upload box and select the matching file you downloaded from your ForiForeign case (highest degree first).</span></div>' : '')
    + '<div style="margin-top:10px;color:#9DB8E4">Review everything, then press the portal\'s own Submit button yourself. ForiForeign never submits for you.</div>'
    + '<button id="ffCloseBox" style="margin-top:10px;background:#1683FF;color:#fff;border:0;border-radius:8px;padding:7px 14px;cursor:pointer;font-weight:700">Got it</button>';
  document.body.appendChild(box);
  document.getElementById('ffCloseBox').onclick = () => box.remove();
})();
