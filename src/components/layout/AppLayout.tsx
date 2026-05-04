import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { BYPASS_AUTH } from '../../config/dev'
import { LOCK_MANAGEMENT_APP_EVENT } from '../../lib/lockParentApp'
import {
  isParentalManagementGateUnlocked,
  setParentalManagementGateUnlocked,
} from '../../lib/parentalManagementGateStorage'
import { ParentalManagementGate } from '../parental/ParentalManagementGate'
import { BottomNav } from './BottomNav'
import { LockAppButton } from './LockAppButton'
import { PageBackBar } from './PageBackBar'
import { ParentAppFooter } from './ParentAppFooter'

export function AppLayout() {
  const [managementUnlocked, setManagementUnlocked] = useState(
    () => BYPASS_AUTH || isParentalManagementGateUnlocked()
  )

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
          <main className="safe-pb-nav flex flex-1 justify-center px-3 pt-6 sm:px-4 sm:pt-8">
            <div className="app-floating-surface mx-auto w-full max-w-5xl p-5 sm:p-6 lg:p-7">
              <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-zinc-700/40 pb-4 dark:border-zinc-600/30">
                <div className="min-w-0 flex-1">
                  <PageBackBar flush />
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
