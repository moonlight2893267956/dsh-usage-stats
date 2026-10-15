// @vitest-environment jsdom
/**
 * The Usage row's own glyph in the settings navigation.
 *
 * The shell picks nav icons from its own built-in section ids and falls back to
 * the gear for everything else, and a `settings.section` registration has no
 * icon to pass — so this module claims the Usage row once the dialog mounts.
 * What these specs pin is the set of failures that are quiet rather than loud:
 * claiming a row that belongs to another section (which would take that
 * section's icon away), keeping a stale claim after a locale switch, and
 * leaving the marker or the stylesheet behind when the fiber goes away.
 *
 * The visual half — that the masked glyph is the bar-chart mark — is held in
 * place by deriving both the drawn bars and the mask from the one geometry
 * table, which the last spec checks.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  NAV_ICON_MARKER,
  NAV_ICON_SIZE,
  NAV_MARK_AXIS,
  NAV_MARK_BARS,
  NAV_MARK_BASELINE,
  NAV_MARK_STROKE,
  installSettingsNavIcon,
  isOwnNavRow,
  navIconCss,
  navMarkSvg,
  navMaskUrl,
  type NavIconContext,
} from '../src/client/nav-icon.ts'

/** The shell's own fallback glyph, as the row receives it. */
const GEAR = '<svg class="Dws9Sa_navIcon" viewBox="0 0 16 16"></svg>'

const STYLESHEET_SELECTOR = 'style[data-plugin-css="@moonlight2893267956/dsh-usage-stats/nav-icon"]'

/** Let the MutationObserver's queued sync run. */
const flush = () => new Promise<void>(done => { setTimeout(done, 0) })

let label = '用量'
let disposers: (() => void)[] = []

/**
 * The shell's panel: `role="dialog"` > nav > one `<button>` per section, each
 * carrying the fallback gear plus its label.
 */
function mountDialog(...sections: string[]): void {
  document.querySelector('[role="dialog"]')?.remove()
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const nav = document.createElement('nav')
  for (const section of sections) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'Dws9Sa_navCell'
    row.innerHTML = `${GEAR}<span class="Dws9Sa_navLabel">${section}</span>`
    nav.append(row)
  }
  dialog.append(nav)
  document.body.append(dialog)
}

/** The labels of the rows currently carrying the marker. */
const marked = (): string[] =>
  [...document.querySelectorAll(`[${NAV_ICON_MARKER}]`)].map(row => row.textContent?.trim() ?? '')

const stylesheet = (): HTMLStyleElement | null => document.head.querySelector(STYLESHEET_SELECTOR)

beforeEach(() => {
  label = '用量'
  disposers = []
  // The plugin boots with the client, before any settings dialog exists.
  const ctx: NavIconContext = { effect: (callback) => { disposers.push(callback()); return undefined } }
  installSettingsNavIcon(ctx, () => label)
})

afterEach(() => {
  for (const dispose of disposers) dispose()
  disposers = []
  document.body.innerHTML = ''
  document.querySelectorAll(STYLESHEET_SELECTOR).forEach(tag => tag.remove())
})

