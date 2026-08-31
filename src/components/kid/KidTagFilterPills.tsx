import { cn } from '../../lib/utils'
import { useContentTagLabel } from '../../hooks/useContentTagLabel'
import { useTranslation } from 'react-i18next'
import type { ChannelContentTag } from '../../lib/contentTags/types'
import { resolveTagIcon } from '../../lib/contentTags/tagUi'

type Props = {
  activeSlug: string | null
  onChange: (slug: string | null) => void
  tags: ChannelContentTag[]
  className?: string
}

export function KidTagFilterPills({ activeSlug, onChange, tags, className }: Props) {
  const { t } = useTranslation()
  const labelFor = useContentTagLabel()

  if (tags.length === 0) return null

  return (
    <div className={cn('min-w-0', className)}>
      <div
        className="premium-scrollbar flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]"
        role="tablist"
        aria-label={t('contentTags.kidFilterLabel')}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSlug == null || activeSlug === ''}
          onClick={() => onChange(null)}
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border px-3.5 py-2 text-sm font-semibold transition touch-manipulation',
            activeSlug == null || activeSlug === ''
              ? 'border-sky-400/60 bg-sky-500/20 text-sky-100 shadow-sm'
              : 'border-zinc-700/80 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800'
          )}
        >
          {t('contentTags.kidAll')}
        </button>
        {tags.map((tag) => {
          const Icon = resolveTagIcon(tag.iconKey)
          const selected = activeSlug === tag.slug
          return (
            <button
              key={tag.tagId}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(selected ? null : tag.slug)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-semibold transition touch-manipulation',
                `safetube-tag-${tag.colorToken}`,
                selected && 'ring-2 ring-sky-400/70'
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="max-w-[8rem] truncate">{labelFor(tag)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
