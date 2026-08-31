import { readChromeTopPad } from './chromeOffset'

/**
 * Bring the watch player into view after selecting a video.
 * When the viewer scrolled deep into the list below, scroll so the player
 * sits in the middle of the viewport and watching can start immediately.
 *
 * Top clearance comes from the Global UI chrome contract
 * (`scroll-margin-top` / `--chrome-top` + `--chrome-page-top`), not a magic 64px.
 */
export function scrollPlayerIntoViewIfNeeded(
  el: HTMLElement | null,
  opts?: { behavior?: ScrollBehavior; force?: boolean }
): void {
  if (!el || typeof window === 'undefined') return

  const rect = el.getBoundingClientRect()
  const topPad = readChromeTopPad(el)
  const vh = window.innerHeight

  // Already well positioned near the top — don't yank the page.
  const alreadyGood =
    !opts?.force &&
    rect.top >= topPad - 12 &&
    rect.top <= Math.min(vh * 0.38, 260) &&
    rect.bottom > topPad + 120

  if (alreadyGood) return

  // Far below / mostly off-screen → center the player for instant watching.
  // Otherwise pin to start (YouTube-like watch chrome under a header).
  // `block: 'start'` respects CSS scroll-margin-top on the anchor.
  const farFromView =
    rect.bottom < topPad + 40 ||
    rect.top > vh * 0.45 ||
    rect.top < -rect.height * 0.35

  el.scrollIntoView({
    behavior: opts?.behavior ?? 'smooth',
    block: opts?.force || farFromView ? 'center' : 'start',
    inline: 'nearest',
  })
}

/** Always scroll the player into a watchable position (e.g. after a new tap). */
export function scrollPlayerIntoViewForWatch(
  el: HTMLElement | null,
  opts?: { behavior?: ScrollBehavior }
): void {
  if (!el || typeof window === 'undefined') return

  const run = () => {
    scrollPlayerIntoViewIfNeeded(el, { behavior: opts?.behavior ?? 'smooth', force: true })
  }

  // First frame: blur + initial scroll. Second: layout after player remount.
  window.requestAnimationFrame(() => {
    suppressFocusScrollJump()
    run()
    window.setTimeout(run, 80)
  })
}

/** Stop focus-driven scroll when tapping a video/song in a list under the player. */
export function suppressFocusScrollJump(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur()
  }
}
