import { Input } from '../ui/Input'

export function PairingCodeInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">קוד מההורה</label>
      <Input
        dir="ltr"
        inputMode="numeric"
        maxLength={6}
        placeholder="000000"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </div>
  )
}
