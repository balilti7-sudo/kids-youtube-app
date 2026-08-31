import { useMemo } from 'react'
import { CONTENT_TAGS_ENABLED, CONTENT_TAGS_STRICT_MODE_DEFAULT } from '../config/contentTags'
import type { ChildAllowedChannel } from '../lib/childDevice'
import type { TagPreference } from '../lib/contentTags/types'
import {
  collectFilterTagsFromChannels,
  getRecommendedChannels,
  rankChannelsForBrowse,
  buildTagWeightMaps,
  toKidBrowseChannel,
  type KidBrowseChannel,
} from '../lib/contentTags/tagBrowseRank'

export function useKidBrowseChannels(
  channels: ChildAllowedChannel[],
  tagPreferences: TagPreference[],
  activeTagSlug: string | null
) {
  return useMemo(() => {
    if (!CONTENT_TAGS_ENABLED) {
      const plain = channels.map(toKidBrowseChannel)
      return {
        enabled: false,
        browseChannels: plain,
        recommendedChannels: [] as KidBrowseChannel[],
        filterTags: [],
        showBrowseUi: false,
      }
    }

    const browseInput = channels.map(toKidBrowseChannel)
    const weights = buildTagWeightMaps(tagPreferences)
    const browseChannels = rankChannelsForBrowse(browseInput, weights, {
      filterSlug: activeTagSlug,
      strictMode: CONTENT_TAGS_STRICT_MODE_DEFAULT,
    })
    const recommendedChannels = getRecommendedChannels(browseInput, weights)
    const filterTags = collectFilterTagsFromChannels(browseInput)
    const showBrowseUi = filterTags.length > 0 || recommendedChannels.length > 0

    return {
      enabled: true,
      browseChannels,
      recommendedChannels,
      filterTags,
      showBrowseUi,
    }
  }, [channels, tagPreferences, activeTagSlug])
}
