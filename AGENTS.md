# React Pin: notes for agents

A Chrome MV3 extension (also works in Edge, Brave, Arc, Helium) for pointing at UI in a React dev
server and copying it for a coding agent: component, source file:line, and the user's notes.
Plain JavaScript, no build step, no dependencies. Owner: Max Katz (github.com/maxktz/react-pin).

## Status

- **Chrome Web Store:** live, version 1.0.0.
  https://chromewebstore.google.com/detail/react-pin/fomonmjaloocjjfjfogmajidfnfbkdcb
  Item ID `fomonmjaloocjjfjfogmajidfnfbkdcb`, publisher ID `4e11d7c6-b12c-4b96-b0b4-8efeac006ee4`.
- **main is 1.0.1, not uploaded yet.** It has the new copy format (Source / Defined in / Stack), the
  hover performance fix and the dist-to-source map hop. `scripts/build.sh` makes the zip.
- Name is "React Pin" (Max's choice). It was briefly "Pin for React" over trademark caution; Max
  preferred the original. The README says it isn't affiliated with Meta.

## Files

```
manifest.json   MV3: content scripts on localhost, toolbar button, commands, options, optional hosts
background.js   toolbar click, shortcuts, "Always load on this site" (context menu + permissions)
bridge.js       ISOLATED world: sends settings + shortcut names to pin.js via DOM CustomEvents
pin.js          MAIN world: everything else (picking, notes, island UI, source lookup, output)
options.html/js options page (chrome.storage.sync { settings })
store/          listing text (listing.md), icon, screenshots, promo tiles, Edge logo
docs/           GitHub Pages site (privacy policy at /privacy/), demo.gif / demo.mp4 for the README
test/           Playwright scripts that load the real extension (see Testing)
scripts/build.sh  dist/react-pin-<version>.zip with only the runtime files
```

Develop by loading the repo unpacked at `chrome://extensions` (Developer mode) and pressing ↻ on
its card after edits. Max loads it from `~/dev/react-pin`; tell him when to reload.

## How it works

- **Two worlds.** pin.js must run in the page's MAIN world to read React's fiber data
  (`__reactFiber$…` keys on DOM nodes), so it has no extension APIs. bridge.js runs beside it in
  the ISOLATED world and dispatches `react-pin:settings` (JSON string detail) on load, on
  `react-pin:hello` from pin.js, and on storage changes. The settings include shortcut names that
  background.js reads from `chrome.commands.getAll()`.
- **Where it loads.** The manifest content scripts cover localhost, 127.0.0.1 and *.localhost.
  Elsewhere, the toolbar click or the toggle shortcut injects bridge.js + pin.js via
  `chrome.scripting` (activeTab). "Always load on this site" requests an optional host permission
  for that origin; `sync()` in background.js turns every granted non-localhost origin into
  registered content scripts (on install, startup, and permissions added/removed).
- **pin.js API** (`window.__pin`, called by background.js through `executeScript`): `show`,
  `toggleHidden` (toolbar), `toggle` (shortcut), `copyAll`. It's assigned as the last statement so a
  failed start can't leave a half-made object behind.
- **Page localStorage keys:** `react-pin:hidden` (island dragged out on this site) and
  `react-pin:position` (island edge and offset).
- **Settings:** `{ localhost: true, selector: false, page: true }`. Defaults live in both pin.js and
  options.js; keep them in sync.

## Source lookup (pin.js, the hard part)

- **Owner chain.** Start at the element's fiber and follow `_debugOwner` (React 19 owners can be
  server-component info objects `{ name, env, owner, debugStack }`). Each node gives a creation spot
  and the component that spot is in. React ≤18 has `_debugSource` (file/line from Babel). React 19
  has `_debugStack` (an Error); its first frame that isn't the JSX runtime or react-dom is the spot.
  The spot is in served (bundled) code, so it goes through `locate()`:
  - **http(s) scripts:** the script's `sourceMappingURL`, inline (Vite) or a `.map` file (webpack,
    CRA). Turbopack serves index maps with `sections`. Relative `sources` resolve against the map
    URL (Vite gives `"StatCard.jsx"`).
  - **`webpack-internal:///…`** (webpack eval devtools): the inline map inside the module's eval
    string, found by scanning loaded scripts for `sourceURL=<url>`.
  - **Anything else on Next.js** (server components: `about://React/Server/…`): POST
    `/__nextjs_original-stack-frames` with `{ frames: [{ file, line1, column1, lineNumber, column }],
    isServer: false, isEdgeServer: false, isAppDirectory }` (Next ≥15.4 reads `line1`/`column1`).
  - **Second hop for built packages:** if a spot lands in a `.js` file (a workspace package's
    `dist`), fetch `<file>.map` and map again. Vite serves files outside the app root at
    `/@fs/<absolute path>`; Vite is detected by its `/@vite/client` script. Don't use resource-timing
    entries for this: that list stops at 250 entries, which real apps pass.
  - **"Cheap" maps** (webpack `cheap-module-source-map`, what CRA uses) keep one mapping per line,
    which lands on the parent's JSX line. `lookup()` moves to the next line that opens `<tag` when
    `sourcesContent` is there.
