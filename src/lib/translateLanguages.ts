/** Languages offered as a prompt-translation target.
 *
 * `code` is a Google language tag (the same string the Rust command hands to
 * the `translators` crate); `native` is the language's own name, which reads
 * the same in every UI language. */
export interface TranslateLanguage {
  code: string;
  native: string;
}

export const TRANSLATE_LANGUAGES: readonly TranslateLanguage[] = [
  { code: "en", native: "English" },
  { code: "ru", native: "Русский" },
  { code: "uk", native: "Українська" },
  { code: "de", native: "Deutsch" },
  { code: "fr", native: "Français" },
  { code: "es", native: "Español" },
  { code: "it", native: "Italiano" },
  { code: "pt", native: "Português" },
  { code: "pl", native: "Polski" },
  { code: "nl", native: "Nederlands" },
  { code: "cs", native: "Čeština" },
  { code: "sk", native: "Slovenčina" },
  { code: "sv", native: "Svenska" },
  { code: "no", native: "Norsk" },
  { code: "da", native: "Dansk" },
  { code: "fi", native: "Suomi" },
  { code: "el", native: "Ελληνικά" },
  { code: "hu", native: "Magyar" },
  { code: "ro", native: "Română" },
  { code: "bg", native: "Български" },
  { code: "sr", native: "Српски" },
  { code: "hr", native: "Hrvatski" },
  { code: "tr", native: "Türkçe" },
  { code: "he", native: "עברית" },
  { code: "ar", native: "العربية" },
  { code: "fa", native: "فارسی" },
  { code: "hi", native: "हिन्दी" },
  { code: "th", native: "ไทย" },
  { code: "vi", native: "Tiếng Việt" },
  { code: "id", native: "Bahasa Indonesia" },
  { code: "ja", native: "日本語" },
  { code: "ko", native: "한국어" },
  { code: "zh-CN", native: "简体中文" },
  { code: "zh-TW", native: "繁體中文" }
] as const;

const BY_CODE = new Map(TRANSLATE_LANGUAGES.map((l) => [l.code, l]));

/** Native name for a stored tag; falls back to the raw tag for anything the
 *  list doesn't know (a language added to the app later, or a manual value). */
export function translateLanguageName(code: string): string {
  return BY_CODE.get(code)?.native ?? code;
}

/** Compact badge text: "ru" → "RU", "zh-CN" → "ZH". */
export function translateLanguageShort(code: string): string {
  return (code.split("-")[0] || code).toUpperCase();
}
