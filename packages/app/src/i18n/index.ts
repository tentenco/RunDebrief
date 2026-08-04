import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";

export const LOCALE_STORAGE_KEY = "debrief-locale";
export type AppLocale = keyof typeof resources;

export function normalizeLocale(value: string | null | undefined): AppLocale | null {
  if (!value) return null;
  const normalized = value.replaceAll("_", "-").toLowerCase();
  if (
    normalized === "zh-hant" ||
    normalized === "zh-tw" ||
    normalized.startsWith("zh-tw-") ||
    normalized === "zh-hk" ||
    normalized.startsWith("zh-hk-") ||
    normalized === "zh-mo" ||
    normalized.startsWith("zh-mo-")
  ) {
    return "zh-Hant";
  }
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}

export function localeFromLanguages(languages: readonly string[]): AppLocale {
  for (const language of languages) {
    const locale = normalizeLocale(language);
    if (locale) return locale;
  }
  return "en";
}

export function readLocalePreference(storage: Storage): AppLocale | null {
  try {
    return normalizeLocale(storage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeLocalePreference(
  storage: Storage,
  locale: AppLocale,
): void {
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // View preferences are best-effort and never block the app shell.
  }
}

export function localeFromSearch(search: string): AppLocale | null {
  const requested = new URLSearchParams(search).get("locale");
  return requested === "zh-Hant" || requested === "en" ? requested : null;
}

export function resolveInitialLocale({
  storage,
  languages,
  search,
  demo,
}: {
  storage: Storage;
  languages: readonly string[];
  search: string;
  demo: boolean;
}): { locale: AppLocale; forced: boolean } {
  const forcedLocale = demo ? localeFromSearch(search) : null;
  if (forcedLocale) return { locale: forcedLocale, forced: true };
  return {
    locale:
      readLocalePreference(storage) ?? localeFromLanguages(languages),
    forced: false,
  };
}

const initial =
  typeof window === "undefined" || typeof navigator === "undefined"
    ? { locale: "en" as const, forced: false }
    : resolveInitialLocale({
        storage: window.localStorage,
        languages: navigator.languages,
        search: window.location.search,
        demo: import.meta.env.VITE_DEBRIEF_DEMO === "1",
      });

export const demoLocaleForced = initial.forced;

void i18n.use(initReactI18next).init({
  resources,
  lng: initial.locale,
  fallbackLng: "en",
  supportedLngs: ["zh-Hant", "en"],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

if (typeof document !== "undefined") {
  document.documentElement.lang = initial.locale;
}
i18n.on("languageChanged", (language) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = normalizeLocale(language) ?? "en";
  }
});

export async function changeAppLocale(locale: AppLocale): Promise<void> {
  await i18n.changeLanguage(locale);
  if (!demoLocaleForced && typeof window !== "undefined") {
    writeLocalePreference(window.localStorage, locale);
  }
}

export function currentLocale(): AppLocale {
  return normalizeLocale(i18n.resolvedLanguage ?? i18n.language) ?? "en";
}

export default i18n;
