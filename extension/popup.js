const sel = document.getElementById('prov');
chrome.storage.sync.get({ provider: 'gmail' }, ({ provider }) => { sel.value = provider; });
sel.addEventListener('change', () => chrome.storage.sync.set({ provider: sel.value }, () => {
  document.getElementById('st').textContent = 'Saved ✓';
}));

document.getElementById('ffFill').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['filler.js'] });
  window.close();
});