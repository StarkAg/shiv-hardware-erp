const input = document.getElementById('server')
chrome.storage.sync.get('server').then(({ server }) => { input.value = server || 'http://localhost:3333' })
document.getElementById('save').onclick = async () => {
  await chrome.storage.sync.set({ server: input.value.trim() })
  document.getElementById('msg').textContent = 'Saved'
}
