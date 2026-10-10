/** Browser diagnostic for the built plugin: synthetic transport, no app-shell claim. */
import { createRequire } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Rolldown } from 'tsdown'

const require = createRequire(import.meta.url)
if (!process.argv[2]) throw new Error('Supply the Harness checkout containing apps/web/package.json')
const { chromium } = createRequire(resolve(process.argv[2], 'apps/web/package.json'))('playwright')
const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const output = resolve(packageDir, '../..', '.playwright-mcp', 'usage-snapshot')
await mkdir(output, { recursive: true })
const bundle = await Rolldown.rolldown({ input: 'fixture', plugins: [{ name: 'fixture', resolveId(id) { if (id === 'fixture') return '\0fixture' }, load(id) { if (id !== '\0fixture') return; return `
import * as React from ${JSON.stringify(require.resolve('react'))};
import * as JSX from ${JSON.stringify(require.resolve('react/jsx-runtime'))};
import { createRoot } from ${JSON.stringify(require.resolve('react-dom/client'))};
import * as Store from ${JSON.stringify(require.resolve('@deepseek-ai/dsh-client-store'))};
const modules = { react: React, 'react/jsx-runtime': JSX, '@deepseek-ai/dsh-client-store': Store };
window.__ModuleLoader__={ load({factory}) { const mod=factory(id=>{if(!(id in modules))throw new Error('Missing module '+id);return modules[id]});
let controller; let effect;
const ctx={effect(fn){effect=fn();},locale:{register(){return ()=>{}},bind(){return key=>window.dictionary[key]}},slots:{inject(_name,fn){fn()},register(_spec,Component){const face=_spec.inject();controller=face.controller;
createRoot(document.getElementById('root')).render(React.createElement(Component,{controller,useSnapshot:(select)=>select(React.useSyncExternalStore(controller.store.subscribe,controller.store.getSnapshot)),t:face.t}));return ()=>controller.stop();}}};
mod.apply(ctx); window.fixtureController=controller;
}};
` } }], platform: 'browser', transform: { define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.MODE': '"production"' } } })
let bootstrap
try { const result = await bundle.generate({ format: 'iife' }); bootstrap = result.output.find(row => row.type === 'chunk').code } finally { await bundle.close() }
const plugin = await readFile(join(packageDir, 'lib/client.js'), 'utf8')
const { zh: dictionaries } = await import('../lib/types/client/locales.js')
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
const errors = []; page.on('pageerror', error => { errors.push(error.message) })
let input = 1234; let freshness = 'pending'; let calls = 0
try {
  await page.route('http://usage-fixture.test/**', async route => {
    if (new URL(route.request().url()).pathname === '/dsh-usage-stats/snapshot') {
      calls++
      await route.fulfill({ json: { value: { days: 1, models: [], buckets: [{date:'2026-10-09',input,cacheRead:300,output:100,requests:3,searches:0,models:{},hours:Array.from({length:24},(_,hour)=>({hour,input:hour===0?input:0,cacheRead:hour===0?300:0,output:hour===0?100:0,requests:hour===0?3:0,searches:0}))}] }, freshness, revision:1,error:null,refreshPollIntervalMs:250 } })
    } else await route.fulfill({ contentType: 'text/html', body: '<html><head><style>body{font-family:Arial;margin:40px;background:white;--dsw-alias-label-primary:#151619;--dsw-alias-label-secondary:#656970;--dsw-alias-bg-layer-2:#fafafa;--dsw-alias-bg-layer-1:white;--dsw-alias-bg-overlay:#eff0f3;--dsw-alias-border-l1:#eee;--dsw-alias-border-l2:#ddd;--dsw-alias-interactive-bg-hover:#eee}</style></head><body><div id="root"></div></body></html>' })
  })
  await page.goto('http://usage-fixture.test/')
  await page.evaluate(dictionary => { window.dictionary = dictionary }, dictionaries)
  await page.addScriptTag({ content: bootstrap }); await page.addScriptTag({ content: plugin })
  await page.getByText('正在更新，当前显示已保存的统计', { exact:true }).waitFor()
  await page.getByText('1,234', { exact:true }).waitFor()
  await page.screenshot({ path: join(output,'cached.png') })
  const cachedMarkup = await page.locator('#root').innerText()
  freshness = 'ready'; input = 2345
  await page.getByText('2,345',{exact:true}).waitFor()
  await page.getByText('正在更新，当前显示已保存的统计',{exact:true}).waitFor({state:'hidden'})
  await page.screenshot({ path: join(output,'ready.png') })
  console.log(JSON.stringify({ fixture: 'Built lib/client.js; synthetic HTTP; real Chrome; not desktop-shell evidence', cachedVisible:true,updatedVisible:true,calls,errors,output,cachedMarkup },null,2))
  if(errors.length)throw new Error(errors.join('\n'))
} finally { await page.close(); await browser.close() }
