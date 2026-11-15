import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { en, type MessageKey } from './en'
import { vi } from './vi'
import { ja } from './ja'

export type { MessageKey }
export type Lang = 'en' | 'ja' | 'vi'
export const LANGS: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'vi', name: 'Tiếng Việt' },
]

const dicts: Record<Lang, Record<MessageKey, string>> = { en, ja, vi }
const isLang = (l: unknown): l is Lang => l === 'en' || l === 'ja' || l === 'vi'

function readLang(): Lang {
  try {
    const saved = localStorage.getItem('lang')
    if (isLang(saved)) return saved
  } catch {
    /* ignore */
  }
  // First visit: follow the browser, English otherwise.
  for (const l of typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]) {
    const code = l.slice(0, 2).toLowerCase()
    if (isLang(code)) return code
  }
  return 'en'
}

let current: Lang = readLang()

/**
 * Translate a key. Usable outside React too (toasts from the note store),
 * where it reads the language last set by <I18nProvider>.
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s = dicts[current][key] ?? en[key]
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

export const dateLocale = () => ({ en: 'en-US', ja: 'ja-JP', vi: 'vi-VN' })[current]

interface I18nState {
  lang: Lang
  setLang: (l: Lang) => void
  t: typeof t
}

const I18nContext = createContext<I18nState>({ lang: current, setLang: () => {}, t })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    current = l
    try {
      localStorage.setItem('lang', l)
    } catch {
      /* ignore */
    }
    setLangState(l)
  }, [])

  // A new `t` per language so memoized components re-render too.
  const tr = useCallback<typeof t>((key, vars) => t(key, vars), [lang]) // eslint-disable-line react-hooks/exhaustive-deps

  return <I18nContext.Provider value={{ lang, setLang, t: tr }}>{children}</I18nContext.Provider>
}

export const useI18n = () => useContext(I18nContext)
