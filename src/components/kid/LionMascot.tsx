import { useId } from 'react'
import type { LionOutfitId } from '../../data/lionOutfits'
import { cn } from '../../lib/utils'

export type LionMood = 'worried' | 'bounce' | 'celebrate'

type Props = {
  mood: LionMood
  outfitId?: LionOutfitId
  className?: string
  compact?: boolean
}

function LionOutfitAccessories({ outfitId, uid }: { outfitId: LionOutfitId; uid: string }) {
  if (outfitId === 'hero') {
    return (
      <g className="lion-outfit-hero-cape">
        <path
          d="M52 118 Q100 92 148 118 L142 178 Q100 168 58 178 Z"
          fill={`url(#${uid}-cape)`}
          stroke="#dc2626"
          strokeWidth="2"
        />
      </g>
    )
  }
  if (outfitId === 'chef') {
    return (
      <g className="lion-outfit-chef-hat">
        <ellipse cx="100" cy="36" rx="38" ry="10" fill="#fff" stroke="#e5e7eb" strokeWidth="2" />
        <rect x="68" y="18" width="64" height="22" rx="8" fill="#fff" stroke="#e5e7eb" strokeWidth="2" />
        <path d="M76 18 Q100 -2 124 18" fill="#fff" stroke="#e5e7eb" strokeWidth="2" />
      </g>
    )
  }
  if (outfitId === 'explorer') {
    return (
      <g className="lion-outfit-magnifier">
        <circle cx="148" cy="162" r="16" fill="none" stroke="#38bdf8" strokeWidth="4" />
        <circle cx="148" cy="162" r="9" fill="#e0f2fe" opacity="0.65" />
        <line x1="160" y1="174" x2="172" y2="186" stroke="#78716c" strokeWidth="5" strokeLinecap="round" />
      </g>
    )
  }
  return null
}

/** Official SafeTube lion cub mascot — responsive inline SVG with moods + unlockable outfits. */
export function LionMascot({ mood, outfitId = 'cub', className, compact }: Props) {
  const uid = useId().replace(/:/g, '')

  return (
    <svg
      viewBox="0 0 200 220"
      className={cn(
        compact ? 'h-10 w-10' : 'mx-auto h-auto w-full max-w-[180px]',
        'select-none',
        mood === 'worried' && 'animate-[lionWorried_2.4s_ease-in-out_infinite]',
        mood === 'bounce' && 'animate-[lionBounce_0.55s_ease-out]',
        mood === 'celebrate' && 'animate-[lionCelebrate_0.9s_ease-in-out_infinite]',
        className
      )}
      aria-hidden
      role="img"
    >
      <defs>
        <linearGradient id={`${uid}-body`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id={`${uid}-mane`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <radialGradient id={`${uid}-cheek`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fecaca" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#fecaca" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-cape`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#991b1b" />
        </linearGradient>
      </defs>

      {outfitId === 'hero' ? <LionOutfitAccessories outfitId="hero" uid={uid} /> : null}

      <path
        d="M158 148 Q188 130 182 108 Q176 92 162 102"
        fill="none"
        stroke="#d97706"
        strokeWidth="10"
        strokeLinecap="round"
      />

      <ellipse cx="100" cy="158" rx="52" ry="44" fill={`url(#${uid}-body)`} />
      <ellipse cx="100" cy="162" rx="34" ry="28" fill="#fcd34d" opacity="0.45" />

      <ellipse cx="72" cy="188" rx="14" ry="10" fill="#d97706" />
      <ellipse cx="128" cy="188" rx="14" ry="10" fill="#d97706" />

      <circle cx="100" cy="88" r="58" fill={`url(#${uid}-mane)`} opacity="0.95" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <ellipse
          key={deg}
          cx={100 + Math.cos((deg * Math.PI) / 180) * 52}
          cy={88 + Math.sin((deg * Math.PI) / 180) * 52}
          rx="12"
          ry="16"
          fill="#fbbf24"
          transform={`rotate(${deg} ${100 + Math.cos((deg * Math.PI) / 180) * 52} ${88 + Math.sin((deg * Math.PI) / 180) * 52})`}
        />
      ))}

      <circle cx="100" cy="86" r="42" fill={`url(#${uid}-body)`} />

      {outfitId === 'chef' ? <LionOutfitAccessories outfitId="chef" uid={uid} /> : null}

      <circle cx="68" cy="58" r="16" fill="#fbbf24" />
      <circle cx="68" cy="58" r="9" fill="#fde68a" />
      <circle cx="132" cy="58" r="16" fill="#fbbf24" />
      <circle cx="132" cy="58" r="9" fill="#fde68a" />

      <circle cx="72" cy="96" r="14" fill={`url(#${uid}-cheek)`} />
      <circle cx="128" cy="96" r="14" fill={`url(#${uid}-cheek)`} />

      {mood === 'worried' ? (
        <>
          <path d="M78 78 Q84 74 90 78" fill="none" stroke="#422006" strokeWidth="3" strokeLinecap="round" />
          <path d="M110 78 Q116 74 122 78" fill="none" stroke="#422006" strokeWidth="3" strokeLinecap="round" />
          <circle cx="84" cy="84" r="4" fill="#422006" />
          <circle cx="116" cy="84" r="4" fill="#422006" />
          <path d="M92 108 Q100 102 108 108" fill="none" stroke="#422006" strokeWidth="2.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="84" cy="82" rx="7" ry="9" fill="#fff" />
          <ellipse cx="116" cy="82" rx="7" ry="9" fill="#fff" />
          <circle cx="86" cy="84" r="4.5" fill="#422006" />
          <circle cx="118" cy="84" r="4.5" fill="#422006" />
          <circle cx="88" cy="82" r="1.8" fill="#fff" />
          <circle cx="120" cy="82" r="1.8" fill="#fff" />
          <path
            d={mood === 'celebrate' ? 'M88 108 Q100 118 112 108' : 'M90 106 Q100 112 110 106'}
            fill="none"
            stroke="#422006"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </>
      )}

      <ellipse cx="100" cy="94" rx="8" ry="6" fill="#92400e" />
      <path d="M100 100 L100 104" stroke="#422006" strokeWidth="2" strokeLinecap="round" />

      <ellipse cx="78" cy="168" rx="12" ry="9" fill="#fbbf24" />
      <ellipse cx="122" cy="168" rx="12" ry="9" fill="#fbbf24" />

      {outfitId === 'explorer' ? <LionOutfitAccessories outfitId="explorer" uid={uid} /> : null}

      {mood === 'celebrate' ? (
        <>
          <text x="42" y="52" fontSize="18" fill="#fde047">
            ✦
          </text>
          <text x="148" y="48" fontSize="16" fill="#f472b6">
            ★
          </text>
          <text x="156" y="78" fontSize="14" fill="#38bdf8">
            ✦
          </text>
        </>
      ) : null}
    </svg>
  )
}
