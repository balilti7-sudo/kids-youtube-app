export function ParentManagementBanner() {
  return (
    <div
      className="border-b border-indigo-200/90 bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 px-3 py-2.5 dark:border-indigo-800/80 dark:from-indigo-950/70 dark:via-sky-950/50 dark:to-violet-950/60 sm:px-4 sm:py-3"
      role="region"
      aria-label="אזור ניהול הורים"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-center">
        <p className="text-center text-sm font-bold leading-snug text-indigo-950 dark:text-indigo-100 sm:text-right sm:text-base">
          🔧 אזור ניהול הורים — השינויים משפיעים מיד על המכשיר
        </p>
      </div>
    </div>
  )
}
