import { useLayoutEffect, useRef, type FormEvent, type CompositionEvent } from 'react';
import { readSourceText, writeSourceText, readSourceSelection, writeSourceSelection } from './nativeSourceDom';

/** The document owns committed source; native textareas own IME preedit and caret.
 * History updates the same input without resetting its focus or input session. */
interface SourceInputOptions {
  value: string;
  onChange: (value: string) => void;
  onCompositionCommit?: (changed: boolean) => void;
}
function useSourceInput<T extends HTMLElement>({ value, onChange, onCompositionCommit }: SourceInputOptions) {
  const input = useRef<T>(null);
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
    if (readSourceText(element) === value) return;
    const previous = readSourceText(element);
    const { anchor, head } = readSourceSelection(element);
    let prefix = 0;
    while (prefix < previous.length && prefix < value.length && previous[prefix] === value[prefix]) prefix++;
    let suffix = 0;
    while (suffix < previous.length - prefix && suffix < value.length - prefix
      && previous[previous.length - suffix - 1] === value[value.length - suffix - 1]) suffix++;
    const oldEnd = previous.length - suffix, newEnd = value.length - suffix;
    const mapCaret = (position: number) => position < prefix ? position : position > oldEnd
      ? position + value.length - previous.length : newEnd;
    const focused = element.ownerDocument.activeElement === element;
    writeSourceText(element, value);
    if (focused) writeSourceSelection(element, { anchor: mapCaret(anchor), head: mapCaret(head) });
  }, [value]);
  return { input, composing, publish, initialValue: initialValue.current, inputProps: {
    ref: input,
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: (event: CompositionEvent<T>) => {
      composing.current = false;
      const changed = publish(readSourceText(event.currentTarget));
      onCompositionCommit?.(changed);
    },
    onInput: (event: FormEvent<T>) => {
      if (composing.current || (event.nativeEvent as InputEvent).isComposing) return;
      publish(readSourceText(event.currentTarget));
    },
  } };
}

export function useNativeSourceInput(options: SourceInputOptions) {
  const session = useSourceInput<HTMLTextAreaElement>(options);
  const { onInput, ...props } = session.inputProps;
  return { ...session, inputProps: { ...props, defaultValue: session.initialValue, onChange: onInput } };
}

export function useInlineSourceInput(options: SourceInputOptions) {
  return useSourceInput<HTMLSpanElement>(options);
}
