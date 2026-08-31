import { useLayoutEffect, type RefObject } from 'react'

export type ChromeCssVar = '--chrome-top' | '--chrome-page-top' | '--chrome-bottom'

/** Ask all chrome publishers to re-read geometry (orientation / FS / theater). */
export const CHROME_OFFSET_REFRESH_EVENT = 'safetube:chrome-offset-refresh'

export function requestChromeOffsetRefresh(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHROME_OFFSET_REFRESH_EVENT))
}

/** Publish a measured chrome height onto a shell element (px). */
export function setChromeVar(target: HTMLElement, name: ChromeCssVar, px: number): void {
  target.style.setProperty(name, `${Math.max(0, Math.round(px))}px`)
}

/**
 * Debounced viewport geometry refresh — orientation, visualViewport, resize, explicit bump.
 * Shared by chrome publishers so we do not stack duplicate listeners per shell.
 */
export function subscribeViewportGeometryRefresh(callback: () => void): () => void {
  let timer: number | null = null
  const schedule = () => {
    if (timer != null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      callback()
    }, 48)
  }

  window.addEventListener('resize', schedule)
  window.addEventListener('orientationchange', schedule)
  window.addEventListener(CHROME_OFFSET_REFRESH_EVENT, schedule)
  const vv = window.visualViewport
  vv?.addEventListener('resize', schedule)
  vv?.addEventListener('scroll', schedule)

  return () => {
    if (timer != null) window.clearTimeout(timer)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('orientationchange', schedule)
    window.removeEventListener(CHROME_OFFSET_REFRESH_EVENT, schedule)
    vv?.removeEventListener('resize', schedule)
    vv?.removeEventListener('scroll', schedule)
  }
}

/**
 * Observe `sourceRef` height and write it to `targetRef` as a CSS chrome variable.
 * Used so sticky offsets / scroll-margin share one measured contract per shell.
 */
export function usePublishChromeOffset(
  sourceRef: RefObject<HTMLElement | null>,
  targetRef: RefObject<HTMLElement | null>,
  name: ChromeCssVar,
  enabled = true
): void {
  useLayoutEffect(() => {
    if (!enabled) return
    const source = sourceRef.current
    const target = targetRef.current
    if (!source || !target) return

    const publish = () => {
      setChromeVar(target, name, source.getBoundingClientRect().height)
    }

    publish()

    const stopViewport = subscribeViewportGeometryRefresh(publish)

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        stopViewport()
      }
    }

    const ro = new ResizeObserver(publish)
    ro.observe(source)
    return () => {
      ro.disconnect()
      stopViewport()
    }
  }, [sourceRef, targetRef, name, enabled])
}

/**
 * Read the effective top clearance for watch scroll heuristics.
 * Prefers computed scroll-margin-top (resolves calc(--chrome-top + --chrome-page-top)).
 */
export function readChromeTopPad(el: HTMLElement): number {
  const styles = getComputedStyle(el)
  const scrollMargin = Number.parseFloat(styles.scrollMarginTop)
  if (Number.isFinite(scrollMargin) && scrollMargin > 0) return scrollMargin

  const chromeTop = Number.parseFloat(styles.getPropertyValue('--chrome-top')) || 0
  const pageTop = Number.parseFloat(styles.getPropertyValue('--chrome-page-top')) || 0
  const sum = chromeTop + pageTop
  return sum > 0 ? sum : 64
}
