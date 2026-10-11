# react-pin

A browser extension for pointing at UI and handing it to a coding agent. Two ways:

- **One element:** hover it and press **⌘C**. You get its component and source line, ready to paste:
  ```md
  ### StatCard "37"
  Element: `src/App.tsx:19` · `div.card.stat:nth-of-type(2) > strong.stat-value`
  ```
- **Feedback on several:** click elements and type a note on each (numbered pins mark them), then
  **Copy feedback** or **⌃C** copies them as one prompt:
  ```md
  ## UI feedback
  Page: http://localhost:3072/
  Viewport: 1987×1211

  ### 1. StatCard "12.4k"
  Element: `src/App.tsx:19` · `div.card.stat:nth-of-type(1) > strong.stat-value`
  Feedback: more padding
  ```

| | |
| --- | --- |
| Turn on/off | **⌃P**, or the island's **Pin** |
| Move the island | drag it; it sticks to the nearest edge |
| Hide on this site | drag the island out of the window |
| Show it again (or on any other site) | the extension's toolbar button |

It loads on `localhost`, `127.0.0.1` and `*.localhost` pages; anywhere else only when you click the
toolbar button (`activeTab`, no access to other sites). Notes live in the page until reload.

## How it finds the source

React keeps each element's component in its internal data on the DOM node; `pin.js` runs in the page's
own world (not the extension's isolated one) to read it. React 19 records where an element was
created (`_debugStack`); dev servers serve transformed code, so the line goes through the module's
source map (Vite inlines one). React ≤18 has `_debugSource` instead. Without React, an element still
gets a selector that matches only it.

## Install

Helium: `chrome://extensions`, Developer mode, **Load unpacked**, `~/dev/cockpit/react-pin`. After editing,
↻ on its card (no build step: `pin.js` is plain JavaScript, no dependencies).

## Files

```
manifest.json   MV3: content script on localhost (MAIN world), toolbar button
background.js   toolbar button: loads pin.js if needed, shows or hides it on the site
pin.js          everything else: picking, notes, the island, output
icons/          toolbar icon
```
