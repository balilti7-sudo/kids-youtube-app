/**
 * Soft audio normalization for Media Bridge `<video>` via Web Audio API.
 * Caps sudden spikes without changing the user's volume control meaning too aggressively.
 *
 * Android YouTube iframe path cannot use this (cross-origin embed audio is opaque).
 *
 * `createMediaElementSource` may only be called once per element — we ref-count
 * so React Strict Mode remounts do not break audio.
 */

export type PlayerAudioNormalizer = {
  /** Call from a user-gesture path if AudioContext starts suspended. */
  resume: () => Promise<void>
  dispose: () => void
}

type AttachOptions = {
  /** Peak reduction strength — keep mild for kids content. */
  thresholdDb?: number
  ratio?: number
  /** Makeup gain after compression (linear). */
  makeupGain?: number
}

const DEFAULTS: Required<AttachOptions> = {
  thresholdDb: -18,
  ratio: 3.5,
  makeupGain: 1.12,
}

type LiveGraph = {
  refs: number
  resume: () => Promise<void>
  teardown: () => void
}

const liveGraphs = new WeakMap<HTMLVideoElement, LiveGraph>()

/**
 * Route `video` through a DynamicsCompressor + gentle makeup gain.
 * Returns null when Web Audio is unavailable.
 */
export function attachPlayerAudioNormalizer(
  video: HTMLVideoElement,
  options?: AttachOptions
): PlayerAudioNormalizer | null {
  if (typeof window === 'undefined') return null

  const existing = liveGraphs.get(video)
  if (existing) {
    existing.refs += 1
    return {
      resume: existing.resume,
      dispose: () => {
        existing.refs -= 1
        if (existing.refs <= 0) {
          existing.teardown()
          liveGraphs.delete(video)
        }
      },
    }
  }

  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null

  const opts = { ...DEFAULTS, ...options }
  let ctx: AudioContext | null = null
  let source: MediaElementAudioSourceNode | null = null

  try {
    ctx = new AC()
    source = ctx.createMediaElementSource(video)

    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = opts.thresholdDb
    compressor.knee.value = 12
    compressor.ratio.value = opts.ratio
    compressor.attack.value = 0.003
    compressor.release.value = 0.22

    const makeup = ctx.createGain()
    makeup.gain.value = opts.makeupGain

    // Soft ceiling so residual peaks stay tame after makeup.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -3
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.08

    source.connect(compressor)
    compressor.connect(makeup)
    makeup.connect(limiter)
    limiter.connect(ctx.destination)
  } catch (err) {
    console.warn('[audioNormalizer] attach failed', err)
    try {
      source?.disconnect()
    } catch {
      /* ignore */
    }
    void ctx?.close().catch(() => {})
    return null
  }

  const resume = async () => {
    if (!ctx) return
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        /* ignore */
      }
    }
  }

  const onPlay = () => {
    void resume()
  }
  video.addEventListener('play', onPlay)
  void resume()

  const teardown = () => {
    video.removeEventListener('play', onPlay)
    try {
      source?.disconnect()
    } catch {
      /* ignore */
    }
    const closing = ctx
    ctx = null
    source = null
    void closing?.close().catch(() => {})
  }

  const graph: LiveGraph = { refs: 1, resume, teardown }
  liveGraphs.set(video, graph)

  return {
    resume,
    dispose: () => {
      const live = liveGraphs.get(video)
      if (!live) return
      live.refs -= 1
      if (live.refs <= 0) {
        live.teardown()
        liveGraphs.delete(video)
      }
    },
  }
}
