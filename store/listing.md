# Chrome Web Store listing

Everything the developer dashboard asks for, in order. Upload `dist/react-pin-<version>.zip`
(`scripts/build.sh`).

## Store listing

**Name** (from the manifest): React Pin

**Summary** (from the manifest, 126/132 characters):
Point at UI in your React dev server and hand it to a coding agent: component, source file:line, and your notes as one prompt.

**Category:** Developer Tools

**Language:** English

**Description:**

```
Point at UI and hand it to your coding agent (Claude Code, Codex, Cursor, Copilot…) without describing where it is.

Turn Pin on in your React dev server and hover anything: you see its component and the exact source file and line. Then:

• Copy one element (⌘C / Ctrl+C) as a short reference your agent can act on:
  ### StatCard "37"
  Source: `app/StatCard.tsx:7`
  Stack: StatCard › Page

• Or click several elements, write a note on each, and copy them all as one prompt: page URL, viewport, and for every note the component, the file:line in your app, the component stack and your feedback.

WORKS WITH
• Next.js (Turbopack and webpack, client and server components)
• Vite, Remix / React Router, Create React App and other webpack setups
• React 19 (through your dev server's source maps) and React 18 and earlier
• Pages without React still get a unique selector and the element's text

HOW IT RUNS
• Loads by itself on localhost, 127.0.0.1 and *.localhost.
• Anywhere else (staging, a LAN address) only when you click the toolbar button or press the shortcut. Right-click the button for "Always load on this site".
• A small island with the Pin toggle and Copy feedback; drag it to any edge, or out of the window to hide it on that site.
• Shortcuts: ⌃P (macOS) / Alt+Shift+P (Windows, Linux) turns it on or off, rebindable at chrome://extensions/shortcuts. Copy keys only act while Pin is on, so normal copy and print are untouched.

PRIVATE BY DESIGN
No servers, accounts, analytics or tracking. It reads the page you point at and writes to your clipboard; nothing leaves your browser.

Open source (MIT): https://github.com/maxktz/react-pin

Not affiliated with Meta or the React team.
```

**Graphic assets** (all in `store/`):

- Store icon: `icon-128.png` (128×128, 96px artwork with transparent padding)
- Screenshots (1280×800): `screenshots/1-hover.png`, `2-notes.png`, `3-prompt.png`, `4-options.png`
- Small promo tile: `promo-440x280.png`
- Marquee promo tile (optional): `marquee-1400x560.png`
- Promo video (optional, YouTube link only): `docs/demo.mp4` if you upload it to YouTube

**Official URL:** none (needs a verified site). **Homepage URL:** https://github.com/maxktz/react-pin
**Support URL:** https://github.com/maxktz/react-pin/issues

## Privacy practices

**Single purpose:**
Lets developers point at elements of a web page they are building and copy a description of them (React component, source file and line, CSS selector, and the developer's notes) to the clipboard, to paste into an AI coding agent.

**Permission justifications:**

- `activeTab`: Loads the picker into the current tab only when the user clicks the toolbar button or presses the extension's shortcut, so it can be used on sites other than localhost without broad host access.
- `scripting`: Injects the picker (pin.js) into the current tab on that click or shortcut, and registers it as a content script on sites the user explicitly chose with "Always load on this site".
- `storage`: Saves the user's options (whether it shows on localhost, what copied text includes).
- `contextMenus`: Adds "Always load on this site" and "Stop loading on this site" to the toolbar button's right-click menu.
- Host permissions (content scripts on `localhost`, `127.0.0.1`, `*.localhost`): Local development servers are where the tool is used; the picker loads there by itself so it is ready while developing.
- Optional host permissions (`http://*/*`, `https://*/*`): Requested for one site at a time, only when the user chooses "Always load on this site" (toolbar right-click menu or options page), so the picker loads there on every visit. Never requested at install.

**Remote code:** No, I am not using remote code. (All scripts are in the package; it fetches the page's own scripts and source maps only as data, to map line numbers.)

**Data usage:** check nothing. It does not collect any of the listed data types.
Certify all three: not sold to third parties; not used for unrelated purposes; not used for creditworthiness or lending.

**Privacy policy URL:** https://maxktz.github.io/react-pin/privacy/

## Distribution

**Visibility:** Public. **Regions:** all.

## Edge Add-ons (optional, free)

Same zip at https://partner.microsoft.com/dashboard/microsoftedge/overview (Microsoft Partner
Center account, no fee). Reuse the description, screenshots and privacy URL above; Edge also asks
for a 300×300 logo: `store/edge-logo-300.png`.
