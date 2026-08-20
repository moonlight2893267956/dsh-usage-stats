/**
 * Usage settings section: the per-day token-usage dashboard. Metric cards
 * total each token category over the selected window, and a stacked bar chart
 * renders the per-day split with a hover tooltip carrying the exact figures.
 * Bars grow in with a staggered cascade on load and on every window change;
 * the tooltip fades in above the hovered day.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageStatsDay } from '@deepseek-ai/dsh-usage-stats/types'
import type { UsageStatsState, UsageStatsStore } from './store.ts'
import type { en } from './locales.ts'
import styles from './UsageSection.module.css'
import { ModelFilter } from './ModelFilter.tsx'

/** Injected dependencies of {@link UsageSection} (slot `inject`). */
export interface UsageSectionInjected {
  /** The page store (loaded on mount and on window change). */
  controller: UsageStatsStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: SnapshotSelectorHook<UsageStatsState>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type UsageSectionProps = Partial<UsageSectionInjected>

/** Selectable window lengths, in days. `1` is today (the current calendar day). */
const RANGES = [1, 7, 30] as const

/** Y-axis gridline count. */
const TICKS = 2

/** Compact token count: 1.2K, 3.4M. */
function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(value)
}

/** Full token count with thousands separators. */
function formatFull(value: number): string {
  return value.toLocaleString()
}

/** `YYYY-MM-DD` rendered as the locale month-day label. */
function dateLabel(key: string): string {
  const parts = key.split('-')
  return `${Number(parts[1])}月${Number(parts[2])}日`
}

/** Total tokens across every category for one day. */
function dayTotal(day: UsageStatsDay): number {
  // `input` already contains `cacheRead`, so the total is input + output
  // (adding `cacheRead` separately would double-count the hit share).
  return day.input + day.output
}

/** A unified chart bucket: either a per-day or per-hour slice. */
interface ChartBucket {
  key: string
  label: string
  input: number
  cacheRead: number
  output: number
  requests: number
  searches: number
}

/** Total tokens for a chart bucket. */
function bucketTotal(bucket: ChartBucket): number {
  return bucket.input + bucket.output
}

/** `HH:00` label for an hour index. */
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** DeepSeek-style x-axis labels: four evenly spaced ticks for a 24-hour day. */
function hourAxisLabels(): string[] {
  return [hourLabel(0), hourLabel(8), hourLabel(16), hourLabel(23)]
}

/** X-axis labels for a daily chart: first, middle, last date; a single bucket
 * is shown once to avoid redundant labels. */
function dayAxisLabels(buckets: ChartBucket[]): string[] {
  const first = buckets[0]
  if (buckets.length <= 1) return [first?.label ?? '']
  const mid = buckets[Math.floor(buckets.length / 2)]
  const last = buckets[buckets.length - 1]
  return [first?.label ?? '', mid?.label ?? '', last?.label ?? '']
}

/** Build the chart buckets array: per-hour when days=1, per-day otherwise. */
function buildChartBuckets(buckets: readonly UsageStatsDay[], days: number): ChartBucket[] {
  if (days === 1) {
    const day = buckets[0]
    if (day?.hours !== undefined) {
      return day.hours.map(h => ({
        key: `h${h.hour}`,
        label: hourLabel(h.hour),
        input: h.input,
        cacheRead: h.cacheRead,
        output: h.output,
        requests: h.requests,
        searches: h.searches,
      }))
    }
  }
  return buckets.map(b => ({
    key: b.date,
    label: dateLabel(b.date),
    input: b.input,
    cacheRead: b.cacheRead,
    output: b.output,
    requests: b.requests,
    searches: b.searches,
  }))
}

