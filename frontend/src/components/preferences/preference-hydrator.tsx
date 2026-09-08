"use client"

import {useEffect, useRef} from "react"
import {useLocale} from "next-intl"
import {Locale, locales, usePathname, useRouter} from "@/i18n/routing"

const LOCALE_STORAGE_KEY = "zmind-locale"

const isLocaleValue = (value: string | null): value is Locale =>
  Boolean(value && (locales as readonly string[]).includes(value))

const safeGet = (key: string) => {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const safeSet = (key: string, value: string) => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore quota/security errors – preference persistence is best-effort
  }
}

export function PreferenceHydrator() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const localeHydrated = useRef(false)

  useEffect(() => {
    if (!locale) return

    const storedLocale = safeGet(LOCALE_STORAGE_KEY)

    if (!localeHydrated.current) {
      localeHydrated.current = true
      if (isLocaleValue(storedLocale) && storedLocale !== locale) {
        const hash = typeof window !== "undefined" ? window.location.hash || "" : ""
        router.replace(`${pathname}${hash}`, { locale: storedLocale })
        return
      }
    }

    if (isLocaleValue(locale) && storedLocale !== locale) {
      safeSet(LOCALE_STORAGE_KEY, locale)
    }
  }, [locale, pathname, router])

  return null
}
