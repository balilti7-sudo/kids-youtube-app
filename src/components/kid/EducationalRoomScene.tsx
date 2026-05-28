import { motion } from 'framer-motion'
import type { SceneItemId } from '../../data/educationalScenes'

type Props = {
  fixedItems: ReadonlySet<string>
  lastFixedItem: SceneItemId | null
}

/** Interactive bedroom scene for Educational Intercept Scene 1. */
export function EducationalRoomScene({ fixedItems, lastFixedItem }: Props) {
  const toysFixed = fixedItems.has('toys')
  const heaterFixed = fixedItems.has('heater')
  const bedFixed = fixedItems.has('bed')

  return (
    <svg viewBox="0 0 400 260" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="wallGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="100%" stopColor="#bae6fd" />
        </linearGradient>
        <linearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#fcd34d" />
        </linearGradient>
      </defs>

      {/* Wall & floor */}
      <rect x="0" y="0" width="400" height="190" fill="url(#wallGrad)" />
      <rect x="0" y="190" width="400" height="70" fill="url(#floorGrad)" />
      <line x1="0" y1="190" x2="400" y2="190" stroke="#ca8a04" strokeWidth="2" />

      {/* Window */}
      <rect x="24" y="28" width="72" height="58" rx="4" fill="#7dd3fc" stroke="#0284c7" strokeWidth="3" />
      <line x1="60" y1="28" x2="60" y2="86" stroke="#0284c7" strokeWidth="2" />
      <line x1="24" y1="57" x2="96" y2="57" stroke="#0284c7" strokeWidth="2" />

      {/* Coat hanger on wall */}
      <g transform="translate(318, 36)">
        <rect x="0" y="0" width="6" height="48" fill="#78716c" rx="2" />
        <path d="M3 48 L3 68 M-14 58 L20 58" stroke="#78716c" strokeWidth="4" strokeLinecap="round" />
        {heaterFixed ? (
          <motion.g
            initial={{ x: -120, y: 80, opacity: 0, rotate: -20 }}
            animate={{ x: 0, y: 52, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 180, damping: 16 }}
          >
            <rect x="-8" y="54" width="22" height="36" rx="4" fill="#dc2626" />
            <path d="M-4 58 L4 58 M-4 66 L4 66 M-4 74 L4 74" stroke="#fca5a5" strokeWidth="2" />
          </motion.g>
        ) : null}
      </g>

      {/* Space heater */}
      <g transform="translate(268, 118)">
        <rect x="0" y="0" width="48" height="64" rx="6" fill="#44403c" stroke="#292524" strokeWidth="2" />
        <rect x="8" y="10" width="32" height="40" rx="4" fill="#ef4444" opacity="0.85" />
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1="12" y1={18 + i * 8} x2="36" y2={18 + i * 8} stroke="#fecaca" strokeWidth="2" />
        ))}
        {!heaterFixed ? (
          <motion.g
            animate={lastFixedItem === 'heater' ? { opacity: 0 } : { x: [0, -2, 2, 0] }}
            transition={{ repeat: lastFixedItem === 'heater' ? 0 : Infinity, duration: 1.2 }}
          >
            <rect x="-28" y="28" width="22" height="36" rx="4" fill="#dc2626" />
            <path d="M-24 32 L-16 32 M-24 40 L-16 40 M-24 48 L-16 48" stroke="#fca5a5" strokeWidth="2" />
          </motion.g>
        ) : null}
      </g>

      {/* Toy chest */}
      <g transform="translate(24, 168)">
        <rect x="0" y="16" width="72" height="44" rx="6" fill="#92400e" stroke="#78350f" strokeWidth="2" />
        <rect x="4" y="20" width="64" height="8" rx="2" fill="#b45309" />
        <text x="36" y="48" textAnchor="middle" fontSize="11" fill="#fde68a" fontWeight="bold">
          צעצועים
        </text>
      </g>

      {/* Scattered toys → fly into chest */}
      {!toysFixed ? (
        <motion.g
          animate={lastFixedItem === 'toys' ? { x: -40, y: 60, scale: 0.2, opacity: 0 } : {}}
          transition={{ type: 'spring', stiffness: 120, damping: 14 }}
        >
          <circle cx="58" cy="198" r="10" fill="#38bdf8" />
          <rect x="78" y="188" width="18" height="18" rx="3" fill="#f472b6" transform="rotate(15 87 197)" />
          <polygon points="108,200 118,182 128,200" fill="#4ade80" />
          <circle cx="92" cy="212" r="8" fill="#fde047" />
        </motion.g>
      ) : (
        <motion.text
          x="60"
          y="200"
          fontSize="20"
          initial={{ scale: 0 }}
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 0.4 }}
        >
          ✓
        </motion.text>
      )}

      {/* Bed */}
      <g transform="translate(118, 148)">
        <rect x="0" y="32" width="120" height="28" rx="4" fill="#a8a29e" />
        <rect x="8" y="8" width="104" height="36" rx="6" fill="#fff" stroke="#d6d3d1" strokeWidth="2" />
        <rect x="0" y="20" width="16" height="40" rx="4" fill="#78716c" />
        {!bedFixed ? (
          <motion.path
            d="M14 14 Q60 28 108 18 Q112 34 108 42 Q60 52 14 38 Z"
            fill="#93c5fd"
            stroke="#3b82f6"
            strokeWidth="2"
            animate={{ d: ['M14 14 Q60 28 108 18 Q112 34 108 42 Q60 52 14 38 Z', 'M14 20 Q60 24 108 22 Q112 30 108 36 Q60 40 14 34 Z'] }}
            transition={{ repeat: Infinity, duration: 2, repeatType: 'reverse' }}
          />
        ) : (
          <motion.rect
            x="14"
            y="22"
            width="92"
            height="18"
            rx="4"
            fill="#93c5fd"
            stroke="#3b82f6"
            strokeWidth="2"
            initial={{ scaleY: 0.6, y: 30 }}
            animate={{ scaleY: 1, y: 22 }}
            transition={{ type: 'spring', stiffness: 200, damping: 18 }}
          />
        )}
        <rect x="14" y="42" width="92" height="6" rx="2" fill="#e7e5e4" />
      </g>

      {/* Rug */}
      <ellipse cx="200" cy="218" rx="90" ry="18" fill="#fdba74" opacity="0.55" />
    </svg>
  )
}
