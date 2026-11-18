// @vitest-environment jsdom
/**
 * The Usage row's own glyph in the settings navigation.
 *
 * The shell draws a built-in icon per section id and falls back to the
 * settings gear for ids it does not know. Hosts from DSH 0.2.2 declare
 * `settings.section.icon`, whose registrant supplies the glyph the shell draws
 * in place of its own, addressed by the matching section id — so this plugin
 * registers {@link UsageNavIcon} under its own `usage` id.
 *
 * What these specs pin is the shape of that mark and the shell-supplied props:
 * a bar-chart reading drawn from one geometry table, in the row's own colour,
 * at whatever size the shell reserves.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import {
  NAV_ICON_SIZE,
  NAV_MARK_AXIS,
  NAV_MARK_BARS,
  NAV_MARK_BASELINE,
  NAV_MARK_STROKE,
  UsageNavIcon,
} from '../src/client/NavIcon.tsx'

describe('UsageNavIcon', () => {
  it('draws an L-shaped axis and the bar table, all in currentColor', () => {
    const { container } = render(<UsageNavIcon />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()

    const axis = svg?.querySelector('path')
    expect(axis?.getAttribute('d')).toBe(NAV_MARK_AXIS)
    expect(axis?.getAttribute('stroke')).toBe('currentColor')
    expect(axis?.getAttribute('stroke-width')).toBe(String(NAV_MARK_STROKE))

    const bars = [...(svg?.querySelectorAll('rect') ?? [])]
    expect(bars).toHaveLength(NAV_MARK_BARS.length)
    bars.forEach((bar, index) => {
      const spec = NAV_MARK_BARS[index]!
      expect(bar.getAttribute('x')).toBe(String(spec.x))
      expect(bar.getAttribute('y')).toBe(String(spec.y))
      expect(bar.getAttribute('width')).toBe(String(spec.width))
      expect(bar.getAttribute('height')).toBe(String(spec.height))
      expect(bar.getAttribute('rx')).toBe(String(spec.radius))
      expect(bar.getAttribute('fill')).toBe('currentColor')
    })
  })

  it('keeps every bar on the baseline and ascending', () => {
    for (const bar of NAV_MARK_BARS) {
      // The column bottoms out on the baseline's centre: half the radius past
      // it, so the shape reads as standing on the axis rather than floating.
      expect(bar.y + bar.height).toBeCloseTo(NAV_MARK_BASELINE, 1)
    }
    const heights = NAV_MARK_BARS.map(bar => bar.height)
    expect([...heights].sort((a, b) => a - b)).toEqual(heights)
  })

  it('uses the size the settings shell reserves for a nav icon', () => {
    const { container } = render(<UsageNavIcon size={20} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('20')
    expect(svg?.getAttribute('height')).toBe('20')
    // The 16-unit coordinate system is independent of the rendered edge.
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16')
  })

  it('falls back to the nav box when the shell passes no size', () => {
    const { container } = render(<UsageNavIcon />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe(String(NAV_ICON_SIZE))
    expect(svg?.getAttribute('height')).toBe(String(NAV_ICON_SIZE))
  })

  it('stays out of the accessibility tree: the row owns the label', () => {
    const { container } = render(<UsageNavIcon active />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