- **Classification (`kindOf`).** A spot is a library (node_modules, or `dist|build|esm|cjs` with no
  map back), shared UI (`components/ui`, or a different repo package than the app), or app. The
  app's folder is the outermost app-side spot in the chain.
- **Output.**
  - **Source:** the first app spot, i.e. where the app renders the element.
  - **Defined in:** the element's own spot, when it's shared UI.
  - **Stack:** up to 4 component names; library and shared ones are tagged with their package, and
    library frames above the app spot are dropped (routers, providers).
- **`tidy()`** shortens paths: strips the origin, `/@fs/`, `webpack://`, `turbopack:///[project]/`,
  `file://`, `about://React/Server/`. Absolute filesystem paths start at the first
  `src|app|pages|packages|apps` folder. Never paste the user's home folder.

## Copied text

```md
### MainCard "Agents" in AgentsPage
Source: `src/AgentsPage.jsx:7`
Defined in: `packages/ui/src/index.jsx:4`
Stack: MainCard (ui) › AgentsPage
Key: a2
Feedback: …
```

- **Heading:** component name, then quoted text only for small elements (≤40 chars, ≤3
  descendants), then "in <app component>" when that differs.
- **Key:** only for real lists (≥2 keyed siblings of the same type), searched up to the first
  component.
- **Selector:** only when there's no source, or when the option asks for it.
- **Copy feedback:** adds `## UI feedback`, page URL and viewport (option), then numbered items.

Modeled partly on React Grab (github.com/aidenybai/react-grab, `packages/react-grab/src/core/context.ts`),
which uses a component stack and names library frames by package. React Grab drops line numbers on
Vite as unreliable; ours are mapped and tested, so keep them.

## Hover performance (keep it this way)

Hover runs for every element the cursor crosses. It must stay cheap.

- Handle `mousemove` once per animation frame, for the latest point only. Scroll redraws are also
  once per frame.
- The tooltip needs only `nameAt(el)` (the owner component name) and the tag. No `innerText`, no
  selector, no chain walk.
- Look up the source only after the cursor rests on an element for 120ms (`REST`), and cache the
  lookup per element (WeakMap `resolved`). Text, key and selector are read at copy or note time.
- Measured on a 28k-element page with the CPU slowed 4×: script time during a sweep went from
  1.7s to about 0.4s, with no long tasks. Max saw real freezes on a heavy app before this fix; that
  freeze itself was never reproduced locally.

## Pitfalls already hit

- **No `innerHTML` anywhere in pin.js.** Trusted Types pages (Gmail, X, YouTube) throw on HTML
  string assignment, and the toolbar silently did nothing. Build the UI with `h()`/`svg()` DOM
  helpers.
- **macOS detection:** `navigator.userAgentData.platform` is `"macOS"`, so match case-insensitively.
- **Shortcuts:**
  - Toggle is a `chrome.commands` command (MacCtrl+P on macOS, Alt+Shift+P elsewhere, so Ctrl+P
    Print stays free), and users can rebind it.
  - The in-page copy keys act only while Pin is on: ⌘C/Ctrl+C copies the hovered element (unless
    text is selected), ⌃C/Alt+Shift+C copies all notes. Ctrl+Shift+C is DevTools on Windows.
  - Headless Playwright can't fire `chrome.commands`; call the background functions from the
    service worker instead (`sw.evaluate(() => call(tabId, 'toggle'))`).
- **Permissions:**
  - Content-script matches don't grant `chrome.scripting.executeScript`; only activeTab (toolbar
    click, command, context menu) or a host permission does.
  - `chrome.permissions.request` must run before any `await` in the gesture handler.
