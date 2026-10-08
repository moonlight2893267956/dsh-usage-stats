/**
 * Usage settings plugin, browser half. It mounts the usageStats Host Remote and
 * registers the Usage page — a per-day token-usage chart. The page store loads
 * the trailing window on mount and on every range change; the Host owns the
 * aggregate.
 * @module @deepseek-ai/dsh-client-ui-usage/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import usageStatsRemote from '@deepseek-ai/dsh-usage-stats/remote'
import { mountUsageStats } from './mount.ts'

export { inject } from './mount.ts'
export type { UsageSectionInjected, UsageSectionProps } from './mount.ts'
export type { UsageStatsRemote, UsageStatsState } from './mount.ts'
export type { UsageKey } from './mount.ts'

/**
 * Activate the usageStats Remote and the Usage settings page.
 * @param ctx - Client runtime.
 * @returns complete page and Remote disposer.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountUsageStats(ctx, usageStatsRemote)
}
