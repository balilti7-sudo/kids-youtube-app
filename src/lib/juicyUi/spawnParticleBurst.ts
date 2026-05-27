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
