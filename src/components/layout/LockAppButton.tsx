import { Lock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import { lockManagementAppShell } from '../../lib/lockParentApp'
import { Button } from '../ui/Button'

/**
 * נעילה מיידית: מנקה סשן PIN (שער ניהול, הורה מקומי וכו׳) ומחזיר למצב ילד.
 * אם יש טוקן מכשיר ילד — מעבר ל־/kid; אחרת נשארים באותו נתיב ושער הניהול חוזר.
 */
export function LockAppButton() {
  const navigate = useNavigate()

  return (
    <Button
      type="button"
      variant="secondary"
      className="shrink-0 gap-2 !border-amber-600/50 !bg-amber-950/40 !text-amber-100 hover:!border-amber-500 hover:!bg-amber-900/50"
      onClick={() => {
        lockManagementAppShell()
        if (getSavedChildAccessToken()) {
          navigate('/kid', { replace: true })
        }
      }}
      title="נעילה מיידית — מנקה את אימות ה-PIN ומחזירה למצב ילד"
      aria-label="נעל אפליקציה — חזרה למצב ילד"
    >
      <Lock className="h-4 w-4 shrink-0" aria-hidden />
      נעל אפליקציה
    </Button>
  )
}
