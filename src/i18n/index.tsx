import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { en, type DictKey } from "./en";
import { ru } from "./ru";
import type { Lang } from "../lib/types";

const DICTS = { en, ru } as const;

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  count: (n: number) => string;
  formatDate: (iso: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function ruPluralForm(n: number): "one" | "few" | "many" {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "one";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "few";
  return "many";
}

export function I18nProvider({ lang, setLang, children }: { lang: Lang; setLang: (l: Lang) => void; children: ReactNode }) {
  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>) => {
      let s: string = DICTS[lang][key] ?? en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return s;
    },
    [lang]
  );

  const count = useCallback(
    (n: number) => {
      if (n === 0) return DICTS[lang]["grid.count.zero"];
      const key: DictKey =
        lang === "ru"
          ? `plurals.ru.${ruPluralForm(n)}`
          : n === 1
            ? "plurals.prompts.one"
            : "plurals.prompts.other";
      // "{n} {form}" template in both languages; ru plurals carry only the
      // word ("промпт"/"промпта"/"промптов") and en only the noun.
      return DICTS[lang]["grid.count"].replace("{n}", String(n)).replace("{form}", DICTS[lang][key]);
    },
    [lang]
  );

  const formatDate = useCallback(
    (iso: string) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
        day: "numeric",
        month: "short",
        year: "numeric"
      }).format(d);
    },
    [lang]
  );

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t, count, formatDate }), [lang, setLang, t, count, formatDate]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export type { DictKey };
