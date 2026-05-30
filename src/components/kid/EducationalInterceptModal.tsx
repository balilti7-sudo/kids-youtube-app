import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import type { EducationalScene, SceneItemId } from '../../data/educationalScenes'
import { spawnMassiveConfetti, spawnParticleBurstOnElement } from '../../lib/juicyUi/spawnParticleBurst'
import { cn } from '../../lib/utils'
import { EducationalRoomScene } from './EducationalRoomScene'
import { LionMascot, type LionMood } from './LionMascot'
import { useLionProgressionOptional } from '../../contexts/LionProgressionContext'

type ModalPhase = 'playing' | 'celebrating'

type Props = {
  scene: EducationalScene
  initialFixedItems: string[]
  onMarkItemFixed: (itemId: SceneItemId) => Promise<string[]>
  onComplete: () => void
}

export function EducationalInterceptModal({ scene, initialFixedItems, onMarkItemFixed, onComplete }: Props) {
  const [fixedItems, setFixedItems] = useState<string[]>(() => [...initialFixedItems])
  const [lastFixedItem, setLastFixedItem] = useState<SceneItemId | null>(null)
  const [lionMood, setLionMood] = useState<LionMood>('worried')
  const [phase, setPhase] = useState<ModalPhase>(() =>
    initialFixedItems.length >= scene.items.length ? 'celebrating' : 'playing'
  )

  const fixedSet = useMemo(() => new Set(fixedItems), [fixedItems])
  const remaining = scene.items.filter((item) => !fixedSet.has(item.id))
  const lion = useLionProgressionOptional()

  useEffect(() => {
    setFixedItems([...initialFixedItems])
  }, [initialFixedItems])

  useEffect(() => {
    if (initialFixedItems.length >= scene.items.length) {
      spawnMassiveConfetti()
      setLionMood('celebrate')
      const id = window.setTimeout(() => onComplete(), 2000)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [initialFixedItems.length, onComplete, scene.items.length])

  const handleItemTap = useCallback(
    (itemId: SceneItemId, element: HTMLElement) => {
      if (fixedSet.has(itemId)) return
      spawnParticleBurstOnElement(element)
      setLionMood('bounce')
      window.setTimeout(() => setLionMood('worried'), 520)
      void onMarkItemFixed(itemId).then((next) => {
        setFixedItems(next)
        setLastFixedItem(itemId)

        if (next.length >= scene.items.length) {
          spawnMassiveConfetti()
          setLionMood('celebrate')
          setPhase('celebrating')
          window.setTimeout(() => {
            onComplete()
          }, 2000)
        }
      })
    },
    [fixedSet, onComplete, onMarkItemFixed, scene.items.length]
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex flex-col items-center justify-center bg-gradient-to-b from-sky-950 via-indigo-950 to-zinc-950 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="intercept-title"
      dir="rtl"
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="flex w-full max-w-lg flex-col gap-3 rounded-3xl border border-white/10 bg-zinc-900/90 p-4 shadow-2xl shadow-black/40 sm:p-5"
      >
        <header className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-300/90">הפסקה חינוכית</p>
          <h2 id="intercept-title" className="mt-1 text-xl font-black text-white sm:text-2xl">
            {scene.title}
          </h2>
          <p className="mt-1 text-sm text-zinc-300">{phase === 'celebrating' ? 'כל הכבוד! החדר מסודר!' : scene.subtitle}</p>
        </header>

        <div className="relative aspect-[400/260] w-full overflow-hidden rounded-2xl border border-white/10 bg-sky-100/10">
          <EducationalRoomScene fixedItems={fixedSet} lastFixedItem={lastFixedItem} />
          {phase === 'playing'
            ? scene.items.map((item) =>
                fixedSet.has(item.id) ? null : (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      'absolute rounded-xl border-2 border-dashed border-amber-300/70 bg-amber-400/10',
                      'animate-pulse transition hover:border-amber-200 hover:bg-amber-300/20',
                      'focus-visible:outline focus-visible:ring-2 focus-visible:ring-amber-300'
                    )}
                    style={{
                      left: `${item.tapZone.x}%`,
                      top: `${item.tapZone.y}%`,
                      width: `${item.tapZone.w}%`,
                      height: `${item.tapZone.h}%`,
                    }}
                    aria-label={item.label}
                    title={item.hint}
                    onClick={(e) => handleItemTap(item.id, e.currentTarget)}
                  />
                )
              )
            : null}
        </div>

        <div className="flex flex-col items-center gap-2">
          <LionMascot mood={lionMood} outfitId={lion?.activeOutfitId ?? 'cub'} />
          <p className="max-w-sm text-center text-sm leading-relaxed text-zinc-200">
            {phase === 'celebrating'
              ? 'גור האריה שמח! ממשיכים לצפות…'
              : remaining[0]?.hint ?? scene.lionIntro}
          </p>
          {phase === 'playing' ? (
            <p className="text-xs text-zinc-500">
              {fixedItems.length} / {scene.items.length} משימות הושלמו
            </p>
          ) : null}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
