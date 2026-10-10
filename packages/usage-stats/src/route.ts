/**
 * The one HTTP route shared by both halves of this plugin: the Host registers
 * an exact-path JSON read and the browser half fetches it. Path and query
 * encoding live here so a change cannot land on only one side.
 * @module @moonlight2893267956/dsh-usage-stats/route
 */

import type { UsageStatsRequest } from './types.ts'

/**
 * Exact pathname of the cross-session usage read. Namespaced by plugin so it
 * cannot collide with the harness' own routes.
 */
export const USAGE_STATS_PATH = '/dsh-usage-stats/stats'
/** Non-blocking read of the last committed aggregate; retry=1 explicitly retries a failed reconciliation. */
export const USAGE_SNAPSHOT_PATH = '/dsh-usage-stats/snapshot'

/** The only day format the route accepts, matching the fold's local day keys. */
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Serialize a request into the route's query string.
 * @param request - the window, optional single day, and optional model filter.
 * @returns the query string without its leading `?`.
 */
export function usageStatsQuery(request: UsageStatsRequest): string {
  const params = new URLSearchParams()
  params.set('days', String(request.days))
  if (request.date !== undefined) params.set('date', request.date)
  if (request.models !== undefined && request.models !== null && request.models.length > 0) {
    params.set('models', request.models.join(','))
  }
  return params.toString()
}

/** A parsed query, or the reason the request is refused. */
export type UsageStatsQueryResult =
  | { readonly ok: true; readonly request: UsageStatsRequest }
  | { readonly ok: false; readonly message: string }

/**
 * Parse the route's query string. Only the fields the fold consumes are read;
 * everything else is ignored rather than refused, so a caller may append
 * cache-busting parameters without breaking the read.
 * @param search - the request's query string, with or without its leading `?`.
 * @returns the request, or the refusal message for a malformed one.
 */
export function parseUsageStatsQuery(search: string): UsageStatsQueryResult {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const rawDays = params.get('days')
  const days = rawDays === null ? 1 : Number(rawDays)
  if (!Number.isInteger(days) || days < 1) {
    return { ok: false, message: `days must be a positive integer, received ${String(rawDays)}` }
  }
  const date = params.get('date')
  if (date !== null && !DAY.test(date)) {
    return { ok: false, message: `date must be YYYY-MM-DD, received ${JSON.stringify(date)}` }
  }
  const models = params.get('models')
  const selected = models === null || models.length === 0 ? undefined : models.split(',')
  return {
    ok: true,
    request: {
      days,
      ...(date === null ? {} : { date }),
      ...(selected === undefined ? {} : { models: selected }),
    },
  }
}
