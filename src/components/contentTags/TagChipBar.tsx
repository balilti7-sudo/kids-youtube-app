import { cn } from '../../lib/utils'
import type { ContentTag } from '../../lib/contentTags/types'
import { TagChip } from './TagChip'

type Props = {
  tags: ContentTag[]
  selectedTagIds?: Set<string>
  onToggleTag?: (tagId: string) => void
  weights?: Record<string, number>
  onCycleWeight?: (tagId: string) => void
  disabled?: boolean
  className?: string
  compact?: boolean
}

export function TagChipBar({
  tags,
  selectedTagIds,
  onToggleTag,
  weights,
  onCycleWeight,
  disabled,
  className,
  compact,
}: Props) {
  if (tags.length === 0) return null

  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="list">
      {tags.map((tag) => {
        const weight = weights?.[tag.tagId] ?? 0
        const selected = selectedTagIds?.has(tag.tagId) ?? false

        if (onCycleWeight) {
          return (
            <TagChip
              key={tag.tagId}
              tag={tag}
              weight={weight}
              disabled={disabled}
              compact={compact}
              onPress={() => onCycleWeight(tag.tagId)}
            />
          )
        }

        if (onToggleTag) {
          return (
            <TagChip
              key={tag.tagId}
              tag={tag}
              selected={selected}
              disabled={disabled}
              compact={compact}
              onPress={() => onToggleTag(tag.tagId)}
            />
          )
        }

        return <TagChip key={tag.tagId} tag={tag} compact={compact} />
      })}
    </div>
  )
}
