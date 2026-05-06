import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, RefreshCw, ServerCog } from 'lucide-react'
import { fetchBridgeDiagnostics, getStreamApiBaseUrl, type BridgeDiagnostics } from '../../lib/streamApi'
import { cn } from '../../lib/utils'

type Health = 'loading' | 'green' | 'yellow' | 'red' | 'unreachable'

interface DerivedSummary {
  health: Health
  pipedAlive: number
  invidiousAlive: number
  shortLabel: string
  longLabel: string
}

const REFRESH_INTERVAL_MS = 60_000

function deriveSummary(d: BridgeDiagnostics | null, error: string | null): DerivedSummary {
  if (error || !d) {
    return {
      health: 'unreachable',
      pipedAlive: 0,
      invidiousAlive: 0,
      shortLabel: 'לא נגיש',
      longLabel: error ?? 'אין תשובה משרת הזרם',
    }
  }
  const pipedAlive = d.probes.piped.filter((p) => p.ok && !p.skipped).length
  const invidiousAlive = d.probes.invidious.filter((p) => p.ok && !p.skipped).length
  const anyExtractor = pipedAlive > 0 || invidiousAlive > 0
  const cookiesOk = d.cookies.usable && d.cookies.hasRequiredAuthCookies
  const ytDlpOk = d.versions.ytDlp.ok

  if (!d.outbound.direct?.ok && !anyExtractor) {
    return {
      health: 'red',
      pipedAlive,
      invidiousAlive,
      shortLabel: 'תקלה',
      longLabel: 'אין יציאת רשת ואף resolver לא עובד',
    }
  }
  if (!anyExtractor && !cookiesOk && !ytDlpOk) {
    return {
      health: 'red',
      pipedAlive,
      invidiousAlive,
      shortLabel: 'תקלה',
      longLabel: 'אין resolver זמין — לא נצליח לפתור סרטונים',
    }
  }
  if (d.auth.stale || (!anyExtractor && cookiesOk)) {
    return {
      health: 'yellow',
      pipedAlive,
      invidiousAlive,
      shortLabel: 'מוגבל',
      longLabel: d.auth.stale
        ? `YouTube הגביל את ה-IP — שימוש במצב fallback (${d.auth.staleRemainingSec ?? 0} ש' נותרו)`
        : 'מסתמך רק על cookies. שני ה-proxies מאוטים',
    }
  }
  if (!cookiesOk) {
    return {
      health: 'yellow',
      pipedAlive,
      invidiousAlive,
      shortLabel: 'חלקי',
      longLabel: 'cookies לא תקפים — חלק מהסרטונים לא יזורמו',
    }
  }
  return {
    health: 'green',
    pipedAlive,
    invidiousAlive,
    shortLabel: 'תקין',
    longLabel: `${pipedAlive} Piped + ${invidiousAlive} Invidious פעילים, cookies תקפים`,
  }
}

const dotClass: Record<Health, string> = {
  loading: 'bg-slate-300 animate-pulse dark:bg-zinc-700',
  green: 'bg-brand-600 shadow-[0_0_0_3px_rgba(255,0,0,0.22)]',
  yellow: 'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]',
  red: 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.18)]',
  unreachable: 'bg-zinc-500 shadow-[0_0_0_3px_rgba(113,113,122,0.18)]',
}

