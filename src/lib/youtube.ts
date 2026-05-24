import type { YouTubeChannelResult, YouTubeVideoResult } from '../types'
import { getStreamApiBaseUrl } from './streamApi'

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

function isQuotaErrorMessage(message: string) {
  const msg = message.toLowerCase()
  return msg.includes('quota') || msg.includes('exceeded your') || msg.includes('quotaexceeded')
}

async function fetchChannelVideosFromRss(channelId: string): Promise<{
  data: ChannelVideoItem[] | null
  error: Error | null
}> {
  try {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`
    const res = await fetch(proxyUrl)
    if (!res.ok) {
      return { data: null, error: new Error(`RSS fetch failed (${res.status})`) }
    }
    const xml = await res.text()
    if (!xml.trim()) return { data: [], error: null }

    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const parserError = doc.querySelector('parsererror')
    if (parserError) return { data: null, error: new Error('RSS parse failed') }

    const entries = Array.from(doc.getElementsByTagName('entry'))
    const items: ChannelVideoItem[] = entries
      .map((entry) => {
        const videoId = entry.getElementsByTagName('yt:videoId')[0]?.textContent?.trim() ?? ''
        const title = entry.getElementsByTagName('title')[0]?.textContent?.trim() ?? ''
        const channelTitle = entry.getElementsByTagName('name')[0]?.textContent?.trim() ?? ''
        if (!videoId || !title) return null
        return {
          videoId,
          title,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          channelTitle,
        }
      })
      .filter(Boolean) as ChannelVideoItem[]

    return { data: items, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e : new Error('RSS fallback failed') }
  }
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

function extractYouTubeHandle(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (raw.startsWith('@') && raw.length > 1) {
    const handle = raw.slice(1).trim()
    return /^[a-zA-Z0-9._-]{3,}$/.test(handle) ? handle : null
  }
  try {
    const url = new URL(raw)
    if (!url.hostname.includes('youtube.com')) return null
    const parts = url.pathname.split('/').filter(Boolean)
    const handlePart = parts.find((p) => p.startsWith('@'))
    if (!handlePart) return null
    const handle = handlePart.slice(1).trim()
    return /^[a-zA-Z0-9._-]{3,}$/.test(handle) ? handle : null
  } catch {
    return null
  }
}

function extractYouTubeUsername(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!url.hostname.includes('youtube.com')) return null
    const parts = url.pathname.split('/').filter(Boolean)
    const userIdx = parts.findIndex((p) => p === 'user')
    if (userIdx < 0) return null
    const username = parts[userIdx + 1]?.trim()
    if (!username) return null
    return /^[a-zA-Z0-9._-]{2,}$/.test(username) ? username : null
  } catch {
    return null
  }
}

function extractYouTubeCustomSlug(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!url.hostname.includes('youtube.com')) return null
    const parts = url.pathname.split('/').filter(Boolean)
    const customIdx = parts.findIndex((p) => p === 'c')
    if (customIdx < 0) return null
    const slug = parts[customIdx + 1]?.trim()
    if (!slug) return null
    return /^[a-zA-Z0-9._-]{2,}$/.test(slug) ? slug : null
  } catch {
    return null
  }
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

export type YouTubeVideoSearchResult = {
  data: YouTubeVideoResult[] | null
  error: Error | null
  continuation: string | null
  hasMore: boolean
}

type BridgeSearchResponse = {
  videos?: YouTubeVideoResult[]
  continuation?: string | null
  hasMore?: boolean
  error?: string
  detail?: string
}

function buildBridgeSearchUrl(query: string, continuation?: string | null): string {
  const base = getStreamApiBaseUrl().replace(/\/+$/, '')
  const url = new URL(`${base}/api/youtube/search`)
  const q = query.trim()
  if (q) url.searchParams.set('q', q)
  if (continuation) url.searchParams.set('continuation', continuation)
  return url.toString()
}

export async function searchYouTubeVideos(
  query: string,
  options?: { continuation?: string | null }
): Promise<YouTubeVideoSearchResult> {
  const q = query.trim()
  const continuation = options?.continuation?.trim() || null
  if (!q && !continuation) {
    return { data: [], error: null, continuation: null, hasMore: false }
  }

  try {
    const res = await fetch(buildBridgeSearchUrl(q, continuation), {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
    })
    const json = (await res.json()) as BridgeSearchResponse

    if (!res.ok) {
      const msg = json.detail || json.error || `שגיאת חיפוש (${res.status})`
      throw new Error(msg)
    }

    const videos = Array.isArray(json.videos) ? json.videos : []
    return {
      data: videos,
      error: null,
      continuation: json.continuation ?? null,
      hasMore: Boolean(json.hasMore),
    }
  } catch (e) {
    console.error('[youtube] searchYouTubeVideos', e)
    return {
      data: null,
      error: e instanceof Error ? new Error(normalizeYouTubeError(e.message)) : new Error('חיפוש נכשל'),
      continuation: null,
      hasMore: false,
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
    // Quota-safe fallback for direct /channel/UC... links:
    // allow adding the channel with minimal metadata even if YouTube API is unavailable.
    if (e instanceof Error && isQuotaErrorMessage(e.message)) {
      return {
        data: {
          channelId: id,
          title: `Channel ${id.slice(0, 8)}`,
          thumbnail: `https://i.ytimg.com/vi/0/hqdefault.jpg`,
          subscriberCount: '—',
          description: '',
        },
        error: null,
      }
    }
    return {
      data: null,
      error: e instanceof Error ? new Error(normalizeYouTubeError(e.message)) : new Error('טעינת ערוץ נכשלה'),
    }
  }
}

