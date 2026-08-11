import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, Tv, ListMusic, Settings, Tablet } from 'lucide-react'
import { juicyPressableClass, useJuicyPointerBurst, useJuicyUiEnabled } from '../../contexts/JuicyUiContext'
import { cn } from '../../lib/utils'
import { useKidDeviceTokenPresent } from '../../hooks/useKidDeviceTokenPresent'
import { LongPressNavButton } from './LongPressNavButton'

export function BottomNav() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const hasKidToken = useKidDeviceTokenPresent()
  const juicy = useJuicyUiEnabled()
  const juicyBurst = useJuicyPointerBurst()

  const parentNavDiscreet = hasKidToken

  return (
    <nav
      className="bottom-nav fixed bottom-0 inset-x-0 z-40 border-t border-yt-border bg-yt-bg/95 pb-[max(0.5rem,var(--sab))] backdrop-blur-md md:hidden"
      aria-label={t('nav.mainNavAria')}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {parentNavDiscreet ? (
          <LongPressNavButton
            to="/dashboard"
            label={t('nav.parentControl')}
            icon={ShieldCheck}
            isActive={pathname === '/dashboard'}
          />
        ) : (
          <NavLink
            to="/dashboard"
            onClick={(e) => {
              if (pathname === '/dashboard') {
                e.preventDefault()
              }
            }}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition',
                isActive ? 'text-yt-text' : 'text-yt-textMuted'
              )
            }
          >
            <ShieldCheck className="h-6 w-6" aria-hidden />
            {t('nav.parentControl')}
          </NavLink>
        )}

        <NavLink
          to="/channels"
          onPointerDown={juicy ? juicyBurst : undefined}
          onClick={(e) => {
            if (pathname === '/channels') {
              e.preventDefault()
            }
          }}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium',
              juicyPressableClass(juicy, isActive ? 'text-yt-text' : 'text-yt-textMuted')
            )
          }
        >
          <Tv className="h-6 w-6" aria-hidden />
          {t('nav.channels')}
        </NavLink>

        {parentNavDiscreet ? (
          <LongPressNavButton
            to="/playlists"
            label={t('nav.playlists')}
            icon={ListMusic}
            isActive={pathname === '/playlists'}
          />
        ) : (
          <NavLink
            to="/playlists"
            onClick={(e) => {
              if (pathname === '/playlists') {
                e.preventDefault()
              }
            }}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition',
                isActive ? 'text-yt-text' : 'text-yt-textMuted'
              )
            }
          >
            <ListMusic className="h-6 w-6" aria-hidden />
            {t('nav.playlists')}
          </NavLink>
        )}

        {hasKidToken ? (
          <NavLink
            to="/kid"
            onPointerDown={juicyBurst}
            onClick={(e) => {
              if (pathname === '/kid') {
                e.preventDefault()
              }
            }}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium',
                juicyPressableClass(true, isActive ? 'text-yt-text' : 'text-yt-textMuted')
              )
            }
          >
            <Tablet className="h-6 w-6" aria-hidden />
            {t('nav.kid')}
          </NavLink>
        ) : null}

        {parentNavDiscreet ? (
          <LongPressNavButton
            to="/settings"
            label={t('nav.settings')}
            icon={Settings}
            isActive={pathname === '/settings'}
          />
        ) : (
          <NavLink
            to="/settings"
            onClick={(e) => {
              if (pathname === '/settings') {
                e.preventDefault()
              }
            }}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition',
                isActive ? 'text-yt-text' : 'text-yt-textMuted'
              )
            }
          >
            <Settings className="h-6 w-6" aria-hidden />
            {t('nav.settings')}
          </NavLink>
        )}
      </div>
    </nav>
  )
}
