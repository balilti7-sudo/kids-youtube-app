import { create } from 'zustand'
import type { Subscription } from '../types'
import { supabase } from '../lib/supabase'

interface SubscriptionState {
  subscription: Subscription | null
  loading: boolean
  fetchSubscription: (userId: string) => Promise<void>
  setSubscription: (sub: Subscription | null) => void
  trialDaysRemaining: () => number | null
}

function daysBetween(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  subscription: null,
  loading: false,

  setSubscription: (subscription) => set({ subscription }),

  fetchSubscription: async (userId) => {
    set({ loading: true })
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    set({
      subscription: error || !data ? null : (data as Subscription),
      loading: false,
    })
  },

  trialDaysRemaining: () => {
    const sub = get().subscription
    if (!sub?.trial_ends_at || sub.plan !== 'trial') return null
    const end = new Date(sub.trial_ends_at)
    const n = daysBetween(new Date(), end)
    return Math.max(0, n)
  },
}))
