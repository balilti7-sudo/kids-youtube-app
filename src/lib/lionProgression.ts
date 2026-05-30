import {
  DEFAULT_LION_OUTFIT_ID,
  highestUnlockedOutfitId,
  sanitizeActiveOutfitId,
  type LionOutfitId,
} from '../data/lionOutfits'

export const LION_XP_KEY = 'safetube_lion_xp'
export const LION_LEVEL_KEY = 'safetube_lion_level'
export const LION_ACTIVE_OUTFIT_KEY = 'safetube_lion_active_outfit'
export const LION_PROGRESSION_CHANGED_EVENT = 'safetube-lion-progression-changed'

export const XP_PER_LEVEL = 100
export const INTERCEPT_XP_REWARD = 50

export type LionProgressionState = {
  level: number
  xp: number
  activeOutfitId: LionOutfitId
}

export type AwardXpResult = LionProgressionState & {
  leveledUp: boolean
  levelsGained: number
  xpGained: number
}

function dispatchChanged() {
  try {
    window.dispatchEvent(new CustomEvent(LION_PROGRESSION_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}

function readLevelRaw(): number {
  try {
    const n = Number.parseInt(localStorage.getItem(LION_LEVEL_KEY) ?? '1', 10)
    return Number.isFinite(n) && n >= 1 ? n : 1
  } catch {
    return 1
  }
}

function readXpRaw(): number {
  try {
    const n = Number.parseInt(localStorage.getItem(LION_XP_KEY) ?? '0', 10)
    if (!Number.isFinite(n) || n < 0) return 0
    return Math.min(n, XP_PER_LEVEL - 1)
  } catch {
    return 0
  }
}

function writeLevel(level: number) {
  localStorage.setItem(LION_LEVEL_KEY, String(Math.max(1, level)))
}

function writeXp(xp: number) {
  localStorage.setItem(LION_XP_KEY, String(Math.max(0, Math.min(xp, XP_PER_LEVEL - 1))))
}

export function readActiveOutfitId(level = readLevelRaw()): LionOutfitId {
  try {
    const raw = localStorage.getItem(LION_ACTIVE_OUTFIT_KEY)
    return sanitizeActiveOutfitId(raw, level)
  } catch {
    return highestUnlockedOutfitId(level)
  }
}

export function writeActiveOutfitId(outfitId: LionOutfitId) {
  const level = readLevelRaw()
  const safe = sanitizeActiveOutfitId(outfitId, level)
  localStorage.setItem(LION_ACTIVE_OUTFIT_KEY, safe)
  dispatchChanged()
}

export function readLionProgression(): LionProgressionState {
  let level = readLevelRaw()
  let xp = (() => {
    try {
      const n = Number.parseInt(localStorage.getItem(LION_XP_KEY) ?? '0', 10)
      return Number.isFinite(n) && n >= 0 ? n : 0
    } catch {
      return 0
    }
  })()

  while (xp >= XP_PER_LEVEL) {
    xp -= XP_PER_LEVEL
    level += 1
  }

  writeLevel(level)
  writeXp(xp)

  return {
    level,
    xp,
    activeOutfitId: readActiveOutfitId(level),
  }
}

export function awardLionXp(amount: number): AwardXpResult {
  let level = readLevelRaw()
  let xp = readXpRaw()
  let levelsGained = 0

  xp += Math.max(0, amount)
  while (xp >= XP_PER_LEVEL) {
    xp -= XP_PER_LEVEL
    level += 1
    levelsGained += 1
  }

  writeLevel(level)
  writeXp(xp)

  const activeOutfitId = sanitizeActiveOutfitId(localStorage.getItem(LION_ACTIVE_OUTFIT_KEY), level)
  writeActiveOutfitId(activeOutfitId)
  dispatchChanged()

  return {
    level,
    xp,
    activeOutfitId,
    leveledUp: levelsGained > 0,
    levelsGained,
    xpGained: amount,
  }
}

export function awardLionXpForIntercept(): AwardXpResult {
  return awardLionXp(INTERCEPT_XP_REWARD)
}

export function formatLionProgressLabel(level: number, xp: number): string {
  return `רמה ${level} • ${xp}/${XP_PER_LEVEL} XP`
}

export function ensureDefaultLionProgression() {
  if (localStorage.getItem(LION_LEVEL_KEY) == null) writeLevel(1)
  if (localStorage.getItem(LION_XP_KEY) == null) writeXp(0)
  if (localStorage.getItem(LION_ACTIVE_OUTFIT_KEY) == null) {
    localStorage.setItem(LION_ACTIVE_OUTFIT_KEY, DEFAULT_LION_OUTFIT_ID)
  }
}
