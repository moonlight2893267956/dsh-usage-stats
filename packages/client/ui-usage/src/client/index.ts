/**
 * Usage settings plugin, browser half. It registers the Usage page — a per-day
 * token-usage chart — backed by the usageStats Host Remote. The page store
 * loads the trailing window on mount and on every range change; the Host owns
 * the aggregate.
 * @module @deepseek-ai/dsh-client-ui-usage/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the UI renderer's slots service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { UsageStatsStore } from './store.ts'
import { UsageSection } from './UsageSection.tsx'
import type { UsageSectionInjected } from './UsageSection.tsx'
import { en, zh } from './locales.ts'

export type { UsageSectionInjected, UsageSectionProps } from './UsageSection.tsx'
export type { UsageStatsRemote, UsageStatsState } from './store.ts'
export type { UsageKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'usage'

/** Required services: the slot registry, the Remote namespace, and the copy. */
export const inject = ['slots', 'remote', 'remote.usageStats', 'locale']

/**
 * Register the Usage section once the `settings.section` declaration is on the
 * ledger and wire its store to the usageStats Remote.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
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
