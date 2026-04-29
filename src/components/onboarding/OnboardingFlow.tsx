import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { PageBackBar } from '../layout/PageBackBar'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

const steps = [
  {
    title: 'ברוכים הבאים ל-SafeTube',
    body: 'כאן תנהלו מכשירי ילדים, תאשרו ערוצי YouTube, ותשלטו על חסימה — הכול ממקום אחד.',
  },
  {
    title: 'הגדרת PIN הורי',
    body: 'כדי שהילד יוכל לאפשר ניהול הורה במכשיר שלו, מגדירים PIN הורי בתוך האפליקציה.',
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

  const PIN_STEP = 1

  const [pinInput, setPinInput] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [settingPin, setSettingPin] = useState(false)
  const [hasPin, setHasPin] = useState<boolean | null>(null)

  const normalizePin = (v: string) => v.replace(/\s+/g, '').trim()

  const fetchHasPin = async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('parent_settings')
      .select('pin_hash')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) {
      setHasPin(false)
      return
    }
    const pinHash = (data as { pin_hash?: string | null } | null)?.pin_hash ?? null
    setHasPin(Boolean(pinHash && pinHash.trim().length > 0))
  }

  useEffect(() => {
    void fetchHasPin()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wants to refetch per user change
  }, [user?.id])

  const finish = async () => {
    if (!user) return
    setSaving(true)
    await supabase.from('profiles').update({ onboarding_done: true }).eq('id', user.id)
    await refreshProfile()
    setSaving(false)
    navigate('/dashboard', { replace: true })
  }

  const continueStep = async () => {
    if (step !== PIN_STEP) {
      setStep((s) => s + 1)
      return
    }

    if (hasPin) {
      setStep((s) => s + 1)
      return
    }

    const pin = normalizePin(pinInput)
    const pin2 = normalizePin(pinConfirm)

    if (pin.length < 4) {
      setPinError('PIN קצר מדי (מינימום 4 ספרות)')
      return
    }
    if (pin !== pin2) {
      setPinError('האישור לא תואם את ה-PIN')
      return
    }

    setSettingPin(true)
    setPinError(null)
    try {
      const { error } = await supabase.rpc('set_parent_pin', { p_pin: pin })
      if (error) {
        setPinError(error.message)
        return
      }
      setHasPin(true)
      setPinInput('')
      setPinConfirm('')
      setStep((s) => s + 1)
    } finally {
      setSettingPin(false)
    }
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

        {step === PIN_STEP ? (
          <div className="mt-5 flex flex-col gap-3">
            {hasPin === null ? (
              <p className="text-sm text-slate-600 dark:text-zinc-400">טוען…</p>
            ) : hasPin ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-100">
                ה-PIN ההורי כבר מוגדר. אפשר להמשיך.
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">PIN הורי</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={pinInput}
                    onChange={(e) => {
                      setPinInput(e.target.value)
                      if (pinError) setPinError(null)
                    }}
                    placeholder="למשל 1234"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">אישור PIN</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={pinConfirm}
                    onChange={(e) => {
                      setPinConfirm(e.target.value)
                      if (pinError) setPinError(null)
                    }}
                    placeholder="חזור על ה-PIN"
                  />
                </div>
                {pinError ? <p className="text-sm text-red-600">{pinError}</p> : null}
              </>
            )}
          </div>
        ) : null}
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
          <Button className="flex-1" onClick={() => void continueStep()} disabled={settingPin || hasPin === null}>
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
