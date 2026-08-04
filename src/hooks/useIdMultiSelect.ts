import { useCallback, useMemo, useState } from 'react'

/** Multi-select by stable string id (channel id / youtube channel id). */
export function useIdMultiSelect() {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  const selectedCount = selectedIds.size

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds])

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectMany = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (id) next.add(id)
      }
      return next
    })
  }, [])

  const clear = useCallback(() => setSelectedIds(new Set()), [])

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true)
  }, [])

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [])

  return useMemo(
    () => ({
      selectionMode,
      selectedIds,
      selectedCount,
      isSelected,
      toggle,
      selectMany,
      clear,
      enterSelectionMode,
      exitSelectionMode,
    }),
    [
      selectionMode,
      selectedIds,
      selectedCount,
      isSelected,
      toggle,
      selectMany,
      clear,
      enterSelectionMode,
      exitSelectionMode,
    ]
  )
}
