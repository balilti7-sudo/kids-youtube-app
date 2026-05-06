import { MessagesSquare } from 'lucide-react'
import { getWhatsAppSupportUrl } from '../../config/support'

/** Native-style FAB — YouTube red, crisp vector icon (no bitmap sticker look). */
export function WhatsAppFloatingButton() {
  const href = getWhatsAppSupportUrl()
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-[60] flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full bg-[#FF0000] text-white shadow-[0_8px_24px_rgba(0,0,0,0.35),0_2px_8px_rgba(255,0,0,0.35)] ring-1 ring-white/25 transition hover:bg-[#e60000] hover:shadow-[0_10px_28px_rgba(0,0,0,0.4)] active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:bottom-8 sm:right-6 sm:h-14 sm:w-14"
      aria-label="פתיחת וואטסאפ לתמיכה"
      title="תמיכה בוואטסאפ"
    >
      <MessagesSquare className="h-7 w-7 shrink-0 text-white sm:h-8 sm:w-8" strokeWidth={2} aria-hidden />
    </a>
  )
}
