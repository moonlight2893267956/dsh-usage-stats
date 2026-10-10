// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { UsageStatsStore } from '../src/client/store.ts'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { zh } from '../src/client/locales.ts'
import type { UsageStatsSnapshot } from '../src/types.ts'

const stores: UsageStatsStore[] = []
afterEach(() => { cleanup(); stores.splice(0).forEach(store => store.stop()); vi.useRealTimers() })
function result(input: number, freshness: UsageStatsSnapshot['freshness'] = 'ready'): UsageStatsSnapshot {
  return { value: { days: 1, models: ['test'], buckets: [{ date: '2026-10-09', input, output: 1, cacheRead: 0, requests: 1, searches: 0, models: {} }] },
    freshness, revision: 1, error: freshness === 'error' ? 'unavailable' : null, refreshPollIntervalMs: 250 }
}
function mount(fetchStats: ConstructorParameters<typeof UsageStatsStore>[0]) {
  const controller = new UsageStatsStore(fetchStats); stores.push(controller)
  render(<UsageSection controller={controller} useSnapshot={() => useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot)} t={key => zh[key]} />)
  return controller
}

describe('cached usage page', () => {
  it('keeps a labelled column for a bucket with no usage and shows its tooltip on focus', async () => {
    const snapshot: UsageStatsSnapshot = {
      value: {
        days: 1, models: [],
        buckets: [
          { date: '2026-10-09', input: 100, output: 10, cacheRead: 0, requests: 1, searches: 0, models: {} },
          { date: '2026-10-08', input: 0, output: 0, cacheRead: 0, requests: 0, searches: 0, models: {} },
        ],
      },
      freshness: 'ready', revision: 1, error: null, refreshPollIntervalMs: 1000,
    }
    mount(async () => snapshot)
    await act(async () => { await Promise.resolve() })
    const columns = screen.getAllByRole('img')
    expect(columns).toHaveLength(2)
    expect(columns[1]?.getAttribute('aria-label')).toContain('tokens')
    fireEvent.focus(columns[1] as HTMLElement)
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('shows the chart while refreshing and automatically replaces it when ready', async () => {
    vi.useFakeTimers()
    let calls = 0
    const controller = mount(async () => result(++calls === 1 ? 1234 : 2345, calls === 1 ? 'pending' : 'ready'))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText(zh['state.refreshing'])).toBeTruthy()
    expect(screen.getByText('1,234')).toBeTruthy()
    expect(screen.queryByText(zh['state.loading'])).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(screen.getByText('2,345')).toBeTruthy()
    expect(screen.queryByText(zh['state.refreshing'])).toBeNull()
    expect(controller.store.getSnapshot().refreshing).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(calls).toBe(2)
  })

  it('keeps saved totals visible after refresh failure and sends explicit retry', async () => {
    vi.useFakeTimers()
    const fetchStats = vi.fn(async () => result(1234, 'error'))
    mount(fetchStats)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('1,234')).toBeTruthy()
    expect(screen.getByText(zh['state.refreshError'])).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['state.retry'] })) })
    expect(fetchStats.mock.calls.length).toBe(2)
    expect(fetchStats.mock.calls[1]?.[2]).toBe(true)
  })

  it('cancels superseded reads and ignores their result', async () => {
    let settle!: (value: UsageStatsSnapshot) => void
    const signals: AbortSignal[] = []
    const controller = new UsageStatsStore((_request, signal) => {
      signals.push(signal as AbortSignal)
      return signals.length === 1 ? new Promise(resolve => { settle = resolve }) : Promise.resolve(result(22))
    }); stores.push(controller)
    const old = controller.load()
    controller.setDays(7)
    await Promise.resolve()
    expect(signals[0]?.aborted).toBe(true)
    settle(result(11)); await old
    expect(controller.store.getSnapshot().buckets[0]?.input).toBe(22)
  })

  it('deduplicates identical reads and stops polling when the view leaves', async () => {
    vi.useFakeTimers()
    let settle!: (value: UsageStatsSnapshot) => void
    const fetchStats = vi.fn(() => new Promise<UsageStatsSnapshot>(resolve => { settle = resolve }))
    const controller = new UsageStatsStore(fetchStats); stores.push(controller)
    const first = controller.load(); const same = controller.load()
    expect(first).toBe(same); expect(fetchStats).toHaveBeenCalledTimes(1)
    settle(result(11, 'pending')); await first
    controller.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchStats).toHaveBeenCalledTimes(1)
  })
})
