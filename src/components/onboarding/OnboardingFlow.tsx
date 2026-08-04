import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { isProfileParentPinMissing } from '../../lib/parentPin'
import { PageBackBar } from '../layout/PageBackBar'
import { SafeTubeLogo } from '../branding/SafeTubeLogo'
import { Button } from '../ui/Button'
import { setSkipParentalManagementGateOnce } from '../../lib/parentalGateSkipOnce'

const STEPS = [
  {
    title: 'צרו פרופיל לילד',
    detail: 'בלוח הבקרה — הוספת פרופיל. מיד יופיע קוד צימוד.',
  },
  {
    title: 'חברו את מכשיר הילד',
    detail: 'הזינו את הקוד (או סרקו QR) במסך הילד באפליקציה.',
  },
  {
    title: 'הוסיפו ערוצים מאושרים',
    detail: 'חפשו ערוץ ב«ניהול ערוצים» — רק ערוצים שאישרתם יופיעו לילד.',
  },
] as const

export function OnboardingFlow() {
  const { user, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)

  const finish = async () => {
    if (!user) return
    setSaving(true)
    await supabase.from('profiles').update({ onboarding_done: true }).eq('id', user.id)
    await refreshProfile()
    setSaving(false)
    setSkipParentalManagementGateOnce()
    const p = useAuthStore.getState().profile
    navigate(isProfileParentPinMissing(p) ? '/set-parent-pin' : '/dashboard', { replace: true })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-4 px-4 pb-8 pt-6 sm:pb-10 sm:pt-8">
      <PageBackBar fallback="/dashboard" />
      <div className="app-floating-surface flex flex-1 flex-col justify-center p-5 sm:p-6">
        <SafeTubeLogo size="lg" className="mb-3" entranceAnimation />
        <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-50">ברוכים הבאים ל־SafeTube</h2>
        <p className="mt-2 text-slate-700 dark:text-zinc-400">
          שלושה צעדים קצרים — והילד כבר צופה רק במה שאישרתם.
        </p>
        <ol className="mt-5 flex flex-col gap-3">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/60"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900 dark:text-zinc-100">
                  {step.title}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
                  {step.detail}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-start gap-2 text-xs text-slate-500 dark:text-zinc-500">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
          במסך הבא נגדיר קוד הורה (אם עדיין לא מוגדר), ואז נעבור ללוח הבקרה עם מדריך התחלה.
        </p>
      </div>
      <Button className="w-full text-base font-bold" onClick={finish} disabled={saving}>
        {saving ? 'שומר...' : 'בואו נתחיל'}
      </Button>
    </div>
  )
}
