import type { YouTubeChannelResult } from '../types'

const YT_API = 'https://www.googleapis.com/youtube/v3'

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
      const msg =
        json.error?.message ||
        json.error?.errors?.[0]?.message ||
        `שגיאת YouTube (${res.status})`
      throw new Error(msg)
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
    return { data: null, error: e instanceof Error ? e : new Error('חיפוש נכשל') }
  }
}
