import { AlertCircle } from 'lucide-react'
import { Button } from './Button'

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-950/40">
      <AlertCircle className="h-10 w-10 text-red-600 dark:text-red-400" />
      <p className="text-sm font-medium text-red-900 dark:text-red-200">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          נסה שוב
        </Button>
      ) : null}
    </div>
  )
}
