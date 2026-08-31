import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Calculator,
  Film,
  Landmark,
  Languages,
  Leaf,
  Microscope,
  Music,
  Palette,
  Scissors,
  Smile,
  Star,
  Tag,
  Trophy,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  microscope: Microscope,
  leaf: Leaf,
  palette: Palette,
  landmark: Landmark,
  'book-open': BookOpen,
  music: Music,
  calculator: Calculator,
  trophy: Trophy,
  scissors: Scissors,
  languages: Languages,
  film: Film,
  smile: Smile,
  star: Star,
  tag: Tag,
}

export function resolveTagIcon(iconKey: string): LucideIcon {
  return ICONS[iconKey] ?? Tag
}

/** Cycle taste weight: Neutral → More → Less → Hide → Neutral */
export function cycleTagWeight(current: number): number {
  if (current === 0) return 1
  if (current === 1) return -1
  if (current === -1) return -2
  return 0
}

export function weightLabelKey(weight: number): string {
  if (weight >= 2) return 'contentTags.weightBoost'
  if (weight === 1) return 'contentTags.weightMore'
  if (weight === -1) return 'contentTags.weightLess'
  if (weight <= -2) return 'contentTags.weightHide'
  return 'contentTags.weightNeutral'
}

export function weightDotCount(weight: number): number {
  if (weight === 0) return 0
  if (weight === 1) return 2
  if (weight >= 2) return 3
  if (weight === -1) return 1
  return 1
}
