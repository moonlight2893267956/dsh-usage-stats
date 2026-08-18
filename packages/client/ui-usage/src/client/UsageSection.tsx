/**
 * Usage settings section: the per-day token-usage dashboard. Metric cards
 * total each token category over the selected window, and a stacked bar chart
 * renders the per-day split with a hover tooltip carrying the exact figures.
 * Bars grow in with a staggered cascade on load and on every window change;
 * the tooltip fades in above the hovered day.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { UsageStatsDay } from '@deepseek-ai/dsh-usage-stats/types'
import type { UsageStatsState, UsageStatsStore } from './store.ts'
import type { en } from './locales.ts'
import styles from './UsageSection.module.css'

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

/** Selectable window lengths, in days. */
const RANGES = [7, 30, 90] as const

/** Y-axis gridline count. */
const TICKS = 4

/** One token category: its bucket field, copy key, and color-owning CSS class. */
const CATEGORIES = [
  { key: 'input', labelKey: 'cat.input', className: styles['catInput'] },
  { key: 'cacheRead', labelKey: 'cat.cacheRead', className: styles['catCacheRead'] },
  { key: 'output', labelKey: 'cat.output', className: styles['catOutput'] },
] as const

/** A category's bucket field. */
type CategoryKey = (typeof CATEGORIES)[number]['key']

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
  return day.input + day.cacheRead + day.output
}

/** Fill the `{placeholder}` tokens in localized copy. */
function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
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
  const loading = state.status !== 'ready'

  const totals: Record<CategoryKey, number> = { input: 0, cacheRead: 0, output: 0 }
  let searches = 0
  let grand = 0
  let maxDay = 1
  for (const bucket of buckets) {
    for (const category of CATEGORIES) totals[category.key] += bucket[category.key]
    const total = dayTotal(bucket)
    grand += total
    if (total > maxDay) maxDay = total
    searches += bucket.searches
  }

  const ticks: number[] = []
  for (let i = 0; i <= TICKS; i++) ticks.push((maxDay / TICKS) * i)

  const first = buckets[0]
  const last = buckets[buckets.length - 1]
  const count = buckets.length

  return (
    <div className={styles['page']}>
      <header className={styles['header']}>
        <h2 className={styles['title']}>{t('title')}</h2>
        <p className={styles['intro']}>{t('intro')}</p>
        <p className={styles['summary']}>
          {substitute(t('summary'), {
            days: String(days),
            total: formatCompact(grand),
            searches: String(searches),
          })}
        </p>
        <div className={styles['range']} role="group" aria-label={t('chart.title')}>
          {RANGES.map((range) => (
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
      </header>

      <div className={styles['metrics']}>
        {CATEGORIES.map((category, index) => (
          <div
            key={category.key}
            className={`${styles['card']} ${category.className}`}
            style={{ animationDelay: `${index * 70}ms` }}
          >
            <span className={styles['cardHead']}>
              <span className={styles['dot']} />
              <span className={styles['cardLabel']}>{t(category.labelKey)}</span>
            </span>
            <span className={styles['cardValue']}>{formatCompact(totals[category.key])}</span>
            <span className={styles['cardSub']}>{t('unit.tokens')}</span>
          </div>
        ))}
      </div>

      <div className={styles['chart']}>
        <h3 className={styles['chartTitle']}>{t('chart.title')}</h3>
        <p className={styles['chartHint']}>{substitute(t('chart.hint'), { days: String(days) })}</p>
        {loading
          ? <div className={styles['chartLoading']}>{t('state.loading')}</div>
          : grand === 0
            ? <div className={styles['chartEmpty']}>{t('state.empty')}</div>
            : (
              <>
                <div className={styles['plot']}>
                  <div className={styles['yAxis']}>
                    {ticks.slice().reverse().map((value) => (
                      <span key={value}>{formatCompact(value)}</span>
                    ))}
                  </div>
                  <div className={styles['grid']}>
                    {ticks.slice(1).map((value) => (
                      <div key={value} className={styles['gridline']} style={{ bottom: `${(value / maxDay) * 100}%` }} />
                    ))}
                    <div className={styles['bars']} key={days}>
                      {buckets.map((bucket, index) => {
                        const total = dayTotal(bucket)
                        const fraction = total / maxDay
                        const isHovered = hovered === bucket.date
                        // Edge days anchor the tooltip inward so it never clips
                        // the panel; tall bars open it downward instead.
                        const align = count > 1 ? index / (count - 1) : 0.5
                        const tipStyle: Record<string, string> = {}
                        if (align < 0.2) tipStyle.left = '0px'
                        else if (align > 0.8) tipStyle.right = '0px'
                        else { tipStyle.left = '50%'; tipStyle.transform = 'translateX(-50%)' }
                        if (fraction > 0.85) tipStyle.top = '4px'
                        else tipStyle.bottom = `calc(${fraction * 100}% + 10px)`
                        return (
                          <div
                            key={bucket.date}
                            className={styles['bar']}
                            onMouseEnter={() => { setHovered(bucket.date) }}
                            onMouseLeave={() => { setHovered(current => (current === bucket.date ? null : current)) }}
                          >
                            {isHovered
                              ? (
                                <div className={styles['tip']} style={tipStyle} role="tooltip">
                                  <span className={styles['tipDate']}>{dateLabel(bucket.date)}</span>
                                  {CATEGORIES.map((category) => bucket[category.key] > 0
                                    ? (
                                      <span key={category.key} className={styles['tipRow']}>
                                        <span className={styles['tipKey']}>
                                          <span className={`${styles['tipDot']} ${category.className}`} />
                                          {t(category.labelKey)}
                                        </span>
                                        <span className={styles['tipValue']}>{formatFull(bucket[category.key])}</span>
                                      </span>
                                    )
                                    : null)}
                                  <span className={`${styles['tipRow']} ${styles['tipTotal']}`}>
                                    <span className={styles['tipKey']}>{t('tip.total')}</span>
                                    <span className={styles['tipValue']}>{`${formatFull(total)} ${t('unit.tokens')}`}</span>
                                  </span>
                                  <span className={`${styles['tipRow']} ${styles['tipSearches']}`}>
                                    <span className={styles['tipKey']}>{t('tip.searches')}</span>
                                    <span className={styles['tipValue']}>{bucket.searches}</span>
                                  </span>
                                </div>
                              )
                              : null}
                            {total > 0
                              ? (
                                <div
                                  className={styles['stack']}
                                  style={{ height: `${fraction * 100}%`, animationDelay: `${index * 14}ms` }}
                                >
                                  {CATEGORIES.map((category) => bucket[category.key] > 0
                                    ? (
                                      <span
                                        key={category.key}
                                        className={`${styles['seg']} ${category.className}`}
                                        style={{ height: `${(bucket[category.key] / total) * 100}%` }}
                                      />
                                    )
                                    : null)}
                                </div>
                              )
                              : <div className={styles['barEmpty']} />}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
                <div className={styles['xAxis']}>
                  <span>{first === undefined ? '' : dateLabel(first.date)}</span>
                  <span>{last === undefined ? '' : dateLabel(last.date)}</span>
                </div>
                <div className={styles['legend']}>
                  {CATEGORIES.map((category) => (
                    <span key={category.key} className={styles['legendKey']}>
                      <span className={`${styles['dot']} ${category.className}`} />
                      {t(category.labelKey)}
                    </span>
                  ))}
                </div>
              </>
            )}
      </div>
    </div>
  )
}
