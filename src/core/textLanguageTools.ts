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
  const filenames = formats.flatMap(format => format.filenames ?? []);
  const firstExtension = extensions[0];
  const iconFileName = firstExtension && !filenames.includes(firstExtension) ? `.${firstExtension}` : filenames[0];
  return { value, label: getTextLanguageLabel(value), iconFileName };
});

export function textLanguageTools(language: string) {
  return {
    json: language === 'json',
    xml: language === 'xml',
    validate: language === 'json' || language === 'yaml' || language === 'xml',
  };
}
