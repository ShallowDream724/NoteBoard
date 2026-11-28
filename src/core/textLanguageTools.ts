import { CODE_LANGUAGES, getCodeLanguage } from './codeLanguages';
import { FILE_FORMATS } from './fileFormats';
import type { LanguageId } from './ipc/types';

export function getTextLanguageLabel(language: LanguageId): string {
  if (language === 'html') return 'HTML';
  if (language === 'xml') return 'XML';
  return getCodeLanguage(language)?.label ?? language.toUpperCase();
}

/** Metadata only; loading a menu must never load a grammar or formatter. */
const languageIds: readonly LanguageId[] = [...CODE_LANGUAGES.map(language => language.value), 'html'];
export const TEXT_LANGUAGE_CHOICES = languageIds.map(value => {
  const formats = FILE_FORMATS.filter(format => format.language === value && (format.kind === 'code' || format.kind === 'markdown' || format.preview === 'svg'));
  const extensions = formats.flatMap(format => format.extensions ?? []);
  const aliases = (value === 'html' ? [] : getCodeLanguage(value)?.aliases ?? [])
    .filter(alias => value !== 'xml' || alias !== 'html' && alias !== 'xhtml');
  const label = getTextLanguageLabel(value);
  const terms = [value, label.toLowerCase(), ...aliases, ...extensions,
    ...extensions.map(extension => `.${extension}`), ...formats.flatMap(format => format.filenames ?? [])];
  return { value, label, extensions, terms };
});

export function searchTextLanguages(query: string) {
  const search = query.trim().toLowerCase();
  if (!search) return TEXT_LANGUAGE_CHOICES;

  return TEXT_LANGUAGE_CHOICES.flatMap(choice => {
    const { terms } = choice;
    if (terms.includes(search)) return [{ choice, rank: 0 }];
    if (terms.some(term => term.startsWith(search))) return [{ choice, rank: 1 }];
    if (!search.startsWith('.') && terms.some(term => term.includes(search))) return [{ choice, rank: 2 }];
    return [];
  }).sort((a, b) => a.rank - b.rank).map(({ choice }) => choice);
}

export function textLanguageTools(language: string) {
  return {
    json: language === 'json',
    xml: language === 'xml',
    validate: language === 'json' || language === 'yaml' || language === 'xml',
  };
}
