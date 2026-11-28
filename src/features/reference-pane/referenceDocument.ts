import type { Tab } from '../../stores/windowStore';
import { isRichDocument } from '../../core/docKind';

export function supportsReference(tab: Tab): boolean {
  if (tab.toolKind) return false;
  return isRichDocument(tab.kind) || tab.kind === 'code'
    || Boolean(tab.path && (tab.kind === 'pdf' || tab.kind === 'image'));
}
