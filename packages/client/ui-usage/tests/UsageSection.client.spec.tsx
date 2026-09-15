// @vitest-environment jsdom
/**
 * UsageSection: the per-day token dashboard. These specs pin the rendered
 * contract — it loads on mount and shows the chart with the day totals, the
 * range selector, and the legend; switching the window reloads it; an empty
 * window and a load failure render their own states, and retry reloads after
 * a failure.
 */
import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { UsageStatsDay, UsageStatsHour, UsageStatsRequest, UsageStatsValue } from '@deepseek-ai/dsh-usage-stats/types'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { UsageStatsStore, type UsageStatsRemote } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import styles from '../src/client/UsageSection.module.css'

const t = (key: keyof typeof zh): string => zh[key]

function day(
  date: string,
  input: number,
  cacheRead: number,
  output: number,
  searches = 0,
  requests = 0,
  hours?: UsageStatsHour[],
): UsageStatsDay {
  return { date, input, cacheRead, output, searches, requests, models: {}, ...(hours !== undefined ? { hours } : {}) }
}

function remoteWith(value: UsageStatsValue): UsageStatsRemote {
  return { stats: () => Promise.resolve<RemoteResult<UsageStatsValue>>({ ok: true, value }) }
}

function injected(remote: UsageStatsRemote) {
  const controller = new UsageStatsStore(remote)
  return { controller, useSnapshot: bindSnapshotSelector(controller.store), t }
}

