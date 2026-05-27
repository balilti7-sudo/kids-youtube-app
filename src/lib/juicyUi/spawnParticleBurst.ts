const PARTICLE_COLORS = ['#38bdf8', '#f472b6', '#fde047', '#c084fc', '#4ade80', '#fb923c']

let particleLayer: HTMLElement | null = null

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function getParticleLayer(): HTMLElement {
  if (!particleLayer) {
    particleLayer = document.createElement('div')
    particleLayer.className = 'juicy-particle-layer'
    particleLayer.setAttribute('aria-hidden', 'true')
    document.body.appendChild(particleLayer)
  }
  return particleLayer
}

/** Colorful star/bubble burst at viewport coordinates (~400ms). */
export function spawnParticleBurst(clientX: number, clientY: number) {
  if (typeof document === 'undefined' || prefersReducedMotion()) return

  const container = getParticleLayer()
  const count = 12

  for (let i = 0; i < count; i++) {
    const node = document.createElement('span')
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.55
    const distance = 22 + Math.random() * 38
    const dx = Math.cos(angle) * distance
    const dy = Math.sin(angle) * distance
    const size = 5 + Math.random() * 7
    const isStar = i % 3 === 0

    node.className = isStar ? 'juicy-particle juicy-particle--star' : 'juicy-particle juicy-particle--bubble'
    node.style.left = `${clientX}px`
    node.style.top = `${clientY}px`
    node.style.width = `${size}px`
    node.style.height = `${size}px`
    if (!isStar) {
      node.style.backgroundColor = PARTICLE_COLORS[i % PARTICLE_COLORS.length]!
    }
    node.style.setProperty('--juicy-dx', `${dx}px`)
    node.style.setProperty('--juicy-dy', `${dy}px`)

    container.appendChild(node)
    window.setTimeout(() => node.remove(), 420)
  }
}

export function spawnParticleBurstOnElement(element: HTMLElement, clientX?: number, clientY?: number) {
  const rect = element.getBoundingClientRect()
  spawnParticleBurst(clientX ?? rect.left + rect.width / 2, clientY ?? rect.top + rect.height / 2)
}

/** Large celebration burst (reward screen) — a few staggered waves from center. */
export function spawnMassiveConfetti(originX?: number, originY?: number) {
  if (typeof window === 'undefined' || prefersReducedMotion()) return
  const x = originX ?? window.innerWidth / 2
  const y = originY ?? window.innerHeight / 2
  spawnParticleBurst(x, y)
  window.setTimeout(() => spawnParticleBurst(x - 40, y - 20), 80)
  window.setTimeout(() => spawnParticleBurst(x + 36, y + 18), 140)
  window.setTimeout(() => {
    const container = getParticleLayer()
    const count = 28
    for (let i = 0; i < count; i++) {
      const node = document.createElement('span')
      const angle = Math.random() * Math.PI * 2
      const distance = 60 + Math.random() * 120
      const dx = Math.cos(angle) * distance
      const dy = Math.sin(angle) * distance
      const size = 6 + Math.random() * 10
      const isStar = Math.random() > 0.45
      node.className = isStar ? 'juicy-particle juicy-particle--star' : 'juicy-particle juicy-particle--bubble'
      node.style.left = `${x}px`
      node.style.top = `${y}px`
      node.style.width = `${size}px`
      node.style.height = `${size}px`
      if (!isStar) {
        node.style.backgroundColor = PARTICLE_COLORS[i % PARTICLE_COLORS.length]!
      }
      node.style.setProperty('--juicy-dx', `${dx}px`)
      node.style.setProperty('--juicy-dy', `${dy}px`)
      node.style.animationDuration = '650ms'
      container.appendChild(node)
      window.setTimeout(() => node.remove(), 680)
    }
  }, 60)
}
