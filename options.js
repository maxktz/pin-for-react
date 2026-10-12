// Settings live in chrome.storage.sync ({ settings }); bridge.js passes them to pin.js.
const DEFAULTS = { localhost: true, selector: true, page: true }
const $ = id => document.getElementById(id)
const mac = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform)

const load = async () => ({ ...DEFAULTS, ...(await chrome.storage.sync.get('settings')).settings })
const save = async patch => chrome.storage.sync.set({ settings: { ...(await load()), ...patch } })

for (const id of Object.keys(DEFAULTS)) $(id).addEventListener('change', e => save({ [id]: e.target.checked }))

// Extension shortcuts (rebindable) first, then the fixed in-page keys.
const renderKeys = async () => {
  for (const row of document.querySelectorAll('.cmd')) row.remove()
  const commands = await chrome.commands.getAll()
  // copy-feedback shows in the in-page row instead ("⌃C or <shortcut>").
  for (const c of commands.filter(c => c.description && c.name !== 'copy-feedback').reverse()) {
    const row = document.createElement('div')
    row.className = 'row cmd'
    row.append(Object.assign(document.createElement('span'), { textContent: c.description }))
    row.append(Object.assign(document.createElement('kbd'), { textContent: c.shortcut || 'Not set' }))
    $('keys').prepend(row)
  }
  $('key-copy-el').textContent = mac ? '⌘C' : 'Ctrl+C'
  const copy = commands.find(c => c.name === 'copy-feedback')?.shortcut
  $('key-copy-all').textContent = [mac ? '⌃C' : 'Alt+Shift+C', copy].filter(Boolean).join(' or ')
}
$('shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })

const LOCAL = chrome.runtime.getManifest().content_scripts.flatMap(c => c.matches)
const renderSites = async () => {
  const { origins = [] } = await chrome.permissions.getAll()
  const sites = origins.filter(o => !LOCAL.includes(o))
  $('sites').replaceChildren(
    ...(sites.length
      ? sites.map(origin => {
          const row = document.createElement('div')
          row.className = 'row'
          const remove = Object.assign(document.createElement('button'), { textContent: 'Remove' })
          remove.onclick = () => chrome.permissions.remove({ origins: [origin] })
          row.append(Object.assign(document.createElement('span'), { textContent: origin.replace(/\/\*$/, '') }), remove)
          return row
        })
      : [Object.assign(document.createElement('div'), { className: 'row empty', textContent: 'No other sites yet.' })]),
  )
}

$('add').addEventListener('submit', async e => {
  e.preventDefault()
  const err = $('add-err')
  err.hidden = true
  let url
  try {
    url = new URL(/^https?:\/\//.test($('origin').value.trim()) ? $('origin').value.trim() : `https://${$('origin').value.trim()}`)
  } catch {
    return Object.assign(err, { hidden: false, textContent: 'That doesn’t look like a site address.' })
  }
  // Asked for during the click: no awaits before this.
  const granted = await chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] })
  if (granted) $('origin').value = ''
})

chrome.permissions.onAdded.addListener(renderSites)
chrome.permissions.onRemoved.addListener(renderSites)
addEventListener('focus', renderKeys)

load().then(s => {
  for (const id of Object.keys(DEFAULTS)) $(id).checked = s[id]
})
renderKeys()
renderSites()
