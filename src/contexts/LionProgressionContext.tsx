import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { LionOutfitId } from '../data/lionOutfits'
import { sanitizeActiveOutfitId } from '../data/lionOutfits'
import { getSavedChildAccessToken } from '../lib/childDevice'
import {
  formatLionProgressLabel,
  XP_PER_LEVEL,
  type AwardXpResult,
} from '../lib/lionProgression'
import { childAwardRaffleTicket } from '../lib/childRuntime'
import { useChildRuntimeOptional } from './ChildRuntimeContext'
import { LionClosetModal } from '../components/kid/LionClosetModal'
import { LionLevelUpFlash } from '../components/kid/LionLevelUpFlash'

type LionProgressionContextValue = {
  level: number
  xp: number
  activeOutfitId: LionOutfitId
  progressLabel: string
  xpPercent: number
  closetOpen: boolean
  openCloset: () => void
  closeCloset: () => void
  equipOutfit: (outfitId: LionOutfitId) => void
  awardXp: (amount: number) => AwardXpResult
  showLevelUp: (level: number) => void
}

const LionProgressionContext = createContext<LionProgressionContextValue | null>(null)

type Props = {
  children: ReactNode
}

export function LionProgressionProvider({ children }: Props) {
  const runtime = useChildRuntimeOptional()
  const server = runtime?.effectiveRuntime
  const [closetOpen, setClosetOpen] = useState(false)
  const [levelUpLevel, setLevelUpLevel] = useState<number | null>(null)

  const level = server?.lionLevel ?? 1
  const xp = server?.lionXp ?? 0
  const activeOutfitId = sanitizeActiveOutfitId(server?.lionActiveOutfit ?? 'cub', level)

  const equipOutfit = useCallback(
    (outfitId: LionOutfitId) => {
      if (runtime) {
        void runtime.equipLionOutfit(outfitId)
        return
      }
    },
    [runtime]
  )

  const awardXpHandler = useCallback(
    (amount: number): AwardXpResult => {
      // XP is awarded server-side on intercept complete; this is a UI-only fallback.
      return {
        level,
        xp,
        activeOutfitId,
        leveledUp: false,
        levelsGained: 0,
        xpGained: amount,
      }
    },
    [level, xp, activeOutfitId]
  )

  const showLevelUp = useCallback(
    (nextLevel: number) => {
      const token = getSavedChildAccessToken()
      if (token) {
        void childAwardRaffleTicket(token, 'lion_level_up', `level_${nextLevel}`).then((res) => {
          if (res.error) {
            console.warn('[LionProgression] raffle award failed', res.error.message)
            return
          }
          void runtime?.refreshRaffleSummary()
        })
      }
      setLevelUpLevel(nextLevel)
    },
    [runtime]
  )

  const value = useMemo(
    (): LionProgressionContextValue => ({
      level,
      xp,
      activeOutfitId,
      progressLabel: formatLionProgressLabel(level, xp),
      xpPercent: Math.min(100, (xp / XP_PER_LEVEL) * 100),
      closetOpen,
      openCloset: () => setClosetOpen(true),
      closeCloset: () => setClosetOpen(false),
      equipOutfit,
      awardXp: awardXpHandler,
      showLevelUp,
    }),
    [level, xp, activeOutfitId, closetOpen, equipOutfit, awardXpHandler, showLevelUp]
  )

  return (
    <LionProgressionContext.Provider value={value}>
      {children}
      <LionClosetModal open={closetOpen} onClose={() => setClosetOpen(false)} />
      {levelUpLevel != null ? (
        <LionLevelUpFlash level={levelUpLevel} onDone={() => setLevelUpLevel(null)} />
      ) : null}
    </LionProgressionContext.Provider>
  )
}

export function useLionProgression() {
  const ctx = useContext(LionProgressionContext)
  if (!ctx) throw new Error('useLionProgression must be used within LionProgressionProvider')
  return ctx
}

export function useLionProgressionOptional() {
  return useContext(LionProgressionContext)
}
