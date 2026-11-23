import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dictionaries, resolveLanguage, setLanguage, t, tn, translateMessage, type Dictionary } from '../src/core/i18n';

// Vitest runs from the project root.
const root = process.cwd();
function sources(dir: string, pattern: RegExp, skip = new Set<string>()): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return skip.has(entry.name) ? [] : sources(path, pattern, skip);
    return pattern.test(entry.name) ? [path] : [];
  });
}

const app = sources(join(root, 'src'), /\.tsx?$/, new Set(['locales'])).map(file => [file, readFileSync(file, 'utf8')] as const);
const keys = new Set<string>(), counted = new Set<string>();
for (const [, text] of app) {
  for (const match of text.matchAll(/(?<![\w.])t\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(match[1]);
  for (const match of text.matchAll(/(?<![\w.])tn\([^']*?,\s*'(?:[^'\\]|\\.)*'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) counted.add(match[1]);
}

// Messages that reach the interface as error text from the Android app; translateMessage handles them.
const nativeDir = join(root, 'android/app/src/main/java/app/rezka/tv');
const nativeOnly = new Set(['Debug tools are disabled.', 'Test report could not be saved.']);
const native = new Set<string>();
for (const file of sources(nativeDir, /\.java$/)) {
  if (/(PlayerActivity|VerificationActivity)\.java$/.test(file)) continue; // These use Android string resources.
  for (const match of readFileSync(file, 'utf8').matchAll(/"([A-Z][^"]{8,}[.!?]) ?"/g)) if (!nativeOnly.has(match[1])) native.add(match[1]);
}
native.add('The update server answered 404.');

// Messages from the self-hosted sync server.
const server = [
  'Invalid request.', 'Enter a valid email and a password with at least 10 characters.', 'Too many attempts. Try again later.',
  'An account with this email may already exist.', 'Email or password did not match.',
  'This server does not accept new accounts. Ask its owner to turn on sign-ups.', 'History upload is too large.',
  'History must contain at most 500 records.', 'Expected a JSON object.', 'The sync service is not configured.',
  'The sync service could not complete this request.', 'Sign in to sync viewing progress.', 'This API route was not found.',
  'A viewing record was incomplete or invalid.', 'Request is too large.',
];

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const values = (entry: Dictionary[string]) => typeof entry === 'string' ? [entry] : [entry.one, entry.few, entry.many, ...(entry.other ? [entry.other] : [])];

afterEach(() => setLanguage('en'));

describe('interface translations', () => {
  it('finds the interface strings', () => {
    expect(keys.size).toBeGreaterThan(250);
    expect(counted.size).toBeGreaterThan(5);
    expect(native.size).toBeGreaterThan(20);
  });

  it('only passes literal strings to t()', () => {
    for (const [file, text] of app) expect(text.match(/(?<![\w.])tn?\(\s*[`"]/g), file).toBeNull();
  });

  for (const [language, dictionary] of Object.entries(dictionaries)) {
    describe(language, () => {
      it('translates every interface string', () => {
        expect([...keys].filter(key => typeof dictionary[key] !== 'string')).toEqual([]);
        expect([...counted].filter(key => !dictionary[key])).toEqual([]);
      });

      it('keeps the placeholders of each string', () => {
        const wrong = Object.entries(dictionary).filter(([key, entry]) => values(entry).some(value => placeholders(value).join() !== placeholders(key).join()));
        expect(wrong.map(([key]) => key)).toEqual([]);
      });

      it('translates messages from the app and the sync server', () => {
        setLanguage(language as 'ru' | 'uk');
        expect([...native, ...server].filter(message => translateMessage(message) === message)).toEqual([]);
      });
    });
  }
});

// The player, website check and download notifications use Android string resources.
const resources = (folder: string) => new Map([...readFileSync(join(root, 'android/app/src/main/res', folder, 'strings.xml'), 'utf8')
  .matchAll(/<string name="(\w+)"( translatable="false")?>([^<]*)<\/string>/g)].filter(match => !match[2]).map(match => [match[1], match[3]]));
const arguments_ = (text: string) => [...text.matchAll(/%\d+\$[sd]/g)].map(match => match[0]).sort().join();

describe('Android string resources', () => {
  const english = resources('values');
  it('finds the native strings', () => expect(english.size).toBeGreaterThan(30));
  for (const language of ['ru', 'uk']) {
    it(`translates every native string into ${language}`, () => {
      const translated = resources(`values-${language}`);
      expect([...english.keys()].filter(name => !translated.has(name))).toEqual([]);
      expect([...translated.keys()].filter(name => !english.has(name))).toEqual([]);
      expect([...english].filter(([name, text]) => arguments_(translated.get(name) || '') !== arguments_(text)).map(([name]) => name)).toEqual([]);
    });
  }
});

describe('language choice', () => {
  it('follows the device unless a language is chosen', () => {
    expect(resolveLanguage('system', ['uk-UA', 'en-US'])).toBe('uk');
    expect(resolveLanguage('system', ['de-DE', 'ru_RU'])).toBe('ru');
    expect(resolveLanguage('system', ['de-DE'])).toBe('en');
    expect(resolveLanguage(undefined, [])).toBe('en');
    expect(resolveLanguage('ru', ['uk-UA'])).toBe('ru');
    expect(resolveLanguage('en', ['uk-UA'])).toBe('en');
  });

  it('marks the document language', () => {
    setLanguage('uk');
    expect(document.documentElement.lang).toBe('uk');
  });
});

describe('translation', () => {
  it('fills placeholders', () => {
    expect(t('Season {season}, episode {episode}', { season: 2, episode: 5 })).toBe('Season 2, episode 5');
    setLanguage('ru');
    expect(t('Season {season}, episode {episode}', { season: 2, episode: 5 })).toBe('Сезон 2, серия 5');
    setLanguage('uk');
    expect(t('Continue at {time}', { time: '12:04' })).toBe('Продовжити з 12:04');
  });

  it('leaves unknown strings in English', () => {
    setLanguage('ru');
    expect(t('Not a translated string')).toBe('Not a translated string');
  });

  it('chooses plural forms', () => {
    const seasons = (n: number) => tn(n, '{n} season', '{n} seasons');
    expect([1, 2, 5].map(seasons)).toEqual(['1 season', '2 seasons', '5 seasons']);
    setLanguage('ru');
    expect([1, 2, 5, 11, 21, 22].map(seasons)).toEqual(['1 сезон', '2 сезона', '5 сезонов', '11 сезонов', '21 сезон', '22 сезона']);
    setLanguage('uk');
    expect([1, 3, 7].map(n => tn(n, '{n} episode', '{n} episodes'))).toEqual(['1 серія', '3 серії', '7 серій']);
    expect(tn(4, 'Next episode in {n} second', 'Next episode in {n} seconds')).toBe('Наступна серія через 4 секунди');
  });

  it('formats counts for the language', () => {
    setLanguage('ru');
    expect(tn(1500, '{n} title', '{n} titles')).toBe(`${(1500).toLocaleString('ru-RU')} фильмов`);
  });
});

describe('messages', () => {
  it('stays English in English', () => {
    expect(translateMessage('The sync server could not be reached.')).toBe('The sync server could not be reached.');
  });

  it('translates known sentences and keeps unknown details', () => {
    setLanguage('ru');
    expect(translateMessage('Invalid request.')).toBe('Неверный запрос.');
    expect(translateMessage('The content source could not be reached. Connection reset by peer')).toBe('Источник контента недоступен. Connection reset by peer');
    expect(translateMessage('The update could not be downloaded. The update server answered 503.')).toBe('Не удалось скачать обновление. Сервер обновлений ответил кодом 503.');
    expect(translateMessage('The content source returned error 403. Try another mirror.')).toBe('Источник контента вернул ошибку 403. Попробуйте другое зеркало.');
    expect(translateMessage('Socket closed')).toBe('Socket closed');
    expect(translateMessage('')).toBe('');
  });

  it('does not apply short labels to other text', () => {
    setLanguage('uk');
    expect(translateMessage('Read 4 of 10 bytes')).toBe('Read 4 of 10 bytes');
  });
});
