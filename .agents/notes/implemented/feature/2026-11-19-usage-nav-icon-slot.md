# Agent Note: Usage Settings Nav Glyph Through the Icon Slot

Status: implemented

English | [中文](2026-11-19-usage-nav-icon-slot.zh.md)

## Problem

The Usage settings section (`id: 'usage'`, label `用量`/`Usage`) wore the generic settings gear in the settings-modal nav rail, and the plugin's workaround drew a second mark beside it. The shell renders one `<button>` per `settings.section` entry as `<span class="navIcon">` + `<span class="navLabel">`; the plugin claimed that row by visible label and hid `[data-dsh-usage-nav-icon] > svg` behind a CSS `mask-image`.

That claim stopped working when the shell took ownership of nav glyphs. DSH 0.2.2's `SettingsRoot` renders the gear inside a wrapper span:

```jsx
<span className={css.navIcon} aria-hidden="true">
  {renderSlot('settings.section.icon', { size: 16, active }, { only: row.id, fallback: navIcon(row.id) })}
</span>
```

The gear is no longer a direct child of the row button, so `[marker] > svg { display: none }` matched nothing. The row showed the shell's gear *and* the plugin's masked mark at once — two icons in one row.

## Decision

Register the mark on `settings.section.icon`, the slot the shell now declares:

```ts
ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
  name: 'settings.section.icon',
  id: 'usage',
  locale: NS,
}, UsageNavIcon))
```

The slot is the seat the previous note named as its own deletion condition: "deleted outright the day `settings.section` grows an `icon` field". It is a root-scoped list whose registration id must equal the target section's id, whose unmatched ids never render, and which the shell reads through `renderSlot(..., { only: row.id, fallback: navIcon(row.id) })`. A section with no icon registered keeps the shell's default glyph, so this is additive for every other row.

`UsageNavIcon` receives `{ size, active }` and draws an L-shaped axis with three ascending bars in `currentColor`, matching the shell's 1.3 stroke weight and its stacked daily chart. The geometry table, axis path, and baseline moved from the deleted `nav-icon.ts` unchanged; the CSS mask, the `MutationObserver`, and the label matching are gone, because the shell now addresses the icon by section id instead of the plugin guessing a row.

Earlier shells that do not declare the slot keep the gear: `ctx.slots.inject` waits for the declaration, so the registration simply never lands there.

## Alternatives considered

**Keep the DOM claim and fix the selector.** Repairing it means hiding the wrapper's `svg` instead (`[marker] .navIcon > svg`), which still leaves the plugin owning a stylesheet, an observer, and a text match to reproduce a decision the shell now makes itself — and it would keep breaking on each shell markup change. Deleted instead.

**Edit the harness `navIcon` map.** The path the first note took; unavailable to an out-of-tree plugin and still unreachable in a packaged build.

**Draw the mark as a `::before` on the row.** Same defect class: styling another package's row from the outside.

## Consequences

- The Usage row carries exactly one mark — the shell's own glyph is replaced, not overlaid.
- The mark follows the row in either theme and in the active state through `currentColor`, and takes the edge the shell passes as `size`.
- The plugin no longer observes the DOM, injects a stylesheet, or matches localized text: nothing to re-derive on a locale switch, and no marker left behind on unload.
- The icon depends on the host declaring `settings.section.icon`. On a host that does not (0.2.1 and earlier), the row keeps the gear — a degraded appearance, never a broken dialog.
- `packages/usage-stats/package.json` dev dependencies now pin `~0.2.2-rc.3`, the first published line whose `@deepseek-ai/dsh-client-ui-settings` declares the slot and exports `SettingsSectionIconOwnerProps`; the old `~0.2.1-alpha.1` pins cannot typecheck the registration.

## Testing

`tests/nav-icon.client.spec.tsx` (jsdom, 5 specs) renders the component: the axis path and every bar come from the geometry table, bars stay on the baseline and ascend, `size` drives the rendered edge while the 16-unit `viewBox` stays fixed, the nav box is the default, and the svg stays `aria-hidden` because the row owns the label. The deleted `nav-icon.client.spec.ts` covered the claim machinery this change removes.

The package suite is 76 of 77 green on this change. `tests/loader-composition.spec.ts` fails identically on the stashed pre-change tree — it expects `@deepseek-ai/dsh-session-persistence-jsonl` to load in its composition — so the failure is pre-existing and unrelated.

`pnpm --filter @moonlight2893267956/dsh-usage-stats run build` (host, bundle, client) is green, and the installed bundle carries the registration: the served `client.js` at the live graph's rev contains `settings.section.icon` and no `data-dsh-usage-nav-icon` residue.
