/** Normalize catalog bindings for engine keymaps without synthesizing DOM input. */
export function engineShortcutEvent(binding: string) {
  const parts = binding.split('+'), key = parts.pop()!;
  return new KeyboardEvent('keydown', { key: key.length === 1 ? key.toLowerCase() : key,
    ctrlKey: parts.includes('Ctrl'), shiftKey: parts.includes('Shift'), altKey: parts.includes('Alt'), metaKey: parts.includes('Meta') });
}
