/**
 * The Usage row's glyph in the settings navigation.
 *
 * The settings shell picks a nav glyph from a closed list of section ids
 * (`account`, `models`, `agent-presets`, `plugins`, `archived-sessions`) and
 * falls back to its own gear for every other id. The `settings.section` slot
 * contract has no `icon` field — the shell projects only `id` / `order` /
 * `label` from a registration — so a contributed section has no icon to pass
 * and wears the gear, this one included.
 *
 * So the plugin claims its own row once the dialog is mounted and swaps the
 * fallback gear for a bar-chart mark: the axis-and-ascending-bars reading the
 * page's own stacked daily chart gives. The claim is by visible label, so only
 * the row carrying this plugin's localized section label is marked and no
 * other section loses its icon.
 *
 * Scope, deliberately narrow:
 *
 * - the marker and the injected stylesheet belong to one `ctx.effect`, so both
 *   are removed with the fiber;
 * - the claim is re-derived on DOM mutations, so opening the dialog and
 *   switching locale both land without re-registering the section.
 *
 * Delete this module (and its call in index.ts) the day `settings.section`
 * grows an `icon` field, which is the seat that would make this claim
 * unnecessary.
 * @module @moonlight2893267956/dsh-usage-stats/client/nav-icon
 */

/**
 * The slice of the client context this feature uses. Narrow on purpose: the mark
 * needs effect ownership and nothing else, so the module stays installable from
 * a test without a whole client context.
 */
export interface NavIconContext {
  /**
   * Register a cleanup-aware effect on the owning fiber.
   * @param callback - the effect body; its disposer releases the mark.
   * @param label - effect label shown in fiber diagnostics.
   */
  effect(callback: () => () => void, label?: string): unknown
}

/** Marks the one nav row this plugin owns. */
export const NAV_ICON_MARKER = 'data-dsh-usage-nav-icon'

/**
 * The settings dialog's nav rows: the shell renders one `<button>` per
 * `settings.section` entry inside the panel's `<nav>` (SettingsPanel in
 * `@deepseek-ai/dsh-client-ui-settings-general`).
 */
export const NAV_ROW_SELECTOR = '[role="dialog"] nav button'

/**
 * Glyph box in px. The shell draws every nav icon at this size and ships no
 * narrow variant of its own, so the mark has none either.
 */
export const NAV_ICON_SIZE = 16

/**
 * Stroke weight of the mark's axis, matching the shell's medium nav icons. A
 * lighter axis would read as a fainter glyph than the icons beside it, and a
 * heavier one as a different icon set.
 */
export const NAV_MARK_STROKE = 1.3

/** The L-shaped axis: up the left edge, then along the baseline. */
export const NAV_MARK_AXIS = 'M2.2 2.6v11h11.6'

/** One bar of the mark: an ascending column standing on the baseline. */
export interface NavMarkBar {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly radius: number
}

/**
 * The mark's three ascending bars, shortest first. The tallest stops short of
 * the axis' top so the mark keeps the 16-box nav margin, and every bar bottoms
 * out on the baseline's centre so the columns read as standing on it.
 */
export const NAV_MARK_BARS: readonly NavMarkBar[] = [
  { x: 4.2, y: 9.9, width: 1.9, height: 3.7, radius: 0.55 },
  { x: 7.1, y: 7.6, width: 1.9, height: 6, radius: 0.55 },
  { x: 10, y: 5.2, width: 1.9, height: 8.4, radius: 0.55 },
]

/** Baseline the bars stand on, as a y coordinate in the 16-box. */
export const NAV_MARK_BASELINE = 13.6

/**
 * The mark as standalone SVG for a CSS `mask-image`.
 *
 * Painted pure black on purpose: a mask reads alpha only, and the visible
 * colour comes from the marked row's `background-color: currentColor`.
 */
