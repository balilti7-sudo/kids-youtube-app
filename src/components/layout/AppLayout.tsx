import { useEffect, useLayoutEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BYPASS_AUTH } from '../../config/dev'
import { useKidDeviceTokenPresent } from '../../hooks/useKidDeviceTokenPresent'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import { LOCK_MANAGEMENT_APP_EVENT, lockManagementAppShell } from '../../lib/lockParentApp'
import { consumeParentEntryIntent } from '../../lib/parentEntryIntent'
import { isParentManagementLockedPath } from '../../lib/parentManagementPaths'
import { isMediaPlaybackActive } from '../../lib/mediaPlaybackActivity'
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
import { ParentalManagementGate } from '../parental/ParentalManagementGate'
import { BottomNav } from './BottomNav'
import { ThemeToggle } from '../theme/ThemeToggle'
import { PageBackBar } from './PageBackBar'
import { SafeTubeBrandMark } from '../branding/SafeTubeBrandMark'
import { ParentAppFooter } from './ParentAppFooter'
import { ParentManagementBanner } from './ParentManagementBanner'
import { ProfileSwitcher } from './ProfileSwitcher'
import { JuicyUiProvider } from '../../contexts/JuicyUiContext'

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const hasKidDeviceToken = useKidDeviceTokenPresent()
  const [managementUnlocked, setManagementUnlocked] = useState(
    () => BYPASS_AUTH || isParentalManagementGateUnlocked()
  )

  useLayoutEffect(() => {
    if (consumeSkipParentalManagementGateOnce()) {
      touchParentalGateActivity()
      setManagementUnlocked(true)
    }
  }, [])

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
  const showGate = !BYPASS_AUTH && !managementUnlocked && pathRequiresParentUnlock
  const showParentManagementChrome = pathRequiresParentUnlock
  const juicyChildUi = location.pathname === '/channels'

  return (
    <JuicyUiProvider enabled={juicyChildUi}>
    <div className="relative flex min-h-dvh flex-col bg-yt-bg">
      {showGate ? <ParentalManagementGate onUnlocked={handleManagementUnlocked} /> : null}
      {!showGate ? (
        <>
          <main className="safe-pb-nav flex flex-1 flex-col">
            <div className="sticky top-0 z-30">
              {showParentManagementChrome ? <ParentManagementBanner /> : null}
              <header className="border-b border-yt-border bg-yt-bg/95 px-2 py-2 backdrop-blur-md sm:px-4 sm:py-2.5">
              <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-2 gap-y-2 overflow-hidden sm:flex-nowrap sm:gap-x-4">
                <div className="order-1 flex min-w-0 flex-1 items-center sm:order-none">
                  <PageBackBar flush />
                </div>
                <SafeTubeBrandMark
                  discreetParentNav={hasKidDeviceToken}
                  size={showParentManagementChrome ? 'prominent' : 'default'}
                  className="order-3 mx-auto px-0.5 sm:order-none sm:mx-0"
                />
                <div className="order-2 flex min-w-0 flex-1 items-center justify-end gap-1.5 pe-0.5 sm:order-none sm:gap-2 sm:pe-1">
                  <ProfileSwitcher />
                  <ThemeToggle />
                </div>
              </div>
              </header>
            </div>
            <div className="mx-auto w-full max-w-5xl flex-1 px-3 py-4 sm:px-4">
              <Outlet />
              <ParentAppFooter />
            </div>
          </main>
          <BottomNav />
        </>
      ) : null}
    </div>
    </JuicyUiProvider>
  )
}
