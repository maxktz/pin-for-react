// Chromium with the unpacked extension (this repo) loaded. Branded Chrome ignores
// --load-extension, so this uses Playwright's Chromium, or CHROME=<path to Chrome for Testing>.
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

export const EXT = fileURLToPath(new URL('..', import.meta.url))

export const launch = async ({ ext = EXT, ...options } = {}) => {
  const ctx = await chromium.launchPersistentContext('', {
    executablePath: process.env.CHROME || undefined,
    headless: true,
    viewport: { width: 1280, height: 800 },
    ...options,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...(options.args ?? [])],
  })
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
  return { ctx, sw, id: sw.url().split('/')[2] }
}
