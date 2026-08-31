import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContentTag } from '../lib/contentTags/types'
import { tagUsesI18nLabel } from '../lib/contentTags/types'

export function useContentTagLabel() {
  const { t } = useTranslation()

  return useCallback(
    (tag: Pick<ContentTag, 'slug' | 'label' | 'scope'>) => {
      if (tagUsesI18nLabel(tag)) {
        return t(`contentTags.${tag.slug}`, { defaultValue: tag.slug })
      }
      return tag.label ?? tag.slug
    },
    [t]
  )
}
