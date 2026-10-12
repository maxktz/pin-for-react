# Privacy policy

_React Pin, last updated 2026-10-12_

React Pin does not collect, store, sell or share any personal data. It has no servers,
accounts, analytics, telemetry or ads.

What it does, all inside your browser:

- **Reads the page you point at.** On the pages where it runs (localhost, sites you turn it on
  for, or the tab where you click its toolbar button), it reads the element under your cursor:
  its React component name, its source file and line, its text and a CSS selector.
- **Reads your dev server's source maps.** To turn a bundled line into a source line it fetches
  the page's own scripts and source maps from the same site (and, on Next.js dev servers, asks
  that dev server to map a line). These requests go only to the site you are on.
- **Writes to your clipboard** when you copy an element or your notes. Notes stay in the page
  until you reload it; they are never sent anywhere.
- **Stores your settings** (options page) with `chrome.storage.sync`, which your browser may sync
  across your own devices. The island's position and "hidden on this site" are stored in that
  site's `localStorage`.

Permissions: `activeTab` and `scripting` load it into the current tab when you click the toolbar
button or press its shortcut; `storage` keeps your settings; `contextMenus` adds "Always load on
this site" to the toolbar button. Access to other sites is optional and asked for per site.

The source code is public: https://github.com/maxktz/react-pin. Questions:
https://github.com/maxktz/react-pin/issues
