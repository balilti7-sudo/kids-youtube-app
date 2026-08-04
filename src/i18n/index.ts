import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { applyDocumentLang, detectInitialLang, LANG_STORAGE_KEY, type AppLang } from './lang'
import he from './locales/he.json'
import en from './locales/en.json'
import es from './locales/es.json'
import ru from './locales/ru.json'

const initialLang = detectInitialLang()
applyDocumentLang(initialLang)

void i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    en: { translation: en },
    es: { translation: es },
    ru: { translation: ru },
  },
  lng: initialLang,
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
  returnNull: false,
})

i18n.on('languageChanged', (lng) => {
  const lang = (lng as AppLang) || 'he'
  applyDocumentLang(lang)
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
})

export default i18n

export async function setAppLanguage(lang: AppLang) {
  await i18n.changeLanguage(lang)
}
