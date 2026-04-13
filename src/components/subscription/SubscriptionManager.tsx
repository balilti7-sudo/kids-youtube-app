import { useSubscription } from '../../hooks/useSubscription'
import { useAuth } from '../../hooks/useAuth'
import { SubscriptionStatus } from './SubscriptionStatus'
import { PricingScreen } from './PricingScreen'

export function SubscriptionManager() {
  const { user } = useAuth()
  const { subscription, trialDaysRemaining, loading: subLoading } = useSubscription(user?.id)

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 pb-4">
      <header>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">מנוי</h1>
        <p className="text-sm text-slate-600 dark:text-zinc-400">סטטוס ושדרוג</p>
      </header>
      <SubscriptionStatus
        subscription={subscription}
        trialDays={trialDaysRemaining}
        loading={subLoading}
      />
      <h2 className="text-sm font-semibold text-slate-800 dark:text-zinc-200">שדרוג</h2>
      <PricingScreen />
    </div>
  )
}
