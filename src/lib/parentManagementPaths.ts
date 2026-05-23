/** נתיבים שדורשים אימות הורה (שער) — לא זמינים לילד בלי כוונה מפורשת. */
export const PARENT_MANAGEMENT_PATHS = new Set([
  '/dashboard',
  '/channels',
  '/playlists',
  '/hidden-videos',
  '/settings',
  '/profile',
  '/subscription',
  '/onboarding',
  '/set-parent-pin',
])

export function isParentManagementLockedPath(pathname: string): boolean {
  return PARENT_MANAGEMENT_PATHS.has(pathname)
}
