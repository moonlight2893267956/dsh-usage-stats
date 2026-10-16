# Agent Note: Usage Settings Nav Glyph Claim

Status: implemented

English | [中文](2026-10-15-usage-nav-glyph-claim.zh.md)

## Problem

The Usage settings section (`id: 'usage'`, label `用量`/`Usage`) wears the generic settings gear in the settings-modal nav rail. `SettingsRoot`'s `navIcon` in `@deepseek-ai/dsh-client-ui-settings-general` names glyphs only for `account`, `models`, `agent-presets`, `plugins`, and `archived-sessions`; every other section id falls through to `IconSettingsOutlineMedium`. The section with the most visually specific page in the modal had the least specific nav affordance.

The earlier [nav chart glyph note](2026-08-20-usage-settings-nav-chart-glyph.md) solved this by editing the harness: a new `IconChartOutline16` in `ui-primitives` plus a `usage` case in the shell's `navIcon`. That path is unavailable now. This repository is an out-of-tree plugin, and the modification lived in a harness fork that upstream never merged, so the shipped shell still falls back to the gear. The `settings.section` slot contract has no `icon` field — the shell projects only `id` / `order` / `label` from a registration — so the plugin cannot pass a glyph the shell would honour.

## Decision

The plugin claims its own nav row once the dialog is mounted, following the approach `dsh-market` uses for the same problem: inject one stylesheet that hides the shell's gear on the marked row and draws the mark through a CSS `mask-image` in `currentColor`, then mark the row whose visible text equals this plugin's current section label.

Two properties keep the claim honest:

- **Ownership is by label, never by position.** Nothing about the shell's DOM structure is assumed beyond `[role="dialog"] nav button`, the shape the shell documents in its own contract. A row is marked only when its text equals the label this plugin is currently projecting, so `模型` and another plugin's `插件市场` keep their icons, and an unresolved (empty) label matches nothing at all — a locale that has not landed cannot mark the whole rail.
- **The claim is derived, not installed once.** A `MutationObserver` re-derives it, so opening the dialog after boot, a section registering later, and a locale switch that re-renders the nav all land without re-registering the section.

Both the marker and the stylesheet belong to one `ctx.effect`, so they are removed with the fiber rather than surviving an unload. The mark is an L-shaped axis with three ascending bars at the shell's 1.3 stroke weight, read as a per-period usage trend and matched to the section's stacked daily chart; its geometry lives in one table that both the mask and the drawn mark derive from.

## Alternatives considered

**Edit the harness.** The previous note's path. It requires every user to run a patched harness build, and it does not reach the packaged application this plugin is installed into.

**Widen `settings.section` with an `icon` field.** The right long-term seat, and the reason this module is written to be deleted: it is a pre-stable public slot contract owned by the harness, so adding the field is an upstream change, not something one plugin can ship. `dsh-market` records the same deletion condition.

**Reuse an existing shell glyph by id.** Not possible: the mapping is private to the shell and keyed by ids this plugin does not own.

**Draw the mark with an injected React component.** The nav rails' rows are rendered by the shell from its own ledger; a registrant has no render site inside them. Claiming the row is the only seat reachable from a plugin.

## The manifest icon

The plugin-list tile renders the manifest icon through an `<img>`, and an image document has no cascade to inherit from: `currentColor` inside an SVG resolves to black rather than to the surrounding UI colour. The icon's first version was an SVG drawn entirely in `currentColor`, so on the dark theme it painted black on a near-black surface and read as an empty tile. A sibling plugin (`dsh-rewind-plugin`) documents the same constraint and hardcodes its palette for it.

The icon is now `icon.png`: a raster mark generated with `image_generate` (gpt-image-2) — a rounded tile in a blue vertical gradient holding three ascending white bars — then post-processed to remove the generated white background to transparency, trim to the mark, re-square with an even margin, and downscale to 256px. Raster settles the colour question by construction: it has no cascade to lose. The PNG is 41 KiB against the manifest's 256 KiB `MAX_ICON_BYTES` cap, and the manifest's `icon`/`exports`/`files` entries all name `icon.png`; `icon.svg` is gone.

Removing that background has one trap worth recording, because the naive version looks right and is not. The generated artwork is white bars on a white page, so keying out *every* near-white pixel also deletes the bars: they become transparent holes, and on the dark theme the holes show the surface behind them, turning the bars dark. Only background *outside* the tile may be dropped, so the post-processing flood-fills the white region inward from the canvas border and leaves the enclosed white marks opaque. The first attempt shipped the naive version; a spec that only checked "an alpha channel exists" passed it.

`tests/icon.spec.ts` decodes the PNG and checks pixels: under the cap, square, 8-bit with an alpha channel, transparent corners, opaque white bars *and* an opaque blue tile, and no transparent pixels across the tile's middle band. It also asserts no `icon.svg` sits beside it. Reintroducing the SVG fails one spec; committing the generator's raw ~700 KiB RGB output fails five; and the transparent-hole version fails the two pixel specs.

## Consequences

- The Usage row carries a bar-chart mark distinct from every other section's, in both themes and in the active state, without touching the shell or the slot contract.
- A shell that renames its dialog markup or stops rendering `[role="dialog"] nav button` rows silently reverts the row to the gear. The mark is cosmetic, so the failure is degraded appearance rather than a broken dialog.
- Claiming is text-based, so two sections projecting the identical label in the same locale would both be marked. Section labels are unique in the shipped composition; the module is deleted outright the day `settings.section` grows an `icon` field.
- No harness package, no `ui-primitives` export, and no e2e aria golden changes: the plugin's own bundle carries the mark.

## Testing

`tests/nav-icon.client.spec.ts` (jsdom, 11 specs) pins the quiet failures: claiming another section's row, claiming while the label is unresolved, a stale claim after a locale switch, claiming a row mounted after the dialog opens, leaving the marker or stylesheet behind after disposal, and the mask drifting from the drawn geometry. Each of the first four was confirmed by mutation: breaking the guard turns the corresponding spec red. The geometry spec also holds the bars to the baseline and to ascending order.

`tests/icon.spec.ts` decodes the PNG and holds the icon to its size cap, format, and pixels, with no `icon.svg` beside it. All three known regressions were confirmed by mutation: reintroducing the SVG fails one spec, committing the generator's raw RGB output fails five, and the transparent-hole version fails two.

`pnpm --filter @moonlight2893267956/dsh-usage-stats run build`, `tsc -b tsconfig.client.json`, and the package suite (79 specs) are green.
