import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { Device } from '../../types'
import { CONTENT_TAGS_ENABLED, TAG_WEIGHT, type TagWeight } from '../../config/contentTags'
import { cycleTagWeight } from '../../lib/contentTags/tagUi'
import type { TagPreferenceInput } from '../../lib/contentTags/types'
import { useContentTagStore } from '../../stores/contentTagStore'
import { cn } from '../../lib/utils'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { TagChipBar } from './TagChipBar'

type Props = {
  device: Device
  className?: string
}

const SAVE_DEBOUNCE_MS = 450

export function TastePreferenceCard({ device, className }: Props) {
  const { t } = useTranslation()
  const catalog = useContentTagStore((s) => s.catalog)
  const catalogLoading = useContentTagStore((s) => s.catalogLoading)
  const fetchCatalog = useContentTagStore((s) => s.fetchCatalog)
  const fetchDevicePrefs = useContentTagStore((s) => s.fetchDevicePrefs)
  const updateTagPreferences = useContentTagStore((s) => s.updateTagPreferences)
  const devicePrefs = useContentTagStore((s) => s.devicePrefs[device.id] ?? null)
  const prefsLoading = useContentTagStore((s) => s.devicePrefsLoading[device.id])

  const [weights, setWeights] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const saveTimerRef = useRef<number | null>(null)
  const pendingSaveRef = useRef<TagPreferenceInput[] | null>(null)

  useEffect(() => {
    if (!CONTENT_TAGS_ENABLED) return
    void fetchCatalog()
    void fetchDevicePrefs(device.id)
  }, [device.id, fetchCatalog, fetchDevicePrefs])

  useEffect(() => {
    const next: Record<string, number> = {}
    for (const pref of devicePrefs?.tagPreferences ?? []) {
      next[pref.tagId] = pref.weight
    }
    setWeights(next)
  }, [devicePrefs?.tagPreferences, device.id])

  const flushSave = useCallback(
    async (inputs: TagPreferenceInput[]) => {
      setSaving(true)
      const { error, offlineQueued } = await updateTagPreferences(device.id, inputs)
      setSaving(false)
      if (error) {
        if (offlineQueued) {
          toast.warning(t('contentTags.savedOffline'), { description: t('contentTags.savedOfflineHint') })
          return
        }
        toast.error(t('contentTags.saveFailed'), { description: error.message })
        void fetchDevicePrefs(device.id)
        return
      }
      toast.success(t('contentTags.saved'), { duration: 1800 })
    },
    [device.id, fetchDevicePrefs, t, updateTagPreferences]
  )

  const scheduleSave = useCallback(
    (nextWeights: Record<string, number>) => {
      const inputs: TagPreferenceInput[] = Object.entries(nextWeights)
        .filter(([, w]) => w !== TAG_WEIGHT.NEUTRAL)
        .map(([tagId, weight]) => ({ tagId, weight: weight as TagWeight }))

      pendingSaveRef.current = inputs
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        void flushSave(pendingSaveRef.current ?? [])
      }, SAVE_DEBOUNCE_MS)
    },
    [flushSave]
  )

  useEffect(
    () => () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current)
    },
    []
  )

  const handleCycle = useCallback(
    (tagId: string) => {
      setWeights((prev) => {
        const next = { ...prev, [tagId]: cycleTagWeight(prev[tagId] ?? 0) }
        scheduleSave(next)
        return next
      })
    },
    [scheduleSave]
  )

  const activeCount = useMemo(
    () => Object.values(weights).filter((w) => w !== 0).length,
    [weights]
  )

  if (!CONTENT_TAGS_ENABLED) return null

  const loading = catalogLoading || prefsLoading

  return (
    <div
      className={cn(
        'rounded-2xl border border-violet-500/25 bg-violet-950/20 px-4 py-4 ring-1 ring-violet-500/10',
        className
      )}
    >
      <div className="mb-3 flex items-start gap-3">
        <span
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-200"
          aria-hidden
        >
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-zinc-50">
            {t('contentTags.tasteTitle', { name: device.name })}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">{t('contentTags.tasteHint')}</p>
        </div>
        {saving || loading ? (
          <LoadingSpinner className="h-5 w-5 shrink-0 border-2 border-violet-300 border-t-transparent" />
        ) : null}
      </div>

      {loading && catalog.length === 0 ? (
        <p className="text-sm text-zinc-500">{t('common.loading')}</p>
      ) : (
        <>
          <TagChipBar tags={catalog} weights={weights} onCycleWeight={handleCycle} disabled={saving} />
          <p className="mt-3 text-xs text-zinc-500">
            {activeCount === 0
              ? t('contentTags.tasteEmpty')
              : t('contentTags.tasteActiveCount', { count: activeCount })}
          </p>
        </>
      )}
    </div>
  )
}
