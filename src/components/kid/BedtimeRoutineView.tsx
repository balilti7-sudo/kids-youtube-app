import { BedtimeRoutineEmergencyExit } from './BedtimeRoutineEmergencyExit'
import { BedtimeRoutineZone } from './BedtimeRoutineZone'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import { cn } from '../../lib/utils'
import { Moon, Sparkles } from 'lucide-react'

type Props = {
  className?: string
}

/** Full-screen bedtime routine — tasks, parent approval, wheel, treasure. */
export function BedtimeRoutineView({ className }: Props) {
  const runtime = useChildRuntimeOptional()
  const bedtime = runtime?.bedtimeState
  const showParentApprove = Boolean(
    bedtime?.tasksCompleted && !bedtime.parentApproved && !bedtime.wheelSpun
  )

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-[250] flex flex-col overflow-y-auto bg-gradient-to-b from-indigo-950 via-violet-950 to-zinc-950 pb-28',
          className
        )}
        dir="rtl"
        role="main"
        aria-label="שגרת שינה"
      >
        <header className="sticky top-0 z-10 border-b border-indigo-400/20 bg-indigo-950/90 px-4 py-4 backdrop-blur-md">
          <div className="mx-auto flex max-w-lg items-center justify-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-200/80" aria-hidden />
            <Moon className="h-6 w-6 text-amber-200" aria-hidden />
            <h1 className="text-lg font-black text-white sm:text-xl">זמן שגרת השינה</h1>
            <Moon className="h-6 w-6 text-amber-200" aria-hidden />
            <Sparkles className="h-5 w-5 text-amber-200/80" aria-hidden />
          </div>
          <p className="mx-auto mt-2 max-w-md text-center text-sm text-indigo-200/85">
            סמנו את המשימות, חכו לאישור ההורים, ואז סובבו את הגלגל!
          </p>
        </header>

        <div className="mx-auto w-full max-w-lg flex-1 px-3 py-4 sm:px-4">
          <BedtimeRoutineZone />
        </div>
      </div>

      <BedtimeRoutineEmergencyExit variant="footer" showParentApprove={showParentApprove} />
    </>
  )
}
