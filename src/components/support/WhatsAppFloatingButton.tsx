import { MessageSquare } from 'lucide-react'
import { getWhatsAppSupportUrl } from '../../config/support'

/** FAB — perfect circle, YouTube red, white lucide chat icon. */
export function WhatsAppFloatingButton() {
  const href = getWhatsAppSupportUrl()
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-[60] flex aspect-square h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#FF0000] text-white shadow-[0_8px_28px_rgba(0,0,0,0.38)] ring-[1.5px] ring-white/30 transition hover:bg-[#e60000] hover:ring-white/45 active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:bottom-8 sm:right-6 sm:h-[3.75rem] sm:w-[3.75rem]"
      aria-label="פתיחת וואטסאפ לתמיכה"
      title="תמיכה בוואטסאפ"
    >
      <MessageSquare className="h-[46%] w-[46%] text-white" strokeWidth={2.15} aria-hidden />
    </a>
  )
}