describe('UsageSection', () => {
  it('renders nothing until the inject face arrives', () => {
    const { container } = render(<UsageSection />)
    expect(container.firstChild).toBeNull()
  })

  it('loads on mount and renders the chart with totals, legend, and chart hint', async () => {
    const value: UsageStatsValue = {
      days: 30,
      buckets: [day('2026-08-17', 1200, 0, 300, 2, 5), day('2026-08-18', 800, 400, 100, 1, 7)],
      models: [],
    }
    render(<UsageSection {...injected(remoteWith(value))} />)
    await waitFor(() => { expect(screen.getByText('用量')).toBeTruthy() })
    // Title carries the period token total (input + output = 2,400 across the
    // window); the chart legend names the three series.
    expect(screen.getAllByText((_, el) => el?.textContent?.startsWith('今日 Tokens') === true).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('2,400') === true).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('输出').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('输入（未命中）').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('输入（命中缓存）').length).toBeGreaterThanOrEqual(1)
    // Range selector offers three windows; today is the active default.
    expect(screen.getByRole('button', { name: '今天' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '7天' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '30天' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '90天' })).toBeNull()
    expect(screen.getByRole('button', { name: '今天' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reloads with the new window when a range button is clicked', async () => {
    const requests: UsageStatsRequest[] = []
    const remote: UsageStatsRemote = {
      stats: (request) => {
        requests.push(request)
        return Promise.resolve({ ok: true, value: { days: request.days, buckets: [day('2026-08-18', 5, 0, 1)], models: [] } })
      },
    }
    render(<UsageSection {...injected(remote)} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: '7天' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '7天' }))
    await waitFor(() => { expect(requests).toContainEqual({ days: 7, models: [] }) })
  })

  it('treats today as a one-day window', async () => {
    const requests: UsageStatsRequest[] = []
    const remote: UsageStatsRemote = {
      stats: (request) => {
        requests.push(request)
        return Promise.resolve({ ok: true, value: { days: request.days, date: request.date, buckets: [day('2026-08-18', 5, 0, 1)], models: [] } })
      },
    }
    render(<UsageSection {...injected(remote)} />)
    // The section defaults to the single-day today view, so its first load
    // requests today's date as a one-day window.
    await waitFor(() => { expect(requests).toHaveLength(1) })
    expect(requests[0]).toMatchObject({ days: 1, models: [] })
    expect(requests[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('shows only today when today is the selected window', async () => {
    const value: UsageStatsValue = {
      days: 1,
      buckets: [day('2026-08-18', 400, 120, 90, 3, 4)],
      models: [],
    }
    render(<UsageSection {...injected(remoteWith(value))} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: '今天' })).toBeTruthy() })
    // Today's grand total (input + output = 490) sits next to the chart title.
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('490') === true).length).toBeGreaterThanOrEqual(1)
  })

  it('shows the empty state when the window has no usage', async () => {
    const value: UsageStatsValue = { days: 7, buckets: [day('2026-08-18', 0, 0, 0)], models: [] }
    render(<UsageSection {...injected(remoteWith(value))} />)
    await waitFor(() => { expect(screen.getByText('这段时间还没有 token 用量')).toBeTruthy() })
  })

  it('shows cache hit and input miss as separate tooltip rows', async () => {
    const value: UsageStatsValue = {
      days: 1,
      buckets: [day('2026-08-18', 800, 400, 100, 0, 4)],
      models: [],
    }
    const { container } = render(<UsageSection {...injected(remoteWith(value))} />)
    await waitFor(() => { expect(screen.getByText('今日 Tokens')).toBeTruthy() })
    const bar = container.querySelector(`.${styles['bar']}`) as HTMLElement
    expect(bar).toBeTruthy()
    fireEvent.mouseEnter(bar)
    await waitFor(() => { expect(screen.getAllByText('输入（未命中）').length).toBeGreaterThanOrEqual(1) })
    expect(screen.getAllByText('输入（命中缓存）').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('输出').length).toBeGreaterThanOrEqual(1)
    // The tooltip also shows the per-day total.
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('900') === true).length).toBeGreaterThanOrEqual(1)
  })

  it('shows an error and reloads when retry is clicked', async () => {
    let calls = 0
    const remote: UsageStatsRemote = {
      stats: () => {
        calls += 1
        return Promise.reject(new Error('socket closed'))
      },
    }
    render(<UsageSection {...injected(remote)} />)
    await waitFor(() => { expect(screen.getByText(/socket closed/)).toBeTruthy() })
    expect(calls).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(calls).toBe(2) })
  })

  it('refetches on every entry instead of showing the first visit stale totals', async () => {
    let calls = 0
    let value = 100
    const remote: UsageStatsRemote = {
      stats: () => {
        calls += 1
        return Promise.resolve({
          ok: true,
          value: { days: 30, buckets: [day('2026-08-18', value, 0, 1)], models: [] },
        })
      },
    }
    const shared = injected(remote)
    // First visit consumes the shared store, which stays 'ready' between
    // mounts, so the page keeps that cached snapshot. Re-entering the section
    // (a fresh mount against the same controller) must reload rather than
    // resurface the old totals.
    const first = render(<UsageSection {...shared} />)
    await waitFor(() => { expect(screen.getAllByText((_, el) => el?.textContent?.includes('101') === true).length).toBeGreaterThan(0) })
    expect(calls).toBe(1)
    first.unmount()
    value = 250
    render(<UsageSection {...shared} />)
    await waitFor(() => { expect(calls).toBeGreaterThan(1) })
    await waitFor(() => { expect(screen.getAllByText((_, el) => el?.textContent?.includes('251') === true).length).toBeGreaterThan(0) })
    expect(screen.queryAllByText((_, el) => el?.textContent?.startsWith('每日 Tokens') === true && el?.textContent?.includes('101'))).toHaveLength(0)
  })

  it('renders per-hour bars up to the current hour when the window is today', async () => {
    // Pin "now" to 15:30 on the same calendar day the buckets describe, so
    // `new Date().getHours()` in the section trims the today chart to 00:00–15:00.
    // Only the Date clock is faked — the waitFor polling needs real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-18T15:30:00'))
    const hours: UsageStatsHour[] = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      input: hour === 10 ? 120 : hour === 14 ? 80 : 0,
      cacheRead: hour === 14 ? 30 : 0,
      output: hour === 10 ? 20 : hour === 14 ? 10 : 0,
      requests: hour === 10 || hour === 14 ? 1 : 0,
      searches: 0,
    }))
    const value: UsageStatsValue = {
      days: 1,
      buckets: [day('2026-08-18', 200, 30, 30, 0, 2, hours)],
      models: [],
    }
    const { container } = render(<UsageSection {...injected(remoteWith(value))} />)
    await waitFor(() => { expect(screen.getByText('今日 Tokens')).toBeTruthy() })
    // Only hours up to the cut (00:00–15:00, inclusive) are drawn — never the
    // whole 24-hour day.
    expect(container.querySelectorAll(`.${styles['bar']}`)).toHaveLength(16)
    // The x-axis ends at the current hour, not the last hour of the day.
    expect(screen.getByText('00:00')).toBeTruthy()
    expect(screen.getByText('15:00')).toBeTruthy()
    expect(screen.queryByText('23:00')).toBeNull()
  })

  it('keeps the today hourly style, drawn to one bar, just past midnight', async () => {
    // At 00:30 the current-hour cut leaves a single bar, but the day still
    // carries per-hour data, so the chart must stay hourly (not degrade to a
    // single day-granularity column) and show only the 00:00 bar. Only the Date
    // clock is faked so waitFor polling keeps real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-18T00:30:00'))
    const hours: UsageStatsHour[] = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      input: hour === 0 ? 5 : 0,
      cacheRead: 0,
      output: hour === 0 ? 1 : 0,
      requests: hour === 0 ? 1 : 0,
      searches: 0,
    }))
    const value: UsageStatsValue = {
      days: 1,
      buckets: [day('2026-08-18', 5, 0, 1, 0, 1, hours)],
      models: [],
    }
    const { container } = render(<UsageSection {...injected(remoteWith(value))} />)
    await waitFor(() => { expect(screen.getByText('今日 Tokens')).toBeTruthy() })
    expect(container.querySelectorAll(`.${styles['bar']}`)).toHaveLength(1)
    expect(container.querySelector(`.${styles['chartHourly']}`)).not.toBeNull()
    expect(screen.queryByText('23:00')).toBeNull()
  })

  it('draws only the elapsed hours at an early current hour', async () => {
    // At 02:30 the cut is hour 2, so only 00:00–02:00 bars appear and the x-axis
    // ends at 02:00 rather than any later hour.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-18T02:30:00'))
    const hours: UsageStatsHour[] = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      input: hour === 1 ? 40 : 0,
      cacheRead: 0,
      output: hour === 1 ? 5 : 0,
      requests: hour === 1 ? 1 : 0,
      searches: 0,
    }))
    const value: UsageStatsValue = {
      days: 1,
      buckets: [day('2026-08-18', 40, 0, 5, 0, 1, hours)],
      models: [],
    }
    const { container } = render(<UsageSection {...injected(remoteWith(value))} />)
    await waitFor(() => { expect(screen.getByText('今日 Tokens')).toBeTruthy() })
    expect(container.querySelectorAll(`.${styles['bar']}`)).toHaveLength(3)
    expect(screen.getByText('00:00')).toBeTruthy()
    expect(screen.getByText('02:00')).toBeTruthy()
    expect(screen.queryByText('08:00')).toBeNull()
    expect(screen.queryByText('23:00')).toBeNull()
  })

  it('renders the full 24 hours when a past day is selected', async () => {
    // Pin "now" to a fixed today so both the picker's max and the seeded today
    // view are stable; only the Date clock is faked so waitFor keeps real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-18T15:30:00'))
    const hours: UsageStatsHour[] = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      input: hour === 10 ? 120 : hour === 14 ? 80 : 0,
      cacheRead: hour === 14 ? 30 : 0,
      output: hour === 10 ? 20 : hour === 14 ? 10 : 0,
      requests: hour === 10 || hour === 14 ? 1 : 0,
      searches: 0,
    }))
    const remote: UsageStatsRemote = {
      stats: request => Promise.resolve<RemoteResult<UsageStatsValue>>({
        ok: true,
        value: {
          days: 1,
          buckets: [day(request.date ?? '2026-08-18', 200, 30, 30, 0, 2, hours)],
          models: [],
        },
      }),
    }
    const { container } = render(<UsageSection {...injected(remote)} />)
    await waitFor(() => { expect(screen.getByText('今日 Tokens')).toBeTruthy() })
    // Open the dropdown calendar and pick a past day (relative to the fake
    // today); the grid anchors to the selected month, which is today's month.
    fireEvent.click(screen.getByLabelText('选择日期'))
    fireEvent.click(screen.getByRole('button', { name: '2026-08-16' }))
    await waitFor(() => { expect(container.querySelectorAll(`.${styles['bar']}`)).toHaveLength(24) })
    // The past day draws its full day and reaches the day's last hour, instead
    // of cutting to the current time like the today view.
    expect(screen.getByText('00:00')).toBeTruthy()
    expect(screen.getByText('23:00')).toBeTruthy()
    // The title names the selected day.
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('8月16日 Tokens') === true).length).toBeGreaterThanOrEqual(1)
    // A picked past day is a custom date, not the "today" preset, so none of the
    // range presets stay highlighted.
    expect(screen.getByRole('button', { name: '今天' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '7天' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '30天' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('renders metric cards with category totals', async () => {
    const value: UsageStatsValue = {
      days: 30,
      buckets: [day('2026-08-17', 1200, 0, 300, 2, 5), day('2026-08-18', 800, 400, 100, 1, 7)],
      models: [],
    }
    render(<UsageSection {...injected(remoteWith(value))} />)
    await waitFor(() => { expect(screen.getByText('用量')).toBeTruthy() })
    // Metric card values: input=2000, cacheRead=400, output=400, requests=12.
    expect(screen.getAllByText((_, el) => el?.textContent === '2,000').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText((_, el) => el?.textContent === '400').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText((_, el) => el?.textContent === '12').length).toBeGreaterThanOrEqual(1)
  })
})
