import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'
import { changeParentPin } from '../../lib/changeParentPin'
import {
  isProfileParentPinMissing,
  isValidParentPinDigits,
  PARENT_PIN_DIGIT_MAX,
} from '../../lib/parentPin'
import { requestPinChangedEmail } from '../../lib/requestPinChangedEmail'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

/** Change parent PIN — only in Settings after authenticated parent session. */
export function ParentPinSettingsCard() {
  const { user, profile, session, refreshProfile } = useAuth()
  const [currentParentPin, setCurrentParentPin] = useState('')
  const [newParentPin, setNewParentPin] = useState('')
  const [newParentPinConfirm, setNewParentPinConfirm] = useState('')
  const [parentPinSaving, setParentPinSaving] = useState(false)

  const pinAlreadyConfigured = !isProfileParentPinMissing(profile)

  const handleParentPinUpdate = async () => {
    const currentDigits = currentParentPin.replace(/\D/g, '')
    const newDigits = newParentPin.replace(/\D/g, '')
    const confirmDigits = newParentPinConfirm.replace(/\D/g, '')

    if (pinAlreadyConfigured) {
      if (!isValidParentPinDigits(currentDigits)) {
        toast.error(`נא להזין את קוד PIN הנוכחי (${PARENT_PIN_DIGIT_MAX} ספרות)`)
        return
      }
    }

    if (!isValidParentPinDigits(newDigits)) {
      toast.error(`הקוד החדש חייב להכיל ${PARENT_PIN_DIGIT_MAX} ספרות`)
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
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-bold text-slate-900 dark:text-zinc-100">קוד PIN לנעילת הורים</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-zinc-500">
        הקוד משמש לכניסה לאזור הניהול ולפעולות רגישות. מומלץ לא לשתף אותו עם הילדים.
      </p>
      <p className="mt-2 text-xs text-slate-500 dark:text-zinc-500">
        שכחתם את הקוד?{' '}
        <Link to="/auth" className="font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">
          התנתקו
        </Link>{' '}
        ובמסך הכניסה לניהול לחצו &quot;שכחתי קוד&quot; — יישלח קוד חדש במייל.
      </p>
      {pinAlreadyConfigured ? (
        <>
          <label htmlFor="settings-current-parent-pin" className="mt-3 block text-xs font-semibold text-slate-700 dark:text-zinc-300">
            קוד PIN נוכחי <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <Input
            id="settings-current-parent-pin"
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
      <label htmlFor="settings-new-parent-pin" className="mt-3 block text-xs font-semibold text-slate-700 dark:text-zinc-300">
        קוד PIN חדש
      </label>
      <Input
        id="settings-new-parent-pin"
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
      <label htmlFor="settings-new-parent-pin-confirm" className="mt-3 block text-xs font-semibold text-slate-700 dark:text-zinc-300">
        אימות קוד PIN חדש
      </label>
      <Input
        id="settings-new-parent-pin-confirm"
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
        הקוד חייב להכיל {PARENT_PIN_DIGIT_MAX} ספרות
      </p>
      <Button
        className="mt-3 w-full"
        disabled={parentPinSaving || !parentPinFormReady}
        onClick={() => void handleParentPinUpdate()}
      >
        {parentPinSaving ? 'מעדכן…' : 'עדכן קוד PIN'}
      </Button>
    </section>
  )
}
