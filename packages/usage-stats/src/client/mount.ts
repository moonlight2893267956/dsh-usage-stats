/**
 * Source-safe lifecycle for the usageStats Remote and the Usage settings page.
 *
 * The plugin mounts its own Remote namespace instead of joining a central
 * assembly: `@moonlight2893267956/dsh-usage-stats/remote` carries both the contribution
 * and the `TypertRemoteMap` merge, so importing it is enough to type and mount
 * `remote.usageStats` without a consumer-side registration seat.
 * @module @moonlight2893267956/dsh-usage-stats/client/mount
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the generated namespace merge and its declaration merging.
import type {} from '@moonlight2893267956/dsh-usage-stats/remote'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the UI renderer's slots service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { UsageStatsStore } from './store.ts'
import { UsageSection } from './UsageSection.tsx'
import type { UsageSectionInjected } from './UsageSection.tsx'
import { en, zh } from './locales.ts'

export type { UsageSectionInjected, UsageSectionProps } from './UsageSection.tsx'
export type { UsageStatsRemote, UsageStatsState } from './store.ts'
export type { UsageKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'usage'

/**
 * Services this plugin needs before it can mount the Remote. `remote.usageStats`
 * is deliberately absent: `mountUsageStats` waits for the namespace it mounts.
 */
export const inject = ['remote', 'slots', 'locale']

/**
 * Register the Usage section once the `settings.section` declaration is on the
 * ledger and wire its store to the usageStats Remote.
 * @param ctx - client root context.
 */
function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-usage: dictionaries')

  const controller = new UsageStatsStore(ctx.remote.usageStats)
  // Registration-time text (the nav label thunk) and the inject face share one
  // bound translate; copy freshness rides the locale revision. The section
  // snapshot rides the UI renderer's `hooks` binding (the renderer delivers it
  // to the component as `useSnapshot`); the controller carries the verbs.
  const t = ctx.locale.bind(NS) as UsageSectionInjected['t']
  const injected = (): UsageSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },
    t,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, UsageSection))
}

/**
 * Mount the usageStats namespace, then register the Usage settings page behind
 * it. Both halves withdraw together, and a failed page registration never
 * leaves the namespace mounted.
 * @param ctx - client runtime owning the Remote, dictionaries and slots.
 * @param contribution - generated usageStats Remote definitions.
 * @returns disposer joining page and Remote withdrawal.
 */
export async function mountUsageStats(
  ctx: Context,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.usageStats', 'slots', 'locale'], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
