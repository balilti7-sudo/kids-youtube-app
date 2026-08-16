import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { useChannels } from '../../hooks/useChannels'
import { useDeviceStore } from '../../stores/deviceStore'
import { isProfileParentPinMissing } from '../../lib/parentPin'
import { setSkipParentalManagementGateOnce } from '../../lib/parentalGateSkipOnce'
import { searchYouTubeChannels } from '../../lib/youtube'
import type { YouTubeChannelResult, WhitelistedChannel } from '../../types'
import { SafeTubeLogo } from '../branding/SafeTubeLogo'
import { OnboardingStepper } from './OnboardingStepper'
import { ChannelCard } from '../channels/ChannelCard'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { ErrorState } from '../ui/ErrorState'

type Phase = 'action' | 'value'

/**
 * Steps 2–3 after email auth:
 * - Auto-create a default child profile
 * - Search & approve a first channel (core value)
 * - Show success + optional PIN later
 */
export function OnboardingFlow() {
  const { t } = useTranslation()
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const { ownerUserId } = useDeviceOwnerId()
  const { devices, loading: devicesLoading, refetch } = useDevices(ownerUserId)
  const addDevice = useDeviceStore((s) => s.addDevice)

  const [phase, setPhase] = useState<Phase>('action')
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [results, setResults] = useState<YouTubeChannelResult[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const [finishing, setFinishing] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const bootstrapTried = useRef(false)

  const { whitelist, addToWhitelist, loadWhitelist } = useChannels(
    deviceId ?? undefined,
    user?.id ?? ownerUserId
  )

  const ensureProfile = useCallback(async () => {
    if (!user || !ownerUserId) return
    setBootError(null)
    try {
      if (devices.length > 0) {
        setDeviceId(devices[0]!.id)
        return
      }
      const { data, error } = await addDevice({
        userId: ownerUserId,
        name: t('onboarding.defaultChildName'),
        device_type: 'tablet',
      })
      if (error) throw error
      if (!data?.id) throw new Error(t('onboarding.profileCreateFailed'))
      await refetch()
      setDeviceId(data.id)
    } catch (e) {
      setBootError(e instanceof Error ? e.message : t('onboarding.profileCreateFailed'))
    } finally {
      setBootstrapping(false)
    }
  }, [addDevice, devices, ownerUserId, refetch, t, user])

  useEffect(() => {
    if (bootstrapTried.current) return
    if (devicesLoading) return
    if (!user || !ownerUserId) return
    bootstrapTried.current = true
    void ensureProfile()
  }, [devicesLoading, ensureProfile, ownerUserId, user])

  useEffect(() => {
    if (deviceId) void loadWhitelist()
  }, [deviceId, loadWhitelist])

  useEffect(() => {
    if (phase !== 'action' || bootstrapping || bootError) return
    const tFocus = window.setTimeout(() => searchRef.current?.focus(), 120)
    return () => window.clearTimeout(tFocus)
  }, [phase, bootstrapping, bootError])

  useEffect(() => {
    if (whitelist.length === 0) return
    setAddedIds((prev) => {
      const next = new Set(prev)
      for (const ch of whitelist) next.add(ch.youtube_channel_id)
      return next
    })
  }, [whitelist])

  useEffect(() => {
    if (bootstrapping || bootError || phase !== 'action') return
    if (whitelist.length > 0 && !hasSearched) setPhase('value')
  }, [bootstrapping, bootError, phase, whitelist.length, hasSearched])

  const runSearch = async () => {
    const trimmed = q.trim()
    if (!trimmed) return
    setHasSearched(true)
    setSearching(true)
    setSearchError(null)
    try {
      const { data, error } = await searchYouTubeChannels(trimmed)
      if (error) {
        setSearchError(error.message)
        setResults([])
        return
      }
      setResults(data ?? [])
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : t('errors.generic'))
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const handleAdd = async (channel: YouTubeChannelResult) => {
    if (!deviceId) return
    setAddingId(channel.channelId)
    setAddedIds((prev) => new Set(prev).add(channel.channelId))
    try {
      const { error } = await addToWhitelist(channel, null)
      if (error) {
        setAddedIds((prev) => {
          const next = new Set(prev)
          next.delete(channel.channelId)
          return next
        })
        toast.error(error.message)
        return
      }
      toast.success(t('onboarding.channelAddedToast', { name: channel.title }))
      setPhase('value')
    } finally {
      setAddingId(null)
    }
  }

  const finish = async (opts?: { goPin?: boolean; goKid?: boolean }) => {
    if (!user) return
    setFinishing(true)
    try {
      await supabase.from('profiles').update({ onboarding_done: true }).eq('id', user.id)
      await refreshProfile()
      setSkipParentalManagementGateOnce()
      if (opts?.goPin && isProfileParentPinMissing(profile)) {
        navigate('/set-parent-pin', { replace: true })
        return
      }
      if (opts?.goKid) {
        navigate('/kid', { replace: true })
        return
      }
      navigate('/dashboard', { replace: true })
    } finally {
      setFinishing(false)
    }
  }

  const stepper =
    phase === 'action'
      ? ([
          { label: t('onboarding.stepAuthLabel'), status: 'done' as const },
          { label: t('onboarding.stepActionLabel'), status: 'current' as const },
          { label: t('onboarding.stepValueLabel'), status: 'upcoming' as const },
        ] as const)
      : ([
          { label: t('onboarding.stepAuthLabel'), status: 'done' as const },
          { label: t('onboarding.stepActionLabel'), status: 'done' as const },
          { label: t('onboarding.stepValueLabel'), status: 'current' as const },
        ] as const)

  const approved: WhitelistedChannel[] = whitelist

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-3 px-3 pb-8 pt-4 xs:px-4 sm:gap-4 sm:pb-10 sm:pt-6">
      <OnboardingStepper steps={[...stepper]} />

      <div className="app-floating-surface flex flex-1 flex-col p-4 sm:p-5">
        <SafeTubeLogo size="md" className="mb-2" />

        {phase === 'action' ? (
          <>
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">
              {t('onboarding.actionTitle')}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">{t('onboarding.actionLead')}</p>

            {bootstrapping || devicesLoading ? (
              <div className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-zinc-500">
                <LoadingSpinner className="h-6 w-6 border-2" />
                {t('onboarding.preparingProfile')}
              </div>
            ) : bootError ? (
              <ErrorState message={bootError} onRetry={() => {
                bootstrapTried.current = false
                setBootstrapping(true)
                void ensureProfile()
              }} />
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void runSearch()
                  }}
                >
                  <div className="relative min-w-0 flex-1">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                      aria-hidden
                    />
                    <Input
                      ref={searchRef}
                      dir="auto"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder={t('onboarding.searchPlaceholder')}
                      className="ps-10"
                      enterKeyHint="search"
                      aria-label={t('onboarding.searchPlaceholder')}
                    />
                  </div>
                  <Button type="submit" disabled={searching || !q.trim()} className="min-w-[7rem] shrink-0">
                    {searching ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
                    {t('onboarding.searchCta')}
                  </Button>
                </form>

                {searchError ? <ErrorState message={searchError} onRetry={() => void runSearch()} /> : null}

                {hasSearched && !searching && results.length === 0 && !searchError ? (
                  <p className="rounded-xl border border-dashed border-zinc-300 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
                    {t('onboarding.noResults')}
                  </p>
                ) : null}

                <ul className="flex flex-col gap-2">
                  {results.map((c) => (
                    <li key={c.channelId}>
                      <ChannelCard
                        variant="search"
                        channel={c}
                        onAdd={() => void handleAdd(c)}
                        adding={addingId === c.channelId}
                        added={addedIds.has(c.channelId)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-brand-600" aria-hidden />
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">
                  {t('onboarding.valueTitle')}
                </h1>
                <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">{t('onboarding.valueLead')}</p>
              </div>
            </div>

            <ul className="mt-4 flex flex-col gap-2" aria-label={t('onboarding.approvedListAria')}>
              {approved.length === 0 ? (
                <li className="rounded-xl border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-700">
                  {t('onboarding.approvedEmpty')}
                </li>
              ) : (
                approved.map((ch) => (
                  <li
                    key={ch.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/60"
                  >
                    {ch.channel_thumbnail ? (
                      <img
                        src={ch.channel_thumbnail}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-lg object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-11 w-11 shrink-0 rounded-lg bg-zinc-200 dark:bg-zinc-800" aria-hidden />
                    )}
                    <span className="min-w-0 truncate font-semibold text-slate-900 dark:text-zinc-100">
                      {ch.channel_name}
                    </span>
                  </li>
                ))
              )}
            </ul>

            <div className="mt-5 flex flex-col gap-2">
              <Button
                type="button"
                className="w-full text-base font-bold"
                disabled={finishing}
                onClick={() => void finish()}
              >
                {finishing ? t('onboarding.saving') : t('onboarding.finishToDashboard')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={finishing}
                onClick={() => void finish({ goKid: true })}
              >
                {t('onboarding.openKidMode')}
              </Button>
              {isProfileParentPinMissing(profile) ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={finishing}
                  onClick={() => void finish({ goPin: true })}
                >
                  {t('onboarding.setPinOptional')}
                </Button>
              ) : null}
              <button
                type="button"
                className="min-h-12 text-sm font-semibold text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
                disabled={finishing}
                onClick={() => setPhase('action')}
              >
                {t('onboarding.addAnotherChannel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
