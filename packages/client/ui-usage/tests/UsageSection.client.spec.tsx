// @vitest-environment jsdom
/**
 * UsageSection: the per-day token dashboard. These specs pin the rendered
 * contract — it loads on mount and shows the totals, cards, range selector,
 * and chart copy; switching the window reloads it; an empty window and a load
 * failure render their own states, and retry reloads after a failure.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(cleanup)
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { UsageStatsDay, UsageStatsRequest, UsageStatsValue } from '@deepseek-ai/dsh-usage-stats/types'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { UsageStatsStore, type UsageStatsRemote } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh): string => zh[key]

function day(date: string, input: number, cacheRead: number, output: number, searches = 0): UsageStatsDay {
  return { date, input, cacheRead, output, searches, models: {} }
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

  it('loads on mount and renders the totals, cards, and chart', async () => {
    const value: UsageStatsValue = {
      days: 30,
      buckets: [day('2026-08-17', 1200, 0, 300, 2), day('2026-08-18', 800, 400, 100, 1)],
      models: [],
    }
    render(<UsageSection {...injected(remoteWith(value))} />)
    await waitFor(() => expect(screen.getByText('用量')).toBeTruthy())
    // Summary and per-category cards carry the folded totals (2.8K / 400 / 400).
    expect(screen.getByText(/2\.8K tokens · 3 次网络搜索/)).toBeTruthy()
    // Each category appears on its metric card and in the chart legend.
    expect(screen.getAllByText('输入')).toHaveLength(2)
    expect(screen.getAllByText('缓存命中')).toHaveLength(2)
    expect(screen.getAllByText('输出')).toHaveLength(2)
    expect(screen.getByText('每日 Tokens')).toBeTruthy()
    // Range selector offers the three windows.
    expect(screen.getByRole('button', { name: '7天' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '30天' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '90天' })).toBeTruthy()
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
    await waitFor(() => expect(screen.getByRole('button', { name: '7天' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '7天' }))
    await waitFor(() => expect(requests).toContainEqual({ days: 7, models: [] }))
  })

  it('shows the empty state when the window has no usage', async () => {
    const value: UsageStatsValue = { days: 7, buckets: [day('2026-08-18', 0, 0, 0)], models: [] }
    render(<UsageSection {...injected(remoteWith(value))} />)
    await waitFor(() => expect(screen.getByText('这段时间还没有 token 用量')).toBeTruthy())
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
    await waitFor(() => expect(screen.getByText(/socket closed/)).toBeTruthy())
    expect(calls).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(calls).toBe(2))
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
    await waitFor(() => expect(screen.getByText(/100/)).toBeTruthy())
    expect(calls).toBe(1)
    first.unmount()
    value = 250
    render(<UsageSection {...shared} />)
    await waitFor(() => expect(calls).toBeGreaterThan(1))
    await waitFor(() => expect(screen.getByText(/250/)).toBeTruthy())
  })
})
