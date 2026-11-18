/**
 * The Usage row's glyph in the settings navigation.
 *
 * The shell renders one nav row per `settings.section` entry and picks a
 * built-in glyph by section id, falling back to the settings gear for every id
 * it does not know. Hosts from DSH 0.2.2 on also declare the optional
 * `settings.section.icon` slot: a list addressed by the matching section id,
 * whose registrant supplies the glyph the shell draws in place of its own.
 * This plugin registers there under its own section id, so the Usage row
 * carries a bar-chart mark instead of the gear — the same reading as the
 * stacked daily chart on the page.
 *
 * The mark is drawn in `currentColor`, so it follows the row in either theme
 * and in the active state, and it keeps the shell's 16px nav box.
 */

import { useId } from 'react'
import type { SettingsSectionIconOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * Glyph box in px. The shell draws every nav icon at the size it passes to the
 * slot, and ships no narrow variant of its own, so the mark has none either.
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
 * Props the settings shell passes to a navigation icon: the square edge it
 * reserves, and whether this section is the selected one.
 */
export interface UsageNavIconProps extends Partial<SettingsSectionIconOwnerProps> {}

/**
 * The Usage nav glyph: a bar-chart mark drawn in the row's own colour.
 * @param props - shell-supplied `size` and `active`; both optional so the
 *   component also renders standalone.
 * @returns the mark as inline SVG.
 */
export function UsageNavIcon({ size = NAV_ICON_SIZE, active: _active }: UsageNavIconProps) {
  // A gradient-free mark needs no per-instance id, but the shell renders every
  // section's icon in one list: an id keeps `aria-hidden` decoration distinct
  // from the labelled row that hosts it.
  const id = useId()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-usage-nav-icon={id}
    >
      <path
        d={NAV_MARK_AXIS}
        stroke="currentColor"
        strokeWidth={NAV_MARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {NAV_MARK_BARS.map(bar => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={bar.radius}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}
