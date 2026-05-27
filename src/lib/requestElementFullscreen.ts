/** Enter native fullscreen on the video element (iOS Safari + standard Fullscreen API). */
export async function enterNativeVideoFullscreen(el: HTMLVideoElement): Promise<void> {
  const webkit = el as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
  if (typeof webkit.webkitEnterFullscreen === 'function') {
    webkit.webkitEnterFullscreen()
    return
  }
  if (el.requestFullscreen) {
    await el.requestFullscreen()
    return
  }
  const webkitReq = el as HTMLVideoElement & { webkitRequestFullscreen?: () => Promise<void> | void }
  if (typeof webkitReq.webkitRequestFullscreen === 'function') {
    await webkitReq.webkitRequestFullscreen()
  }
}

/** Fullscreen for a player shell (iframe wrapper) when no `<video>` is available. */
export async function enterElementFullscreen(el: HTMLElement): Promise<void> {
  const target = el as HTMLElement & {
    requestFullscreen?: () => Promise<void>
    webkitRequestFullscreen?: () => Promise<void> | void
  }
  if (target.requestFullscreen) {
    await target.requestFullscreen()
    return
  }
  if (typeof target.webkitRequestFullscreen === 'function') {
    await target.webkitRequestFullscreen()
  }
}

export async function exitDocumentFullscreen(): Promise<void> {
  const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void }
  if (document.exitFullscreen) {
    await document.exitFullscreen()
    return
  }
  if (typeof doc.webkitExitFullscreen === 'function') {
    await doc.webkitExitFullscreen()
  }
}

export function isDocumentFullscreen(): boolean {
  const doc = document as Document & { webkitFullscreenElement?: Element | null }
  return Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement)
}
