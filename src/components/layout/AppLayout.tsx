import { useEffect, useLayoutEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { BYPASS_AUTH } from '../../config/dev'
import { LOCK_MANAGEMENT_APP_EVENT } from '../../lib/lockParentApp'
import { consumeSkipParentalManagementGateOnce } from '../../lib/parentalGateSkipOnce'
import {
  isParentalManagementGateUnlocked,
  setParentalManagementGateUnlocked,
} from '../../lib/parentalManagementGateStorage'
import { ParentalManagementGate } from '../parental/ParentalManagementGate'
import { BottomNav } from './BottomNav'
import { LockAppButton } from './LockAppButton'
import { PageBackBar } from './PageBackBar'
import { SafeTubeBrandMark } from '../branding/SafeTubeBrandMark'
import { ParentAppFooter } from './ParentAppFooter'

export function AppLayout() {
  const [managementUnlocked, setManagementUnlocked] = useState(
    () => BYPASS_AUTH || isParentalManagementGateUnlocked()
  )

  useLayoutEffect(() => {
    if (consumeSkipParentalManagementGateOnce()) {
      setManagementUnlocked(true)
    }
  }, [])

  useEffect(() => {
    if (BYPASS_AUTH) setManagementUnlocked(true)
  }, [])

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

  const showGate = !BYPASS_AUTH && !managementUnlocked

  return (
    <div className="relative flex min-h-dvh flex-col">
      {showGate ? <ParentalManagementGate onUnlocked={handleManagementUnlocked} /> : null}
      {!showGate ? (
        <>
          <main className="safe-pb-nav flex flex-1 justify-center px-2 pt-3 sm:px-3 sm:pt-4">
            <div className="app-floating-surface mx-auto w-full max-w-5xl p-3 sm:p-3.5 lg:p-4">
              <header className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-700/40 pb-2 dark:border-zinc-600/30">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <SafeTubeBrandMark />
                  <div className="min-w-0 flex-1">
                    <PageBackBar flush />
                  </div>
                </div>
                <LockAppButton />
              </header>
              <Outlet />
              <ParentAppFooter />
            </div>
          </main>
          <BottomNav />
        </>
      ) : null}
    </div>
  )
}
