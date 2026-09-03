/**
 * TEMPORARY on-screen debug for expand router / short surface detection (phone-only).
 * Remove after diagnosing short vs long expand routing.
 */

const PANEL_ID = 'safetube-short-expand-debug'
const LOG_PREFIX = '[SafeTubeExpandRouter]'

let lines: string[] = []

function ensurePanel(): HTMLDivElement | null {
  if (!import.meta.env.DEV && import.meta.env.VITE_SHORT_EXPAND_DEBUG !== 'true') return null
  if (typeof document === 'undefined') return null
  let panel = document.getElementById(PANEL_ID) as HTMLDivElement | null
  if (panel) return panel

  panel = document.createElement('div')
  panel.id = PANEL_ID
  panel.setAttribute('data-safetube-debug', 'expand-router')
  panel.style.cssText = [
    'position:fixed',
    'inset:auto 8px 8px 8px',
    'max-height:55vh',
    'z-index:2147483646',
    'overflow:auto',
    'padding:10px 12px 36px',
    'border-radius:12px',
    'background:rgba(0,0,0,0.92)',
    'color:#7CFFB2',
    'font:12px/1.35 ui-monospace,Menlo,Consolas,monospace',
    'white-space:pre-wrap',
    'word-break:break-word',
    'box-shadow:0 8px 28px rgba(0,0,0,0.55)',
    'border:1px solid rgba(124,255,178,0.35)',
    'pointer-events:auto',
    'direction:ltr',
    'text-align:left',
  ].join(';')

  const title = document.createElement('div')
  title.textContent = 'EXPAND ROUTER DEBUG — short vs long path (tap ✕)'
  title.style.cssText = 'color:#fff;font-weight:700;margin-bottom:8px;font-size:13px'
  panel.appendChild(title)

  const body = document.createElement('div')
  body.id = `${PANEL_ID}-body`
  panel.appendChild(body)

  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '✕'
  close.setAttribute('aria-label', 'Close debug')
  close.style.cssText = [
    'position:absolute',
    'top:6px',
    'right:8px',
    'width:32px',
    'height:32px',
    'border:0',
    'border-radius:8px',
    'background:#333',
    'color:#fff',
    'font-size:16px',
    'font-weight:700',
  ].join(';')
  close.onclick = () => {
    panel?.remove()
    lines = []
  }
  panel.appendChild(close)

  document.body.appendChild(panel)
  return panel
}

function render(): void {
  const panel = ensurePanel()
  if (!panel) return
  const body = document.getElementById(`${PANEL_ID}-body`)
  if (body) body.textContent = lines.join('\n')
  panel.scrollTop = panel.scrollHeight
}

/** Append a debug line to on-screen panel + console. */
export function shortExpandDebug(message: string, data?: unknown): void {
  if (!import.meta.env.DEV && import.meta.env.VITE_SHORT_EXPAND_DEBUG !== 'true') return
  const stamp = new Date().toISOString().slice(11, 23)
  const extra =
    data === undefined
      ? ''
      : typeof data === 'string'
        ? ` ${data}`
        : ` ${JSON.stringify(data)}`
  const line = `${stamp} ${message}${extra}`
  lines.push(line)
  console.log(LOG_PREFIX, message, data ?? '')
  render()
}

export function shortExpandDebugClear(): void {
  if (!import.meta.env.DEV && import.meta.env.VITE_SHORT_EXPAND_DEBUG !== 'true') return
  lines = []
  render()
}
