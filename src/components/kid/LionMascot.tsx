import { cn } from '../../lib/utils'

export type LionMood = 'worried' | 'bounce' | 'celebrate'

type Props = {
  mood: LionMood
  className?: string
}

/** Official SafeTube lion cub mascot — responsive inline SVG with mood animations. */
export function LionMascot({ mood, className }: Props) {
  return (
    <svg
      viewBox="0 0 200 220"
      className={cn(
        'mx-auto h-auto w-full max-w-[180px] select-none',
        mood === 'worried' && 'animate-[lionWorried_2.4s_ease-in-out_infinite]',
        mood === 'bounce' && 'animate-[lionBounce_0.55s_ease-out]',
        mood === 'celebrate' && 'animate-[lionCelebrate_0.9s_ease-in-out_infinite]',
        className
      )}
      aria-hidden
      role="img"
    >
      <defs>
        <linearGradient id="lionBody" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id="lionMane" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <radialGradient id="lionCheek" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fecaca" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#fecaca" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Tail */}
      <path
        d="M158 148 Q188 130 182 108 Q176 92 162 102"
        fill="none"
        stroke="#d97706"
        strokeWidth="10"
        strokeLinecap="round"
      />

      {/* Body */}
      <ellipse cx="100" cy="158" rx="52" ry="44" fill="url(#lionBody)" />
      <ellipse cx="100" cy="162" rx="34" ry="28" fill="#fcd34d" opacity="0.45" />

      {/* Back legs */}
      <ellipse cx="72" cy="188" rx="14" ry="10" fill="#d97706" />
      <ellipse cx="128" cy="188" rx="14" ry="10" fill="#d97706" />

      {/* Mane */}
      <circle cx="100" cy="88" r="58" fill="url(#lionMane)" opacity="0.95" />
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

      {/* Head */}
      <circle cx="100" cy="86" r="42" fill="url(#lionBody)" />

      {/* Ears */}
      <circle cx="68" cy="58" r="16" fill="#fbbf24" />
      <circle cx="68" cy="58" r="9" fill="#fde68a" />
      <circle cx="132" cy="58" r="16" fill="#fbbf24" />
      <circle cx="132" cy="58" r="9" fill="#fde68a" />

      {/* Cheeks */}
      <circle cx="72" cy="96" r="14" fill="url(#lionCheek)" />
      <circle cx="128" cy="96" r="14" fill="url(#lionCheek)" />

      {/* Eyes — mood dependent */}
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

      {/* Nose */}
      <ellipse cx="100" cy="94" rx="8" ry="6" fill="#92400e" />
      <path d="M100 100 L100 104" stroke="#422006" strokeWidth="2" strokeLinecap="round" />

      {/* Front paws */}
      <ellipse cx="78" cy="168" rx="12" ry="9" fill="#fbbf24" />
      <ellipse cx="122" cy="168" rx="12" ry="9" fill="#fbbf24" />

      {/* Celebrate sparkles */}
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
