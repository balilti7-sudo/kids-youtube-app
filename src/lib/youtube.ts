import type { YouTubeChannelResult, YouTubeVideoResult } from '../types'

const YT_API = 'https://www.googleapis.com/youtube/v3'

const QUOTA_EXCEEDED_MSG = 'מכסת החיפושים הסתיימה להיום, ניתן להוסיף ערוצים באמצעות הדבקת לינק ישיר.'

function getApiKey(): string | null {
  const k = import.meta.env.VITE_YOUTUBE_API_KEY
  return typeof k === 'string' && k.trim() ? k.trim() : null
}

function formatSubscriberCount(raw: string | undefined): string {
  if (raw === undefined || raw === '') return '—'
  const n = Number(raw)
  if (Number.isNaN(n)) return raw
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

type SearchItem = {
  id: { channelId?: string }
  snippet?: {
    title?: string
    description?: string
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } }
  }
}

type ChannelItem = {
  id?: string
  snippet?: {
    title?: string
    description?: string
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } }
  }
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean }
}

type VideoSearchItem = {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    channelTitle?: string
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } }
  }
}

type VideoItem = {
  id?: string
  snippet?: {
    title?: string
    channelId?: string
    channelTitle?: string
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } }
  }
}

export interface ChannelVideoItem {
  videoId: string
  title: string
  thumbnail: string
  channelTitle: string
}

function normalizeYouTubeError(message: string) {
  const msg = message.toLowerCase()
  if (msg.includes('quota') || msg.includes('exceeded your') || msg.includes('quotaexceeded')) {
    return QUOTA_EXCEEDED_MSG
  }
  return message
}

function toYouTubeRequestError(status: number, fallback: string, raw?: string) {
  return new Error(normalizeYouTubeError(raw || fallback || `שגיאת YouTube (${status})`))
}

export async function searchYouTubeChannels(query: string): Promise<{
  data: YouTubeChannelResult[] | null
  error: Error | null
}> {
  const q = query.trim()
  if (!q) return { data: [], error: null }

  const key = getApiKey()
  if (!key) {
    return {
      data: null,
      error: new Error(
        'חסר מפתח YouTube: הוסיפו VITE_YOUTUBE_API_KEY לקובץ .env.local והפעילו מחדש את שרת הפיתוח (npm run dev).'
      ),
    }
  }

  try {
    const searchUrl = new URL(`${YT_API}/search`)
    searchUrl.searchParams.set('part', 'snippet')
    searchUrl.searchParams.set('type', 'channel')
    searchUrl.searchParams.set('maxResults', '15')
    searchUrl.searchParams.set('q', q)
    searchUrl.searchParams.set('key', key)

    const res = await fetch(searchUrl.toString())
    const json = (await res.json()) as {
      items?: SearchItem[]
      error?: { message?: string; errors?: { message?: string }[] }
    }

    if (!res.ok) {
      const msg = json.error?.message || json.error?.errors?.[0]?.message || `שגיאת YouTube (${res.status})`
      throw toYouTubeRequestError(res.status, `שגיאת YouTube (${res.status})`, msg)
    }

    const items = json.items ?? []
    if (items.length === 0) return { data: [], error: null }

    const channelIds = items.map((i) => i.id?.channelId).filter(Boolean) as string[]
    const idParam = channelIds.join(',')

    const chUrl = new URL(`${YT_API}/channels`)
    chUrl.searchParams.set('part', 'snippet,statistics')
    chUrl.searchParams.set('id', idParam)
    chUrl.searchParams.set('maxResults', '50')
    chUrl.searchParams.set('key', key)

    const resCh = await fetch(chUrl.toString())
    const jsonCh = (await resCh.json()) as {
      items?: ChannelItem[]
      error?: { message?: string }
    }

    const byId = new Map<string, ChannelItem>()
    if (resCh.ok && jsonCh.items) {
      for (const ch of jsonCh.items) {
        if (ch.id) byId.set(ch.id, ch)
      }
    }

    const results: YouTubeChannelResult[] = channelIds.map((channelId) => {
      const fromSearch = items.find((i) => i.id?.channelId === channelId)
      const fromCh = byId.get(channelId)
      const sn = fromCh?.snippet ?? fromSearch?.snippet
      const thumb =
        sn?.thumbnails?.medium?.url ?? sn?.thumbnails?.default?.url ?? ''
      const stats = fromCh?.statistics
      let subs = '—'
      if (stats?.hiddenSubscriberCount) subs = 'מוסתר'
      else if (stats?.subscriberCount !== undefined)
        subs = formatSubscriberCount(stats.subscriberCount)

      return {
        channelId,
        title: sn?.title ?? 'ללא שם',
        thumbnail: thumb,
        subscriberCount: subs,
        description: (sn?.description ?? '').slice(0, 500),
      }
    })

    return { data: results, error: null }
  } catch (e) {
    console.error('[youtube] searchYouTubeChannels', e)
    return {
      data: null,
      error: e instanceof Error ? new Error(normalizeYouTubeError(e.message)) : new Error('חיפוש נכשל'),
    }
  }
}

