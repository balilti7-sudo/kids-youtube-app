import type { Profile } from '../types'
import { getExpectedChannelActionPin, pinsMatch } from './parentPin'
import { verifyLoggedInUserParentPin, type ParentPinVerifyResult } from './verifyParentProfilePin'

export type { ParentPinVerifyResult } from './verifyParentProfilePin'

/** אימות קוד הורה לדשבורד / פעולות ניהול — DB כשיש `userId`, אחרת ניהול מקומי / env. */
export async function verifyParentManagementPin(
  ctx: {
    userId: string | undefined
    profile: Profile | null | undefined
    localParent: { isActive: boolean; pin?: string | null }
  },
  pin: string
): Promise<ParentPinVerifyResult> {
  if (ctx.userId) {
    return verifyLoggedInUserParentPin(ctx.userId, pin)
  }
  const expected = getExpectedChannelActionPin(ctx.profile, ctx.localParent)
  const trimmed = pin.replace(/\D/g, '').trim()
  if (!pinsMatch(trimmed, expected)) {
    return { ok: false, errorMessage: 'קוד שגוי' }
  }
  return { ok: true }
}
