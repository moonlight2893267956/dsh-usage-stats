---
description: "The Usage settings page in the Web GUI: per-day token totals, a model filter, and a date picker reading the usageStats Host Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-usage

English | [中文](README.zh.md)

## Summary

Use this package to see how many tokens this device has spent without leaving the Web GUI. The Usage settings section totals input, cache-read, and output tokens over a today, 7-day, or 30-day window, draws the per-day or per-hour split as a stacked bar chart, and counts web searches. A model filter narrows every figure to the models you pick, and the date picker opens one past day with its hourly breakdown. Figures come from the Host on mount and on every change, so the page reports durable usage, not the live session's counters.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin beside the settings shell and the `usage-stats` Host package; the Usage section then appears in the settings navigation.

### What the page shows

Four metric cards total input, cache-read, output, and requests over the selected window. The chart below them draws one bar per day, split into input, cache-read, and output segments; the today view draws one bar per hour up to the current hour instead, so a partly elapsed day reads as "so far today". Hovering a bar opens a tooltip with that bar's exact figures, and the bars, cards, and tooltip animate in when the window changes.

### Choosing a window, a day, and models

The Today, 7d, and 30d buttons set the trailing window; Today is the default and is the only preset that renders hourly bars. The date picker opens any past day as a single-day window with its full hourly breakdown, and picking a day clears the trailing-window selection. The model filter narrows every card and bar to the selected models and offers every model the Host reported for the window, so the choices do not shrink to the current selection.

### Failure and recovery

A failed load keeps the last good figures and shows the error with a Retry button; a window with no usage shows an empty-state message instead of an empty chart. While a load is in flight the page shows a loading line in place of the chart.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page store `UsageStatsStore` holds one snapshot: status, error, the window length, an optional single date, the returned buckets, and the model selection. `apply` creates it and delivers it through the slot `inject` face, with the store itself in the reserved `hooks` compartment so the renderer binds it as `useSnapshot`; the verbs (`setDays`, `setDate`, `setModels`, `load`) go through the injected controller. Every verb writes the snapshot and then reloads, and each load carries a generation counter so a slow earlier response never overwrites a newer one. The plugin registers one `settings.section` entry (`id: 'usage'`, order 30) through `ctx.slots.inject`, and its dictionary is registered on the same fiber, so unmounting removes both. The Host call is `ctx.remote.usageStats.stats()`, whose result is a `RemoteResult`: a carrier failure arrives as `ok: false` and surfaces as the page error rather than a rejection.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-usage-stats](../../session/usage-stats/README.md) — the Host aggregate this page reads, its fold rules, and its checkpoint.
- [ui-settings](../ui-settings/README.md) — the settings shell that declares the `settings.section` slot.
- [Client package map](../README.md) — adjacent browser UI packages and their shared rules.

-----

<a id="model-experience"></a>
## Model Experience

None, as the plugin only renders Host-supplied usage data in a settings page and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current Usage page. They are current package constraints.

- **No live refresh while open** — the page loads on mount and on range change, so usage that accrues while it sits open appears on the next reload; a pushed invalidation or a poll would close this, at the cost of a subscription the static page does not need.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin owns one settings-section registration, one page store, and one locale dictionary, all released by the effects of the fiber that registers them, so no second authority exists to check at runtime.
