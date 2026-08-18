/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-usage-stats`.
 * @module @deepseek-ai/dsh-usage-stats/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-usage-stats'

/** Cordis companion plugin name. */
export const name = 'usage-stats-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package only aggregates `assistant/message` usage
 * records and `tool/call` names whose shapes and append-only ordering are
 * owned and runtime-checked by dsh-session and dsh-agent-loop, and reads them
 * through dsh-session-persistence, whose contiguity and durability are checked
 * there; it owns no event relation of its own to assert.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
