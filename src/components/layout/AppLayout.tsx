import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { BYPASS_AUTH } from '../../config/dev'
import {
  isParentalManagementGateUnlocked,
  setParentalManagementGateUnlocked,
} from '../../lib/parentalManagementGateStorage'
import { ParentalManagementGate } from '../parental/ParentalManagementGate'
import { BottomNav } from './BottomNav'
import { PageBackBar } from './PageBackBar'
import { ParentAppFooter } from './ParentAppFooter'

export function AppLayout() {
  const [managementUnlocked, setManagementUnlocked] = useState(
    () => BYPASS_AUTH || isParentalManagementGateUnlocked()
  )

  useEffect(() => {
    if (BYPASS_AUTH) setManagementUnlocked(true)
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
              <PageBackBar />
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
