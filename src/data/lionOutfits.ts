/** Unlockable lion outfits — level-gated mascot evolution. */

export type LionOutfitId = 'cub' | 'explorer' | 'chef' | 'hero'

export type LionOutfit = {
  id: LionOutfitId
  unlockLevel: number
  title: string
  subtitle: string
  emoji: string
}

export const LION_OUTFITS: LionOutfit[] = [
  {
    id: 'cub',
    unlockLevel: 1,
    title: 'גור אריות חמוד',
    subtitle: 'האריה הרגיל שלך',
    emoji: '🦁',
  },
  {
    id: 'explorer',
    unlockLevel: 2,
    title: 'האריה הסקרן',
    subtitle: 'חוקר טבע — זכוכית מגדלת',
    emoji: '🔍',
  },
  {
    id: 'chef',
    unlockLevel: 4,
    title: 'האריה השף',
    subtitle: 'עוזר במטבח — כובע שף',
    emoji: '👨‍🍳',
  },
  {
    id: 'hero',
    unlockLevel: 6,
    title: 'האריה הגיבור',
    subtitle: 'עושה מעשים טובים — גלימת גיבור',
    emoji: '🦸',
  },
]

export const DEFAULT_LION_OUTFIT_ID: LionOutfitId = 'cub'

export function getLionOutfit(id: LionOutfitId | string | null | undefined): LionOutfit {
  return LION_OUTFITS.find((o) => o.id === id) ?? LION_OUTFITS[0]!
}

export function isOutfitUnlocked(outfit: LionOutfit, level: number): boolean {
  return level >= outfit.unlockLevel
}

export function highestUnlockedOutfitId(level: number): LionOutfitId {
  const unlocked = LION_OUTFITS.filter((o) => isOutfitUnlocked(o, level))
  return unlocked[unlocked.length - 1]?.id ?? 'cub'
}

export function sanitizeActiveOutfitId(raw: string | null, level: number): LionOutfitId {
  const outfit = getLionOutfit(raw)
  if (isOutfitUnlocked(outfit, level)) return outfit.id
  return highestUnlockedOutfitId(level)
}
