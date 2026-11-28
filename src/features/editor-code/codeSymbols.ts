import { LanguageSupport, syntaxTree, syntaxTreeAvailable, type Language } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { CodeSymbol } from '../../core/editor/editorTypes';
import type { LanguageId } from '../../core/ipc/types';
import { loadLanguageExtension } from './languages';

const MAX_CHARS = 120_000;
const MAX_SYMBOLS = 1_000;
const MAX_LABEL = 160;

type SymbolKind = CodeSymbol['kind'];
type SyntaxNode = ReturnType<Language['parser']['parse']>['topNode'];
type AddSymbol = (kind: SymbolKind, label: string, position: number) => void;
type ExtractSymbol = (node: SyntaxNode, source: string, add: AddSymbol) => void;

function unquote(label: string) {
  const quote = label[0];
  return (quote === '"' || quote === "'") && label.at(-1) === quote ? label.slice(1, -1) : label;
}

function addName(add: AddSymbol, kind: SymbolKind, name: SyntaxNode | null | undefined, source: string) {
  if (name && name.to <= source.length && name.to - name.from <= MAX_LABEL) {
    add(kind, unquote(source.slice(name.from, name.to)), name.from);
  }
}

const jsDeclarations: Readonly<Record<string, SymbolKind | undefined>> = {
  FunctionDeclaration: 'function', ClassDeclaration: 'class', MethodDeclaration: 'function',
  InterfaceDeclaration: 'type', EnumDeclaration: 'type', TypeAliasDeclaration: 'type',
};

const extractJavaScript: ExtractSymbol = (node, source, add) => {
  const kind = jsDeclarations[node.name];
  if (kind) {
    const name = node.getChild('VariableDefinition') ?? node.getChild('TypeDefinition')
      ?? node.getChild('PropertyDefinition') ?? node.getChild('PrivatePropertyDefinition') ?? node.getChild('String');
    addName(add, kind, name ?? node.parent?.getChild('default'), source);
  } else if (node.name === 'ArrowFunction' || node.name === 'FunctionExpression' || node.name === 'ClassExpression') {
    const parent = node.parent;
    const assignedKind = node.name === 'ClassExpression' ? 'class' : 'function';
    if (parent?.name === 'VariableDeclaration') {
      let name = node.prevSibling;
      while (name && ['Equals', 'TypeAnnotation', 'LineComment', 'BlockComment'].includes(name.name)) name = name.prevSibling;
      if (name?.name === 'VariableDefinition') addName(add, assignedKind, name, source);
    } else if (parent?.name === 'PropertyDeclaration' || parent?.name === 'Property') {
      addName(add, assignedKind, parent.getChild('PropertyDefinition') ?? parent.getChild('PrivatePropertyDefinition'), source);
    } else if (parent?.name === 'ExportDeclaration') {
      addName(add, assignedKind, node.getChild('VariableDefinition') ?? parent.getChild('default'), source);
    }
  } else if (node.name === 'Property' && node.getChild('ParamList')) {
    addName(add, 'function', node.getChild('PropertyDefinition') ?? node.getChild('String'), source);
  }
};

const extractPython: ExtractSymbol = (node, source, add) => {
  if (node.name === 'FunctionDefinition') addName(add, 'function', node.getChild('VariableName'), source);
  if (node.name === 'ClassDefinition') addName(add, 'class', node.getChild('VariableName'), source);
};

const declaratorKinds = new Set(['FunctionDeclarator', 'PointerDeclarator', 'ReferenceDeclarator', 'ParenthesizedDeclarator']);
const extractCpp: ExtractSymbol = (node, source, add) => {
  if (node.name === 'ClassSpecifier' || node.name === 'StructSpecifier' || node.name === 'UnionSpecifier') {
    if (node.getChild('FieldDeclarationList')) addName(add, 'class', node.getChild('TypeIdentifier'), source);
  } else if (node.name === 'FunctionDefinition') {
    let declarator: SyntaxNode | null = node;
    while (declarator && declarator.name !== 'FunctionDeclarator') {
      let child: SyntaxNode | null = declarator.firstChild;
      while (child && !declaratorKinds.has(child.name)) child = child.nextSibling;
      declarator = child;
    }
    addName(add, 'function', declarator?.firstChild, source);
  }
};

const extractJson: ExtractSymbol = (node, source, add) => {
  if (node.name !== 'PropertyName' || node.nextSibling?.name !== ':' || node.to - node.from > MAX_LABEL) return;
  try {
    const key: unknown = JSON.parse(source.slice(node.from, node.to));
    if (typeof key === 'string') add('key', key, node.from);
  } catch { /* Ignore keys still being typed. */ }
};

