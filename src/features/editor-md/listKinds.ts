import type { Node } from '@tiptap/pm/model';

export const isListItem = (node: Node | null | undefined) => node?.type.name === 'listItem' || node?.type.name === 'taskItem';
export const isList = (node: Node) => ['bulletList', 'orderedList', 'taskList'].includes(node.type.name);
