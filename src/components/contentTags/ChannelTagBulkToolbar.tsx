import { Tags } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ContentTag } from '../../lib/contentTags/types'
import { Button } from '../ui/Button'
import { TagChipBar } from './TagChipBar'

type Props = {
  tags: ContentTag[]
  selectedChannelCount: number
  selectedTagIds: Set<string>
  onToggleTag: (tagId: string) => void
  onApply: () => void
  applying?: boolean
  className?: string
}

export function ChannelTagBulkToolbar({
  tags,
  selectedChannelCount,
  selectedTagIds,
  onToggleTag,
  onApply,
  applying,
  className,
}: Props) {
  const { t } = useTranslation()

  if (tags.length === 0) return null

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border border-violet-500/30 bg-violet-950/25 px-3.5 py-3 ring-1 ring-violet-500/15 ${className ?? ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-100">
          {t('contentTags.bulkTagTitle', { count: selectedChannelCount })}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="!min-h-10 gap-2 !px-3 text-sm"
          disabled={applying || selectedChannelCount === 0}
          onClick={onApply}
        >
          <Tags className="h-4 w-4 shrink-0" aria-hidden />
          {applying ? t('common.loading') : t('contentTags.bulkTagApply')}
        </Button>
      </div>
      <TagChipBar
        tags={tags}
        selectedTagIds={selectedTagIds}
        onToggleTag={onToggleTag}
        disabled={applying}
        compact
      />
      <p className="text-xs text-zinc-500">{t('contentTags.bulkTagHint')}</p>
    </div>
  )
}