export function BridgeStatusBadge() {
  const [data, setData] = useState<BridgeDiagnostics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const intervalRef = useRef<number | null>(null)
  const inFlightRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    inFlightRef.current?.abort()
    const ctrl = new AbortController()
    inFlightRef.current = ctrl
    try {
      const d = await fetchBridgeDiagnostics({ signal: ctrl.signal })
      setData(d)
      setError(null)
    } catch (err) {
      if (ctrl.signal.aborted) return
      setError(err instanceof Error ? err.message : String(err))
      setData(null)
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    intervalRef.current = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
      inFlightRef.current?.abort()
    }
  }, [refresh])

  const summary = deriveSummary(data, error)
  const health = loading && !data ? 'loading' : summary.health
  const cacheHits = data?.cache.hits ?? 0
  const cacheMisses = data?.cache.misses ?? 0
  const totalCalls = cacheHits + cacheMisses
  const hitRatioPct =
    data?.cache.hitRatio != null ? Math.round(data.cache.hitRatio * 100) : null

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-slate-50 dark:hover:bg-zinc-800/60"
      >
        <ServerCog className="h-5 w-5 shrink-0 text-slate-500 dark:text-zinc-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-zinc-100">סטטוס שרת הזרם</span>
            <span
              aria-hidden
              className={cn('inline-block h-2.5 w-2.5 rounded-full transition-shadow', dotClass[health])}
            />
            <span className="text-xs font-medium text-slate-500 dark:text-zinc-400">{summary.shortLabel}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-zinc-500">{summary.longLabel}</p>
        </div>
        <ChevronDown
          className={cn(
            'h-5 w-5 shrink-0 text-slate-400 transition-transform dark:text-zinc-500',
            open ? 'rotate-180' : ''
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950/40">
          {loading && !data ? (
            <p className="text-slate-500 dark:text-zinc-500">טוען נתונים…</p>
          ) : error ? (
            <div className="space-y-2">
              <p className="font-medium text-red-600 dark:text-red-400">לא ניתן להגיע ל-API:</p>
              <p className="text-xs text-slate-600 dark:text-zinc-400" dir="ltr">
                {error}
              </p>
              <p className="text-xs text-slate-500 dark:text-zinc-500" dir="ltr">
                {getStreamApiBaseUrl()}
              </p>
            </div>
          ) : data ? (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              <Field label="Render IP (ישיר)" value={data.outbound.direct?.ip ?? '—'} mono />
              <Field
                label="Tunnel IP (proxy)"
                value={
                  data.outbound.viaProxy?.ip
                    ? data.outbound.viaProxy.ip
                    : !data.proxy.configured
                      ? '—'
                      : !data.proxy.httpTunnelActive
                        ? '— (נדרש http:// או https:// ל-tunnel מלא; SOCKS רק ב-yt-dlp)'
                        : data.outbound.viaProxy?.error
                          ? String(data.outbound.viaProxy.error)
                          : '—'
                }
                mono
              />
              <Field
                label="Proxy"
                value={
                  data.proxy.configured
                    ? `${data.proxy.httpTunnelActive ? 'HTTP tunnel פעיל' : 'לא HTTP'} · ${data.proxy.urlMasked ?? ''}`
                    : 'לא מוגדר'
                }
                mono
                className="sm:col-span-2"
              />
              <Field
                label="yt-dlp"
                value={
                  data.versions.ytDlp.ok
                    ? data.versions.ytDlp.version ?? 'תקין'
                    : `שגיאה: ${data.versions.ytDlp.error ?? 'לא זמין'}`
                }
                mono
              />
              <Field
                label="Cookies"
                value={
                  data.cookies.usable
                    ? `תקפים (${data.cookies.ageHours ?? '?'} שעות, ${data.cookies.presentRequiredCookies.length}/7 נוכחים)`
                    : data.cookies.reason ?? 'לא זמינים'
                }
              />
              <Field
                label="Auth state"
                value={
                  data.auth.stale
                    ? `STALE — ${data.auth.staleRemainingSec ?? 0} שניות נותרו`
                    : 'תקין'
                }
              />
              <Field
                label="Cache"
                value={
                  totalCalls === 0
                    ? `${data.cache.size} ב-cache (אין תנועה עדיין)`
                    : `${data.cache.size} פריטים · ${hitRatioPct ?? 0}% hit rate (${cacheHits}/${totalCalls}) · TTL ${data.cache.ttlMinutes} דק'`
                }
              />
              <Field
                label="Piped"
                value={`${summary.pipedAlive} פעילים מתוך ${data.probes.piped.length} שנבדקו`}
              />
              <Field
                label="Invidious"
                value={`${summary.invidiousAlive} פעילים מתוך ${data.probes.invidious.length} שנבדקו`}
              />
              <Field
                label="elapsed"
                value={`${data.elapsedMs} ms · ${new Date(data.now).toLocaleTimeString('he-IL')}`}
                className="sm:col-span-2"
              />
            </dl>
          ) : null}
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading ? 'animate-spin' : '')} />
              רענון
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function Field({
  label,
  value,
  mono,
  className,
}: {
  label: string
  value: string
  mono?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-zinc-500">{label}</dt>
      <dd
        className={cn(
          'truncate text-slate-700 dark:text-zinc-200',
          mono ? 'font-mono text-xs' : 'text-xs'
        )}
        dir={mono ? 'ltr' : undefined}
      >
        {value}
      </dd>
    </div>
  )
}
