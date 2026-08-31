/**
 * Block long-press text selection / copy-share menus in the app shell.
 * Inputs and textareas stay selectable so parents can still type and edit.
 */

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function installDisableTextSelection(): void {
  if (typeof document === 'undefined') return

  const block = (e: Event) => {
    if (isEditableTarget(e.target)) return
    e.preventDefault()
  }

  document.addEventListener('contextmenu', block, { capture: true })
  document.addEventListener('selectstart', block, { capture: true })
}
