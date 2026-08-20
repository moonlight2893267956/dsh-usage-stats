# Agent Note: Usage Settings Nav Chart Glyph

Status: implemented

English | [中文](2026-08-20-usage-settings-nav-chart-glyph.zh.md)

## Problem

The Usage settings section (`id: 'usage'`, label `用量`/`Usage`) renders a per-day token-usage stacked bar chart, but its settings-modal nav row carried the generic settings gear. The `navIcon` map in `ui-settings-general`'s `SettingsRoot` named glyphs only for `models`, `agent-presets`, and `plugins`; every other section id — including `usage` — fell through to `IconSettingsOutline16`. The chart content was the most visually specific section in the modal yet had the least specific nav affordance.

## Decision

Add a bar-chart glyph `IconChartOutline16` to the `ic_ds_*` icon set in `ui-primitives`, and extend `SettingsRoot.navIcon` to return it for `id === 'usage'`. Three ascending bars rising from a baseline read as a per-period usage trend, matching the section's stacked daily chart. The glyph is a hand-authored approximation: the deepsuite icon library ships no chart extract, so it stands in the way the sparkle and fish glyphs already do, and the `ui-primitives` README records that precedent.

The nav-icon mapping stays owned by `ui-settings-general`'s shell — a section registrant does not declare its own glyph. The map keys section ids, so a contributed section the shell never heard of still falls back to the gear; `usage` now joins the named set alongside `models`, `agent-presets`, and `plugins`.

## Alternatives considered

**Reuse an existing glyph.** `IconDataOutline16` (database) already backs `models`; a second data section sharing it would read as duplication, and no shipped glyph depicts a trend or bars.

**Let each section registrant carry its own icon.** That would widen the `settings.section` slot contract for a cosmetic choice, spreading glyph ownership across feature plugins instead of one shell map the settings nav already owns.

**Wait for a deepsuite chart extract.** The usage nav would keep the wrong gear indefinitely; the approximation follows the established fish/sparkle path and swaps to the exact export when one arrives.

## Consequences

- The Usage nav row now carries a chart glyph distinct from every other named section's; the settings-root nav-glyph test covers the `usage` id alongside the other three, and the icon-set count test moved to 71.
- The e2e aria goldens are unaffected: the settings nav captures each icon only as `img` with no glyph-discriminating markup, so swapping the path needs no golden refresh.

## Testing

The `icons.client.spec.tsx` set-count assertion and the per-glyph `currentColor` render cover the new glyph; `settings-root.client.spec.tsx`'s nav-glyph distinctness test asserts `usage` gets its own path and an unknown id still shares the gear. Repo `typecheck` and `lint` are green.
