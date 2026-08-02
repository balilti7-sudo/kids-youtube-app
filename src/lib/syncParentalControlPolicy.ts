import {
  applyParentalControlPolicy,
  isParentalControlNativeAvailable,
  type ParentalControlPolicy,
} from './parentalControlNative'

/** Push Supabase device policy into the Android Accessibility prefs. */
export async function syncParentalControlPolicy(policy: ParentalControlPolicy): Promise<void> {
  if (!isParentalControlNativeAvailable()) return
  await applyParentalControlPolicy(policy)
}

export function policyFromDeviceFields(fields: {
  block_youtube_app?: boolean | null
  browser_filter_enabled?: boolean | null
  browser_whitelist?: string[] | null
}): ParentalControlPolicy {
  return {
    blockYoutube: Boolean(fields.block_youtube_app),
    browserFilterEnabled: Boolean(fields.browser_filter_enabled),
    whitelist: Array.isArray(fields.browser_whitelist)
      ? fields.browser_whitelist.map((h) => String(h || '').trim()).filter(Boolean)
      : [],
  }
}
