/** נתיבים שדורשים אימות הורה (שער) — לא זמינים לילד בלי כוונה מפורשת. */
export const PARENT_MANAGEMENT_PATHS = new Set([
  '/dashboard',
  '/dashboard/add-profile',
  '/hidden-videos',
  '/settings',
  '/profile',
  '/subscription',
  '/onboarding',
  '/set-parent-pin',
])

export function isParentManagementLockedPath(pathname: string): boolean {
  if (PARENT_MANAGEMENT_PATHS.has(pathname)) return true
  // Nested parental-control routes (e.g. future /dashboard/* steps).
  if (pathname.startsWith('/dashboard/')) return true
  return false
}
