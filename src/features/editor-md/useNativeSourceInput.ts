import { useLayoutEffect, useRef, type ChangeEvent, type CompositionEvent } from 'react';

/** The document owns committed source; native textareas own IME preedit and caret.
 * History updates the same input without resetting its focus or input session. */
export function useNativeSourceInput({ value, onChange, onCompositionCommit }: {
  value: string;
  onChange: (value: string) => void;
  onCompositionCommit?: (changed: boolean) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const initialValue = useRef(value);
  const composing = useRef(false);
  const published = useRef(value);
  const publish = (next: string) => {
    if (next === published.current) return false;
    published.current = next;
    onChange(next);
    return true;
  };
  useLayoutEffect(() => {
    if (composing.current) return;
    const element = input.current;
    if (!element) return;
    published.current = value;
    if (element.value === value) return;
    const previous = element.value;
    const { selectionStart, selectionEnd, selectionDirection } = element;
    let prefix = 0;
    while (prefix < previous.length && prefix < value.length && previous[prefix] === value[prefix]) prefix++;
    let suffix = 0;
    while (suffix < previous.length - prefix && suffix < value.length - prefix
      && previous[previous.length - suffix - 1] === value[value.length - suffix - 1]) suffix++;
    const oldEnd = previous.length - suffix, newEnd = value.length - suffix;
    const mapCaret = (position: number) => position < prefix ? position : position > oldEnd
      ? position + value.length - previous.length : newEnd;
    element.value = value;
    element.setSelectionRange(mapCaret(selectionStart), mapCaret(selectionEnd), selectionDirection);
  }, [value]);
  return { input, composing, inputProps: {
    ref: input,
    defaultValue: initialValue.current,
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => {
      composing.current = false;
      const changed = publish(event.currentTarget.value);
      onCompositionCommit?.(changed);
    },
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
      if (composing.current || (event.nativeEvent as InputEvent).isComposing) return;
      publish(event.currentTarget.value);
    },
  } };
}