/**
 * Render the Usage section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function UsageSection(props: UsageSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

function Loaded({ injected }: { injected: UsageSectionInjected }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [hovered, setHovered] = useState<string | null>(null)

  // The store is a shared singleton whose status stays 'ready' between visits,
  // so re-entering the settings page must refetch on every mount instead of
  // only when the snapshot is 'idle' (which happens exactly once). Without
  // this, leaving and returning shows the first visit's stale totals.
  useEffect(() => { void controller.load() }, [controller])

  if (state.status === 'error') {
    return (
      <div className={styles['page']}>
        <h2 className={styles['title']}>{t('title')}</h2>
        <p className={styles['error']}>{`${t('state.error')}: ${state.error ?? ''}`}</p>
        <button type="button" className={styles['retryButton']} onClick={() => { void controller.load() }}>
          {t('state.retry')}
        </button>
      </div>
    )
  }

  const buckets = state.buckets
  const days = state.days
  const availableModels = state.availableModels
  const selectedModels = state.selectedModels
  const loading = state.status !== 'ready'

  const totals: Record<'input' | 'cacheRead' | 'output', number> = { input: 0, cacheRead: 0, output: 0 }
  let requests = 0
  let searches = 0
  let grand = 0
  for (const bucket of buckets) {
    totals.input += bucket.input
    totals.cacheRead += bucket.cacheRead
    totals.output += bucket.output
    grand += dayTotal(bucket)
    requests += bucket.requests
    searches += bucket.searches
  }

  const chartBuckets = buildChartBuckets(buckets, days)
  let maxBucket = 1
  for (const cb of chartBuckets) {
    const total = bucketTotal(cb)
    if (total > maxBucket) maxBucket = total
  }

  const ticks: number[] = []
  for (let i = 0; i <= TICKS; i++) ticks.push((maxBucket / TICKS) * i)

  const isToday = days === 1
  const isHourly = isToday && chartBuckets.length > 1
  const count = chartBuckets.length
  const hitRate = totals.input > 0 ? Math.round((totals.cacheRead / totals.input) * 100) : 0

  return (
    <div className={styles['page']}>
      <header className={styles['header']}>
        <h2 className={styles['title']}>{t('title')}</h2>
        <div className={styles['controls']}>
          {availableModels.length > 0 && (
            <ModelFilter
              label={t('model.title' as keyof typeof en)}
              allLabel={t('model.all' as keyof typeof en)}
              models={availableModels}
              selected={selectedModels}
              onChange={next => controller.setModels(next)}
            />
          )}
          <div className={styles['range']} role="group" aria-label={t('chart.title')}>
            {RANGES.map(range => (
              <button
                key={range}
                type="button"
                className={`${styles['rangeButton']} ${range === days ? styles['rangeButtonActive'] : ''}`}
                aria-pressed={range === days}
                onClick={() => controller.setDays(range)}
              >
                {t(`range.${range}` as keyof typeof en)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className={styles['cards']}>
        <div className={`${styles['card']} ${styles['catInput']}`}>
          <div className={styles['cardHead']}>
            <span className={styles['cardDot']} />
            <span className={styles['cardLabel']}>{t('cat.input')}</span>
          </div>
          <span className={styles['cardValue']}>{formatFull(totals.input)}</span>
          <span className={styles['cardSub']}>{t('card.input.sub').replace('{rate}', String(hitRate))}</span>
        </div>
        <div className={`${styles['card']} ${styles['catCacheRead']}`}>
          <div className={styles['cardHead']}>
            <span className={styles['cardDot']} />
            <span className={styles['cardLabel']}>{t('cat.cacheRead')}</span>
          </div>
          <span className={styles['cardValue']}>{formatFull(totals.cacheRead)}</span>
        </div>
        <div className={`${styles['card']} ${styles['catOutput']}`}>
          <div className={styles['cardHead']}>
            <span className={styles['cardDot']} />
            <span className={styles['cardLabel']}>{t('cat.output')}</span>
          </div>
          <span className={styles['cardValue']}>{formatFull(totals.output)}</span>
        </div>
        <div className={`${styles['card']} ${styles['catRequests']}`}>
          <div className={styles['cardHead']}>
            <span className={styles['cardDot']} />
            <span className={styles['cardLabel']}>{t('requests')}</span>
          </div>
          <span className={styles['cardValue']}>{formatFull(requests)}</span>
        </div>
      </div>

      <div className={`${styles['chart']} ${isHourly ? styles['chartHourly'] : ''}`}>
        <h3 className={styles['chartTitle']}>
          {isToday ? t('chart.title.today') : t('chart.title')}
          {grand > 0 && <span className={styles['chartTotal']}>{` ${formatFull(grand)}`}</span>}
        </h3>
        {loading
          ? <div className={styles['chartLoading']}>{t('state.loading')}</div>
          : grand === 0
            ? <div className={styles['chartEmpty']}>{t('state.empty')}</div>
            : (
              <>
                <div className={styles['plot']}>
                  <div className={styles['yAxis']}>
                    {ticks.slice().reverse().map(value => (
                      <span key={value}>{formatCompact(value)}</span>
                    ))}
                  </div>
                  <div className={styles['grid']}>
                    {ticks.slice(1).map(value => (
                      <div key={value} className={styles['gridline']} style={{ bottom: `${(value / maxBucket) * 100}%` }} />
                    ))}
                    <div className={styles['bars']} key={days}>
                      {chartBuckets.map((bucket, index) => {
                        const total = bucketTotal(bucket)
                        const fraction = total / maxBucket
                        const cacheMiss = bucket.input - bucket.cacheRead
                        return (
                          <div
                            key={bucket.key}
                            className={`${styles['bar']} ${hovered === bucket.key ? styles['barHover'] : ''}`}
                            onMouseEnter={() => { setHovered(bucket.key) }}
                            onMouseLeave={() => { setHovered(current => (current === bucket.key ? null : current)) }}
                          >
                            {total > 0
                              ? (
                                <div
                                  className={styles['stack']}
                                  style={{ height: `${fraction * 100}%`, animationDelay: `${index * 14}ms` }}
                                >
                                  {/* Top-to-bottom: input miss (lightest) →
                                   * cache hit (medium) → output (darkest). */}
                                  {cacheMiss > 0
                                    ? (
                                      <span
                                        className={`${styles['seg']} ${styles['catInput']}`}
                                        style={{ height: `${(cacheMiss / total) * 100}%` }}
                                      />
                                    )
                                    : null}
                                  {bucket.cacheRead > 0
                                    ? (
                                      <span
                                        className={`${styles['seg']} ${styles['catCacheRead']}`}
                                        style={{ height: `${(bucket.cacheRead / total) * 100}%` }}
                                      />
                                    )
                                    : null}
                                  {bucket.output > 0
                                    ? (
                                      <span
                                        className={`${styles['seg']} ${styles['catOutput']}`}
                                        style={{ height: `${(bucket.output / total) * 100}%` }}
                                      />
                                    )
                                    : null}
                                </div>
                              )
                              : <div className={styles['barEmpty']} />}
                          </div>
                        )
                      })}
                      {hovered !== null && (() => {
                        const bucket = chartBuckets.find(b => b.key === hovered)
                        if (bucket === undefined) return null
                        const index = chartBuckets.indexOf(bucket)
                        const total = bucketTotal(bucket)
                        const cacheMiss = bucket.input - bucket.cacheRead
                        // The tooltip floats over the plot grid, anchored to
                        // the hovered bar's center. Edge bars clamp to the
                        // left/right so it never covers the y-axis or the
                        // chart border.
                        const midpoint = count > 0 ? ((index + 0.5) / count) * 100 : 50
                        const tipStyle: Record<string, string> = { top: '4px' }
                        if (midpoint < 25) {
                          tipStyle.left = '4px'
                          tipStyle.transform = 'none'
                        } else if (midpoint > 75) {
                          tipStyle.right = '4px'
                          tipStyle.transform = 'none'
                        } else {
                          tipStyle.left = `${midpoint}%`
                          tipStyle.transform = 'translateX(-50%)'
                        }
                        return (
                          <div className={styles['tip']} style={tipStyle} role="tooltip">
                            <div className={styles['tipHead']}>
                              <span>{bucket.label}</span>
                              <span>{formatFull(total)}</span>
                            </div>
                            {bucket.input - bucket.cacheRead > 0
                              ? (
                                <div className={styles['tipLine']}>
                                  <span>
                                    <span className={`${styles['tipSwatch']} ${styles['catInput']}`} />
                                    {t('tip.input')}
                                  </span>
                                  <span>{formatFull(cacheMiss)}</span>
                                </div>
                              )
                              : null}
                            {bucket.cacheRead > 0
                              ? (
                                <div className={styles['tipLine']}>
                                  <span>
                                    <span className={`${styles['tipSwatch']} ${styles['catCacheRead']}`} />
                                    {t('tip.input.cached')}
                                  </span>
                                  <span>{formatFull(bucket.cacheRead)}</span>
                                </div>
                              )
                              : null}
                            {bucket.output > 0
                              ? (
                                <div className={styles['tipLine']}>
                                  <span>
                                    <span className={`${styles['tipSwatch']} ${styles['catOutput']}`} />
                                    {t('cat.output')}
                                  </span>
                                  <span>{formatFull(bucket.output)}</span>
                                </div>
                              )
                              : null}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </div>
                {(() => {
                  const labels = isHourly ? hourAxisLabels() : dayAxisLabels(chartBuckets)
                  return (
                    <div className={`${styles['xAxis']} ${isHourly ? styles['xAxisHourly'] : ''} ${labels.length === 1 ? styles['xAxisSingle'] : ''}`}>
                      {labels.map((label, i) => (
                        <span key={i}>{label}</span>
                      ))}
                    </div>
                  )
                })()}
                <div className={styles['legend']}>
                  <span className={styles['legendKey']}>
                    <span className={`${styles['swatch']} ${styles['catInput']}`} />
                    {t('tip.input')}
                  </span>
                  <span className={styles['legendKey']}>
                    <span className={`${styles['swatch']} ${styles['catCacheRead']}`} />
                    {t('tip.input.cached')}
                  </span>
                  <span className={styles['legendKey']}>
                    <span className={`${styles['swatch']} ${styles['catOutput']}`} />
                    {t('cat.output')}
                  </span>
                </div>
              </>
            )}
      </div>
    </div>
  )
}
