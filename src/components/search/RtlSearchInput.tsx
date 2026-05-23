import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '../../lib/utils'

export type RtlSearchInputProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  onFocusChange?: (focused: boolean) => void
  'aria-label'?: string
}

/**
 * RTL Hebrew search field — icon on the right (text start), clear on the left.
 * Wrapper sets dir="rtl" so absolute positioning matches typed Hebrew text.
 */
export const RtlSearchInput = memo(function RtlSearchInput({
  id: idProp,
  value,
  onChange,
  placeholder = 'חיפוש…',
  className,
  inputClassName,
  onFocusChange,
  'aria-label': ariaLabel,
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

  return (
    <div dir="rtl" className={cn('relative w-full', className)} aria-label={ariaLabel}>
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
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        dir="rtl"
        enterKeyHint="search"
        className={cn(
          'h-12 w-full rounded-2xl border border-zinc-600/90 bg-zinc-900 text-base font-medium text-zinc-50 shadow-sm outline-none transition placeholder:text-zinc-500',
          'focus:border-brand-500/70 focus:ring-2 focus:ring-brand-500/25',
          'pr-11 pl-4',
          hasQuery && 'pl-11',
          inputClassName
        )}
      />

      <span
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-zinc-500"
        aria-hidden
      >
        <Search className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
      </span>

      {hasQuery ? (
        <button
          type="button"
          tabIndex={-1}
          className="absolute inset-y-0 left-2.5 my-auto flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clearInput}
          aria-label="מחק את החיפוש"
        >
          <X className="h-4 w-4" strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
    </div>
  )
})
