import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './DatePicker.module.css'

/** Props for the {@link DatePicker} calendar control. Copy is fully supplied by
 * the caller so the component stays locale-agnostic (client copy is
 * locale-owned). */
export interface DatePickerProps {
  /** The selected local calendar day (`YYYY-MM-DD`). */
  readonly value: string
  /** The latest selectable day (`YYYY-MM-DD`), typically today; days after it are disabled. */
  readonly max: string
  /** Accessible label for the trigger button. */
  readonly label: string
  /** Single-day formatter for the trigger text, e.g. `2026-08-18` → `8月18日`. */
  readonly formatValue: (key: string) => string
  /** Month-and-year heading, 0-based `month`. */
  readonly monthLabel: (year: number, month: number) => string
  /** Exactly seven weekday headings, Monday first. */
  readonly weekdays: readonly string[]
  /** "Today" quick action label. */
  readonly todayLabel: string
  /** Previous/next month control labels. */
  readonly prevLabel: string
  readonly nextLabel: string
  /** Called with the picked `YYYY-MM-DD`. */
  readonly onChange: (date: string) => void
}

/** Zero-pad a number to two digits. */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** `YYYY-MM-DD` for a 0-based month and day. */
function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`
}

/** `{ year, month }` (0-based month) parsed from a `YYYY-MM-DD` key. */
function monthOf(key: string): { year: number; month: number } {
  const parts = key.split('-')
  return { year: Number(parts[0]), month: Number(parts[1]) - 1 }
}

/** A dropdown calendar that lets the user pick one day within `[..., max]`. It
 * opens on click, renders the selected month's grid (today ringed, selected day
 * brand-filled, days after `max` disabled), and closes on outside click or
 * Escape. Previous/next month arrows and a "today" quick action are provided. */
export function DatePicker(props: DatePickerProps): ReactNode {
  const { value, max, label, formatValue, monthLabel, weekdays, todayLabel, prevLabel, nextLabel, onChange } = props
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => monthOf(value))
  const rootRef = useRef<HTMLDivElement>(null)

  // Anchor the view to the selected month whenever the popover opens, so a
  // day-picked elsewhere swaps back to its own month on the next open.
  useEffect(() => {
    if (!open) return
    setView(monthOf(value))
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, value])

  const { year, month } = view
  const monthHead = monthLabel(year, month)
  // Monday-first weekday offset of the 1st of the viewed month.
  const leadDays = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function shiftMonth(delta: number): void {
    const next = new Date(year, month + delta, 1)
    setView({ year: next.getFullYear(), month: next.getMonth() })
  }

  function pick(day: number): void {
    const key = dateKey(year, month, day)
    if (key > max) return
    onChange(key)
    setOpen(false)
  }

  function pickToday(): void {
    onChange(max)
    setOpen(false)
  }

  const cells: Array<number | null> = []
  for (let i = 0; i < leadDays; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(day)

  return (
    <div ref={rootRef} className={styles['root']}>
      <button
        type="button"
        className={`${styles['trigger']} ${open ? styles['triggerOpen'] : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => { setOpen(v => !v) }}
      >
        <svg className={styles['calIcon']} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2 6h12M5.5 1.5V4M10.5 1.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className={styles['triggerText']}>{formatValue(value)}</span>
        <svg className={styles['chevron']} width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className={styles['panel']} role="dialog" aria-label={monthHead}>
          <div className={styles['head']}>
            <button type="button" className={styles['nav']} aria-label={prevLabel} onClick={() => { shiftMonth(-1) }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className={styles['title']}>{monthHead}</span>
            <button type="button" className={styles['nav']} aria-label={nextLabel} onClick={() => { shiftMonth(1) }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className={styles['grid']}>
            {weekdays.map(name => (
              <span key={name} className={styles['weekday']}>{name}</span>
            ))}
            {cells.map((day, index) => {
              if (day === null) return <span key={`empty-${index}`} className={styles['cellEmpty']} />
              const key = dateKey(year, month, day)
              const disabled = key > max
              const selected = key === value
              const isToday = key === max
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    styles['cell'],
                    disabled ? styles['cellDisabled'] : '',
                    selected ? styles['cellSelected'] : '',
                    !selected && isToday ? styles['cellToday'] : '',
                  ].join(' ')}
                  aria-label={key}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => { pick(day) }}
                >
                  {day}
                </button>
              )
            })}
          </div>

          <div className={styles['foot']}>
            <button type="button" className={styles['today']} onClick={pickToday}>
              {todayLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
