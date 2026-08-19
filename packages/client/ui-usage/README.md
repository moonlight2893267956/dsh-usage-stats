# @deepseek-ai/dsh-client-ui-usage

English | [中文](README.zh.md)

Usage settings section: a per-day token-usage dashboard backed by the `usageStats` Host Remote. It renders each token category's total over the selected window as metric cards and the per-day split as a stacked bar chart with a hover tooltip, animated with a staggered bar cascade, fading cards, and a fading tooltip.

## What it renders

A `settings.section` entry (`id: 'usage'`, order 30) carrying the Usage page:

- A Today / 7d / 30d range selector (Today is the default and requests a one-day window). Today renders per-hour bars; multi-day windows render per-day bars.
- One metric card per token category (input, cache read, output) plus a request-count card, with their window totals.
- A stacked bar chart with Y-axis gridlines, an X axis, and a legend; hovering a bar opens a tooltip with that bar's exact figures. Edge bars anchor the tooltip inward so it never clips the panel.

The page store (`UsageStatsStore`) loads the trailing window from `ctx.remote.usageStats.stats()` on mount and on every range change, keeping the last good buckets on failure; the Host owns the aggregate.

## Composition

Registered through the package's `dsh.client` declaration and a `cordis.patch.yml` row (`ui-usage`). Requires the `usage-stats` Host package for the `usageStats` Remote namespace.

## Model Experience

None, as the plugin only renders Host-supplied usage data in a settings page and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **No live refresh while open** — the page loads on mount and on range change; usage that accrues while the page sits open appears on the next reload, not continuously. A pushed invalidation or a poll would close this, at the cost of a subscription the static page does not need.
