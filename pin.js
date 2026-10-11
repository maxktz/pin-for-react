// React Pin: point at UI and hand it to an agent. Its island (bottom center, shown on localhost)
// has a Pin toggle and can be dragged to any edge; dragging it out of the window hides it for the
// site, and the extension's toolbar button shows it again (or anywhere else, off localhost).
//   ⌃P turns it on or off. Hover shows what's under the cursor; ⌘C copies that element for a chat.
//   Click adds feedback to an element; "Copy feedback" (or ⌃C) copies every note as one prompt.
// Plain script, no dependencies: React info is read from React's own dev data when present.
;(() => {
  if (window.__pin) return
  // What the extension calls (toolbar button): window.__pin.toggleHidden()
  const api = (window.__pin = {})

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

  // Components from the element up (StatCard, App), skipping React and library internals.
  const componentsOf = fiber => {
    const out = []
    for (let f = fiber; f && out.length < 4; f = f.return) {
      const name = typeof f.type === 'string' ? null : nameOf(f.type)
      if (name && /^[A-Z]/.test(name) && !/^(Fragment|Suspense|StrictMode|Provider|Consumer)$/.test(name)) out.push(name)
    }
    return out
  }

  // Where the element's JSX is: React ≤18 keeps _debugSource; React 19 keeps the stack of the
  // render that created it (_debugStack), whose first app frame is the file and line. Dev servers
  // serve transformed code, so that line goes through the module's source map (see mapped).
  const sourceOf = fiber => {
    for (let f = fiber; f; f = f.return) {
      if (f._debugSource) return { file: short(f._debugSource.fileName), line: f._debugSource.lineNumber }
      const stack = f._debugStack?.stack
      if (stack) {
        for (const line of stack.split('\n').slice(1)) {
          const m = line.match(/\(?((?:https?:\/\/[^/]+)?\/[^\s)]+?):(\d+):(\d+)\)?$/)
          if (m && !/node_modules|react-dom|react\.|\/@vite\/|chunk-/.test(m[1])) {
            return { url: m[1], file: short(m[1]), genLine: +m[2], genCol: +m[3] }
          }
        }
      }
    }
    return null
  }

  // Source maps by module URL: { mappings: lines of [genCol, src, origLine, origCol] }.
  const maps = new Map()
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
  const mapOf = url => {
    if (!maps.has(url)) {
      maps.set(url, fetch(url).then(r => r.text()).then(code => {
        const inline = code.match(/\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)/)
        return inline ? decode(JSON.parse(atob(inline[1])).mappings) : null
      }).catch(() => null))
    }
    return maps.get(url)
  }
  // "file:line" in the original source, or the served line when there's no map.
  const mapped = async src => {
    if (!src) return null
    if (!src.url) return `${src.file}:${src.line}`
    const lines = await mapOf(src.url)
    const segs = lines?.[src.genLine - 1]
    const seg = segs?.filter(s => s[0] <= src.genCol - 1).pop() ?? segs?.[0]
    return seg ? `${src.file}:${seg[2] + 1}` : `${src.file}:${src.genLine}`
  }

  const short = path => path.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/^\//, '')

  const textOf = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)

  // The shortest selector that names only this element, from the element up: nth-of-type
  // wherever siblings share a tag, stopping as soon as it matches just this one.
  const selectorOf = el => {
    const parts = []
    for (let n = el; n && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      let part = n.id ? `#${n.id}` : n.tagName.toLowerCase()
      if (!n.id) {
        const cls = [...n.classList].slice(0, 2)
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
    return { el, tag, components, src: fiber ? sourceOf(fiber) : null, text: textOf(el), selector: selectorOf(el) }
  }

  const label = d => [d.components[0], d.tag].filter(Boolean).join(' › ')
  const resolve = async d => ({ ...d, source: await mapped(d.src) })

  // One element in the prompt (markdown):
  //   ### 2. StatCard "-12%"
  //   Element: `src/App.tsx:20` · `div.card.stat:nth-of-type(2) > span.delta.down`
  //   Feedback: red is too loud
  const heading = d => {
    const text = d.text.length > 30 ? `${d.text.slice(0, 30)}…` : d.text
    return text ? `${d.components[0] ?? d.tag} "${text}"` : [d.components[0], d.tag].filter(Boolean).join(' ')
  }
  const item = (d, note, n) =>
    [
      `### ${n ? `${n}. ` : ''}${heading(d)}`,
      `Element: ${d.source ? `\`${d.source}\` · ` : ''}\`${d.selector}\``,
      note && `Feedback: ${note}`,
    ]
      .filter(Boolean)
      .join('\n')

  // ---- UI, in a shadow root so the page's CSS can't touch it ----------------------------------

  const host = document.createElement('pin-ui')
  const root = host.attachShadow({ mode: 'open' })
  // Dark pills sized like React Grab's toolbar (26px tall, 13px text, soft shadow).
  const PIN_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`
  root.innerHTML = `<style>
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
  </style>
  <div class="box"></div><div class="tip"></div><div class="pins"></div>
  <div class="pop shadow"><div class="what"></div><textarea placeholder="What should change? (Enter to add)"></textarea>
    <div class="row"><button class="cancel">Cancel</button><button class="add">Add</button></div></div>
  <div class="bar shadow">
    <button class="toggle" aria-pressed="false" title="Turn Pin on or off (⌃P)">${PIN_ICON}Pin</button>
    <button class="copy" hidden><span class="label">Copy feedback</span><span class="keys">⌃C</span></button>
    <button class="clear" hidden>Clear</button>
  </div>
  <div class="toast shadow"></div>`
  // On by default only on local dev servers (the extension can turn it on anywhere).
  // ✕ hides it for the whole site (this origin), remembered across reloads; the extension's toolbar
  // button shows it again.
  const HIDDEN = 'react-pin:hidden'
  const hiddenHere = () => {
    try {
      return localStorage.getItem(HIDDEN) === '1'
    } catch {
      return false
    }
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(location.hostname)
  if (local && !hiddenHere()) document.documentElement.append(host)

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
      span('keys', '  ·  ⌘C to copy'),
    )
    mapped(d.src).then(source => source && hovered === el && (src.textContent = `  ${source}`))
    // 4px above the element, or below it when there's no room; kept inside the window.
    tip.style.display = 'block'
    const h = tip.offsetHeight
    tip.style.left = `${Math.max(4, Math.min(r.left, innerWidth - tip.offsetWidth - 4))}px`
    tip.style.top = `${r.top - h - 4 >= 4 ? r.top - h - 4 : Math.min(r.bottom + 4, innerHeight - h - 4)}px`
  }

  // Off keeps the notes but hides them: pins and their buttons come back when it's turned on.
  const redrawPins = () => {
    pins.innerHTML = ''
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

  const copy = async text => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
    const area = document.createElement('textarea')
    area.value = text
    area.style.cssText = 'position:fixed;opacity:0'
    root.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }

  const copyAll = async () => {
    const head = `## UI feedback\nPage: ${location.href}\nViewport: ${innerWidth}×${innerHeight}`
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

  addEventListener('keydown', e => {
    // ⌃P toggles Pin wherever focus is, except while typing a note (and not when it's hidden).
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.code === 'KeyP' && host.isConnected && !editing) {
      e.preventDefault()
      e.stopImmediatePropagation()
      return setOn(!on)
    }
    if (!on) return
    if (editing && ours(e)) {
      if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), addNote())
      if (e.key === 'Escape') closeNote()
      return
    }
    if (e.key === 'Escape') return setOn(false)
    // ⌃C: every note. ⌘C: the hovered element (unless text is selected, so normal copy still works).
    // (⌘⇧C and ⌥⌘C are the browser's "inspect element", so copy-all lives on Control.)
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.code === 'KeyC') {
      e.preventDefault()
      e.stopImmediatePropagation()
      return notes.length ? copyAll() : flash('No feedback yet: click an element to add some')
    }
    if (e.metaKey && !e.ctrlKey && e.key === 'c' && hovered && !getSelection()?.toString()) {
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
  // The toolbar button: shown → hidden for the site; hidden (or never shown, off localhost) → shown.
  api.toggleHidden = () => {
    if (host.isConnected) return hideHere()
    try {
      localStorage.removeItem(HIDDEN)
    } catch {}
    document.documentElement.append(host)
    placeBar()
  }
  renderBar()
})()
