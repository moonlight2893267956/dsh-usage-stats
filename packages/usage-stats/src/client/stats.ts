/**
 * Browser-side reader for the Host's usage route. The window is fetched from
 * the same origin that served this bundle, so no host or port is configured
 * here.
 * @module @moonlight2893267956/dsh-usage-stats/client/stats
 */

import { USAGE_SNAPSHOT_PATH, usageStatsQuery } from '../route.ts'
import type { UsageStatsRequest, UsageStatsSnapshot } from '../types.ts'

/**
 * Read one usage window from the Host.
 * @param request - the window, optional single day, and optional model filter.
 * @param signal - cancels the read when the caller's window is superseded.
 * @returns the requested day/window.
 * @throws {Error} when the Host refuses the request or the transport fails.
 */
export async function fetchUsageStats(
  request: UsageStatsRequest,
  signal?: AbortSignal,
  retry = false,
): Promise<UsageStatsSnapshot> {
  const response = await fetch(
    `${USAGE_SNAPSHOT_PATH}?${usageStatsQuery(request)}${retry ? '&retry=1' : ''}`,
    signal === undefined ? {} : { signal },
  )
  if (!response.ok) throw new Error(await refusalMessage(response))
  return await response.json() as UsageStatsSnapshot
}

/**
 * Read the Host's refusal into the error the page shows. The route's own
 * message is preferred; a body that is absent or not JSON falls back to the
 * status, so the failure is never reported as success or as an empty string.
 * @param response - the non-2xx response.
 * @returns the message for the thrown error.
 */
async function refusalMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined)
  if (typeof body === 'object' && body !== null && 'message' in body
    && typeof (body as { message?: unknown }).message === 'string') {
    return (body as { message: string }).message
  }
  return `usage-stats read failed with HTTP ${String(response.status)}`
}
