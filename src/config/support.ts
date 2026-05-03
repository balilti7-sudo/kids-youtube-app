/**
 * WhatsApp support — digits only (country code + number, no +), e.g. 972501234567.
 * Override with `VITE_WHATSAPP_PHONE_E164` in `.env` / Vercel.
 */
export const WHATSAPP_PHONE_E164 =
  (import.meta.env.VITE_WHATSAPP_PHONE_E164 as string | undefined)?.replace(/\D/g, '') || '972501234567'

/** Pre-filled message when opening WhatsApp from the floating button. */
export const WHATSAPP_DEFAULT_MESSAGE = 'היי, אני צריך עזרה באתר'

export function getWhatsAppSupportUrl(): string {
  const phone = WHATSAPP_PHONE_E164.replace(/\D/g, '')
  const text = encodeURIComponent(WHATSAPP_DEFAULT_MESSAGE)
  return `https://wa.me/${phone}?text=${text}`
}
