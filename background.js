// The toolbar button, the shortcuts, and the sites the user turned on.
// pin.js runs in the page's own world (where React's data is) with bridge.js beside it in the
// extension's world, passing it settings. On localhost both load from the manifest. Elsewhere the
// toolbar button or the toggle shortcut loads them into that tab (activeTab, nothing else), and a
// site added with "Always load on this site" gets them on every visit (an optional host permission
// for that site, asked for when it's added).

const inject = async tabId => {
  const target = { tabId }
  const [{ result: loaded }] = await chrome.scripting.executeScript({ target, world: 'MAIN', func: () => !!window.__pin })
  if (!loaded) {
    await chrome.scripting.executeScript({ target, files: ['bridge.js'] })
    await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['pin.js'] })
  }
  return loaded
}
const call = (tabId, name) =>
  chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: name => window.__pin?.[name](), args: [name] })

// Errors are pages extensions can't touch: chrome://, the Web Store, the PDF viewer.
chrome.action.onClicked.addListener(async tab => {
  try {
    await call(tab.id, (await inject(tab.id)) ? 'toggleHidden' : 'show')
  } catch {}
})

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab?.id) return
  try {
    if (command === 'toggle-pin') await inject(tab.id), await call(tab.id, 'toggle')
    if (command === 'copy-feedback') await call(tab.id, 'copyAll')
  } catch {}
})

// Shortcut names for the island's hints (bridge.js asks).
const NAMES = { 'toggle-pin': 'toggle', 'copy-feedback': 'copy' }
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message !== 'keys') return
  chrome.commands.getAll().then(commands => reply(Object.fromEntries(commands.map(c => [NAMES[c.name] ?? c.name, c.shortcut]))))
  return true
})

// ---- sites beyond localhost ----------------------------------------------------------------

// Every granted site, except the manifest's own (localhost), gets pin.js as a registered content
// script. Run on install, on browser start, and whenever a site is added or removed (here, from the
// options page, or from chrome://extensions).
const LOCAL = chrome.runtime.getManifest().content_scripts.flatMap(c => c.matches)
let syncing = Promise.resolve()
const sync = () =>
  (syncing = syncing.then(async () => {
    const { origins = [] } = await chrome.permissions.getAll()
    const matches = origins.filter(o => !LOCAL.includes(o))
    await chrome.scripting.unregisterContentScripts().catch(() => {})
    if (!matches.length) return
    await chrome.scripting.registerContentScripts([
      { id: 'bridge', matches, js: ['bridge.js'], runAt: 'document_idle' },
      { id: 'pin', matches, js: ['pin.js'], world: 'MAIN', runAt: 'document_idle' },
    ])
  }).catch(console.error))

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'add', title: 'Always load on this site', contexts: ['action'] })
  chrome.contextMenus.create({ id: 'remove', title: 'Stop loading on this site', contexts: ['action'] })
  sync()
})
chrome.runtime.onStartup.addListener(sync)
chrome.permissions.onAdded.addListener(sync)
chrome.permissions.onRemoved.addListener(sync)

// The toolbar button's right-click menu. The permission prompt has to open during the click, so
// it's asked for before anything is awaited.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let url
  try {
    url = new URL(tab?.url || info.pageUrl)
  } catch {
    return
  }
  if (!/^https?:$/.test(url.protocol)) return
  const origins = [`${url.protocol}//${url.hostname}/*`]
  if (info.menuItemId === 'add') {
    const granted = await chrome.permissions.request({ origins })
    if (granted && tab?.id) await inject(tab.id).then(() => call(tab.id, 'show')).catch(() => {})
  }
  if (info.menuItemId === 'remove') await chrome.permissions.remove({ origins }).catch(() => {})
})