async function getYouTubeChannelByHandle(handle: string): Promise<{
  data: YouTubeChannelResult | null
  error: Error | null
}> {
  const clean = handle.replace(/^@+/, '').trim()
  if (!clean) return { data: null, error: new Error('Handle לא תקין') }
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
    chUrl.searchParams.set('forHandle', clean)
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
    if (!item?.id) return { data: null, error: new Error('לא נמצא ערוץ עבור ה-handle שנשלח.') }
    const stats = item.statistics
    let subs = '—'
    if (stats?.hiddenSubscriberCount) subs = 'מוסתר'
    else if (stats?.subscriberCount !== undefined) subs = formatSubscriberCount(stats.subscriberCount)
    return {
      data: {
        channelId: item.id,
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

async function getYouTubeChannelByUsername(username: string): Promise<{
  data: YouTubeChannelResult | null
  error: Error | null
}> {
  const clean = username.trim()
  if (!clean) return { data: null, error: new Error('Username לא תקין') }
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
    chUrl.searchParams.set('forUsername', clean)
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
    if (!item?.id) return { data: null, error: new Error('לא נמצא ערוץ עבור המשתמש שנשלח.') }
    const stats = item.statistics
    let subs = '—'
    if (stats?.hiddenSubscriberCount) subs = 'מוסתר'
    else if (stats?.subscriberCount !== undefined) subs = formatSubscriberCount(stats.subscriberCount)
    return {
      data: {
        channelId: item.id,
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

  const handle = extractYouTubeHandle(input)
  if (handle) return getYouTubeChannelByHandle(handle)

  const username = extractYouTubeUsername(input)
  if (username) return getYouTubeChannelByUsername(username)

  const customSlug = extractYouTubeCustomSlug(input)
  if (customSlug) {
    const { data, error } = await searchYouTubeChannels(customSlug)
    if (error) return { data: null, error }
    if (!data?.length) return { data: null, error: new Error('לא נמצא ערוץ עבור הקישור שנשלח.') }
    const exact =
      data.find((c) => c.title.toLowerCase() === customSlug.toLowerCase()) ??
      data.find((c) => c.channelId) ??
      null
    return { data: exact, error: exact ? null : new Error('לא נמצא ערוץ עבור הקישור שנשלח.') }
  }

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

/** מגן מפני לולאת דפדוף חריגה ב־API (לא מגבלת ערוץ רגילה). */
const PLAYLIST_ITEMS_PAGE_GUARD = 50_000

type ChannelsContentDetailsResponse = {
  items?: Array<{
    contentDetails?: { relatedPlaylists?: { uploads?: string } }
  }>
  error?: { message?: string; errors?: { message?: string }[] }
}

type PlaylistItemsListResponse = {
  items?: Array<{
    snippet?: {
      title?: string
      channelTitle?: string
      resourceId?: { videoId?: string; kind?: string }
      thumbnails?: { medium?: { url?: string }; default?: { url?: string } }
    }
  }>
  nextPageToken?: string
  error?: { message?: string; errors?: { message?: string }[] }
}

async function fetchChannelUploadsPlaylistId(channelId: string, key: string): Promise<string | null> {
  const url = new URL(`${YT_API}/channels`)
  url.searchParams.set('part', 'contentDetails')
  url.searchParams.set('id', channelId.trim())
  url.searchParams.set('key', key)
  const res = await fetch(url.toString())
  const json = (await res.json()) as ChannelsContentDetailsResponse
  if (!res.ok) {
    const msg = json.error?.message || json.error?.errors?.[0]?.message || `שגיאת YouTube (${res.status})`
    throw toYouTubeRequestError(res.status, `שגיאת YouTube (${res.status})`, msg)
  }
  const uploads = json.items?.[0]?.contentDetails?.relatedPlaylists?.uploads?.trim()
  return uploads || null
}

type SearchListVideoResponse = {
  items?: Array<{
    id?: { kind?: string; videoId?: string }
    snippet?: {
      title?: string
      channelTitle?: string
      thumbnails?: { medium?: { url?: string }; default?: { url?: string } }
    }
  }>
  nextPageToken?: string
  error?: { message?: string; errors?: { message?: string }[] }
}

/** מגבלת דפים ל־search.list (מניעת לולאה + חיסכון במכסה; כל קריאה ~100 יחידות מכסה). */
const CHANNEL_SEARCH_PAGE_GUARD = 10

/**
 * חיפוש סרטונים בתוך ערוץ בלבד דרך YouTube Data API (`search.list` עם channelId + q + type=video).
 * לא משמש כברירת מחדל לרענון מלא — רק כשמועברת מחרוזת חיפוש.
 */
async function fetchChannelVideosViaSearchQuery(
  channelId: string,
  query: string,
  key: string
): Promise<ChannelVideoItem[]> {
  const q = query.trim()
  if (!q) return []

  const out: ChannelVideoItem[] = []
  const seen = new Set<string>()
  let pageToken: string | undefined
  let pages = 0

  for (;;) {
    pages += 1
    if (pages > CHANNEL_SEARCH_PAGE_GUARD) {
      break
    }

    const url = new URL(`${YT_API}/search`)
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('channelId', channelId.trim())
    url.searchParams.set('q', q)
    url.searchParams.set('type', 'video')
    url.searchParams.set('maxResults', '50')
    url.searchParams.set('key', key)
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url.toString())
    const json = (await res.json()) as SearchListVideoResponse
    if (!res.ok) {
      const msg = json.error?.message || json.error?.errors?.[0]?.message || `שגיאת YouTube (${res.status})`
      throw toYouTubeRequestError(res.status, `שגיאת YouTube (${res.status})`, msg)
    }

    for (const item of json.items ?? []) {
      const vid = item.id?.videoId?.trim()
      if (!vid || seen.has(vid)) continue
      seen.add(vid)
      out.push({
        videoId: vid,
        title: item.snippet?.title ?? 'ללא כותרת',
        thumbnail: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? '',
        channelTitle: item.snippet?.channelTitle ?? '',
      })
    }

    const next = json.nextPageToken
    if (!next || (json.items?.length ?? 0) === 0) break
    pageToken = next
  }

  return out
}

/** כל פריטי פלייליסט ההעלאות (דפדוף עד אין `nextPageToken`). */
async function fetchUploadsPlaylistVideos(uploadsPlaylistId: string, key: string): Promise<ChannelVideoItem[]> {
  const out: ChannelVideoItem[] = []
  let pageToken: string | undefined
  let pages = 0

  for (;;) {
    pages += 1
    if (pages > PLAYLIST_ITEMS_PAGE_GUARD) {
      throw new Error('דפדוף הרשימה נעצר אחרי יותר מדי עמודים; נסו שוב מאוחר יותר.')
    }

    const url = new URL(`${YT_API}/playlistItems`)
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('playlistId', uploadsPlaylistId)
    url.searchParams.set('maxResults', '50')
    url.searchParams.set('key', key)
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url.toString())
    const json = (await res.json()) as PlaylistItemsListResponse
    if (!res.ok) {
      const msg = json.error?.message || json.error?.errors?.[0]?.message || `שגיאת YouTube (${res.status})`
      throw toYouTubeRequestError(res.status, `שגיאת YouTube (${res.status})`, msg)
    }

    for (const item of json.items ?? []) {
      const vid = item.snippet?.resourceId?.videoId?.trim()
      if (!vid) continue
      out.push({
        videoId: vid,
        title: item.snippet?.title ?? 'ללא כותרת',
        thumbnail: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? '',
        channelTitle: item.snippet?.channelTitle ?? '',
      })
    }

    const next = json.nextPageToken
    if (!next || (json.items?.length ?? 0) === 0) break
    pageToken = next
  }

  return out
}

export async function getLatestVideosForChannel(
  channelId: string,
  options?: { /** חיפוש מוגבל לערוץ זה בלבד (`search.list` עם channelId + q) */ searchQuery?: string }
): Promise<{
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

  const searchQuery = options?.searchQuery?.trim() ?? ''

  try {
    if (searchQuery) {
      const results = await fetchChannelVideosViaSearchQuery(id, searchQuery, key)
      return { data: results, error: null }
    }

    const uploadsPlaylistId = await fetchChannelUploadsPlaylistId(id, key)
    if (!uploadsPlaylistId) {
      return { data: [], error: new Error('לא נמצאה רשימת העלאות לערוץ (ייתכן שהערוץ לא זמין ב־API).') }
    }
    const results = await fetchUploadsPlaylistVideos(uploadsPlaylistId, key)
    return { data: results, error: null }
  } catch (e) {
    console.error('[youtube] getLatestVideosForChannel', e)
    const normalized =
      e instanceof Error ? new Error(normalizeYouTubeError(e.message)) : new Error('טעינת סרטוני ערוץ נכשלה')

    // Fallback: when API quota is exhausted, read the public channel RSS feed (~15 אחרונים).
    // לא מנסים RSS כשביקשנו חיפוש ספציפי — ה־feed אינו תומך ב־q.
    if (!searchQuery && isQuotaErrorMessage(normalized.message)) {
      const fallback = await fetchChannelVideosFromRss(id)
      if (!fallback.error) return { data: fallback.data, error: null }
    }

    return { data: null, error: normalized }
  }
}
