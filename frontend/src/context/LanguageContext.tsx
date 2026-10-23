import React, { createContext, useContext, useState, useEffect } from "react";
import { WebApp } from "../telegram";
import ruDict from "../locales/ru-RU.json";
import enDict from "../locales/en-US.json";

export type Language = "ru-RU" | "en-US" | "de-DE" | "es-ES" | "fr-FR" | "id-ID";

export const LANGUAGES_CONFIG: { code: Language; flag: string; label: string; name: string; fullName: string }[] = [
  { code: "ru-RU", flag: "🇷🇺", label: "RU", name: "Русский", fullName: "Русский" },
  { code: "en-US", flag: "🇺🇸", label: "EN", name: "English", fullName: "English" },
  { code: "id-ID", flag: "🇮🇩", label: "ID", name: "Bahasa Indonesia", fullName: "Bahasa Indonesia" },
  { code: "de-DE", flag: "🇩🇪", label: "DE", name: "Deutsch", fullName: "Deutsch" },
  { code: "es-ES", flag: "🇪🇸", label: "ES", name: "Español", fullName: "Español" },
  { code: "fr-FR", flag: "🇫🇷", label: "FR", name: "Français", fullName: "Français" },
];

export const translations = {
  "ru-RU": ruDict,
  "en-US": enDict,
};

// Динамические загрузчики для дополнительных языков (код-сплиттинг бандла)
const extendedLocaleLoaders: Record<string, () => Promise<{ default: Record<string, string> }>> = {
  "id-ID": () => import("../locales/id-ID.json"),
  "de-DE": () => import("../locales/de-DE.json"),
  "es-ES": () => import("../locales/es-ES.json"),
  "fr-FR": () => import("../locales/fr-FR.json"),
};

// In-memory кэш загруженных словарей для предотвращения повторных сетевых запросов
const loadedExtendedDicts: Partial<Record<Language, Record<string, string>>> = {};

export const extendedTranslations = new Proxy(translations as any, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    if (loadedExtendedDicts[prop as Language]) return loadedExtendedDicts[prop as Language];
    return target["ru-RU"];
  }
});

export type TranslationKey = keyof typeof ruDict;

interface LanguageContextProps {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem("app_language") as Language;
      if (saved && (saved === "ru-RU" || saved === "en-US" || saved === "de-DE" || saved === "es-ES" || saved === "fr-FR" || saved === "id-ID")) return saved;

      // Check URL query parameters (e.g. ?lang=en or ?lang=en-US or ?lang=id)
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlLang = urlParams.get("lang")?.toLowerCase();
        if (urlLang) {
          if (urlLang.startsWith("id") || urlLang.startsWith("in")) return "id-ID";
          if (urlLang.startsWith("en")) return "en-US";
          if (urlLang.startsWith("ru") || urlLang.startsWith("uk") || urlLang.startsWith("be") || urlLang.startsWith("kk")) return "ru-RU";
          if (urlLang.startsWith("de")) return "de-DE";
          if (urlLang.startsWith("es")) return "es-ES";
          if (urlLang.startsWith("fr")) return "fr-FR";
        }
      } catch (_) {}

      const tgLang = WebApp.initDataUnsafe?.user?.language_code?.toLowerCase();
      if (tgLang) {
        if (tgLang.startsWith("id") || tgLang.startsWith("in")) return "id-ID";
        if (tgLang.startsWith("en")) return "en-US";
        if (tgLang.startsWith("ru") || tgLang.startsWith("uk") || tgLang.startsWith("be") || tgLang.startsWith("kk")) return "ru-RU";
        if (tgLang.startsWith("de")) return "de-DE";
        if (tgLang.startsWith("es")) return "es-ES";
        if (tgLang.startsWith("fr")) return "fr-FR";
      }

      // Fallback for regular web browsers & Safari mobile (inspect full preferences array)
      const navLangs = Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];

      for (const rawLang of navLangs) {
        if (!rawLang || typeof rawLang !== "string") continue;
        const l = rawLang.trim().toLowerCase();
        if (l.startsWith("id") || l.startsWith("in")) return "id-ID";
        if (l.startsWith("en")) return "en-US";
        if (l.startsWith("ru") || l.startsWith("uk") || l.startsWith("be") || l.startsWith("kk")) return "ru-RU";
        if (l.startsWith("de")) return "de-DE";
        if (l.startsWith("es")) return "es-ES";
        if (l.startsWith("fr")) return "fr-FR";
      }
    } catch (e) {
      console.error("Failed to get language", e);
    }
    return "ru-RU";
  });

  // Локальное состояние динамически загруженных словарей для реактивного обновления компонентов при смене локали
  const [loadedDicts, setLoadedDicts] = useState<Partial<Record<Language, Record<string, string>>>>(loadedExtendedDicts);

  useEffect(() => {
    // Базовые словари ru-RU и en-US уже синхронно в памяти бандла
    if (language === "ru-RU" || language === "en-US") return;
    if (loadedDicts[language]) return;

    const loader = extendedLocaleLoaders[language];
    if (loader) {
      let isMounted = true;
      loader().then((mod) => {
        if (!isMounted) return;
        const dict = mod.default;
        loadedExtendedDicts[language] = dict;
        setLoadedDicts((prev) => ({ ...prev, [language]: dict }));
      }).catch((err) => {
        console.error(`Failed to dynamically load locale ${language}`, err);
      });
      return () => { isMounted = false; };
    }
  }, [language, loadedDicts]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem("app_language", lang);
    } catch (_) {}
  };

  const t = (key: TranslationKey): string => {
    // 1. Поиск в загруженном расширенном словаре
    const activeDict = loadedDicts[language];
    if (activeDict && activeDict[key]) return activeDict[key];

    // 2. Поиск в базовом словаре en-US или ru-RU
    if (language === "en-US" && (enDict as any)[key]) return (enDict as any)[key];
    if (language === "ru-RU") return (ruDict as any)[key] || "";

    // 3. Каскадный фоллбэк: для не-русского интерфейса пробуем en-US, затем ru-RU
    if ((enDict as any)[key]) return (enDict as any)[key];
    return (ruDict as any)[key] || "";
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
};
