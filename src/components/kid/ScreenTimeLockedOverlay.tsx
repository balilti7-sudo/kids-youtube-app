import { createPortal } from 'react-dom'
import { Moon, Shield } from 'lucide-react'

export function ScreenTimeLockedOverlay() {
  return createPortal(
    <div
      className="fixed inset-0 z-[190] flex flex-col items-center justify-center bg-zinc-950 px-6 text-center"
      role="alert"
      aria-live="polite"
    >
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-zinc-800 ring-2 ring-zinc-600">
        <Moon className="h-10 w-10 text-sky-300" aria-hidden />
      </div>
      <h2 className="text-xl font-black text-zinc-50">המסך במנוחה</h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-400">
        זמן הצפייה הסתיים. כדי לצפות שוב, ההורה צריך לפתוח סשן חדש ממסך בקרת ההורים.
      </p>
      <p className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-zinc-500">
        <Shield className="h-4 w-4" aria-hidden />
        SafeTube — מוגן מקומית במכשיר
      </p>
    </div>,
    document.body
  )
}
