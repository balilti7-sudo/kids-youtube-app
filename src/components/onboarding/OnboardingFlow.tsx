import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { isProfileParentPinMissing } from '../../lib/parentPin'
import { PageBackBar } from '../layout/PageBackBar'
import { SafeTubeLogo } from '../branding/SafeTubeLogo'
import { Button } from '../ui/Button'

export function OnboardingFlow() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)

  const finish = async () => {
    if (!user) return
    setSaving(true)
    await supabase.from('profiles').update({ onboarding_done: true }).eq('id', user.id)
    await refreshProfile()
    setSaving(false)
    navigate(isProfileParentPinMissing(profile) ? '/set-parent-pin' : '/dashboard', { replace: true })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 px-4 pb-10 pt-10">
      <PageBackBar fallback="/dashboard" />
      <div className="app-floating-surface flex flex-1 flex-col justify-center p-6">
        <SafeTubeLogo size="md" className="mb-4" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-50">ברוכים הבאים</h2>
        <p className="mt-3 text-slate-700 dark:text-zinc-400">
          ניהול בטוח ונוח של תכני YouTube לילדים — ממקום אחד.
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-zinc-500">
          במסך הבא נגדיר קוד הורה חד-פעמי (אם עדיין לא מוגדר), ואז נעבור לדשבורד.
        </p>
      </div>
      <Button className="w-full" onClick={finish} disabled={saving}>
        {saving ? 'שומר...' : 'המשך'}
      </Button>
    </div>
  )
}
