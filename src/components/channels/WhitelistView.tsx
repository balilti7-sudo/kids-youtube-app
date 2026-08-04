import type { WhitelistedChannel } from '../../types'
import { ChannelCard } from './ChannelCard'
import { EmptyState } from '../ui/EmptyState'
import { Tv } from 'lucide-react'
import {
  PlaylistMultiSelectToolbar,
} from '../playlists/PlaylistMultiSelectToolbar'

export function WhitelistView({
  channels,
  onRemoveRequest,
  onPreviewRequest,
  canMultiSelect = false,
  selectionMode = false,
  selectedIds,
  onEnterSelectionMode,
  onExitSelectionMode,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onBulkAddToPlaylist,
  bulkLoading = false,
}: {
  channels: WhitelistedChannel[]
  onRemoveRequest: (c: WhitelistedChannel) => void
  onPreviewRequest: (c: WhitelistedChannel) => void
  canMultiSelect?: boolean
  selectionMode?: boolean
  selectedIds?: Set<string>
  onEnterSelectionMode?: () => void
  onExitSelectionMode?: () => void
  onToggleSelect?: (channelId: string) => void
  onSelectAll?: () => void
  onClearSelection?: () => void
  onBulkAddToPlaylist?: () => void
  bulkLoading?: boolean
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700 dark:text-zinc-300">
          {channels.length} ערוצים מאושרים
          {bulkLoading ? <span className="ms-2 text-xs text-slate-500">טוען סרטונים…</span> : null}
        </p>
      </div>
      {canMultiSelect &&
      onEnterSelectionMode &&
      onExitSelectionMode &&
      onBulkAddToPlaylist ? (
        <PlaylistMultiSelectToolbar
          selectionMode={selectionMode}
          selectedCount={selectedIds?.size ?? 0}
          totalVisible={channels.length}
          itemNoun="ערוצים"
          enterLabel="בחירת ערוצים"
          addButtonLabel="הוסף סרטונים לפלייליסט"
          onEnterSelectionMode={onEnterSelectionMode}
          onExitSelectionMode={onExitSelectionMode}
          onSelectAllVisible={onSelectAll}
          onClearSelection={onClearSelection}
          onAddToPlaylist={onBulkAddToPlaylist}
        />
      ) : null}
      {channels.map((c) => (
        <ChannelCard
          key={c.id}
          variant="whitelist"
          channel={c}
          onRemove={() => onRemoveRequest(c)}
          onOpenChannel={() => onPreviewRequest(c)}
          selectionMode={selectionMode}
          selected={selectedIds?.has(c.id) ?? false}
          onToggleSelect={() => onToggleSelect?.(c.id)}
        />
      ))}
    </div>
  )
}
