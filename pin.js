// React Pin: point at UI and hand it to a coding agent. Its island (bottom center, shown on
// local dev servers) has a Pin toggle and can be dragged to any edge; dragging it out of the window
// hides it for the site, and the extension's toolbar button shows it again (or on any other site).
//   The toggle shortcut (⌃P on macOS, Alt+Shift+P elsewhere) turns it on or off. While on, hover
//   shows what's under the cursor and ⌘C / Ctrl+C copies that element for a chat; click adds feedback
//   to an element, and "Copy feedback" (⌃C on macOS, Alt+Shift+C elsewhere) copies every note as one prompt.
// Plain script, no dependencies: React info is read from React's own dev data when present. It runs
// in the page's own world; bridge.js (the extension's side) sends it settings and shortcut names.
;(() => {
  if (window.__pin) return
  // What the extension calls (background.js): show, toggleHidden, toggle, copyAll. Published last,
  // so a page where this fails to start doesn't keep a half-made one.
  const api = {}
  const mac = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform ?? navigator.platform)

  // ---- what an element is: React components, source, text, a selector ---------------------

  const fiberOf = el => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const key = Object.keys(n).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
      if (key) return n[key]
    }
    return null
  }

  const nameOf = type =>
    typeof type === 'function' ? type.displayName || type.name : type?.displayName || type?.render?.displayName || type?.render?.name || null
  const component = name => name && /^[A-Z]/.test(name) && !/^(Fragment|Suspense|StrictMode|Provider|Consumer)$/.test(name)

  // Components that rendered the element, nearest first (StatCard, Page): its owners, which is
  // where its JSX is written. React 19 owners can be server components ({ name, env, owner }).
  // Without owner data (production builds), the components above it in the tree.
  const componentsOf = fiber => {
    const out = []
    const ownerOf = o => o._debugOwner ?? o.owner ?? null
    for (let o = ownerOf(fiber); o && out.length < 4; o = ownerOf(o)) {
      const name = o.tag === undefined ? o.name : nameOf(o.type)
      if (component(name) && out.at(-1) !== name) out.push(name)
    }
    for (let f = fiber; f && !out.length && out.length < 4; f = f.return) {
      const name = typeof f.type === 'string' ? null : nameOf(f.type)
      if (component(name)) out.push(name)
    }
    return out
  }

  // Where the element's JSX is. React ≤18 keeps _debugSource (file and line, added by Babel).
  // React 19 keeps the stack of the render that created the element (_debugStack): its first frame
  // past React's JSX runtime is the spot, but in served (transformed, bundled) code, so it goes
  // through a source map (see locate). Frames come from the element and then its parents, and the
  // first one that lands outside node_modules wins.
  const LIBRARY = /node_modules|\/@vite\/|\/\.vite\/deps\/|react-dom|react-server-dom/
  const RUNTIME = /(^|\.)(jsxDEV|jsxs?|createElement|fakeJSXCallSite|react_stack_bottom_frame)$/
  const framesOf = fiber => {
    const out = []
    for (let f = fiber; f && out.length < 6; f = f.return) {
      if (f._debugSource) {
        out.push({ url: f._debugSource.fileName, line: f._debugSource.lineNumber })
        continue
      }
      for (const line of f._debugStack?.stack?.split('\n').slice(1) ?? []) {
        const m = line.match(/^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?$/)
        if (!m || RUNTIME.test(m[1] ?? '') || LIBRARY.test(m[2])) continue
        out.push({ url: m[2], line: +m[3], col: +m[4], tag: typeof f.type === 'string' ? f.type : nameOf(f.type) })
        break
      }
    }
    return out
  }

  const sourceOf = async fiber => {
    for (const frame of framesOf(fiber)) {
      const at = await locate(frame)
      if (at && !/node_modules/.test(at.file)) return at.line ? `${tidy(at.file)}:${at.line}` : tidy(at.file)
    }
    return null
  }

  // A served position → { file, line } in the original source, or { file } when there's no map:
  //   http(s) scripts (Vite, Turbopack, webpack): the script's source map, inline or a .map file
  //   webpack-internal:///… (webpack's eval devtools, Next.js with webpack): the map inside the
  //     module's eval'd code, found in whichever loaded script defines it
  //   anything else (Next.js server components: about://React/Server/…): Next's dev server maps it
  const located = new Map()
  const locate = ({ url, line, col, tag }) => {
    if (!col) return { file: url, line }
    const key = `${url}:${line}:${col}:${tag}`
    if (!located.has(key)) {
      located.set(key, (async () => {
        let at = null
        if (/^https?:/.test(url)) at = lookup(await scriptMap(url), line, col, tag)
        else if (url.startsWith('webpack-internal:///')) at = lookup(await evalMap(url), line, col, tag)
        if (!at && next()) at = await nextFrame(url, line, col)
        return at ?? { file: url }
      })().catch(() => ({ file: url })))
    }
    return located.get(key)
  }

  const cache = (store, key, load) => {
    if (!store.has(key)) store.set(key, load().catch(() => null))
    return store.get(key)
  }
  const texts = new Map(), maps = new Map()
  const text = url => cache(texts, String(url), () => fetch(url).then(r => (r.ok ? r.text() : null)))
  const sameOrigin = url => url.startsWith(location.origin + '/')

  const scriptMap = url =>
    cache(maps, url, async () => {
      if (!sameOrigin(url)) return null
      const code = await text(url)
      const i = code?.lastIndexOf('sourceMappingURL=') ?? -1
      return i < 0 ? null : readMap(code.slice(i + 17).match(/^[^\s'"\\]+/)?.[0], url)
    })

  const evalMap = url =>
    cache(maps, url, async () => {
      const scripts = [...document.scripts].map(s => s.src).concat(performance.getEntriesByType('resource').map(e => e.name))
      for (const src of new Set(scripts.filter(s => sameOrigin(s) && /\.js(\?|$)/.test(s)))) {
        const code = await text(src)
        const end = code?.indexOf(`sourceURL=${url}`) ?? -1
        if (end < 0) continue
        const i = code.lastIndexOf('sourceMappingURL=', end)
        return i < 0 ? null : readMap(code.slice(i + 17).match(/^[^\s'"\\]+/)?.[0], src)
      }
      return null
    })

  // A map reference (data: URL or a path next to the script) → { sections: [{ line, col, map }] }.
  // Turbopack serves index maps (one section per module); a plain map is one section at 0:0.
  const readMap = async (ref, base) => {
    if (!ref) return null
    let json
    const data = ref.match(/^data:application\/json[^,]*?(;base64)?,(.*)$/)
    if (data) json = data[1] ? new TextDecoder().decode(Uint8Array.from(atob(data[2]), c => c.charCodeAt(0))) : decodeURIComponent(data[2])
    else json = await text((base = new URL(ref, base).href))
    const map = JSON.parse(json.replace(/^\)\]\}'[^\n]*\n/, ''))
    const sections = map.sections ? map.sections.map(s => ({ line: s.offset.line, col: s.offset.column, map: s.map })) : [{ line: 0, col: 0, map }]
    return { sections, base }
  }

  // Stack positions are 1-based; maps are 0-based. "Cheap" maps (webpack's cheap-module-source-map,
  // what Create React App uses) keep one mapping per line, which can land on the parent's JSX line;
  // when the line doesn't open the element's tag (<strong, <StatCard), the next one that does wins.
  const lookup = (m, line, col, tag) => {
    if (!m) return null
    let l = line - 1, c = col - 1
    const s = m.sections.filter(s => s.line < l || (s.line === l && s.col <= c)).pop()
    if (!s?.map?.mappings) return null
    if (l === s.line) c -= s.col
    l -= s.line
    s.map.lines ??= decode(s.map.mappings)
    const segs = s.map.lines[l]
    const seg = segs?.filter(x => x[0] <= c).pop() ?? segs?.[0]
    const file = seg && s.map.sources[seg[1]]
    if (!file) return null
    let at = seg[2]
    const content = s.map.sourcesContent?.[seg[1]]
    if (content && tag) {
      const lines = (s.map.contentLines ??= {})[seg[1]] ??= content.split('\n')
      const opens = l => new RegExp(`<${tag.replace(/[.$]/g, '\\$&')}(?![\\w.-])`).test(lines[l] ?? '')
      if (!opens(at)) for (let l = at + 1; l < Math.min(lines.length, at + 12); l++) if (opens(l)) { at = l; break }
    }
    // Relative sources are relative to the map (Vite: "StatCard.jsx" next to /src/StatCard.jsx).
    const source = (s.map.sourceRoot ? s.map.sourceRoot.replace(/\/?$/, '/') : '') + file
    return { file: /^([a-z][\w+.-]*:|\/)/i.test(source) ? source : new URL(source, m.base).href, line: at + 1 }
  }

  // Source map "mappings" → lines of [genCol, source, origLine, origCol] (Base64 VLQ).
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const decode = mappings => {
    const lines = []
    let src = 0, oLine = 0, oCol = 0
    for (const lineStr of mappings.split(';')) {
      const segs = []
      let gCol = 0
      for (const seg of lineStr.split(',')) {
        if (!seg) continue
        const v = []
        let shift = 0, value = 0
        for (const ch of seg) {
          const digit = B64.indexOf(ch)
          value += (digit & 31) << shift
          if (digit & 32) shift += 5
          else {
            v.push(value & 1 ? -(value >> 1) : value >> 1)
            shift = value = 0
          }
        }
        gCol += v[0]
        if (v.length >= 4) {
          src += v[1]; oLine += v[2]; oCol += v[3]
          segs.push([gCol, src, oLine, oCol])
        }
      }
      lines.push(segs)
    }
    return lines
  }

  // Next.js dev servers map any frame, server components included, for their error overlay.
  const next = () => !!document.querySelector('script[src*="/_next/"]')
  const nextFrame = async (file, line, col) => {
    const res = await fetch('/__nextjs_original-stack-frames', {
      method: 'POST',
      body: JSON.stringify({
        // line1/column1 since Next 15.4, lineNumber/column before.
        frames: [{ file, methodName: '', arguments: [], line1: line, column1: col, lineNumber: line, column: col }],
        isServer: false,
        isEdgeServer: false,
        isAppDirectory: !!window.__next_f,
      }),
    })
    const f = res.ok ? (await res.json())[0]?.value?.originalStackFrame : null
    const at = f?.line1 ?? f?.lineNumber
    return f?.file && at ? { file: f.file, line: at } : null
  }

  // A source path as an agent would write it: project-relative when it can tell. Absolute paths
  // (React ≤18, Turbopack maps) start at the first src/app/pages/packages/apps folder.
  const tidy = file => {
    if (/^https?:/.test(file)) return decodeURI(file.replace(/^https?:\/\/[^/]+\/?/, '').replace(/[?#].*$/, ''))
    let f = decodeURI(file)
      .replace(/\\/g, '/')
      .replace(/^about:\/\/React\/Server\//, '')
      .replace(/^(webpack-internal:\/\/\/|webpack:\/\/[^/]*\/|turbopack:\/\/\/|file:\/\/)/, '')
      .replace(/^\([^)]*\)\//, '')
      .replace(/^\[project\]\//, '')
      .replace(/[?#].*$/, '')
    if (/^(\/|[A-Za-z]:\/)/.test(f)) {
      const m = f.match(/\/(src|app|pages|packages|apps)\//)
      return m ? f.slice(m.index + 1) : f
    }
    return f.replace(/^\.\//, '')
  }

  const textOf = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)

  // The shortest selector that names only this element, from the element up: nth-of-type
  // wherever siblings share a tag, stopping as soon as it matches just this one.
  const selectorOf = el => {
    const parts = []
    for (let n = el; n && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      let part = n.id ? `#${CSS.escape(n.id)}` : n.tagName.toLowerCase()
      if (!n.id) {
        const cls = [...n.classList].slice(0, 2).map(c => CSS.escape(c))
        if (cls.length) part += '.' + cls.join('.')
        const same = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : []
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`
      }
      parts.unshift(part)
      const sel = parts.join(' > ')
      try {
        const hits = document.querySelectorAll(sel)
        if (hits.length === 1 && hits[0] === el) return sel
      } catch {}
      if (n.id) break
    }
    return parts.join(' > ')
  }

  const describe = el => {
    const fiber = fiberOf(el)
    const components = fiber ? componentsOf(fiber) : []
    const tag = el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '')
    return { el, tag, components, fiber, text: textOf(el), selector: selectorOf(el) }
  }

  const label = d => [d.components[0], d.tag].filter(Boolean).join(' › ')
  const resolve = async d => ({ ...d, source: d.fiber ? await sourceOf(d.fiber).catch(() => null) : null })

  // Settings from the options page (bridge.js sends them; defaults until it does).
  let settings = { localhost: true, selector: true, page: true, keys: {} }

  // One element in the prompt (markdown):
  //   ### 2. StatCard "-12%"
  //   Element: `src/App.tsx:20` · `div.card.stat:nth-of-type(2) > span.delta.down`
  //   Feedback: red is too loud
  const heading = d => {
    const text = d.text.length > 30 ? `${d.text.slice(0, 30)}…` : d.text
    return text ? `${d.components[0] ?? d.tag} "${text}"` : [d.components[0], d.tag].filter(Boolean).join(' ')
  }
  const item = (d, note, n) => {
    const where = [d.source, (settings.selector || !d.source) && d.selector].filter(Boolean).map(s => `\`${s}\``).join(' · ')
    return [`### ${n ? `${n}. ` : ''}${heading(d)}`, `Element: ${where}`, note && `Feedback: ${note}`].filter(Boolean).join('\n')
  }

  // ---- UI, in a shadow root so the page's CSS can't touch it ----------------------------------

  const host = document.createElement('pin-ui')
  const root = host.attachShadow({ mode: 'open' })
  // Dark pills sized like React Grab's toolbar (26px tall, 13px text, soft shadow).
  // Built with DOM calls, not HTML strings: pages with Trusted Types (Gmail, X, …) block innerHTML.
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    el.append(...children)
    return el
  }
  const svg = (tag, attrs) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    return el
  }
  const pinIcon = () => {
    const icon = svg('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
    icon.append(
      svg('path', { d: 'M12 17v5' }),
      svg('path', { d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z' }),
    )
    return icon
  }
  const css = `
    :host { all: initial }
    * { box-sizing: border-box; font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased }
    .shadow { box-shadow: 0 2px 12px #0000004d, 0 0 0 1px #ffffff12 }
    .box { position: fixed; pointer-events: none; border: 1.5px solid #7c8cff; background: #7c8cff1a; border-radius: 3px; z-index: 2147483646; display: none }
    .tip { position: fixed; pointer-events: none; background: #1c1c1f; color: #e7e7ea; font-size: 11px; font-weight: 500; line-height: 16px; padding: 2px 7px; border-radius: 6px; white-space: nowrap; z-index: 2147483647; display: none; border: 1px solid #ffffff17; box-shadow: 0 4px 14px #00000059 }
    .tip .c { color: #9aa6ff; font-weight: 600 }
    .tip .src { color: #a1a1aa }
    .tip .keys { color: #6b6b74 }
    .bar { position: fixed; left: 0; top: 0; display: flex; touch-action: none; cursor: grab; align-items: center; gap: 2px; height: 26px; padding: 0 3px; background: #1c1c1f; color: #e7e7ea; border-radius: 13px; z-index: 2147483647; white-space: nowrap }
    .bar button { all: unset; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; height: 20px; padding: 0 6px; border-radius: 10px; color: #8d8d95 }
    .bar button:hover { color: #e7e7ea; background: #ffffff12 }
    .bar .toggle[aria-pressed="true"] { color: #e7e7ea }
    .bar .toggle[aria-pressed="true"] svg { color: #8d98ff }
    .bar .copy { background: #5b67f0; color: #fff }
    .bar .copy:hover { background: #6b76f5; color: #fff }
    .bar .copy .keys { color: #ffffffa6 }
    .bar .clear { background: #ffffff14; color: #e7e7ea }
    .bar .clear:hover { background: #ffffff21 }
    .bar.dragging { cursor: grabbing }
    .bar.leaving { opacity: .4 }
    .bar [hidden] { display: none }
    .pop { position: fixed; width: 280px; background: #1c1c1f; color: #e7e7ea; padding: 6px; border-radius: 12px; z-index: 2147483647; display: none }
    .pop .what { color: #8d8d95; font-size: 11px; margin: 0 2px 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
    .pop textarea { width: 100%; min-height: 54px; resize: vertical; background: #121214; color: #e7e7ea; border: 1px solid #2c2c31; border-radius: 8px; padding: 6px 8px; outline: none; transition: border-color .12s }
    .pop textarea:focus { border-color: #3d3d45 }
    .pop .row { display: flex; justify-content: flex-end; gap: 4px; margin-top: 5px }
    .pop button { all: unset; cursor: pointer; height: 20px; display: flex; align-items: center; padding: 0 9px; border-radius: 10px; font-size: 12px; background: #ffffff14; color: #e7e7ea }
    .pop button:hover { background: #ffffff21 }
    .pop .add { background: #5b67f0; color: #fff }
    .pop .add:hover { background: #6b76f5; color: #fff }
    .pin { position: fixed; width: 18px; height: 18px; border-radius: 9px; background: #5b67f0; color: #fff; font-size: 10px; font-weight: 700; display: grid; place-items: center; z-index: 2147483646; pointer-events: none; box-shadow: 0 1px 4px #0006 }
    .toast { position: fixed; transform: translateX(-50%); background: #1c1c1f; color: #e7e7ea; font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 99px; z-index: 2147483647; display: none }
  `
  root.append(
    h('style', {}, css),
    h('div', { class: 'box' }), h('div', { class: 'tip' }), h('div', { class: 'pins' }),
    h('div', { class: 'pop shadow' },
      h('div', { class: 'what' }),
      h('textarea', { placeholder: 'What should change? (Enter to add)' }),
      h('div', { class: 'row' }, h('button', { class: 'cancel' }, 'Cancel'), h('button', { class: 'add' }, 'Add'))),
    h('div', { class: 'bar shadow' },
      h('button', { class: 'toggle', 'aria-pressed': 'false' }, pinIcon(), 'Pin'),
      h('button', { class: 'copy', hidden: '' }, h('span', { class: 'label' }, 'Copy feedback'), h('span', { class: 'keys' })),
      h('button', { class: 'clear', hidden: '' }, 'Clear')),
    h('div', { class: 'toast shadow' }),
  )
  // Shown when loaded (local dev servers, sites the user enabled, or the toolbar button), unless
  // dragged out on this site (remembered for the origin) or turned off for localhost in the options.
  // The toolbar button shows it again.
  const HIDDEN = 'react-pin:hidden'
  const hiddenHere = () => {
    try {
      return localStorage.getItem(HIDDEN) === '1'
    } catch {
      return false
    }
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(location.hostname)

  const $ = s => root.querySelector(s)
  const box = $('.box'), tip = $('.tip'), pop = $('.pop'), bar = $('.bar'), pins = $('.pins'), toast = $('.toast')
  const area = pop.querySelector('textarea')

  let on = false
  let hovered = null
  let editing = null // the element a note is being written for
  const notes = [] // { d, note }

  const flash = text => {
    toast.textContent = text
    toast.style.display = 'block'
    clearTimeout(flash.t)
    flash.t = setTimeout(() => (toast.style.display = 'none'), 1400)
  }

  const show = el => {
    hovered = el
    const r = el.getBoundingClientRect()
    Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
    const d = describe(el)
    // Component (accent) › element, then the source and the copy shortcut, each dimmer.
    const span = (cls, text) => Object.assign(document.createElement('span'), { className: cls, textContent: text })
    const src = span('src', '')
    tip.replaceChildren(
      ...(d.components[0] ? [span('c', d.components[0]), ' › '] : []),
      d.tag,
      src,
      span('keys', `  ·  ${mac ? '⌘C' : 'Ctrl+C'} to copy`),
    )
    // 4px above the element, or below it when there's no room; kept inside the window (again once
    // the source arrives, which makes it wider).
    const place = () => {
      const h = tip.offsetHeight
      tip.style.left = `${Math.max(4, Math.min(r.left, innerWidth - tip.offsetWidth - 4))}px`
      tip.style.top = `${r.top - h - 4 >= 4 ? r.top - h - 4 : Math.min(r.bottom + 4, innerHeight - h - 4)}px`
    }
    tip.style.display = 'block'
    place()
    resolve(d).then(res => res.source && hovered === el && ((src.textContent = `  ${res.source}`), place()))
  }

  // Off keeps the notes but hides them: pins and their buttons come back when it's turned on.
  const redrawPins = () => {
    pins.replaceChildren()
    if (on) notes.forEach(({ d }, i) => {
      if (!d.el.isConnected) return
      const r = d.el.getBoundingClientRect()
      const p = document.createElement('div')
      p.className = 'pin'
      p.textContent = String(i + 1)
      // Top right corner of the element, nudged inside the viewport when the element touches an edge.
      const left = Math.min(innerWidth - 20, Math.max(2, r.right - 9))
      const top = Math.min(innerHeight - 20, Math.max(2, r.top - 9))
      Object.assign(p.style, { left: `${left}px`, top: `${top}px` })
      pins.append(p)
    })
    renderBar()
  }

  const renderBar = () => {
    bar.querySelector('.toggle').setAttribute('aria-pressed', String(on))
    bar.querySelector('.copy').hidden = bar.querySelector('.clear').hidden = !on || !notes.length
    bar.querySelector('.copy .label').textContent = `Copy feedback (${notes.length})`
    placeBar()
  }

  // The island sits on one edge of the window (bottom by default) at a fraction along it. Dragging
  // moves it freely; on release it snaps to the nearest edge, and the spot is remembered.
  const POS = 'react-pin:position'
  const MARGIN = 16
  let pos = { edge: 'bottom', at: 0.5 }
  try {
    pos = JSON.parse(localStorage.getItem(POS)) ?? pos
  } catch {}
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const placeBar = () => {
    const w = bar.offsetWidth, h = bar.offsetHeight
    let left, top
    if (pos.edge === 'bottom' || pos.edge === 'top') {
      left = clamp(pos.at * innerWidth - w / 2, MARGIN, innerWidth - w - MARGIN)
      top = pos.edge === 'top' ? MARGIN : innerHeight - h - MARGIN
    } else {
      top = clamp(pos.at * innerHeight - h / 2, MARGIN, innerHeight - h - MARGIN)
      left = pos.edge === 'left' ? MARGIN : innerWidth - w - MARGIN
    }
    bar.style.left = `${left}px`
    bar.style.top = `${top}px`
    // Messages show next to the island, on the side facing the page.
    toast.style.left = `${left + w / 2}px`
    toast.style.top = pos.edge === 'top' ? `${top + h + 8}px` : `${top - 26}px`
  }

  let drag = null
  bar.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    drag = { x: e.clientX, y: e.clientY, left: bar.offsetLeft, top: bar.offsetTop, moved: false }
  })
  addEventListener('pointermove', e => {
    if (!drag) return
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    // Only a real drag takes the pointer, so a plain press still clicks the button under it.
    if (!drag.moved) bar.setPointerCapture(e.pointerId)
    drag.moved = true
    bar.classList.add('dragging')
    bar.style.left = `${drag.left + dx}px`
    bar.style.top = `${drag.top + dy}px`
    bar.classList.toggle('leaving', leaving())
  })

  // Mostly outside the window (over 40% of it past an edge): letting go there hides it.
  const leaving = () => {
    const r = bar.getBoundingClientRect()
    const outX = Math.max(0, -r.left, r.right - innerWidth) / r.width
    const outY = Math.max(0, -r.top, r.bottom - innerHeight) / r.height
    return Math.max(outX, outY) > 0.4
  }
  addEventListener('pointerup', () => {
    if (!drag) return
    const moved = drag.moved
    drag = null
    bar.classList.remove('dragging')
    if (!moved) return
    if (bar.classList.contains('leaving')) {
      bar.classList.remove('leaving')
      return hideHere()
    }
    const cx = bar.offsetLeft + bar.offsetWidth / 2, cy = bar.offsetTop + bar.offsetHeight / 2
    const gaps = { left: cx, right: innerWidth - cx, top: cy, bottom: innerHeight - cy }
    const edge = Object.entries(gaps).sort((a, b) => a[1] - b[1])[0][0]
    pos = { edge, at: edge === 'top' || edge === 'bottom' ? cx / innerWidth : cy / innerHeight }
    try {
      localStorage.setItem(POS, JSON.stringify(pos))
    } catch {}
    placeBar()
    // The click that ends a drag isn't a button press.
    bar.addEventListener('click', ev => ev.stopPropagation(), { capture: true, once: true })
  })

  // The async clipboard can refuse (page not focused, http on a LAN address); then the old way.
  const copy = async text => {
    try {
      return await navigator.clipboard.writeText(text)
    } catch {}
    const area = document.createElement('textarea')
    area.value = text
    area.style.cssText = 'position:fixed;opacity:0'
    root.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }

  const copyAll = async () => {
    if (!notes.length) return flash('No feedback yet: click an element to add some')
    const head = ['## UI feedback', settings.page && `Page: ${location.href}\nViewport: ${innerWidth}×${innerHeight}`].filter(Boolean).join('\n')
    await copy([head, ...notes.map(({ d, note }, i) => item(d, note, i + 1))].join('\n\n'))
    flash(`Copied ${notes.length} note${notes.length > 1 ? 's' : ''}`)
  }

  const copyElement = el => {
    const d = describe(el)
    resolve(d).then(r => copy(item(r))).then(() => flash(`Copied ${heading(d)}`))
  }

  const openNote = el => {
    editing = el
    const r = el.getBoundingClientRect()
    pop.querySelector('.what').textContent = label(describe(el))
    pop.style.display = 'block'
    pop.style.left = `${Math.min(innerWidth - 290, Math.max(8, r.left))}px`
    pop.style.top = `${r.bottom + 8 + 130 < innerHeight ? r.bottom + 8 : Math.max(8, r.top - 138)}px`
    area.value = ''
    area.focus()
  }

  const closeNote = () => {
    editing = null
    pop.style.display = 'none'
  }

  const addNote = async () => {
    const note = area.value.trim()
    const el = editing
    closeNote()
    if (el && note) notes.push({ d: await resolve(describe(el)), note })
    redrawPins()
  }

  const setOn = value => {
    on = value
    if (!on) {
      box.style.display = tip.style.display = 'none'
      hovered = null
      closeNote()
    }
    redrawPins()
  }

  const ours = e => e.composedPath().includes(host)

  // Keys only act while Pin is on, so copy and print work as usual otherwise. Turning it on is the
  // extension's shortcut (chrome.commands, rebindable), which calls api.toggle.
  //   copy every note: ⌃C on macOS, Alt+Shift+C elsewhere (Ctrl+Shift+C is "inspect element")
  //   copy the hovered element: ⌘C / Ctrl+C, unless text is selected
  const copyAllKey = e => (mac ? e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey : e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) && e.code === 'KeyC'
  const copyKey = e => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyC'
  addEventListener('keydown', e => {
    if (!on) return
    if (editing && ours(e)) {
      if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), addNote())
      if (e.key === 'Escape') closeNote()
      return
    }
    if (e.key === 'Escape') return setOn(false)
    if (copyAllKey(e)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      return copyAll()
    }
    if (copyKey(e) && hovered && !getSelection()?.toString()) {
      e.preventDefault()
      e.stopImmediatePropagation()
      copyElement(hovered)
    }
  }, true)

  addEventListener('mousemove', e => {
    if (!on || editing || ours(e)) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (el && el !== host && el !== hovered) show(el)
  }, true)

  // While on, clicks pick elements instead of reaching the page.
  for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
    addEventListener(type, e => {
      if (!on || ours(e) || drag) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (type !== 'click') return
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el || el === host) return
      show(el)
      openNote(el)
    }, true)
  }

  addEventListener('scroll', () => (redrawPins(), hovered && on && !editing && show(hovered)), true)
  addEventListener('resize', () => (redrawPins(), placeBar()))

  pop.querySelector('.add').onclick = addNote
  pop.querySelector('.cancel').onclick = closeNote
  bar.querySelector('.copy').onclick = copyAll
  bar.querySelector('.clear').onclick = () => (notes.length = 0, redrawPins(), flash('Notes cleared'))
  bar.querySelector('.toggle').onclick = () => setOn(!on)
  // Dragged out of the window: hidden on this site (notes kept); the extension's toolbar button
  // brings it back.
  const hideHere = () => {
    setOn(false)
    host.remove()
    try {
      localStorage.setItem(HIDDEN, '1')
    } catch {}
  }
  // The extension's side (background.js through the toolbar button and shortcuts).
  api.show = () => {
    try {
      localStorage.removeItem(HIDDEN)
    } catch {}
    if (!host.isConnected) document.documentElement.append(host)
    placeBar()
  }
  // Toolbar button: shown → hidden for the site; hidden → shown.
  api.toggleHidden = () => (host.isConnected ? hideHere() : api.show())
  // Toggle shortcut: on/off, showing the island first if needed.
  api.toggle = () => {
    if (!host.isConnected) return api.show(), setOn(true)
    if (!editing) setOn(!on)
  }
  api.copyAll = () => host.isConnected && copyAll()

  // Settings and shortcut names arrive from bridge.js (asked for on load, resent on change). The
  // first ones decide whether the island shows by itself.
  let first = true
  document.addEventListener('react-pin:settings', e => {
    try {
      settings = { ...settings, ...JSON.parse(e.detail) }
    } catch {
      return
    }
    const toggle = settings.keys.toggle
    bar.querySelector('.toggle').title = `Turn Pin on or off${toggle ? ` (${toggle})` : ''}`
    bar.querySelector('.copy .keys').textContent = settings.keys.copy || (mac ? '⌃C' : 'Alt+Shift+C')
    if (first && (settings.localhost || !local) && !hiddenHere()) document.documentElement.append(host)
    first = false
    renderBar()
  })
  window.__pin = api
  document.dispatchEvent(new CustomEvent('react-pin:hello'))
  renderBar()
})()
