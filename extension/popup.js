const sel = document.getElementById('prov');
chrome.storage.sync.get({ provider: 'gmail' }, ({ provider }) => { sel.value = provider; });
sel.addEventListener('change', () => chrome.storage.sync.set({ provider: sel.value }, () => {
  document.getElementById('st').textContent = 'Saved ✓';
}));
