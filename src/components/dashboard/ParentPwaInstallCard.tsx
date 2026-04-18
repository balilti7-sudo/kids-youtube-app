import { useState } from 'react'
import { Download, Share2, Smartphone } from 'lucide-react'
import { Button } from '../ui/Button'
import { usePwaInstall } from '../../hooks/usePwaInstall'

export function ParentPwaInstallCard() {
  const { canPrompt, isInstalled, promptInstall } = usePwaInstall()
  const [showManualHint, setShowManualHint] = useState(false)

  if (isInstalled) {
    return (
      <section
        className="rounded-2xl border border-emerald-800/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100/95"
        aria-live="polite"
      >
        <p className="font-medium text-emerald-50">האפליקציה פועלת במצב מותקן (מסך מלא).</p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/80">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600/15 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
          <Smartphone className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-900 dark:text-zinc-50">שמירה כאיקון / התקנה</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
            יצירת קיצור דרך לאיקון הבית או למסך הנייד — גישה מהירה להורה בלי להקיש את הכתובת בכל פעם.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {canPrompt ? (
              <Button
                type="button"
                className="w-full gap-2 sm:w-auto"
                onClick={() =>
                  void promptInstall().catch(() => {
                    setShowManualHint(true)
                  })
                }
              >
                <Download className="h-4 w-4" />
                התקן או הוסף לאיקון
              </Button>
            ) : null}
            <Button type="button" variant="secondary" className="w-full gap-2 sm:w-auto" onClick={() => setShowManualHint((v) => !v)}>
              <Share2 className="h-4 w-4" />
              {showManualHint ? 'הסתר הוראות' : 'איך מוסיפים לאיקון (ידני)'}
            </Button>
          </div>
          {showManualHint ? (
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-[11px] leading-relaxed text-slate-600 dark:text-zinc-500">
              <li>
                <strong className="text-slate-700 dark:text-zinc-400">Chrome / Edge:</strong> בתפריט הדפדפן בחרו &quot;התקן אפליקציה&quot; / Install
                app (או אייקון מסך+חץ בשורת הכתובת).
              </li>
              <li>
                <strong className="text-slate-700 dark:text-zinc-400">Safari (אייפון / אייפד):</strong> Share{' '}
                <Share2 className="inline h-3 w-3 align-text-bottom opacity-70" aria-hidden /> → &quot;הוסף למסך הבית&quot;.
              </li>
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  )
}
