import { useTranslation } from 'react-i18next'
import type { ContentTag } from '../../lib/contentTags/types'
import { TagChipBar } from './TagChipBar'

type Props = {
  tags: ContentTag[]
  selectedTagIds: Set<string>
  onToggleTag: (tagId: string) => void
  disabled?: boolean
}

export function TagOnAddPrompt({ tags, selectedTagIds, onToggleTag, disabled }: Props) {
  const { t } = useTranslation()

  if (tags.length === 0) return null

  return (
    <div className="mt-4 rounded-2xl border border-violet-500/20 bg-violet-950/15 px-3.5 py-3">
      <p className="mb-2 text-sm font-semibold text-zinc-100">{t('contentTags.tagOnAddTitle')}</p>
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">{t('contentTags.tagOnAddHint')}</p>
      <TagChipBar
        tags={tags}
        selectedTagIds={selectedTagIds}
        onToggleTag={onToggleTag}
        disabled={disabled}
        compact
      />
    </div>
  )
}
