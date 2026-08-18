import { useEffect, useId, useRef, useState } from 'react'
import styles from './ModelFilter.module.css'

export interface ModelFilterProps {
  /** Label shown before the trigger. */
  readonly label: string
  /** Text for the "all models" option. */
  readonly allLabel: string
  /** Available model ids. */
  readonly models: readonly string[]
  /** Currently selected model ids; empty means every model. */
  readonly selected: readonly string[]
  /** Called when the selection changes. */
  readonly onChange: (models: readonly string[]) => void
}

/** A compact dropdown that lets the user pick one or more models. */
export function ModelFilter({ label, allLabel, models, selected, onChange }: ModelFilterProps): JSX.Element {
  const id = useId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const isAll = selected.length === 0
  const triggerText = isAll ? allLabel : `${selected.length} 个模型`

  function toggle(model: string): void {
    const next = selected.includes(model)
      ? selected.filter(m => m !== model)
      : [...selected, model]
    onChange(next)
  }

  function toggleAll(): void {
    onChange([])
  }

  return (
    <div ref={rootRef} className={styles['root']}>
      <span className={styles['label']}>{label}</span>
      <button
        type="button"
        id={`${id}-trigger`}
        className={`${styles['trigger']} ${open ? styles['triggerOpen'] : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => setOpen(v => !v)}
      >
        <span className={styles['triggerText']} title={triggerText}>{triggerText}</span>
        <svg className={styles['chevron']} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          id={`${id}-listbox`}
          className={styles['panel']}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={`${id}-trigger`}
        >
          <Option
            checked={isAll}
            label={allLabel}
            onClick={toggleAll}
          />
          <div className={styles['divider']} />
          {models.map(model => (
            <Option
              key={model}
              checked={selected.includes(model)}
              label={model}
              onClick={() => toggle(model)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface OptionProps {
  readonly checked: boolean
  readonly label: string
  readonly onClick: () => void
}

function Option({ checked, label, onClick }: OptionProps): JSX.Element {
  return (
    <button
      type="button"
      className={`${styles['option']} ${checked ? styles['optionChecked'] : ''}`}
      role="option"
      aria-selected={checked}
      onClick={onClick}
      title={label}
    >
      <span className={styles['check']} aria-hidden="true">
        {checked && (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className={styles['optionLabel']}>{label}</span>
    </button>
  )
}