describe('settings nav glyph', () => {
  it('claims its own row and nobody else\'s', async () => {
    mountDialog('通用设置', '模型', '用量', '插件市场')
    await flush()

    // 模型 and 插件市场 belong to the shell and to another plugin: a marker on
    // either would replace an icon this plugin does not own.
    expect(marked()).toEqual(['用量'])
  })

  it('claims nothing while the section label has not resolved', async () => {
    label = ''
    // The second row is a section whose own label has not rendered yet, so its
    // text is empty: an unguarded empty-label match would claim it and take an
    // icon this plugin does not own.
    mountDialog('通用设置', '')
    await flush()

    expect(marked()).toEqual([])
  })

  it('moves the claim when the locale switches', async () => {
    mountDialog('General', 'Usage')
    await flush()
    expect(marked()).toEqual([])

    // The shell re-renders its nav on a locale change, which is what the
    // observer sees; the module must not need a second registration for it.
    label = 'Usage'
    mountDialog('General', 'Usage')
    await flush()

    expect(marked()).toEqual(['Usage'])
  })

  it('claims a row mounted after the dialog opens', async () => {
    mountDialog('通用设置')
    await flush()
    expect(marked()).toEqual([])

    // A section registered later still lands: the claim is re-derived on the
    // mutation, not only at install time.
    const nav = document.querySelector('[role="dialog"] nav')!
    const row = document.createElement('button')
    row.innerHTML = `${GEAR}<span class="Dws9Sa_navLabel">用量</span>`
    nav.append(row)
    await flush()

    expect(marked()).toEqual(['用量'])
  })

  it('hides the shell gear and paints the mark through a mask', async () => {
    mountDialog('用量')
    await flush()

    const row = document.querySelector('[role="dialog"] nav button')
    expect(row?.querySelector('svg'), 'the row must carry a gear for the stylesheet to hide').not.toBeNull()

    const css = stylesheet()?.textContent ?? ''
    expect(css).toContain(`[${NAV_ICON_MARKER}] > svg { display: none; }`)
    // currentColor, so the glyph follows the row's colour in either theme and
    // in the active state.
    expect(css).toContain('background-color: currentColor')
    expect(css).toContain(`width: ${NAV_ICON_SIZE}px`)
    expect(css).toContain('-webkit-mask-image: url("data:image/svg+xml,')
    expect(css).toContain('mask-image: url("data:image/svg+xml,')
    // A mask is an independent image, so currentColor inside it would not resolve.
    expect(css).not.toContain('currentColor);')
  })

  it('derives the mask from the same geometry the drawn mark uses', () => {
    const svg = decodeURIComponent(navMaskUrl().replace('data:image/svg+xml,', ''))

    expect(svg.match(/<rect/g)).toHaveLength(NAV_MARK_BARS.length)
    expect(svg).toContain(`stroke-width="${NAV_MARK_STROKE}"`)
    expect(svg).toContain(`d="${NAV_MARK_AXIS}"`)
    for (const bar of NAV_MARK_BARS) {
      expect(svg).toContain(`<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" rx="${bar.radius}"/>`)
    }
    // View box in lockstep with the glyph box the shell draws at.
    expect(svg).toContain(`viewBox="0 0 ${NAV_ICON_SIZE} ${NAV_ICON_SIZE}"`)
  })

  it('keeps every bar standing on the axis baseline, ascending', () => {
    // A bar whose bottom missed the baseline would float above it; one taller
    // than the axis would break the nav box.
    const bottoms = NAV_MARK_BARS.map(bar => bar.y + bar.height)
    for (const bottom of bottoms) expect(bottom).toBeCloseTo(NAV_MARK_BASELINE, 5)
    const heights = NAV_MARK_BARS.map(bar => bar.height)
    expect([...heights].sort((a, b) => a - b)).toEqual(heights)
    // Ascending left to right, so the mark reads as growth.
    for (let index = 1; index < NAV_MARK_BARS.length; index++) {
      expect(NAV_MARK_BARS[index]!.x).toBeGreaterThan(NAV_MARK_BARS[index - 1]!.x)
    }
  })

  it('accepts a label match only, never an empty one', () => {
    expect(isOwnNavRow('用量', '用量')).toBe(true)
    expect(isOwnNavRow(' 用量 ', '用量')).toBe(true)
    expect(isOwnNavRow('用量统计', '用量')).toBe(false)
    expect(isOwnNavRow('用量', '')).toBe(false)
    expect(isOwnNavRow('用量', null)).toBe(false)
    expect(isOwnNavRow(null, '用量')).toBe(false)
  })

  it('leaves no marker and no stylesheet behind when the fiber goes away', async () => {
    mountDialog('通用设置', '用量')
    await flush()
    expect(marked()).toEqual(['用量'])
    expect(stylesheet()).not.toBeNull()

    for (const dispose of disposers) dispose()
    await flush()

    expect(marked()).toEqual([])
    expect(stylesheet()).toBeNull()
  })

  it('draws no document-global ids and no themeable colour in the mark', () => {
    const svg = navMarkSvg()
    expect(svg).not.toContain('id=')
    expect(svg).not.toContain('clip-path')
    // Black is the mask's alpha carrier, not a themeable colour: any other
    // palette value would survive into the mask and lose the row's own colour.
    const colors = [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,8})"/g)].map(match => match[1])
    expect(colors.length).toBeGreaterThan(0)
    expect([...new Set(colors)]).toEqual(['#000'])
  })

  it('shares one source of geometry with the module, not a second copy in the page', () => {
    // The mark is geometry here and nowhere else in the package: a second copy
    // is how the nav glyph and the mark drift apart.
    const source = readFileSync(resolve('src/client/nav-icon.ts'), 'utf8')
    expect(source).toContain('NAV_MARK_BARS')
    expect(source).not.toContain('x="1.96"')
  })
})
