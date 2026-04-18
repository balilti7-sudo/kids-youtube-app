import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { PageBackBar } from './PageBackBar'
import { ParentAppFooter } from './ParentAppFooter'

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="safe-pb-nav flex flex-1 justify-center px-3 pt-6 sm:px-4 sm:pt-8">
        <div className="app-floating-surface mx-auto w-full max-w-lg p-5 sm:p-6">
          <PageBackBar />
          <Outlet />
          <ParentAppFooter />
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