export function navMarkSvg(): string {
  const bars = NAV_MARK_BARS
    .map(bar => `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" rx="${bar.radius}"/>`)
    .join('')
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
    + `<g fill="none" stroke="#000" stroke-width="${NAV_MARK_STROKE}" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="${NAV_MARK_AXIS}"/></g>`
    + `<g fill="#000">${bars}</g>`
    + '</svg>'
}

/**
 * The mask URL for the mark. Encoded at runtime, never hand-escaped: a raw
 * `#` in the painted colour would otherwise end the URL at a fragment.
 * @param svg - the standalone mark; defaults to {@link navMarkSvg}.
 * @returns a `data:` URL usable as a CSS mask source.
 */
export function navMaskUrl(svg: string = navMarkSvg()): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Whether a nav row is this plugin's own.
 *
 * Pure, and the only decision this feature makes: the row whose visible text
 * equals the section label the shell is currently projecting. An empty label
 * matches nothing, so a locale that has not resolved yet cannot mark the nav.
 * @param rowText - the candidate row's text content.
 * @param wantedLabel - this plugin's current section label.
 * @returns true when the row is the Usage entry.
 */
export function isOwnNavRow(rowText: string | null | undefined, wantedLabel: string | null | undefined): boolean {
  const wanted = String(wantedLabel ?? '').trim()
  if (wanted.length === 0) return false
  return String(rowText ?? '').trim() === wanted
}

/**
 * Stylesheet for the marked row: hide the shell's gear, draw the mark.
 * @param maskUrl - the mark's mask source.
 * @returns CSS text for one style element.
 */
export function navIconCss(maskUrl: string): string {
  return [
    `[${NAV_ICON_MARKER}] > svg { display: none; }`,
    `[${NAV_ICON_MARKER}]::before {`,
    `  content: '';`,
    `  display: block;`,
    `  flex: none;`,
    `  width: ${NAV_ICON_SIZE}px;`,
    `  height: ${NAV_ICON_SIZE}px;`,
    `  background-color: currentColor;`,
    `  -webkit-mask-image: url("${maskUrl}");`,
    `  mask-image: url("${maskUrl}");`,
    `  -webkit-mask-repeat: no-repeat;`,
    `  mask-repeat: no-repeat;`,
    `  -webkit-mask-position: center;`,
    `  mask-position: center;`,
    `  -webkit-mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `  mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `}`,
  ].join('\n')
}

/** Style-element identity, matching the tag naming the client bundle's own stylesheets use. */
const STYLE_PLUGIN = '@moonlight2893267956/dsh-usage-stats'
const STYLE_ID = `${STYLE_PLUGIN}/nav-icon`

/**
 * Install the nav glyph.
 *
 * @param ctx - client context, for effect ownership.
 * @param resolveLabel - this plugin's current section label; the same thunk the
 *   `settings.section` registration passes, re-read on every sync so a locale
 *   switch is picked up without re-registering.
 */
export function installSettingsNavIcon(ctx: NavIconContext, resolveLabel: () => string): void {
  if (typeof document === 'undefined') return

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = STYLE_PLUGIN
    tag.dataset.pluginCss = STYLE_ID
    tag.textContent = navIconCss(navMaskUrl())
    document.head.appendChild(tag)

    let disposed = false
    let scheduled = false

    const sync = (): void => {
      scheduled = false
      if (disposed) return
      const wanted = resolveLabel()
      for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
        if (isOwnNavRow(row.textContent, wanted)) row.setAttribute(NAV_ICON_MARKER, '')
        else row.removeAttribute(NAV_ICON_MARKER)
      }
    }

    // Coalesce a burst of mutations into one sync, and land it before the next
    // paint so the row never shows the gear first.
    const schedule = (): void => {
      if (scheduled || disposed) return
      scheduled = true
      queueMicrotask(sync)
    }

    sync()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => {
      disposed = true
      observer.disconnect()
      for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER)
      tag.remove()
    }
  }, 'usage-stats: settings nav icon')
}
