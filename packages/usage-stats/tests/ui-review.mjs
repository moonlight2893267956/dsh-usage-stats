/**
 * Design-review captures for the built Usage page: real Chrome, synthetic HTTP,
 * three data shapes. Diagnostics only — not desktop-shell evidence.
 */
import { createRequire } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Rolldown } from 'tsdown'

if (!process.argv[2]) throw new Error('Supply the Harness checkout containing apps/web/package.json')
const require = createRequire(resolve(process.argv[2], 'apps/web/package.json'))
const { chromium } = require('playwright')
const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const output = resolve(packageDir, '../..', '.playwright-mcp', 'usage-ui')
await mkdir(output, { recursive: true })

const bundle = await Rolldown.rolldown({
  input: 'fixture',
  plugins: [{
    name: 'fixture',
    resolveId(id) { if (id === 'fixture') return '\0fixture' },
    load(id) {
      if (id !== '\0fixture') return
      return `
import * as React from ${JSON.stringify(require.resolve('react'))};
import * as JSX from ${JSON.stringify(require.resolve('react/jsx-runtime'))};
import { createRoot } from ${JSON.stringify(require.resolve('react-dom/client'))};
import * as Store from ${JSON.stringify(require.resolve('@deepseek-ai/dsh-client-store'))};
const modules = { react: React, 'react/jsx-runtime': JSX, '@deepseek-ai/dsh-client-store': Store };
window.__ModuleLoader__ = { load({ factory }) {
  const mod = factory(id => { if (!(id in modules)) throw new Error('Missing module ' + id); return modules[id] });
  const ctx = {
    effect(fn) { fn() },
    locale: { register() { return () => {} }, bind() { return key => window.dictionary[key] } },
    slots: { inject(_name, fn) { fn() }, register(spec, Component) {
      const face = spec.inject();
      const controller = face.controller;
      createRoot(document.getElementById('root')).render(React.createElement(Component, {
        controller,
        useSnapshot: select => select(React.useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot)),
        t: face.t,
      }));
      return () => controller.stop();
    } },
  };
  mod.apply(ctx);
} };
`
    },
  }],
  platform: 'browser',
  transform: { define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.MODE': '"production"' } },
})
let bootstrap
try {
  const result = await bundle.generate({ format: 'iife' })
  bootstrap = result.output.find(row => row.type === 'chunk').code
} finally { await bundle.close() }
const plugin = await readFile(join(packageDir, 'lib/client.js'), 'utf8')
const { zh: dictionary } = await import('../lib/types/client/locales.js')

const now = new Date()
const pad = value => String(value).padStart(2, '0')
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const nowHour = now.getHours()
const hourOf = (input) => ({
  hour: 0, input, cacheRead: Math.round(input * 0.92), output: Math.round(input * 0.03),
  requests: input > 0 ? 3 : 0, searches: 0,
})
function dayBucket(date, hours, index) {
  const buckets = hours.map((value, hour) => ({ ...hourOf(value), hour }))
  const sum = key => buckets.reduce((total, bucket) => total + bucket[key], 0)
  return {
    date, input: sum('input'), cacheRead: sum('cacheRead'), output: sum('output'),
    requests: sum('requests'), searches: 0, models: {},
    ...(index === undefined ? {} : {}),
    hours: buckets,
  }
}
/** The user's shape: nothing until the last two hours of the current day. */
const sparseHours = Array.from({ length: 24 }, (_, hour) => (hour === nowHour - 1 ? 88_000_000 : hour === nowHour ? 5_000_000 : 0))
const busyHours = Array.from({ length: 24 }, (_, hour) => (hour > nowHour ? 0 : 3_000_000 + (hour % 5) * 2_400_000))
const dailyBuckets = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(now)
  date.setDate(date.getDate() - (29 - index))
  const value = [12, 7, 0, 4, 19, 26, 9][index % 7] * 1_100_000
  return dayBucket(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, [value])
})

let mode = 'sparse'
function currentValue() {
  if (mode === 'sparse') return { days: 1, models: [], buckets: [dayBucket(today, sparseHours)] }
  if (mode === 'busy') return { days: 1, models: [], buckets: [dayBucket(today, busyHours)] }
  return { days: 30, models: [], buckets: dailyBuckets }
}

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', error => { errors.push(error.message) })
try {
  await page.route('http://usage-ui.test/**', async route => {
    if (new URL(route.request().url()).pathname === '/dsh-usage-stats/snapshot') {
      await route.fulfill({ json: { value: currentValue(), freshness: 'ready', revision: 1, error: null, refreshPollIntervalMs: 1000 } })
    } else {
      await route.fulfill({
        contentType: 'text/html',
        body: `<html><head><style>
          :root{--dsw-alias-label-primary:#151619;--dsw-alias-label-secondary:#656970;--dsw-alias-label-tertiary:#9096a0;
          --dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fbfbfc;--dsw-alias-bg-overlay:#f2f3f5;--dsw-alias-border-l1:#eceef1;
          --dsw-alias-border-l2:#dcdfe4;--dsw-alias-interactive-bg-hover:#eef0f3;--dsw-alias-state-error-primary:#d03050}
          body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;margin:0;padding:36px 44px;background:#fff}
        </style></head><body><div id="root"></div></body></html>`,
      })
    }
  })
  await page.goto('http://usage-ui.test/')
  await page.evaluate(value => { window.dictionary = value }, dictionary)
  await page.addScriptTag({ content: bootstrap })
  await page.addScriptTag({ content: plugin })
  await page.getByText('今日 Tokens', { exact: false }).first().waitFor()

  const capture = async (name, next) => {
    mode = next
    await page.getByRole('button', { name: '7天', exact: true }).click()
    await page.getByRole('button', { name: mode === 'daily' ? '30天' : '今天', exact: true }).click()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(output, `${name}.png`) })
    await page.locator('#root').screenshot({ path: join(output, `${name}-root.png`) })
  }
  const prefix = process.argv[3] ?? 'before'
  await capture(`${prefix}-sparse`, 'sparse')
  await capture(`${prefix}-busy`, 'busy')
  await capture(`${prefix}-daily`, 'daily')

  // Hover and keyboard-focus states: the tooltip and the focus ring must both
  // be visible on a real column, not only in jsdom.
  mode = 'busy'
  await page.getByRole('button', { name: '今天', exact: true }).click()
  await page.waitForTimeout(1200)
  const bars = page.locator('[role="img"][aria-label*="tokens"]')
  await bars.nth(6).hover()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(output, `${prefix}-hover.png`) })
  await bars.nth(2).focus()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(output, `${prefix}-focus.png`) })
  console.log(JSON.stringify({ output, bars: await bars.count(), errors }))
} finally {
  await page.close()
  await browser.close()
}
