import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowLeft, Globe, Home } from 'lucide-react'
import { buildSafeBrowserUrl, validateSafeBrowserNavigation } from '../../lib/safeBrowserNavigation'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'

type Props = {
  host: string
  whitelist: string[]
  onClose: () => void
  className?: string
}

/**
 * In-app browser frame — only whitelisted hosts may load.
 * Uses a sandboxed iframe so navigation cannot escape SafeTube.
 */
export function SafeBrowserFrame({ host, whitelist, onClose, className }: Props) {
  const { t } = useTranslation()
  const initialUrl = useMemo(() => buildSafeBrowserUrl(host) ?? '', [host])
  const [activeUrl, setActiveUrl] = useState(initialUrl)
  const [blockedNotice, setBlockedNotice] = useState(false)

  const safeSrc = validateSafeBrowserNavigation(activeUrl, whitelist) ? activeUrl : initialUrl

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col bg-zinc-950', className)}>
      <header className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-900/95 px-3 py-2.5">
        <Button type="button" variant="ghost" className="shrink-0 !min-h-10 !min-w-10 !px-2" onClick={onClose} aria-label={t('safeBrowser.back')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-zinc-950/80 px-3 py-2 ring-1 ring-zinc-800">
          <Globe className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <span className="truncate text-sm font-medium text-zinc-100" dir="ltr">
            {host}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="shrink-0 !min-h-10 !min-w-10 !px-2"
          onClick={() => {
            setBlockedNotice(false)
            setActiveUrl(initialUrl)
          }}
          aria-label={t('safeBrowser.home')}
        >
          <Home className="h-5 w-5" />
        </Button>
      </header>

      {blockedNotice ? (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-950/40 px-4 py-2 text-sm text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {t('safeBrowser.blockedNavigation')}
        </div>
      ) : null}

      <iframe
        key={safeSrc}
        title={t('safeBrowser.frameTitle', { host })}
        src={safeSrc}
        className="min-h-0 w-full flex-1 border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
        onLoad={(e) => {
          try {
            const frame = e.currentTarget
            const loc = frame.contentWindow?.location.href
            if (!loc || loc === 'about:blank') return
            if (!validateSafeBrowserNavigation(loc, whitelist)) {
              setBlockedNotice(true)
              setActiveUrl(initialUrl)
            }
          } catch {
            /* cross-origin — expected for most sites */
          }
        }}
      />
    </div>
  )
}
