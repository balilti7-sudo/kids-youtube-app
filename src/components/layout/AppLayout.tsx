import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BYPASS_AUTH } from '../../config/dev'
import { useAuth } from '../../hooks/useAuth'
import { useKidDeviceTokenPresent } from '../../hooks/useKidDeviceTokenPresent'
import { JuicyUiProvider } from '../../contexts/JuicyUiContext'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import { LOCK_MANAGEMENT_APP_EVENT, lockManagementAppShell } from '../../lib/lockParentApp'
import { consumeParentEntryIntent } from '../../lib/parentEntryIntent'
import { isParentManagementLockedPath } from '../../lib/parentManagementPaths'
import { isMediaPlaybackActive } from '../../lib/mediaPlaybackActivity'
import { isProfileParentPinMissing } from '../../lib/parentPin'
import {
  clearParentalGateActivity,
  isParentalGateIdleExceeded,
  touchParentalGateActivity,
} from '../../lib/parentalGateActivity'
import { consumeSkipParentalManagementGateOnce } from '../../lib/parentalGateSkipOnce'
import {
  clearParentalManagementGate,
  isParentalManagementGateUnlocked,
  setParentalManagementGateUnlocked,
} from '../../lib/parentalManagementGateStorage'
import { usePublishChromeOffset, setChromeVar, subscribeViewportGeometryRefresh } from '../../lib/chromeOffset'
import { ParentalManagementGate } from '../parental/ParentalManagementGate'
import { BottomNav } from './BottomNav'
import { ParentSideNav } from './ParentSideNav'
import { ThemeToggle } from '../theme/ThemeToggle'
import { PageBackBar } from './PageBackBar'
import { SafeTubeBrandMark } from '../branding/SafeTubeBrandMark'
import { ParentManagementBanner } from './ParentManagementBanner'
import { ProfileSwitcher } from './ProfileSwitcher'
import { cn } from '../../lib/utils'

