import ru from './locales/ru';
import uk from './locales/uk';

/** Languages the interface is translated into. English strings are the keys of the other dictionaries. */
export type Language = 'en' | 'ru' | 'uk';
export type LanguageSetting = 'system' | Language;
export type Plural = { one: string; few: string; many: string; other?: string };
export type Dictionary = Record<string, string | Plural>;
type Values = Record<string, string | number>;

export const languages: Language[] = ['en', 'ru', 'uk'];
export const dictionaries: Record<Exclude<Language, 'en'>, Dictionary> = { ru, uk };
const locales: Record<Language, string> = { en: 'en-US', ru: 'ru-RU', uk: 'uk-UA' };
let current: Language = 'en';

/** Chooses the interface language: the saved choice, or the first supported device language. */
export function resolveLanguage(setting: LanguageSetting | undefined, preferred: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]): Language {
  if (setting && setting !== 'system') return setting;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (base === 'en' || base === 'ru' || base === 'uk') return base;
  }
  return 'en';
}

export function setLanguage(next: Language) {
  current = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}
export const language = () => current;
export const locale = () => locales[current];

function fill(text: string, values?: Values) {
  return values ? text.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match) : text;
}

/** Translates an English interface string. `{name}` placeholders are filled from `values`. */
export function t(key: string, values?: Values): string {
  const entry = current === 'en' ? undefined : dictionaries[current][key];
  const text = typeof entry === 'string' ? entry : entry ? entry.other || entry.many : key;
  return fill(text, values);
}

/** Translates a counted string. `{n}` is the formatted count; the English plural form is the dictionary key. */
export function tn(count: number, one: string, other: string, values?: Values): string {
  const all = { n: count.toLocaleString(locale()), ...values };
  if (current === 'en') return fill(count === 1 ? one : other, all);
  const entry = dictionaries[current][other];
  if (!entry) return fill(count === 1 ? one : other, all);
  if (typeof entry === 'string') return fill(entry, all);
  const form = new Intl.PluralRules(locale()).select(count) as keyof Plural;
  return fill(entry[form] || entry.other || entry.many, all);
}

const patterns = new Map<string, { key: string; names: string[]; pattern: RegExp }[]>();
function patternsFor(lang: Exclude<Language, 'en'>) {
  let list = patterns.get(lang);
  if (!list) {
    // Only whole sentences with a placeholder, so short labels such as "{time} of {duration}" never rewrite system text.
    list = Object.keys(dictionaries[lang]).filter(key => /\{\w+\}/.test(key) && /[.!?]$/.test(key)).map(key => {
      const names: string[] = [];
      const source = key.split(/(\{\w+\})/).map(part => {
        const name = part.match(/^\{(\w+)\}$/)?.[1];
        if (name) { names.push(name); return '(.+?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      return { key, names, pattern: new RegExp(`^${source}$`) };
    });
    patterns.set(lang, list);
  }
  return list;
}

function translateSentence(sentence: string) {
  if (current === 'en') return sentence;
  const dictionary = dictionaries[current];
  if (typeof dictionary[sentence] === 'string') return t(sentence);
  for (const { key, names, pattern } of patternsFor(current)) {
    const match = sentence.match(pattern);
    if (match) return t(key, Object.fromEntries(names.map((name, i) => [name, match[i + 1]])));
  }
  return sentence;
}

/**
 * Translates a message that arrived as text, such as an error from the native app or the sync server.
 * Known sentences are translated one by one; unknown details, such as a system error, stay as they are.
 */
export function translateMessage(message: string): string {
  if (current === 'en' || !message) return message;
  const whole = translateSentence(message);
  if (whole !== message) return whole;
  return message.split(/(?<=[.!?])\s+/).map(translateSentence).join(' ');
}
