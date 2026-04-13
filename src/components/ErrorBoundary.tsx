import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/Button'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-lg font-semibold text-slate-900 dark:text-zinc-50">משהו השתבש</p>
          <p className="max-w-md text-sm text-slate-600 dark:text-zinc-400">{this.state.error.message}</p>
          <Button onClick={() => window.location.reload()}>רענון</Button>
        </div>
      )
    }
    return this.props.children
  }
}
