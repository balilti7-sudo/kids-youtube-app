import type { WhitelistedChannel } from '../../types'
import { ChannelCard } from './ChannelCard'
import { EmptyState } from '../ui/EmptyState'
import { Tv } from 'lucide-react'

export function WhitelistView({
  channels,
  onRemoveRequest,
  onPreviewRequest,
  manageLocked,
}: {
  channels: WhitelistedChannel[]
  onRemoveRequest: (c: WhitelistedChannel) => void
  onPreviewRequest: (c: WhitelistedChannel) => void
  manageLocked?: boolean
}) {
  if (channels.length === 0) {
    return (
      <EmptyState
        icon={<Tv className="mx-auto h-10 w-10" />}
        title="אין ערוצים מאושרים"
        description="השתמשו בחיפוש כדי להוסיף ערוץ ראשון."
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-slate-700 dark:text-zinc-300">{channels.length} ערוצים מאושרים</p>
      {channels.map((c) => (
        <ChannelCard
          key={c.id}
          variant="whitelist"
          channel={c}
          onRemove={() => onRemoveRequest(c)}
          onOpenChannel={() => onPreviewRequest(c)}
          manageLocked={manageLocked}
        />
      ))}
    </div>
  )
}