const extractYaml: ExtractSymbol = (node, source, add) => {
  if (node.name !== 'Key' || node.parent?.name !== 'Pair') return;
  const key = node.firstChild;
  if (key?.name === 'Literal' || key?.name === 'QuotedLiteral') addName(add, 'key', key, source);
};

const extractElementId: ExtractSymbol = (node, source, add) => {
  if (node.name !== 'Attribute') return;
  const name = node.getChild('AttributeName');
  if (!name || name.to - name.from > 6) return;
  const attribute = source.slice(name.from, name.to).toLowerCase();
  if (attribute !== 'id' && attribute !== 'xml:id') return;
  const value = node.getChild('AttributeValue') ?? node.getChild('UnquotedAttributeValue');
  addName(add, 'id', value, source);
};

const syntaxExtractors: Partial<Record<LanguageId, ExtractSymbol>> = {
  javascript: extractJavaScript, typescript: extractJavaScript, python: extractPython,
  c: extractCpp, cpp: extractCpp, json: extractJson, yaml: extractYaml,
  infographic: extractYaml, html: extractElementId, xml: extractElementId,
};

const lineExtractors: Partial<Record<LanguageId, (line: string) => { kind: SymbolKind; label: string; column: number } | undefined>> = {
  matlab(line) {
    const fn = /^[ \t]*function[ \t]+(?:(?:\[[^\]]*\]|\w+)[ \t]*=[ \t]*)?(?<name>[a-zA-Z]\w*)[ \t]*(?:\(|%|$)/d.exec(line);
    if (fn?.groups && fn.indices?.groups) return { kind: 'function', label: fn.groups.name, column: fn.indices.groups.name[0] };
    const cls = /^[ \t]*classdef[ \t]+(?:\([^)]*\)[ \t]*)?(?<name>[a-zA-Z]\w*)\b/d.exec(line);
    if (cls?.groups && cls.indices?.groups) return { kind: 'class', label: cls.groups.name, column: cls.indices.groups.name[0] };
  },
  toml(line) {
    const section = /^[ \t]*(?:\[\[([^\]]+)\]\]|\[([^\]]+)\])[ \t]*(?:#.*)?$/d.exec(line);
    if (section?.indices) return { kind: 'section', label: (section[1] ?? section[2]).trim(), column: (section.indices[1] ?? section.indices[2])[0] };
  },
  ini(line) {
    const section = /^[ \t]*\[([^\]]+)\][ \t]*(?:[;#].*)?$/d.exec(line);
    if (section?.indices) return { kind: 'section', label: section[1].trim(), column: section.indices[1][0] };
  },
};

export function supportsCodeSymbols(language: LanguageId) {
  return !!(syntaxExtractors[language] || lineExtractors[language]);
}

export async function collectCodeSymbols(state: EditorState, language: LanguageId) {
  const { doc } = state;
  const end = Math.min(doc.length, MAX_CHARS);
  const source = doc.sliceString(0, end);
  const symbols: CodeSymbol[] = [];
  let limited = doc.length > end;
  const add: AddSymbol = (kind, label, position) => {
    if (!label || label.length > MAX_LABEL || position >= end) return;
    if (symbols.length === MAX_SYMBOLS) { limited = true; return; }
    symbols.push({ kind, label, position, line: doc.lineAt(position).number });
  };
  const extractSyntax = syntaxExtractors[language];
  const extractLine = lineExtractors[language];
  if (extractSyntax) {
    const support = await loadLanguageExtension(language);
    if (!(support instanceof LanguageSupport)) throw new Error('无法加载文档语法');
    const tree = support.language.isActiveAt(state, 0) && syntaxTreeAvailable(state, end)
      ? syntaxTree(state) : support.language.parser.parse(source);
    const cursor = tree.cursor();
    do {
      if (cursor.from >= end) break;
      extractSyntax(cursor.node, source, add);
      if (symbols.length === MAX_SYMBOLS && limited) break;
    } while (cursor.next());
  } else if (extractLine) {
    let inMatlabComment = false;
    let position = 0;
    for (const text of source.split('\n')) {
      const from = position;
      position += text.length + 1;
      if (position > end && limited && doc.sliceString(end, end + 1) !== '\n') break;
      if (language === 'matlab') {
        const trimmed = text.trim();
        if (trimmed === '%}') { inMatlabComment = false; continue; }
        if (trimmed === '%{') inMatlabComment = true;
        if (inMatlabComment) continue;
      }
      const symbol = extractLine(text);
      if (symbol) add(symbol.kind, symbol.label, from + symbol.column);
      if (symbols.length === MAX_SYMBOLS && limited) break;
    }
  }
  return { symbols, limited };
}
