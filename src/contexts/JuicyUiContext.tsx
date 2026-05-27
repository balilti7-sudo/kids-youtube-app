import {
  createContext,
  useCallback,
  useContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { spawnParticleBurst } from '../lib/juicyUi/spawnParticleBurst'
import { cn } from '../lib/utils'

const JuicyUiContext = createContext(false)

export function JuicyUiProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <JuicyUiContext.Provider value={enabled}>{children}</JuicyUiContext.Provider>
}

export function useJuicyUiEnabled() {
  return useContext(JuicyUiContext)
}

export function useJuicyPointerBurst() {
  const enabled = useJuicyUiEnabled()

  return useCallback(
    (event: ReactPointerEvent) => {
      if (!enabled || event.button !== 0) return
      spawnParticleBurst(event.clientX, event.clientY)
    },
    [enabled]
  )
}

/** Tactile shrink/pop on press — pair with `group/juicy` on thumbnail wrappers. */
export const JUICY_PRESSABLE_CLASS =
  'juicy-press transition-transform duration-100 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100'

export const JUICY_THUMB_INNER_CLASS =
  'juicy-thumb-inner transition-transform duration-100 group-active/juicy:scale-95 group-hover/juicy:scale-[1.02] motion-reduce:transform-none'

export function juicyPressableClass(enabled: boolean, extra?: string) {
  return cn(enabled && JUICY_PRESSABLE_CLASS, extra)
}
