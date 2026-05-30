import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { LionOutfitId } from '../data/lionOutfits'
import {
  awardLionXp,
  ensureDefaultLionProgression,
  formatLionProgressLabel,
  LION_PROGRESSION_CHANGED_EVENT,
  readLionProgression,
  writeActiveOutfitId,
  XP_PER_LEVEL,
  type AwardXpResult,
  type LionProgressionState,
} from '../lib/lionProgression'
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
  const [state, setState] = useState<LionProgressionState>(() => readLionProgression())
  const [closetOpen, setClosetOpen] = useState(false)
  const [levelUpLevel, setLevelUpLevel] = useState<number | null>(null)

  const sync = useCallback(() => {
    setState(readLionProgression())
  }, [])

  useEffect(() => {
    ensureDefaultLionProgression()
    sync()
    const onChange = () => sync()
    window.addEventListener(LION_PROGRESSION_CHANGED_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(LION_PROGRESSION_CHANGED_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [sync])

  const equipOutfit = useCallback(
    (outfitId: LionOutfitId) => {
      writeActiveOutfitId(outfitId)
      sync()
    },
    [sync]
  )

  const awardXpHandler = useCallback(
    (amount: number) => {
      const result = awardLionXp(amount)
      sync()
      return result
    },
    [sync]
  )

  const showLevelUp = useCallback((level: number) => {
    setLevelUpLevel(level)
  }, [])

  const value = useMemo(
    (): LionProgressionContextValue => ({
      level: state.level,
      xp: state.xp,
      activeOutfitId: state.activeOutfitId,
      progressLabel: formatLionProgressLabel(state.level, state.xp),
      xpPercent: Math.min(100, (state.xp / XP_PER_LEVEL) * 100),
      closetOpen,
      openCloset: () => setClosetOpen(true),
      closeCloset: () => setClosetOpen(false),
      equipOutfit,
      awardXp: awardXpHandler,
      showLevelUp,
    }),
    [state, closetOpen, equipOutfit, awardXpHandler, showLevelUp]
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
