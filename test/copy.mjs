// What ⌘C copies for each element: node copy.mjs <url> <selector>...
// Turns Pin on, hovers each element, waits for the source, copies, prints tooltip and clipboard.
import { launch } from './launch.mjs'

const [url, ...selectors] = process.argv.slice(2)
const { ctx } = await launch()
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('PAGE ERROR', e.message))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__pin)
await page.evaluate(() => window.__pin.toggle())
for (const selector of selectors) {
  await page.locator(selector).first().hover({ position: { x: 3, y: 3 } })
  await page.waitForTimeout(1200)
  const tip = await page.evaluate(() => document.querySelector('pin-ui').shadowRoot.querySelector('.tip').textContent)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C')
  await page.waitForTimeout(800)
  console.log(`== ${selector}\ntip: ${tip}\n${await page.evaluate(() => navigator.clipboard.readText())}\n`)
}
await ctx.close()