export function extractYouTubeChannelId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(raw)) return raw
  try {
    const url = new URL(raw)
    if (!url.hostname.includes('youtube.com')) return null
    const parts = url.pathname.split('/').filter(Boolean)
    const channelIdx = parts.findIndex((p) => p === 'channel')
    if (channelIdx >= 0) {
      const id = parts[channelIdx + 1]
      return id && /^UC[a-zA-Z0-9_-]{22}$/.test(id) ? id : null
    }
  } catch {
    return null
  }
  return null
}

export function extractYouTubeVideoId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw

  try {
    const url = new URL(raw)
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.split('/').filter(Boolean)[0]
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
    }
    if (url.hostname.includes('youtube.com')) {
      const fromQuery = url.searchParams.get('v')
      if (fromQuery && /^[a-zA-Z0-9_-]{11}$/.test(fromQuery)) return fromQuery
      const parts = url.pathname.split('/').filter(Boolean)
      const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts')
      if (embedIdx >= 0) {
        const id = parts[embedIdx + 1]
        return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
      }
    }
  } catch {
    return null
  }
  return null
}

export async function searchYouTubeVideos(query: string): Promise<{
  data: YouTubeVideoResult[] | null
  error: Error | null
}> {
  const q = query.trim()
  if (!q) return { data: [], error: null }
  const key = getApiKey()
  if (!key) {
    return {
      data: null,
      error: new Error(
        'חסר מפתח YouTube: הוסיפו VITE_YOUTUBE_API_KEY לקובץ .env.local והפעילו מחדש את שרת הפיתוח (npm run dev).'
      ),
    }
  }

  try {
    const searchUrl = new URL(`${YT_API}/search`)
    searchUrl.searchParams.set('part', 'snippet')
    searchUrl.searchParams.set('type', 'video')
    searchUrl.searchParams.set('videoEmbeddable', 'true')
    searchUrl.searchParams.set('safeSearch', 'strict')
    searchUrl.searchParams.set('maxResults', '15')
    searchUrl.searchParams.set('q', q)
    searchUrl.searchParams.set('key', key)

    const res = await fetch(searchUrl.toString())
    const json = (await res.json()) as {
      items?: VideoSearchItem[]
      error?: { message?: string; errors?: { message?: string }[] }
    }

    if (!res.ok) {
      const msg = json.error?.message || json.error?.errors?.[0]?.message || `שגיאת YouTube (${res.status})`
      throw toYouTubeRequestError(res.status, `שגיאת YouTube (${res.status})`, msg)
    }

    const items = json.items ?? []
    const results: YouTubeVideoResult[] = items
      .map((item) => {
        const videoId = item.id?.videoId
        if (!videoId) return null
        return {
          videoId,
          title: item.snippet?.title ?? 'ללא כותרת',
          thumbnail: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? '',
          channelTitle: item.snippet?.channelTitle ?? '',
        }
      })
      .filter(Boolean) as YouTubeVideoResult[]

    return { data: results, error: null }
  } catch (e) {
    console.error('[youtube] searchYouTubeVideos', e)
    return {
      data: null,
      error: e instanceof Error ? new Error(normalizeYouTubeError(e.message)) : new Error('חיפוש נכשל'),
    }
  }
}

export async function getYouTubeChannelById(channelId: string): Promise<{
  data: YouTubeChannelResult | null
  error: Error | null
}> {
  const id = channelId.trim()
  if (!/^UC[a-zA-Z0-9_-]{22}$/.test(id)) {
    return { data: null, error: new Error('קישור הערוץ לא תקין. השתמשו בלינק מסוג /channel/UC... או Channel ID.') }
  }
  const key = getApiKey()
  if (!key) {
    return {
      data: null,
      error: new Error(
        'חסר מפתח YouTube: הוסיפו VITE_YOUTUBE_API_KEY לקובץ .env.local והפעילו מחדש את שרת הפיתוח (npm run dev).'
      ),
    }
  }
  try {
    const chUrl = new URL(`${YT_API}/channels`)
    chUrl.searchParams.set('part', 'snippet,statistics')
    chUrl.searchParams.set('id', id)
    chUrl.searchParams.set('maxResults', '1')
    chUrl.searchParams.set('key', key)

    const res = await fetch(chUrl.toString())
    const json = (await res.json()) as {
      items?: ChannelItem[]
      error?: { message?: string; errors?: { message?: string }[] }
    }
    if (!res.ok) {
      const msg = json.error?.message || json.error?.errors?.[0]?.message || `שגיאת YouTube (${res.status})`
      throw toYouTubeRequestError(res.status, `שגיאת YouTube (${res.status})`, msg)
    }
    const item = json.items?.[0]
    if (!item) return { data: null, error: new Error('לא נמצא ערוץ עבור הקישור שניתן.') }
    const stats = item.statistics
    let subs = '—'
    if (stats?.hiddenSubscriberCount) subs = 'מוסתר'
    else if (stats?.subscriberCount !== undefined) subs = formatSubscriberCount(stats.subscriberCount)
    return {
      data: {
        channelId: id,
        title: item.snippet?.title ?? 'ללא שם',
        thumbnail: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? '',
        subscriberCount: subs,
        description: (item.snippet?.description ?? '').slice(0, 500),
      },
      error: null,
    }
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? new Error(normalizeYouTubeError(e.message)) : new Error('טעינת ערוץ נכשלה'),
    }
  }
}

