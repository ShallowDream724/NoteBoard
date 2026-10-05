import { CODE_LANGUAGES } from './codeLanguages';
import type { LanguageId } from './ipc/types';

/** Metadata only; loading a menu must never load a grammar or formatter. */
export const TEXT_LANGUAGE_CHOICES: readonly { value: LanguageId; label: string }[] = [
  ...CODE_LANGUAGES.map(language => ({ value: language.value, label: language.value === 'xml' ? 'XML' : language.label })),
  { value: 'html', label: 'HTML' },
];

export function textLanguageTools(language: string) {
  return {
    json: language === 'json',
    xml: language === 'xml',
    validate: language === 'json' || language === 'yaml' || language === 'xml',
  };
}