export function AppLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const hasKidDeviceToken = useKidDeviceTokenPresent()
  const pinNotSetYet = isProfileParentPinMissing(profile)
  const [managementUnlocked, setManagementUnlocked] = useState(
    () => BYPASS_AUTH || isParentalManagementGateUnlocked()
  )

  useLayoutEffect(() => {
    if (consumeSkipParentalManagementGateOnce()) {
      touchParentalGateActivity()
      setManagementUnlocked(true)
    }
  }, [])

  /** Until a parent PIN exists, don’t block the shell — PIN is optional after first value. */
  useLayoutEffect(() => {
    if (BYPASS_AUTH || !pinNotSetYet) return
    touchParentalGateActivity()
    setParentalManagementGateUnlocked()
    setManagementUnlocked(true)
  }, [pinNotSetYet])

  /** מכשיר עם טוקן ילד: לא לאפשר דילוג על שער ע״י הקלדת URL — חזרה ל־/kid אם לא אומתו. */
  useLayoutEffect(() => {
    if (BYPASS_AUTH) return
    if (!getSavedChildAccessToken()) return
    if (managementUnlocked) return
    if (!isParentManagementLockedPath(location.pathname)) return
    if (consumeParentEntryIntent()) return
    navigate('/kid', { replace: true })
  }, [location.pathname, managementUnlocked, navigate])

  useEffect(() => {
    if (BYPASS_AUTH) setManagementUnlocked(true)
  }, [])

  useEffect(() => {
    if (BYPASS_AUTH || isParentManagementLockedPath(location.pathname)) return
    clearParentalManagementGate()
    clearParentalGateActivity()
    setManagementUnlocked(false)
  }, [location.pathname])

  useEffect(() => {
    const onLock = () => {
      setManagementUnlocked(false)
    }
    window.addEventListener(LOCK_MANAGEMENT_APP_EVENT, onLock as EventListener)
    return () => window.removeEventListener(LOCK_MANAGEMENT_APP_EVENT, onLock as EventListener)
  }, [])

  const handleManagementUnlocked = () => {
    setParentalManagementGateUnlocked()
    setManagementUnlocked(true)
  }

  useEffect(() => {
    if (BYPASS_AUTH || !managementUnlocked) return
    touchParentalGateActivity()
  }, [location.pathname, managementUnlocked])

  useEffect(() => {
    if (BYPASS_AUTH || !managementUnlocked) return
    const bump = () => touchParentalGateActivity()
    window.addEventListener('pointerdown', bump, { passive: true })
    window.addEventListener('keydown', bump)
    return () => {
      window.removeEventListener('pointerdown', bump)
      window.removeEventListener('keydown', bump)
    }
  }, [managementUnlocked])

  useEffect(() => {
    if (BYPASS_AUTH || !managementUnlocked) return
    const id = window.setInterval(() => {
      if (isMediaPlaybackActive()) {
        touchParentalGateActivity()
        return
      }
      if (!isParentalGateIdleExceeded()) return
      lockManagementAppShell()
      if (getSavedChildAccessToken()) {
        navigate('/kid', { replace: true })
      }
    }, 15_000)
    return () => window.clearInterval(id)
  }, [managementUnlocked, navigate])

  const pathRequiresParentUnlock = isParentManagementLockedPath(location.pathname)
  const showGate =
    !BYPASS_AUTH && !managementUnlocked && pathRequiresParentUnlock && !pinNotSetYet
  const showParentManagementChrome = pathRequiresParentUnlock
  const juicyChildUi = location.pathname === '/channels'

  const shellRef = useRef<HTMLDivElement>(null)
  const chromeTopRef = useRef<HTMLDivElement>(null)
  usePublishChromeOffset(chromeTopRef, shellRef, '--chrome-top', !showGate)

  useLayoutEffect(() => {
    const shell = shellRef.current
    if (!shell) return

    const publishBottom = () => {
      // BottomNav is md:hidden — match .safe-pb-nav phone clearance only.
      const phone = window.matchMedia('(max-width: 767px)').matches
      if (!phone) {
        setChromeVar(shell, '--chrome-bottom', 0)
        return
      }
      const sab = Number.parseFloat(getComputedStyle(shell).getPropertyValue('--sab')) || 0
      // 4.5rem nav row + safe-area bottom (same formula as .safe-pb-nav)
      setChromeVar(shell, '--chrome-bottom', 4.5 * 16 + sab)
    }

    publishBottom()
    return subscribeViewportGeometryRefresh(publishBottom)
  }, [])

  return (
    <JuicyUiProvider enabled={juicyChildUi}>
    <div ref={shellRef} className="relative flex min-h-dvh flex-col bg-yt-bg">
      <a href="#main-content" className="skip-to-content">
        {t('common.skipToContent')}
      </a>
      {showGate ? (
        <ParentalManagementGate
          onUnlocked={handleManagementUnlocked}
          onReturnToWatching={() => {
            navigate('/channels', { replace: true })
          }}
        />
      ) : null}
      {!showGate ? (
        <>
          <div className="flex min-h-0 min-w-0 flex-1">
            <ParentSideNav />
            <main id="main-content" tabIndex={-1} className="safe-pb-nav flex min-w-0 flex-1 flex-col outline-none">
              <div ref={chromeTopRef} className="sticky top-0 z-30">
                {showParentManagementChrome ? <ParentManagementBanner /> : null}
                <header className="border-b border-yt-border bg-yt-bg/95 px-2 py-1.5 backdrop-blur-md xs:py-2 sm:px-4 sm:py-2.5">
                  <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-x-2 gap-y-2 overflow-hidden sm:flex-nowrap sm:gap-x-4">
                    <div className="order-1 flex min-w-0 flex-1 items-center sm:order-none">
                      <PageBackBar flush />
                    </div>
                    <SafeTubeBrandMark
                      discreetParentNav={hasKidDeviceToken}
                      size={showParentManagementChrome ? 'prominent' : 'default'}
                      className="order-3 mx-auto px-0.5 sm:order-none sm:mx-0"
                    />
                    <div className="order-2 flex min-w-0 flex-1 items-center justify-end gap-1 pe-0.5 xs:gap-1.5 sm:order-none sm:gap-2 sm:pe-1">
                      <ProfileSwitcher />
                      <ThemeToggle />
                    </div>
                  </div>
                </header>
              </div>
              <div
                className={cn(
                  'mx-auto w-full flex-1 page-pad-x py-3 sm:py-4',
                  juicyChildUi ? 'max-w-[1754px]' : 'max-w-5xl lg:max-w-6xl xl:max-w-7xl'
                )}
              >
                <Outlet />
              </div>
            </main>
          </div>
          <BottomNav />
        </>
      ) : null}
    </div>
    </JuicyUiProvider>
  )
}
