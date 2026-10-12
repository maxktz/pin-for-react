// The extension's side of pin.js. pin.js runs in the page's own world (where React's data is) and
// has no extension APIs, so this sends it the settings from the options page and the names of the
// shortcuts: when it asks (on load), and again whenever the settings change.
;(() => {
  if (globalThis.__pinBridge) return
  globalThis.__pinBridge = true
  const send = async () => {
    const [{ settings }, keys] = await Promise.all([
      chrome.storage.sync.get('settings'),
      chrome.runtime.sendMessage('keys').catch(() => ({})),
    ])
    document.dispatchEvent(new CustomEvent('react-pin:settings', { detail: JSON.stringify({ ...settings, keys }) }))
  }
  document.addEventListener('react-pin:hello', send)
  chrome.storage.onChanged.addListener(send)
  send()
})()
