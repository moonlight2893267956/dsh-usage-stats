// @vitest-environment jsdom
/**
 * DatePicker: the dropdown calendar behind the usage range control. These
 * specs pin the rendered contract — it shows the selected day on the trigger,
 * opens a month grid with the weekday headings and a month title, reports the
 * picked day, disables future days, and closes after picking.
 */
import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DatePicker, type DatePickerProps } from '../src/client/DatePicker.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function baseProps(overrides: Partial<DatePickerProps> = {}): DatePickerProps {
  return {
    value: '2026-08-18',
    max: '2026-08-18',
    label: '选择日期',
    formatValue: key => key,
    monthLabel: (year, month) => `${year}-${month + 1}`,
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    todayLabel: '今天',
    prevLabel: '上个月',
    nextLabel: '下个月',
    onChange: () => {},
    ...overrides,
  }
}

describe('DatePicker', () => {
  it('shows the selected day on the trigger and opens a month grid', async () => {
    render(<DatePicker {...baseProps()} />)
    expect(screen.getByLabelText('选择日期')).toBeTruthy()
    expect(screen.getByText('2026-08-18')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('选择日期'))
    // The viewed month title and weekday headings are present.
    expect(screen.getByText('2026-8')).toBeTruthy()
    expect(screen.getByText('一')).toBeTruthy()
    expect(screen.getByText('日')).toBeTruthy()
    // The selected day is pressed and today is marked.
    expect(screen.getByRole('button', { name: '2026-08-18' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '2026-08-18' }).getAttribute('aria-current')).toBe('date')
  })

  it('disables days after max and leaves earlier days selectable', () => {
    render(<DatePicker {...baseProps()} />)
    fireEvent.click(screen.getByLabelText('选择日期'))
    expect(screen.getByRole('button', { name: '2026-08-19' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '2026-08-17' }).hasAttribute('disabled')).toBe(false)
  })

  it('reports the picked day and closes after picking', () => {
    const onChange = vi.fn()
    render(<DatePicker {...baseProps({ onChange })} />)
    fireEvent.click(screen.getByLabelText('选择日期'))
    fireEvent.click(screen.getByRole('button', { name: '2026-08-16' }))
    expect(onChange).toHaveBeenCalledWith('2026-08-16')
    // The panel closes, so the weekday heading is gone.
    expect(screen.queryByText('一')).toBeNull()
  })

  it('moves between months and jumps back to today', () => {
    const onChange = vi.fn()
    render(<DatePicker {...baseProps({ onChange })} />)
    fireEvent.click(screen.getByLabelText('选择日期'))
    fireEvent.click(screen.getByLabelText('上个月'))
    expect(screen.getByText('2026-7')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '今天' }))
    expect(onChange).toHaveBeenCalledWith('2026-08-18')
  })
})
