import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { PageBackBar } from '../layout/PageBackBar'
import { Button } from '../ui/Button'

const steps = [
  {
    title: 'ברוכים הבאים ל-SafeTube',
    body: 'כאן תנהלו מכשירי ילדים, תאשרו ערוצי YouTube, ותשלטו על חסימה — הכול ממקום אחד.',
  },
  {
    title: 'חיבור מכשיר',
    body: 'בשלב הבא תוכלו ליצור קוד חיבור ולקשר טאבלט או טלפון של הילד. (אפשר לדלג ולחזור אחר כך)',
  },
  {
    title: 'ערוץ ראשון',
    body: 'בטאב ערוצים תחפשו ערוצים ותוסיפו לאישור. רק מה שאתם מאשרים — יופיע במכשיר.',
  },
]

export function OnboardingFlow() {
  const [step, setStep] = useState(0)
  const { user, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)

  const finish = async () => {
    if (!user) return
    setSaving(true)
    await supabase.from('profiles').update({ onboarding_done: true }).eq('id', user.id)
    await refreshProfile()
    setSaving(false)
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 px-4 pb-10 pt-10">
      <PageBackBar fallback="/dashboard" />
      <div className="flex justify-center gap-2">
        {steps.map((_, i) => (
          <span
            key={i}
            className={`h-2 w-8 rounded-full ${i === step ? 'bg-brand-600' : 'bg-slate-200 dark:bg-zinc-700'}`}
          />
        ))}
      </div>
      <div className="app-floating-surface flex flex-1 flex-col justify-center p-6">
        <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-50">{steps[step].title}</h2>
        <p className="mt-3 text-slate-700 dark:text-zinc-400">{steps[step].body}</p>
      </div>
      <div className="flex gap-2">
        {step > 0 ? (
          <Button variant="secondary" className="flex-1" onClick={() => setStep((s) => s - 1)}>
            חזרה
          </Button>
        ) : (
          <span className="flex-1" />
        )}
        {step < steps.length - 1 ? (
          <Button className="flex-1" onClick={() => setStep((s) => s + 1)}>
            המשך
          </Button>
        ) : (
          <Button className="flex-1" onClick={finish} disabled={saving}>
            {saving ? 'שומר...' : 'סיום'}
          </Button>
        )}
      </div>
    </div>
  )
}