- **`sync()` race:** `sync()` runs on install. A test manifest with `host_permissions` gets those
  sites registered as content scripts, which can race with the toolbar path.

## Testing

Branded Chrome ignores `--load-extension`. The Claude app's built-in browser can't load extensions or
open the Web Store. Use Playwright's Chromium (or Chrome for Testing via `CHROME=<binary>`) with
the real unpacked extension:

```bash
cd test && pnpm install && npx playwright install chromium
node copy.mjs http://localhost:<port>/ ".stat-value" "td.name >> nth=1"   # tooltip + copied text
node perf.mjs "http://localhost:<port>/?stress" on                         # hover cost; also "off"
```

Fixtures aren't in the repo (they're throwaway apps under the scratchpad). Get ports with
`ck port <name>` and run dev servers in the Terminal panel. Last verified against:

- **Next.js 16, Turbopack and webpack:** client components plus a server-component `<h1>`;
  `app/page.tsx` renders `StatCard` from `app/StatCard.tsx`.
- **Vite + React 18** (`_debugSource`) and **Vite + React 19** (`_debugStack`).
- **webpack 5 + Babel + React 19** with `devtool: 'cheap-module-source-map'` (CRA-like).
- **Monorepo:** `packages/ui` is built with `vite build` in lib mode with `sourcemap: true`,
  `minify: false` and development mode (so it emits `jsxDEV`). `packages/web` (Vite) imports
  `../../ui/dist/index.js`, which reproduces the `/@fs/` + dist case from Max's mastra worktree.
- **Stress pages** in that web app: `?stress` (~28k elements, nested grids) and `?many` (300
  component modules).
- **A Trusted Types page:** any server sending
  `Content-Security-Policy: require-trusted-types-for 'script'; trusted-types 'none'`.

Things checked each time: source lines for client, server and list items, Copy feedback output,
keys passing through while off, settings (selector, page, localhost), toolbar injection on a
non-localhost page (`--host-resolver-rules=MAP *.test 127.0.0.1` plus a test-only
`host_permissions` copy of the manifest), and no page errors.

## Releasing

1. Bump `version` in manifest.json, update the README / `store/listing.md` if the output changed,
   run `scripts/build.sh`, commit, push.
2. Upload `dist/react-pin-<version>.zip` in the developer dashboard (Package → Upload new package),
   then Submit for review. Updates are reviewed again (usually hours to a few days).
3. Optionally attach the zip to a GitHub release (`gh release create v<version> dist/…zip`).

### Dashboard automation

Chrome blocks all extensions (Claude in Chrome too) on Web Store pages, so drive it over CDP from a
separate Helium instance that Max signs into once:

```bash
open -na /Applications/Helium.app --args --user-data-dir="$HOME/.cache/react-pin-cws-profile" \
  --remote-debugging-port=$(ck port cws) https://chrome.google.com/webstore/devconsole
```

Then `chromium.connectOverCDP('http://localhost:<port>')`, find the devconsole page, and use
`fill` / `setInputFiles` / `getByRole('combobox')`. The profile stays signed in to Max's Google
account. Ask Max before pressing Submit, and never enter passwords or payment details.

Already set up in the dashboard:
- Account: non-trader, publisher name "Max Katz", contact email verified.
- Listing: category Developer Tools, English, free, public, all regions.
- Privacy: single purpose, permission justifications and data answers as in
  `store/listing.md`; no remote code.
- Privacy policy URL must be https://maxktz.github.io/react-pin/privacy/. The dashboard reported
  the GitHub `blob/…/PRIVACY.md` URL as "not reachable".

### Store assets

Made by rendering HTML and screenshots with Playwright, then downscaling 2× captures with ffmpeg
(lanczos):
- Screenshots: 1280×800 of a Next.js "Acme dashboard" fixture.
- Icon: 128px with 96px artwork and transparent padding.
- Promo tiles: 440×280 and 1400×560.
- Edge logo: 300×300.

For video, CDP `Page.startScreencast` ignores viewport emulation (frames come out at the window
size), so record with a `page.screenshot` loop and a fake cursor overlay, then build the mp4/gif with
ffmpeg's concat demuxer.

## Style

- Plain JS, no dependencies, no build.
- Comments explain why, in short prose matching the existing ones.
- Prose in docs and listings: no em dashes.
- Max wants short, plain replies, and to be told explicitly when to reload the extension.
