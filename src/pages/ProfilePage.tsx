import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { changeParentPin } from '../lib/changeParentPin'
import {
  isProfileParentPinMissing,
  isValidParentPinDigits,
  PARENT_PIN_DIGIT_MAX,
  PARENT_PIN_DIGIT_MIN,
} from '../lib/parentPin'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { requestPinChangedEmail } from '../lib/requestPinChangedEmail'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

const MIN_PASSWORD_LEN = 8

const WRONG_CURRENT_PASSWORD_HE = 'הסיסמה הנוכחית שגויה'

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

/** Supabase GoTrue: wrong email/password on sign-in (e.g. AuthApiError "Invalid credentials"). */
function isInvalidLoginCredentials(error: { message?: string; status?: number; code?: string }): boolean {
  const msg = (error.message ?? '').toLowerCase()
  if (error.code === 'invalid_credentials') return true
  if (
    error.status === 400 &&
    (msg.includes('invalid login') ||
      msg.includes('invalid credential') ||
      msg.includes('invalid email or password'))
  ) {
    return true
  }
  return false
}

export function ProfilePage() {
  const { user, profile, session, refreshProfile } = useAuth()
  const [email, setEmail] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [currentParentPin, setCurrentParentPin] = useState('')
  const [newParentPin, setNewParentPin] = useState('')
  const [newParentPinConfirm, setNewParentPinConfirm] = useState('')
  const [parentPinSaving, setParentPinSaving] = useState(false)

  const pinAlreadyConfigured = !isProfileParentPinMissing(profile)

  useEffect(() => {
    setEmail(user?.email ?? '')
  }, [user?.email])

  const handleEmailUpdate = async () => {
    const next = email.trim()
    if (!isValidEmail(next)) {
      toast.error('נא להזין כתובת אימייל תקינה')
      return
    }
    setEmailSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ email: next })
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success('בקשת עדכון האימייל נשלחה. ייתכן שתצטרכו לאשר בקישור שנשלח לתיבה.')
      await refreshProfile()
    } finally {
      setEmailSaving(false)
    }
  }

  const handlePasswordUpdate = async () => {
    if (!currentPassword) {
      toast.error('נא להזין את הסיסמה הנוכחית')
      return
    }
    if (password.length < MIN_PASSWORD_LEN) {
      toast.error(`הסיסמה החדשה חייבת להכיל לפחות ${MIN_PASSWORD_LEN} תווים`)
      return
    }
    if (password !== passwordConfirm) {
      toast.error('הסיסמאות החדשות אינן תואמות')
      return
    }
    const email = user?.email?.trim()
    if (!email) {
      toast.error('לא נמצאה כתובת אימייל לחשבון. לא ניתן לאמת סיסמה.')
      return
    }
    setPasswordSaving(true)
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      })
      if (verifyError) {
        toast.error(isInvalidLoginCredentials(verifyError) ? WRONG_CURRENT_PASSWORD_HE : verifyError.message)
        return
      }
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success('הסיסמה עודכנה')
      setCurrentPassword('')
      setPassword('')
      setPasswordConfirm('')
    } finally {
      setPasswordSaving(false)
    }
  }

  const handleParentPinUpdate = async () => {
    const currentDigits = currentParentPin.replace(/\D/g, '')
    const newDigits = newParentPin.replace(/\D/g, '')
    const confirmDigits = newParentPinConfirm.replace(/\D/g, '')

    if (pinAlreadyConfigured) {
      if (!isValidParentPinDigits(currentDigits)) {
        toast.error(`נא להזין את קוד PIN הנוכחי (${PARENT_PIN_DIGIT_MIN}–${PARENT_PIN_DIGIT_MAX} ספרות)`)
        return
      }
    }

    if (!isValidParentPinDigits(newDigits)) {
      toast.error(`הקוד החדש חייב להכיל בין ${PARENT_PIN_DIGIT_MIN} ל-${PARENT_PIN_DIGIT_MAX} ספרות`)
      return
    }

    if (newDigits !== confirmDigits) {
      toast.error('קוד PIN החדש ואימות הקוד אינם תואמים')
      return
    }

    if (pinAlreadyConfigured && newDigits === currentDigits) {
      toast.error('הקוד החדש חייב להיות שונה מהקוד הנוכחי')
      return
    }

    if (!user?.id) {
      toast.error('יש להתחבר מחדש')
      return
    }

    setParentPinSaving(true)
    try {
      const result = await changeParentPin(user.id, currentDigits, newDigits)
      if (!result.ok) {
        toast.error(result.message)
        return
      }

      toast.success('קוד PIN לנעילת הורים עודכן')
      requestPinChangedEmail(session?.access_token)
      setCurrentParentPin('')
      setNewParentPin('')
      setNewParentPinConfirm('')
      await refreshProfile()
    } finally {
      setParentPinSaving(false)
    }
  }

  const newParentPinDigits = newParentPin.replace(/\D/g, '')
  const newParentPinHintInvalid =
    newParentPin.length > 0 && !isValidParentPinDigits(newParentPinDigits)
  const parentPinFormReady =
    isValidParentPinDigits(newParentPinDigits) &&
    newParentPinDigits === newParentPinConfirm.replace(/\D/g, '') &&
    (!pinAlreadyConfigured || isValidParentPinDigits(currentParentPin.replace(/\D/g, '')))

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 pb-4">
      <header>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">חשבון והתחברות</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">עדכון אימייל וסיסמה (Supabase Auth)</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-bold text-slate-900 dark:text-zinc-100">שינוי אימייל</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">
          אחרי השמירה ייתכן שתתבקשו לאשר את הכתובת החדשה במייל (לפי הגדרות Supabase).
        </p>
        <Input
          type="email"
          dir="ltr"
          className="mt-3"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <Button className="mt-3 w-full" disabled={emailSaving} onClick={() => void handleEmailUpdate()}>
          {emailSaving ? 'שומר…' : 'עדכן אימייל'}
        </Button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-bold text-slate-900 dark:text-zinc-100">שינוי סיסמה</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">
          יש להזין את הסיסמה הנוכחית לאימות מול השרת. הסיסמה החדשה: לפחות {MIN_PASSWORD_LEN} תווים.
        </p>
        <label htmlFor="profile-current-password" className="mt-3 block text-xs font-semibold text-slate-700 dark:text-zinc-300">
          סיסמה נוכחית <span className="text-red-600 dark:text-red-400">*</span>
        </label>
        <Input
          id="profile-current-password"
          type="password"
          dir="ltr"
          className="mt-1"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="הסיסמה בשימוש כיום"
          autoComplete="current-password"
        />
        <label htmlFor="profile-new-password" className="mt-3 block text-xs font-semibold text-slate-700 dark:text-zinc-300">
          סיסמה חדשה
        </label>
        <Input
          id="profile-new-password"
          type="password"
          dir="ltr"
          className="mt-1"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`לפחות ${MIN_PASSWORD_LEN} תווים`}
          autoComplete="new-password"
        />
        <label htmlFor="profile-new-password-confirm" className="mt-3 block text-xs font-semibold text-slate-700 dark:text-zinc-300">
          אימות סיסמה חדשה
        </label>
        <Input
          id="profile-new-password-confirm"
          type="password"
          dir="ltr"
          className="mt-1"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          placeholder="הזינו שוב את הסיסמה החדשה"
          autoComplete="new-password"
        />
        <Button className="mt-3 w-full" disabled={passwordSaving} onClick={() => void handlePasswordUpdate()}>
          {passwordSaving ? 'מעדכן…' : 'עדכן סיסמה'}
        </Button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-bold text-slate-900 dark:text-zinc-100">שינוי קוד PIN לנעילת הורים</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">
          הקוד משמש לגישה לאזור הניהול ולפעולות רגישות. מומלץ לא לשתף אותו עם הילדים. לשינוי קוד קיים
          יש להזין את הקוד הנוכחי.
        </p>
        {pinAlreadyConfigured ? (
          <>
            <label
              htmlFor="profile-current-parent-pin"
              className="mt-3 block text-xs font-semibold text-slate-700 dark:text-zinc-300"
            >
              קוד PIN נוכחי <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            <Input
              id="profile-current-parent-pin"
              type="password"
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              maxLength={PARENT_PIN_DIGIT_MAX}
              className="mt-1 tracking-widest"
              value={currentParentPin}
              onChange={(e) =>
                setCurrentParentPin(e.target.value.replace(/\D/g, '').slice(0, PARENT_PIN_DIGIT_MAX))
              }
              placeholder="••••"
            />
          </>
        ) : null}
        <label
          htmlFor="profile-new-parent-pin"
          className="mt-3 block text-xs font-semibold text-slate-700 dark:text-zinc-300"
        >
          קוד PIN חדש
        </label>
        <Input
          id="profile-new-parent-pin"
          type="password"
          dir="ltr"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={PARENT_PIN_DIGIT_MAX}
          className="mt-1 tracking-widest"
          value={newParentPin}
          onChange={(e) => setNewParentPin(e.target.value.replace(/\D/g, '').slice(0, PARENT_PIN_DIGIT_MAX))}
          placeholder="••••"
          aria-invalid={newParentPinHintInvalid}
        />
        <label
          htmlFor="profile-new-parent-pin-confirm"
          className="mt-3 block text-xs font-semibold text-slate-700 dark:text-zinc-300"
        >
          אימות קוד PIN חדש
        </label>
        <Input
          id="profile-new-parent-pin-confirm"
          type="password"
          dir="ltr"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={PARENT_PIN_DIGIT_MAX}
          className="mt-1 tracking-widest"
          value={newParentPinConfirm}
          onChange={(e) =>
            setNewParentPinConfirm(e.target.value.replace(/\D/g, '').slice(0, PARENT_PIN_DIGIT_MAX))
          }
          placeholder="••••"
        />
        <p
          className={
            newParentPinHintInvalid
              ? 'mt-2 text-xs text-red-600 dark:text-red-400'
              : 'mt-2 text-xs text-slate-500 dark:text-zinc-500'
          }
        >
          הקוד חייב להכיל בין {PARENT_PIN_DIGIT_MIN} ל-{PARENT_PIN_DIGIT_MAX} ספרות
        </p>
        <Button
          className="mt-3 w-full"
          disabled={parentPinSaving || !parentPinFormReady}
          onClick={() => void handleParentPinUpdate()}
        >
          {parentPinSaving ? 'מעדכן…' : 'עדכן קוד PIN'}
        </Button>
      </section>
    </div>
  )
}
