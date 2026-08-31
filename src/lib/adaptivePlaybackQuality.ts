import type Hls from 'hls.js'
import {
  STREAM_START_QUALITY,
  STREAM_UPGRADE_QUALITY,
  type StreamPlaybackQuality,
} from './streamApi'

export type NetworkQualityHint = 'poor' | 'fair' | 'good' | 'unknown'

type NetworkConnection = {
  downlink?: number
  effectiveType?: string
  saveData?: boolean
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

function getConnection(): NetworkConnection | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator as Navigator & {
    connection?: NetworkConnection
    mozConnection?: NetworkConnection
    webkitConnection?: NetworkConnection
  }
  return nav.connection || nav.mozConnection || nav.webkitConnection || null
}

/** Coarse bandwidth hint for progressive (non-HLS) ladder decisions. */
export function getNetworkQualityHint(): NetworkQualityHint {
  const conn = getConnection()
  if (!conn) return 'unknown'
  if (conn.saveData) return 'poor'
  const type = String(conn.effectiveType || '').toLowerCase()
  if (type === 'slow-2g' || type === '2g') return 'poor'
  if (type === '3g') return 'fair'
  if (typeof conn.downlink === 'number' && Number.isFinite(conn.downlink)) {
    if (conn.downlink < 1.2) return 'poor'
    if (conn.downlink < 3.5) return 'fair'
    return 'good'
  }
  if (type === '4g') return 'good'
  return 'unknown'
}

export function preferredProgressiveQuality(
  hint: NetworkQualityHint = getNetworkQualityHint()
): StreamPlaybackQuality {
  if (hint === 'poor') return STREAM_START_QUALITY
  if (hint === 'fair') return STREAM_START_QUALITY
  return STREAM_UPGRADE_QUALITY
}

export function playbackQualityHeight(raw: string | null | undefined): number {
  const m = String(raw || '').match(/(\d+)\s*p/i)
  return m ? Number(m[1]) : 0
}

/** Forward buffer seconds ahead of currentTime (0 if unknown). */
export function getForwardBufferSeconds(el: HTMLVideoElement): number {
  try {
    if (!el.buffered || el.buffered.length === 0) return 0
    const t = el.currentTime
    for (let i = 0; i < el.buffered.length; i++) {
      const start = el.buffered.start(i)
      const end = el.buffered.end(i)
      if (t >= start && t <= end) return Math.max(0, end - t)
    }
    const end = el.buffered.end(el.buffered.length - 1)
    return Math.max(0, end - t)
  } catch {
    return 0
  }
}

/**
 * Stable hls.js ABR defaults — smooth ladder changes, avoid aggressive upshifts.
 * (hls.js 1.6.x — no abrSwitchInterval yet.)
 */
export function buildSmoothHlsAbrConfig(): Partial<Hls['config']> {
  const hint = getNetworkQualityHint()
  const defaultEstimate =
    hint === 'poor' ? 400_000 : hint === 'fair' ? 1_200_000 : hint === 'good' ? 2_500_000 : 800_000

  return {
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: 36,
    maxMaxBufferLength: 72,
    backBufferLength: 24,
    startLevel: -1,
    abrEwmaFastVoD: 3.5,
    abrEwmaSlowVoD: 10,
    abrEwmaFastLive: 3.5,
    abrEwmaSlowLive: 10,
    abrEwmaDefaultEstimate: defaultEstimate,
    abrBandWidthFactor: 0.9,
    abrBandWidthUpFactor: 0.6,
    maxStarvationDelay: 3,
    maxLoadingDelay: 3,
    testBandwidth: true,
  }
}

export type AdaptiveQualityTarget = {
  quality: StreamPlaybackQuality
  reason: 'upgrade' | 'downgrade' | 'hold'
}

/**
 * Decide next progressive quality from buffer health + network (no thrash).
 */
export function decideAdaptiveProgressiveTarget(input: {
  currentQuality: string | null | undefined
  forwardBufferSec: number
  recentlyWaiting: boolean
  cooldownActive: boolean
}): AdaptiveQualityTarget {
  const currentH = playbackQualityHeight(input.currentQuality || STREAM_START_QUALITY)
  const startH = playbackQualityHeight(STREAM_START_QUALITY)
  const upgradeH = playbackQualityHeight(STREAM_UPGRADE_QUALITY)
  const hint = getNetworkQualityHint()

  if (input.cooldownActive) {
    return {
      quality: (currentH >= upgradeH ? STREAM_UPGRADE_QUALITY : STREAM_START_QUALITY) as StreamPlaybackQuality,
      reason: 'hold',
    }
  }

  // Prefer safety: starving or poor network → drop to start quality.
  if (
    (input.recentlyWaiting || input.forwardBufferSec < 3 || hint === 'poor') &&
    currentH > startH
  ) {
    return { quality: STREAM_START_QUALITY, reason: 'downgrade' }
  }

  // Upgrade only when buffer is healthy and network is OK.
  if (
    !input.recentlyWaiting &&
    input.forwardBufferSec >= 10 &&
    (hint === 'good' || hint === 'unknown') &&
    currentH < upgradeH
  ) {
    return { quality: STREAM_UPGRADE_QUALITY, reason: 'upgrade' }
  }

  return {
    quality: (currentH >= upgradeH ? STREAM_UPGRADE_QUALITY : STREAM_START_QUALITY) as StreamPlaybackQuality,
    reason: 'hold',
  }
}
