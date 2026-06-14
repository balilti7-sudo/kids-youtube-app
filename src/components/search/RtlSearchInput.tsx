import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '../../lib/utils'

export type RtlSearchInputProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  /** Enter key or search icon — e.g. global YouTube search (must be gated in kid mode). */
  onSubmit?: (query: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  onFocusChange?: (focused: boolean) => void
  'aria-label'?: string
  'aria-expanded'?: boolean
  'aria-controls'?: string
  'aria-autocomplete'?: 'none' | 'inline' | 'list' | 'both'
}

/**
 * YouTube-style RTL pill search — icon button in grey capsule on the right (text start).
 */
export const RtlSearchInput = memo(function RtlSearchInput({
  id: idProp,
  value,
  onChange,
  placeholder = 'חיפוש…',
  className,
  inputClassName,
  onSubmit,
  onFocusChange,
  'aria-label': ariaLabel,
  'aria-expanded': ariaExpanded,
  'aria-controls': ariaControls,
  'aria-autocomplete': ariaAutocomplete,
}: RtlSearchInputProps) {
  const autoId = useId()
  const inputId = idProp ?? autoId
  const inputRef = useRef<HTMLInputElement>(null)
  const [localValue, setLocalValue] = useState(value)

  useEffect(() => {
    if (inputRef.current === document.activeElement) return
    setLocalValue(value)
  }, [value])

  const hasQuery = localValue.trim().length > 0

  const commitChange = useCallback(
    (next: string) => {
      setLocalValue(next)
      onChange(next)
    },
    [onChange]
  )

  const clearInput = useCallback(() => {
    commitChange('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [commitChange])

  const submitQuery = useCallback(() => {
    if (!onSubmit) return
    const q = localValue.trim()
    if (!q) return
    onSubmit(q)
  }, [localValue, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (onSubmit) submitQuery()
    },
    [onSubmit, submitQuery]
  )

  return (
    <div
      dir="rtl"
      className={cn(
        'flex h-11 w-full items-center overflow-hidden rounded-full border border-yt-border bg-yt-input shadow-sm transition focus-within:border-yt-textMuted/40',
        className
      )}
      aria-label={ariaLabel}
    >
      <label htmlFor={inputId} className="sr-only">
        {ariaLabel ?? placeholder}
      </label>

      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="search"
        value={localValue}
        onChange={(e) => commitChange(e.target.value)}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        dir="rtl"
        enterKeyHint="search"
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
        aria-autocomplete={ariaAutocomplete}
        className={cn(
          'min-w-0 flex-1 bg-transparent px-4 text-sm font-normal text-yt-text outline-none placeholder:text-yt-textMuted',
          hasQuery ? 'pl-2' : '',
          inputClassName
        )}
      />

      {hasQuery ? (
        <button
          type="button"
          tabIndex={-1}
          className="me-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-yt-textMuted transition hover:bg-yt-surfaceHover hover:text-yt-text"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clearInput}
          aria-label="מחק את החיפוש"
        >
          <X className="h-4 w-4" strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}

      {onSubmit ? (
        <button
          type="button"
          className="me-1 flex h-9 w-11 shrink-0 items-center justify-center rounded-full bg-yt-searchBtn text-yt-text transition hover:bg-yt-surfaceHover"
          onClick={submitQuery}
          aria-label="חפש ב-YouTube"
          title="חפש ב-YouTube (נדרש PIN הורה)"
        >
          <Search className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} aria-hidden />
        </button>
      ) : (
        <span
          className="me-1 flex h-9 w-11 shrink-0 items-center justify-center rounded-full bg-yt-searchBtn text-yt-text"
          aria-hidden
        >
          <Search className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
        </span>
      )}
    </div>
  )
})
