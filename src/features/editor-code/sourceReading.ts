import { ensureSyntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Line, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SourceReadingControl } from '../../core/editor/editorTypes';
import type { LanguageId } from '../../core/ipc/types';

const LONG_LINE = 400;
const MAX_STRUCTURED_SOURCE = 192 * 1024;
const MAX_READING_BREAKS = 2500;
const SCAN_BATCH_LINES = 2048;

class ReadingBreak extends WidgetType {
  constructor(private readonly indent: number) { super(); }
  get lineBreaks() { return 1; }
  eq(other: ReadingBreak) { return this.indent === other.indent; }
  toDOM(view: EditorView) {
    const element = view.dom.ownerDocument.createElement('span');
    const indent = element.ownerDocument.createElement('span');
    element.setAttribute('aria-hidden', 'true');
    indent.className = 'nb-source-reading-indent';
    indent.style.width = `${this.indent}ch`;
    element.append(element.ownerDocument.createElement('br'), indent);
    return element;
  }
}

const readingBreaks = Array.from({ length: 13 }, (_, indent) => Decoration.widget({
  widget: new ReadingBreak(indent * 2),
  side: 1,
}));

const setLayout = StateEffect.define<DecorationSet | null>();
const readingLayout = StateField.define<DecorationSet | null>({
  create: () => null,
  update(previous, transaction) {
    if (transaction.docChanged) return null;
    const effect = transaction.effects.find(effect => effect.is(setLayout));
    return effect ? effect.value : previous;
  },
  provide: field => [
    EditorView.decorations.from(field, set => set ?? Decoration.none),
    EditorView.contentAttributes.from(field, (set): Record<string, string> => set ? {
      class: set.size > 0 ? 'cm-lineWrapping nb-source-reading' : 'cm-lineWrapping nb-source-reading nb-source-reading-wrap',
    } : {}),
  ],
});

const readingTheme = EditorView.theme({
  '.cm-content.nb-source-reading-wrap': { maxWidth: 'calc(100ch + 48px)' },
  '.nb-source-reading-wrap .cm-line': {
    paddingInlineStart: 'calc(6px + 2ch)',
    textIndent: '-2ch',
  },
  '.nb-source-reading-indent': { display: 'inline-block', userSelect: 'none' },
});

const statementLists = new Set(['Script', 'Block', 'ClassBody', 'SwitchBody']);
const expressionLists = new Set(['ObjectExpression', 'ArrayExpression', 'SequenceExpression', 'ObjectType']);
const listPunctuation = new Set(['{', '[', ';', ',']);
const opaqueExpressions = new Set(['TemplateString', 'JSXElement', 'JSXFragment']);

/** Add display breaks at grammar boundaries. The underlying Text and offsets remain authoritative. */
function structuredLayout(state: EditorState, language: LanguageId): DecorationSet {
  const doc = state.doc;
  if ((language !== 'javascript' && language !== 'typescript') || doc.length > MAX_STRUCTURED_SOURCE) return Decoration.none;
  const tree = ensureSyntaxTree(state, doc.length, 24);
  if (!tree || tree.topNode.name !== 'Script') return Decoration.none;

  const ranges: Range<Decoration>[] = [];
  const frames: Array<{ depth: number; split: boolean; indentChildren: boolean }> = [];
  let line: Line | undefined;
  let firstToken = 0;
  let lastBreak = -1;
  let fallback = false;
  tree.iterate({
    enter(node) {
      if (node.type.isError) fallback = true;
      if (fallback || ranges.length >= MAX_READING_BREAKS) return false;
      const parent = frames.at(-1);
      const closing = node.name === '}' || node.name === ']';
      const depth = (parent?.depth ?? 0) + (parent?.indentChildren && !closing ? 1 : 0);
      if (parent?.split && !listPunctuation.has(node.name) && node.from > lastBreak) {
        if (!line || node.from > line.to) {
          line = doc.lineAt(node.from);
          firstToken = line.from + (/^[ \t]*/.exec(line.text)?.[0].length ?? 0);
        }
        if (line.length >= LONG_LINE && node.from > firstToken) {
          ranges.push(readingBreaks[Math.min(depth, readingBreaks.length - 1)].range(node.from));
          lastBreak = node.from;
        }
      }
      if (opaqueExpressions.has(node.name)) return false;
      const span = node.to - node.from;
      const split = node.name === 'Script' || (statementLists.has(node.name) && span >= 12)
        || (expressionLists.has(node.name) && span >= 60);
      frames.push({ depth, split, indentChildren: split && node.name !== 'Script' });
    },
    leave() { frames.pop(); },
  });
  return fallback || ranges.length >= MAX_READING_BREAKS ? Decoration.none : Decoration.set(ranges);
}

export const sourceReadingPlugin = ViewPlugin.fromClass(class {
  private readonly listeners = new Set<() => void>();
  private witness: number | undefined;
  private scanTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshot: ReturnType<SourceReadingControl['getSnapshot']> = 'hidden';

  constructor(private readonly view: EditorView) {
    this.scan(view.state.doc, 1, view.state.doc.lines);
  }

  readonly getSnapshot = () => this.snapshot;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  toggle(language: LanguageId) {
    const { view } = this;
    if (view.composing) return;
    if (view.state.field(readingLayout) !== null) {
      view.dispatch({ effects: setLayout.of(null) });
      return;
    }
    if (this.witness === undefined) return;
    const caret = view.state.selection.main.head;
    const target = view.state.doc.lineAt(caret).length >= LONG_LINE ? caret : this.witness;
    view.dispatch({ effects: [setLayout.of(structuredLayout(view.state, language)), EditorView.scrollIntoView(target)] });
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      const doc = update.state.doc;
      const mapped = this.witness === undefined ? undefined : update.changes.mapPos(this.witness);
      if (mapped !== undefined && doc.lineAt(mapped).length >= LONG_LINE) {
        this.witness = mapped;
      } else {
        let from = 1, to = doc.lines;
        if (this.witness === undefined && this.scanTimer === undefined) {
          // An already-checked document without long lines only needs to check edited lines.
          from = doc.lines;
          to = 1;
          update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
            from = Math.min(from, doc.lineAt(fromB).number);
            to = Math.max(to, doc.lineAt(toB).number);
          });
        }
        this.witness = undefined;
        this.scan(doc, from, to);
      }
    }
    this.publish();
  }

  destroy() {
    clearTimeout(this.scanTimer);
    this.listeners.clear();
  }

  private scan(doc: Text, from: number, to: number) {
    clearTimeout(this.scanTimer);
    this.scanTimer = undefined;
    if (doc.length < LONG_LINE) return;
    const lines = doc.iterLines(from, to + 1);
    let start = doc.line(from).from;
    const batch = () => {
      this.scanTimer = undefined;
      for (let count = 0; count < SCAN_BATCH_LINES; count++) {
        const line = lines.next();
        if (line.done) return;
        if (line.value.length >= LONG_LINE) {
          this.witness = start;
          this.publish();
          return;
        }
        start += line.value.length + 1;
      }
      this.scanTimer = setTimeout(batch, 0);
    };
    this.scanTimer = setTimeout(batch, 0);
  }

  private publish() {
    const next = this.view.state.field(readingLayout) !== null
      ? 'reading' : this.witness === undefined ? 'hidden' : 'available';
    if (this.snapshot === next) return;
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  }
});

export const sourceReadingExtension = [readingLayout, readingTheme, sourceReadingPlugin];