export async function resolveYouTubeChannelFromInput(input: string): Promise<{
  data: YouTubeChannelResult | null
  error: Error | null
}> {
  const channelId = extractYouTubeChannelId(input)
  if (channelId) return getYouTubeChannelById(channelId)

  const videoId = extractYouTubeVideoId(input)
  if (!videoId) {
    return {
      data: null,
      error: new Error('לא זוהה לינק תקין לערוץ או לסרטון. הדביקו לינק YouTube מלא.'),
    }
  }

  const key = getApiKey()
  if (!key) {
    return {
      data: null,
      error: new Error(
        'חסר מפתח YouTube: הוסיפו VITE_YOUTUBE_API_KEY לקובץ .env.local והפעילו מחדש את שרת הפיתוח (npm run dev).'
      ),
    }
  }
  try {
    const url = new URL(`${YT_API}/videos`)
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('id', videoId)
    url.searchParams.set('maxResults', '1')
    url.searchParams.set('key', key)
    const res = await fetch(url.toString())
    const json = (await res.json()) as {
      items?: VideoItem[]
      error?: { message?: string; errors?: { message?: string }[] }
    }
    if (!res.ok) {
      const msg = json.error?.message || json.error?.errors?.[0]?.message || `שגיאת YouTube (${res.status})`
      throw toYouTubeRequestError(res.status, `שגיאת YouTube (${res.status})`, msg)
    }
    const chId = json.items?.[0]?.snippet?.channelId
    if (!chId) return { data: null, error: new Error('לא הצלחתי לזהות ערוץ מהסרטון שנשלח.') }
    return getYouTubeChannelById(chId)
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? new Error(normalizeYouTubeError(e.message)) : new Error('פתרון לינק נכשל'),
    }
  }
}

export async function getLatestVideosForChannel(channelId: string): Promise<{
  data: ChannelVideoItem[] | null
  error: Error | null
}> {
  const id = channelId.trim()
  if (!id) return { data: [], error: null }
  const key = getApiKey()
  if (!key) {
    return {
      data: null,
      error: new Error(
        'חסר מפתח YouTube: הוסיפו VITE_YOUTUBE_API_KEY לקובץ .env.local והפעילו מחדש את שרת הפיתוח (npm run dev).'
      ),
    }
  }

  try {
    const searchUrl = new URL(`${YT_API}/search`)
    searchUrl.searchParams.set('part', 'snippet')
    searchUrl.searchParams.set('channelId', id)
    searchUrl.searchParams.set('type', 'video')
    searchUrl.searchParams.set('order', 'date')
    searchUrl.searchParams.set('videoEmbeddable', 'true')
    searchUrl.searchParams.set('safeSearch', 'strict')
    searchUrl.searchParams.set('maxResults', '20')
    searchUrl.searchParams.set('key', key)

    const res = await fetch(searchUrl.toString())
    const json = (await res.json()) as {
      items?: VideoSearchItem[]
      error?: { message?: string; errors?: { message?: string }[] }
    }

    if (!res.ok) {
      const msg = json.error?.message || json.error?.errors?.[0]?.message || `שגיאת YouTube (${res.status})`
      throw toYouTubeRequestError(res.status, `שגיאת YouTube (${res.status})`, msg)
    }

    const results = (json.items ?? [])
      .map((item) => {
        const videoId = item.id?.videoId
        if (!videoId) return null
        return {
          videoId,
          title: item.snippet?.title ?? 'ללא כותרת',
          thumbnail: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? '',
          channelTitle: item.snippet?.channelTitle ?? '',
        }
      })
      .filter(Boolean) as ChannelVideoItem[]

    return { data: results, error: null }
  } catch (e) {
    console.error('[youtube] getLatestVideosForChannel', e)
    return {
      data: null,
      error: e instanceof Error ? new Error(normalizeYouTubeError(e.message)) : new Error('טעינת סרטוני ערוץ נכשלה'),
    }
  }
}
