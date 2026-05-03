import { MessageCircle } from 'lucide-react'
import { getWhatsAppSupportUrl } from '../../config/support'

export function WhatsAppFloatingButton() {
  const href = getWhatsAppSupportUrl()
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg ring-2 ring-white/30 transition hover:scale-105 hover:bg-[#20bd5a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:bottom-8 sm:right-6"
      aria-label="פתיחת וואטסאפ לתמיכה"
      title="תמיכה בוואטסאפ"
    >
      <MessageCircle className="h-7 w-7" strokeWidth={2} aria-hidden />
    </a>
  )
}
