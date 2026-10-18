// Main-thread cost of hovering: node perf.mjs <url> [on|off] [extension dir]
// Sweeps the cursor across the page 6 times with the CPU slowed 4x, and prints the script, layout
// and style time spent during the sweep, long tasks (>50ms), and how long the tooltip takes to show
// a source after the cursor stops. Compare on vs off, and old vs new (git archive an old commit
// into a folder and pass it as the extension dir).
import { launch, EXT } from './launch.mjs'

const [url, mode = 'on', ext = EXT] = process.argv.slice(2)
const on = mode !== 'off'
const { ctx } = await launch({ ext })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
await cdp.send('Performance.enable')
if (on) await page.evaluate(() => window.__pin.toggle())
await page.evaluate(() => {
  window.__long = []
  new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(e.duration))).observe({ type: 'longtask' })
})
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
const before = await metrics()
for (let k = 0; k < 6; k++) {
  await page.mouse.move(40, 120 + k * 100)
  await page.mouse.move(1240, 160 + k * 100, { steps: 120 })
}
const after = await metrics()
const ms = key => Math.round((after[key] - before[key]) * 1000)
const t = Date.now()
const settleMs = on
  ? await page
      .waitForFunction(() => /\.[cm]?[jt]sx?:\d+/.test(document.querySelector('pin-ui').shadowRoot.querySelector('.tip').textContent), null, { timeout: 15000 })
      .then(() => Date.now() - t)
      .catch(() => 'no source')
  : '-'
const long = await page.evaluate(() => window.__long)
console.log(JSON.stringify({
  elements: await page.evaluate(() => document.querySelectorAll('*').length),
  on, scriptMs: ms('ScriptDuration'), layoutMs: ms('LayoutDuration'), styleMs: ms('RecalcStyleDuration'),
  longTasks: long.length, longMaxMs: Math.round(Math.max(0, ...long)), settleMs,
}))
await ctx.close()
