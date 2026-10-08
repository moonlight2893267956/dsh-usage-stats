/**
 * UsageStatsStore: the usage page's snapshot controller. These specs pin the
 * load lifecycle — success populates the window, a refused read or a transport
 * throw surfaces an error without losing the last good buckets, changing the
 * window reloads it, and an out-of-date response never overwrites a newer one.
 */
import { describe, expect, it } from 'vitest'
import type { UsageStatsDay, UsageStatsRequest, UsageStatsValue } from '../src/types.ts'
import { UsageStatsStore, type UsageStatsFetch } from '../src/client/store.ts'

function day(date: string, input: number, output: number, searches = 0): UsageStatsDay {
  return { date, input, output, cacheRead: 0, requests: 0, searches, models: {} }
}

function window(days: number, buckets: UsageStatsDay[]): UsageStatsValue {
  return { days, buckets, models: [] }
}

/** A fake Host read with scripted answers and recorded requests. */
function fakeFetch(answer: (request: UsageStatsRequest) => Promise<UsageStatsValue>) {
  const requests: UsageStatsRequest[] = []
  const fetchStats: UsageStatsFetch = (request) => {
    requests.push(request)
    return answer(request)
  }
  return { fetchStats, requests }
}

describe('UsageStatsStore', () => {
  it('loads the window into a ready snapshot', async () => {
    const { fetchStats, requests } = fakeFetch(() => Promise.resolve(window(30, [day('2026-08-18', 10, 5)])))
    const store = new UsageStatsStore(fetchStats)
    await store.load()
    const snapshot = store.store.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.error).toBeNull()
    expect(snapshot.buckets).toEqual([day('2026-08-18', 10, 5)])
    // The seeded default is the single-day view, so the first load asks for
    // today's date (a one-day window), not a plain trailing window.
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ days: 1, models: [] })
    expect(requests[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('surfaces a refused read without losing the last good buckets', async () => {
    let fail = false
    const { fetchStats } = fakeFetch(() => fail
      ? Promise.reject(new Error('host exploded'))
      : Promise.resolve(window(30, [day('2026-08-18', 10, 5)])))
    const store = new UsageStatsStore(fetchStats)
    await store.load()
    expect(store.store.getSnapshot().status).toBe('ready')
    fail = true
    await store.load()
    const snapshot = store.store.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toBe('host exploded')
    expect(snapshot.buckets).toEqual([day('2026-08-18', 10, 5)])
  })

  it('surfaces a transport throw as an error', async () => {
    const { fetchStats } = fakeFetch(() => Promise.reject(new Error('socket closed')))
    const store = new UsageStatsStore(fetchStats)
    await store.load()
    const snapshot = store.store.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toBe('socket closed')
  })

  it('reloads with the new window when it changes, and not when it is unchanged', async () => {
    const { fetchStats, requests } = fakeFetch(request => Promise.resolve(window(request.days, [])))
    const store = new UsageStatsStore(fetchStats)
    // The seeded default is the single-day today view; entering a multi-day
    // window is a change, so it reloads.
    store.setDays(30)
    await Promise.resolve()
    expect(store.store.getSnapshot().days).toBe(30)
    // Setting the same window again issues no request.
    store.setDays(30)
    expect(requests).toEqual([{ days: 30, models: [] }])
    store.setDays(90)
    await Promise.resolve()
    expect(requests).toEqual([{ days: 30, models: [] }, { days: 90, models: [] }])
  })

  it('ignores a stale response that resolves after a newer load started', async () => {
    const resolvers: Array<() => void> = []
    const { fetchStats } = fakeFetch(request => new Promise<UsageStatsValue>((resolve) => {
      resolvers.push(() => { resolve(window(request.days, [day(`2026-08-0${request.days}`, request.days, 0)])) })
    }))
    const store = new UsageStatsStore(fetchStats)
    void store.load()
    store.setDays(7)
    // Resolve the newer (7d) load first, then the stale (1d today) one; the
    // stale response must not overwrite the newer snapshot.
    resolvers[1]?.()
    await Promise.resolve()
    resolvers[0]?.()
    await Promise.resolve()
    expect(store.store.getSnapshot().days).toBe(7)
  })
})
