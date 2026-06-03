/** Data-driven educational intercept scenes — extend this array for new rooms/tasks. */

export type SceneItemId = 'toys' | 'heater' | 'bed'

export type EducationalSceneItem = {
  id: SceneItemId
  label: string
  hint: string
  /** Position hint for the tap target (% of scene box). */
  tapZone: { x: number; y: number; w: number; h: number }
}

export type EducationalScene = {
  id: string
  title: string
  subtitle: string
  lionIntro: string
  items: EducationalSceneItem[]
}

export const EDUCATIONAL_SCENES: EducationalScene[] = [
  {
    id: 'room-order-safety',
    title: 'סדר ובטיחות בחדר',
    subtitle: 'עזרו לגור האריה לסדר את החדר!',
    lionIntro: 'אוי לא… החדר מבולגן ויש סכנה ליד התנור! בואו נסדר יחד.',
    items: [
      {
        id: 'toys',
        label: 'צעצועים מפוזרים',
        hint: 'לחצו כדי לאסוף את הצעצועים לארגז',
        tapZone: { x: 8, y: 58, w: 28, h: 22 },
      },
      {
        id: 'heater',
        label: 'צעיף ליד תנור חימום',
        hint: 'לחצו כדי להעביר את הצעיף לוו ש על הקיר',
        tapZone: { x: 62, y: 48, w: 22, h: 24 },
      },
      {
        id: 'bed',
        label: 'מיטה לא מסודרת',
        hint: 'לחצו כדי לישר את השמיכה',
        tapZone: { x: 28, y: 62, w: 34, h: 26 },
      },
    ],
  },
]

export function getEducationalScene(sceneId?: string | null): EducationalScene {
  return EDUCATIONAL_SCENES.find((s) => s.id === sceneId) ?? EDUCATIONAL_SCENES[0]!
}

export { INTERCEPT_BREAK_INTERVAL_OPTIONS } from '../lib/breakIntervalOptions'
