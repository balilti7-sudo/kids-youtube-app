import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false
    if (el.tabIndex < 0) return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    return true
  })
}

/**
 * Stack of currently-active traps. When modals stack (e.g. the PIN modal opens on top
 * of the discovery modal), only the top-most trap may handle Tab/Escape — otherwise
 * the lower trap steals focus out of the upper modal and Escape closes the wrong one.
 */
const trapStack: RefObject<HTMLElement | null>[] = []

/**
 * Trap Tab / Shift+Tab inside `containerRef` while `active`, handle Escape,
 * move initial focus into the container, and restore focus on cleanup.
 * Essential for D-Pad / keyboard users when modals open.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  options?: {
    onEscape?: () => void
    /** Prefer this element for initial focus (e.g. first PIN digit). */
    initialFocusRef?: RefObject<HTMLElement | null>
  }
) {
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const initialFocusRef = options?.initialFocusRef

  // Callers pass inline closures; keeping the latest in a ref means the trap effect
  // re-runs ONLY on open/close. Re-running per render restored focus away from the
  // input mid-typing (every keystroke re-rendered the modal → keyboard kept closing).
  const onEscapeRef = useRef(options?.onEscape)
  onEscapeRef.current = options?.onEscape

  useEffect(() => {
    if (!active) return

    trapStack.push(containerRef)
    const isTopTrap = () => trapStack[trapStack.length - 1] === containerRef

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusInitial = () => {
      if (!isTopTrap()) return
      const root = containerRef.current
      if (!root) return
      const preferred = initialFocusRef?.current
      if (preferred && root.contains(preferred)) {
        preferred.focus()
        return
      }
      const items = listFocusable(root)
      const target = items.find((el) => el.getAttribute('data-autofocus') === 'true') ?? items[0]
      target?.focus()
    }

    const t = window.setTimeout(focusInitial, 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopTrap()) return
      if (event.key === 'Escape') {
        const onEscape = onEscapeRef.current
        if (!onEscape) return
        event.preventDefault()
        event.stopPropagation()
        onEscape()
        return
      }

      if (event.key !== 'Tab') return
      const root = containerRef.current
      if (!root) return
      const items = listFocusable(root)
      if (items.length === 0) {
        event.preventDefault()
        return
      }

      const first = items[0]!
      const last = items[items.length - 1]!
      const activeEl = document.activeElement

      if (event.shiftKey) {
        if (activeEl === first || !root.contains(activeEl)) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (activeEl === last || !root.contains(activeEl)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      const idx = trapStack.lastIndexOf(containerRef)
      if (idx !== -1) trapStack.splice(idx, 1)
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown, true)
      const prev = previousFocusRef.current
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        prev.focus()
      }
      previousFocusRef.current = null
    }
  }, [active, containerRef, initialFocusRef])
}
