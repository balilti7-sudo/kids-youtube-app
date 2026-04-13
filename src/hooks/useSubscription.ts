import { useEffect } from 'react'
import { useSubscriptionStore } from '../stores/subscriptionStore'

export function useSubscription(userId: string | undefined) {
  const subscription = useSubscriptionStore((s) => s.subscription)
  const loading = useSubscriptionStore((s) => s.loading)
  const fetchSubscription = useSubscriptionStore((s) => s.fetchSubscription)
  const trialDaysRemaining = useSubscriptionStore((s) => s.trialDaysRemaining)

  useEffect(() => {
    if (!userId) return
    void fetchSubscription(userId)
  }, [userId, fetchSubscription])

  return {
    subscription,
    loading,
    refetch: () => userId && fetchSubscription(userId),
    trialDaysRemaining: trialDaysRemaining(),
  }
}
