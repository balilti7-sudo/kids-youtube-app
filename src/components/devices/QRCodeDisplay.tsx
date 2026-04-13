export function QRCodeDisplay({ code }: { code: string }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50 p-6 text-center dark:border-brand-800 dark:bg-brand-950/40">
      <p className="text-sm font-medium text-slate-600 dark:text-zinc-400">קוד חיבור</p>
      <p className="mt-2 font-mono text-4xl font-bold tracking-[0.3em] text-slate-900 dark:text-zinc-50" dir="ltr">
        {code}
      </p>
      <p className="mt-2 text-xs text-slate-500 dark:text-zinc-500">הזינו במכשיר הילד (תוקף מומלץ: 15 דקות)</p>
    </div>
  )
}
