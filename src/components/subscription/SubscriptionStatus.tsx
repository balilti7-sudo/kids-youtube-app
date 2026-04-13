import type { Subscription } from '../../types'
import { Badge } from '../ui/Badge'

export function SubscriptionStatus({
  subscription,
  trialDays,
  loading,
}: {
  subscription: Subscription | null
  trialDays: number | null
  loading?: boolean
}) {
  if (loading && !subscription) {
    return <p className="text-sm text-slate-600 dark:text-zinc-400">טוען מנוי...</p>
  }
  if (!subscription) {
    return (
      <p className="text-sm text-slate-600 dark:text-zinc-400">
        לא נמצא רשומת מנוי (הריצו SQL / trigger ב-Supabase)
      </p>
    )
  }

  const statusLabel: Record<Subscription['status'], string> = {
    active: 'פעיל',
    expired: 'פג תוקף',
    cancelled: 'בוטל',
    payment_failed: 'תשלום נכשל',
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">{subscription.plan}</Badge>
        <Badge variant="neutral">{statusLabel[subscription.status]}</Badge>
      </div>
      {subscription.plan === 'trial' && trialDays !== null ? (
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">נותרו {trialDays} ימים בניסיון</p>
      ) : null}
      <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">עד {subscription.max_devices} מכשירים</p>
    </div>
  )
}
