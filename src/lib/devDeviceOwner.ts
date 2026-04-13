import { USE_DEV_DUMMY_DEVICE_OWNER } from '../config/dev'

const STORAGE_KEY = 'safetube-dev-device-owner-id'

/** UUID קבוע אם אין localStorage (למשל מצב נדיר) */
const STATIC_DEV_UUID = '00000000-0000-4000-8000-00000000d3v'

/**
 * יוצר/קורא UUID יציב ב-localStorage — כל המכשירים בפיתוח ישויכו לאותו "בעלים" דמה.
 */
export function getOrCreateDevDummyUserId(): string {
  const fixed = import.meta.env.VITE_DEV_DEVICE_OWNER_ID?.trim()
  if (fixed && /^[0-9a-f-]{36}$/i.test(fixed)) {
    return fixed
  }

  try {
    if (typeof localStorage === 'undefined') return STATIC_DEV_UUID
    let id = localStorage.getItem(STORAGE_KEY)
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = crypto.randomUUID()
      localStorage.setItem(STORAGE_KEY, id)
    }
    return id
  } catch {
    return STATIC_DEV_UUID
  }
}

/**
 * user_id לטבלת devices: משתמש אמיתי, או בפיתוח — מזהה מ-.env או מ-localStorage.
 */
export function resolveDeviceOwnerUserId(realProfileOrAuthId: string | null | undefined): string | undefined {
  if (realProfileOrAuthId) return realProfileOrAuthId
  if (!USE_DEV_DUMMY_DEVICE_OWNER) return undefined
  return getOrCreateDevDummyUserId()
}
