/**
 * DEV-only visual gallery for UI design screenshots.
 * Visit /dev/ui-gallery or /dev/ui-gallery?shot=<id>
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AuthScreen } from '../components/auth/AuthScreen'
import { SplashScreen } from '../components/branding/SplashScreen'
import { RemoveChannelModal } from '../components/channels/RemoveChannelModal'
import { ParentalPinModal } from '../components/parental/ParentalPinModal'
import { ParentalForgotPinModal } from '../components/parental/ParentalForgotPinModal'
import { ScreenTimeLockedOverlay } from '../components/kid/ScreenTimeLockedOverlay'
import { ScreenTimeGiftChallengeModal } from '../components/kid/ScreenTimeGiftChallengeModal'
import { DailyLimitOverlay } from '../components/kid/DailyLimitOverlay'
import { LionLevelUpFlash } from '../components/kid/LionLevelUpFlash'
import { LionClosetModal } from '../components/kid/LionClosetModal'
import { LionProgressionProvider } from '../contexts/LionProgressionContext'
import { PlayerErrorOverlay } from '../components/player/PlayerErrorOverlay'
import { UpcomingLiveLionOverlay } from '../components/player/UpcomingLiveLionOverlay'
import { ChannelContentTabs, type ChannelContentTab } from '../components/youtube/ChannelContentTabs'
import { YoutubeLikeButton } from '../components/youtube/YoutubeLikeButton'
import { YoutubeVideoCard } from '../components/youtube/YoutubeVideoCard'
import { YoutubeWatchVideoDetails } from '../components/youtube/YoutubeWatchVideoDetails'
import { YoutubeWatchLayout } from '../components/youtube/YoutubeWatchLayout'
import { YoutubeSuggestedList } from '../components/youtube/YoutubeSuggestedList'
import { ChannelVideoBrowseRows } from '../components/kid/ChannelVideoBrowseRows'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'
import { ErrorBoundary } from '../components/ErrorBoundary'
import type { WatchableVideoBase } from '../lib/videoFormatClassification'

const noop = () => undefined
const pinNever = async () => ({ ok: false as const, errorMessage: 'קוד שגוי (תצוגת עיצוב)' })

const SAMPLE_VIDEOS: WatchableVideoBase[] = [
  {
    youtube_video_id: 'dQw4w9WgXcQ',
    title: 'סרטון לדוגמה — חינוכי לילדים',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    durationSeconds: 212,
    watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    format: 'long',
    viewCount: 1_240_000,
    likeCount: 48_200,
    liveBroadcastContent: 'none',
  },
  {
    youtube_video_id: 'aaaaaaaaaaa',
    title: 'Shorts לדוגמה #shorts',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    durationSeconds: 45,
    watchUrl: 'https://www.youtube.com/shorts/aaaaaaaaaaa',
    format: 'short',
    viewCount: 88_000,
    likeCount: 3200,
    liveBroadcastContent: 'none',
  },
  {
    youtube_video_id: 'bbbbbbbbbbb',
    title: 'שידור חי — LIVE עם החברים',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    durationSeconds: null,
    watchUrl: 'https://www.youtube.com/watch?v=bbbbbbbbbbb',
    format: 'long',
    viewCount: 1200,
    likeCount: 90,
    liveBroadcastContent: 'live',
  },
]

type Shot = { id: string; title: string; render: () => ReactNode }

function PhoneFrame({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <div
      className={`mx-auto flex min-h-dvh w-full max-w-[390px] flex-col overflow-hidden border-x border-zinc-800 ${
        dark ? 'bg-yt-bg text-yt-text' : 'bg-slate-50 text-slate-900'
      }`}
      data-shot-frame="1"
    >
      {children}
    </div>
  )
}

function GalleryIndex({ shots }: { shots: Shot[] }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8" dir="ltr">
      <h1 className="text-2xl font-bold text-zinc-100">SafeTube UI gallery (DEV)</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Open each shot for a full-viewport PNG capture. Used by scripts/capture-ui-screenshots.mjs
      </p>
      <ul className="mt-6 space-y-2">
        {shots.map((s) => (
          <li key={s.id}>
            <a className="text-sky-400 underline" href={`/dev/ui-gallery?shot=${encodeURIComponent(s.id)}`}>
              {s.id} — {s.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function WatchChromeDemo() {
  const [tab, setTab] = useState<ChannelContentTab>('home')
  return (
    <PhoneFrame dark>
      <div className="p-3">
        <ChannelContentTabs value={tab} onChange={setTab} showShortsTab />
      </div>
      <YoutubeWatchLayout
        className="px-2"
        main={
          <div>
            <div className="aspect-video w-full rounded-lg bg-zinc-800" />
            <YoutubeWatchVideoDetails
              title={SAMPLE_VIDEOS[0].title}
              channelName="ערוץ לדוגמה"
              subtitle="1.2M צפיות"
              actions={
                <>
                  <YoutubeLikeButton videoId={SAMPLE_VIDEOS[0].youtube_video_id} likeCount={48200} />
                  <Button variant="secondary" className="rounded-full text-xs">
                    הוסף לפלייליסט
                  </Button>
                </>
              }
            />
          </div>
        }
        sidebar={
          <YoutubeSuggestedList title="סרטונים מומלצים">
            {SAMPLE_VIDEOS.map((v) => (
              <li key={v.youtube_video_id}>
                <YoutubeVideoCard
                  layout="row"
                  title={v.title}
                  thumbnail={v.thumbnail_url}
                  metadata={`${(v.viewCount ?? 0).toLocaleString()} צפיות`}
                />
              </li>
            ))}
          </YoutubeSuggestedList>
        }
      />
    </PhoneFrame>
  )
}

function BrowseTabsDemo() {
  return (
    <PhoneFrame dark>
      <div className="p-2">
        <h2 className="mb-2 px-1 text-lg font-black text-zinc-50">ערוץ לדוגמה</h2>
        <ChannelVideoBrowseRows videos={SAMPLE_VIDEOS} allowShorts onSelectVideo={noop} />
      </div>
    </PhoneFrame>
  )
}

function KidBlockedDemo() {
  return (
    <PhoneFrame dark>
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="rounded-3xl border border-red-500/40 bg-red-950/40 p-6">
          <p className="text-lg font-black text-red-100">הצפייה חסומה</p>
          <p className="mt-2 text-sm text-red-200/80">בקשו מההורה לבטל את החסימה בפרופיל.</p>
        </div>
      </div>
    </PhoneFrame>
  )
}

function ParentHubDemo() {
  return (
    <PhoneFrame>
      <div className="flex min-h-dvh flex-col gap-3 p-4" dir="rtl">
        <h1 className="text-xl font-black">אזור הורים (מקומי)</h1>
        <Button className="w-full">לוח בקרה</Button>
        <Button className="w-full" variant="secondary">
          ערוצים
        </Button>
        <Button className="w-full" variant="secondary">
          נעילה
        </Button>
        <Button className="w-full" variant="danger">
          יציאה ממצב ילד
        </Button>
      </div>
    </PhoneFrame>
  )
}

function SettingsAboutDemo() {
  return (
    <>
      <PhoneFrame>
        <div className="p-4" dir="rtl">
          <h1 className="text-xl font-bold">הגדרות</h1>
          <p className="mt-2 text-sm text-slate-500">פרופיל · קוד הורה · סרטונים מוסתרים · מנוי</p>
        </div>
      </PhoneFrame>
      <Modal open onClose={noop} title="אודות SafeTube" footer={<Button onClick={noop}>סגור</Button>}>
        <p className="text-sm text-slate-600 dark:text-zinc-300">
          SafeTube עוזר להורים לשלוט ב-YouTube לילדים — ערוצים מאושרים בלבד, בלי תגובות ובלי קהילה.
        </p>
      </Modal>
    </>
  )
}

function ExitKidPinDemo() {
  return (
    <>
      <PhoneFrame dark>
        <div className="flex min-h-dvh items-center justify-center text-zinc-500">רקע מצב ילד</div>
      </PhoneFrame>
      <Modal
        open
        onClose={noop}
        title="יציאה ממצב ילד"
        footer={
          <>
            <Button variant="secondary" onClick={noop}>
              ביטול
            </Button>
            <Button variant="danger" onClick={noop}>
              אישור יציאה
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-zinc-400">הזינו את קוד ההורה כדי לצאת ממצב ילד.</p>
      </Modal>
    </>
  )
}

export function DevUiGalleryPage() {
  const [params] = useSearchParams()
  const shotId = params.get('shot')

  const shots: Shot[] = useMemo(
    () => [
      { id: 'splash', title: 'Splash screen', render: () => <SplashScreen /> },
      { id: 'auth', title: 'Auth login/register', render: () => <AuthScreen /> },
      {
        id: 'parental-pin-modal',
        title: 'Parental PIN modal',
        render: () => (
          <PhoneFrame dark>
            <div className="min-h-dvh bg-zinc-950" />
            <ParentalPinModal open onClose={noop} onVerified={noop} verifyPin={pinNever} />
          </PhoneFrame>
        ),
      },
      {
        id: 'forgot-pin-modal',
        title: 'Forgot PIN modal',
        render: () => (
          <PhoneFrame>
            <div className="min-h-dvh" />
            <ParentalForgotPinModal open onClose={noop} defaultEmail="parent@example.com" />
          </PhoneFrame>
        ),
      },
      {
        id: 'remove-channel-modal',
        title: 'Remove channel confirm',
        render: () => (
          <PhoneFrame>
            <div className="min-h-dvh p-4" dir="rtl">
              <p className="text-sm text-slate-500">רשימת ערוצים…</p>
            </div>
            <RemoveChannelModal
              open
              channel={
                {
                  id: '1',
                  youtube_channel_id: 'UCxxxx',
                  channel_name: 'ערוץ לדוגמה',
                  channel_thumbnail: null,
                  device_id: 'd1',
                } as never
              }
              onClose={noop}
              onConfirm={noop}
            />
          </PhoneFrame>
        ),
      },
      {
        id: 'add-profile-modal',
        title: 'Add profile modal',
        render: () => (
          <>
            <PhoneFrame>
              <div className="min-h-dvh p-4" dir="rtl">
                <h1 className="font-bold">לוח בקרה</h1>
              </div>
            </PhoneFrame>
            <Modal
              open
              onClose={noop}
              title="הוספת פרופיל ילד"
              footer={
                <>
                  <Button variant="secondary">ביטול</Button>
                  <Button>שמירה</Button>
                </>
              }
            >
              <label className="block text-sm">
                שם הפרופיל
                <input className="mt-1 w-full rounded-lg border px-3 py-2" defaultValue="ילד/ה" />
              </label>
            </Modal>
          </>
        ),
      },
      {
        id: 'channel-add-success',
        title: 'Channel added success',
        render: () => (
          <>
            <PhoneFrame>
              <div className="min-h-dvh" />
            </PhoneFrame>
            <Modal
              open
              onClose={noop}
              title="הערוץ נוסף"
              footer={
                <>
                  <Button variant="secondary">הוסף עוד</Button>
                  <Button>סיום</Button>
                </>
              }
            >
              <p className="text-sm">הערוץ נוסף לרשימה המאושרת בהצלחה.</p>
            </Modal>
          </>
        ),
      },
      {
        id: 'settings-about-modal',
        title: 'Settings About modal',
        render: () => <SettingsAboutDemo />,
      },
      {
        id: 'exit-kid-pin-modal',
        title: 'Exit kid mode PIN modal',
        render: () => <ExitKidPinDemo />,
      },
      {
        id: 'screen-time-locked',
        title: 'Screen time locked overlay',
        render: () => (
          <PhoneFrame dark>
            <div className="relative min-h-dvh">
              <ScreenTimeLockedOverlay />
            </div>
          </PhoneFrame>
        ),
      },
      {
        id: 'gift-challenge',
        title: 'Screen-time gift challenge',
        render: () => (
          <PhoneFrame dark>
            <div className="min-h-dvh bg-zinc-950" />
            <ScreenTimeGiftChallengeModal task="ספרו עד 10 לאט לאט" onChallengeComplete={noop} />
          </PhoneFrame>
        ),
      },
      {
        id: 'daily-limit',
        title: 'Daily watch limit overlay',
        render: () => (
          <LionProgressionProvider>
            <PhoneFrame dark>
              <div className="relative min-h-dvh bg-black">
                <DailyLimitOverlay />
              </div>
            </PhoneFrame>
          </LionProgressionProvider>
        ),
      },
      {
        id: 'upcoming-live',
        title: 'Upcoming live overlay',
        render: () => (
          <LionProgressionProvider>
            <PhoneFrame dark>
              <div className="relative aspect-[9/16] w-full bg-black">
                <UpcomingLiveLionOverlay />
              </div>
            </PhoneFrame>
          </LionProgressionProvider>
        ),
      },
      {
        id: 'player-error',
        title: 'Player error overlay',
        render: () => (
          <LionProgressionProvider>
            <PhoneFrame dark>
              <div className="relative aspect-[9/16] w-full bg-black">
                <PlayerErrorOverlay onRetry={noop} />
              </div>
            </PhoneFrame>
          </LionProgressionProvider>
        ),
      },
      {
        id: 'lion-level-up',
        title: 'Lion level-up flash',
        render: () => (
          <PhoneFrame dark>
            <div className="relative min-h-dvh bg-black">
              <LionLevelUpFlash level={3} onDone={noop} />
            </div>
          </PhoneFrame>
        ),
      },
      {
        id: 'lion-closet',
        title: 'Lion closet modal',
        render: () => (
          <LionProgressionProvider>
            <PhoneFrame dark>
              <div className="min-h-dvh bg-zinc-950" />
              <LionClosetModal open onClose={noop} />
            </PhoneFrame>
          </LionProgressionProvider>
        ),
      },
      { id: 'watch-chrome', title: 'YouTube watch chrome + likes/views', render: () => <WatchChromeDemo /> },
      { id: 'channel-tabs-browse', title: 'Channel tabs Home/Videos/Shorts/Live', render: () => <BrowseTabsDemo /> },
      { id: 'kid-blocked', title: 'Kid viewing blocked', render: () => <KidBlockedDemo /> },
      { id: 'kid-parent-hub', title: 'Kid local parent hub', render: () => <ParentHubDemo /> },
      {
        id: 'error-boundary',
        title: 'Error boundary fallback',
        render: () => (
          <PhoneFrame>
            <ErrorBoundary>
              <ThrowOnPurpose />
            </ErrorBoundary>
          </PhoneFrame>
        ),
      },
      {
        id: 'hidden-unblock-all',
        title: 'Unblock all hidden videos confirm',
        render: () => (
          <>
            <PhoneFrame>
              <div className="min-h-dvh p-4" dir="rtl">
                <h1 className="font-bold">סרטונים מוסתרים</h1>
              </div>
            </PhoneFrame>
            <Modal
              open
              onClose={noop}
              title="שחרור הכל"
              footer={
                <>
                  <Button variant="secondary">ביטול</Button>
                  <Button variant="danger">שחרר הכל</Button>
                </>
              }
            >
              <p className="text-sm">לשחרר את כל הסרטונים המוסתרים בפרופיל הזה?</p>
            </Modal>
          </>
        ),
      },
    ],
    []
  )

  if (!import.meta.env.DEV) {
    return (
      <div className="p-8 text-center text-zinc-400">
        UI gallery is available only in development builds.
      </div>
    )
  }

  if (!shotId) return <GalleryIndex shots={shots} />

  const shot = shots.find((s) => s.id === shotId)
  if (!shot) {
    return (
      <div className="p-8 text-zinc-300">
        Unknown shot “{shotId}”. <a href="/dev/ui-gallery">Back</a>
      </div>
    )
  }

  return (
    <div data-shot={shot.id} data-shot-title={shot.title} className="min-h-dvh bg-black">
      {shot.render()}
    </div>
  )
}

function ThrowOnPurpose(): ReactNode {
  throw new Error('שגיאת הדגמה לעיצוב')
}
