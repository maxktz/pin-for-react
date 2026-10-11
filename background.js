// The toolbar button shows or hides React Pin on the current site. On localhost it's already
// loaded (content script); anywhere else the click loads it first (activeTab, nothing else).
// pin.js runs in the page's own world, where React's component data lives.

const toggle = () => window.__pin?.toggleHidden()

chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) return
  const target = { tabId: tab.id }
  try {
    const [{ result: loaded }] = await chrome.scripting.executeScript({ target, world: 'MAIN', func: () => !!window.__pin })
    if (!loaded) await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['pin.js'] })
    await chrome.scripting.executeScript({ target, world: 'MAIN', func: toggle })
  } catch {
    // chrome:// pages, the Web Store and other pages extensions can't touch.
  }
})
