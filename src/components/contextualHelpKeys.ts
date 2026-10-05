import type { ContextualHelpKey } from './contextualHelp';
import type { ImageTemplate } from '../features/editor-md/rich-content/commands';

/** UI identities stay separate from the document's public insertion recipes. */
export const IMAGE_TEMPLATE_HELP_KEYS = {
  4: 'image.collection.4',
  6: 'image.collection.6',
  9: 'image.collection.9',
  carousel: 'image.collection.carousel',
} as const satisfies Record<ImageTemplate, ContextualHelpKey>;

export const HEADING_HELP_KEYS = {
  1: 'block.heading.1', 2: 'block.heading.2', 3: 'block.heading.3',
  4: 'block.heading.4', 5: 'block.heading.5', 6: 'block.heading.6',
} as const satisfies Record<1 | 2 | 3 | 4 | 5 | 6, ContextualHelpKey>;
