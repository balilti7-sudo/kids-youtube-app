import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PlanCard } from './PlanCard'
import { toast } from 'sonner'

export function PricingScreen() {
  const [loading, setLoading] = useState<'monthly' | 'yearly' | null>(null)

  const checkout = async (plan: 'monthly' | 'yearly') => {
    setLoading(plan)
    const { data, error } = await supabase.functions.invoke<{ url?: string }>('create-checkout', {
      body: { plan },
    })
    setLoading(null)
    if (error || !data?.url) {
      toast.error('לא ניתן לפתוח תשלום כרגע')
      return
    }
    window.location.href = data.url
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <PlanCard
        title="חודשי"
        price="₪29 / חודש"
        features={['עד 5 מכשירים', 'ניהול ערוצים', 'תמיכה במייל']}
        onSelect={() => void checkout('monthly')}
        loading={loading === 'monthly'}
      />
      <PlanCard
        title="שנתי"
        price="₪249 / שנה"
        features={['עד 10 מכשירים', 'חיסכון לשנה', 'עדכונים שוטפים']}
        highlighted
        onSelect={() => void checkout('yearly')}
        loading={loading === 'yearly'}
      />
    </div>
  )
}
