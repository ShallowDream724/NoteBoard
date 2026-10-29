import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import skill from '../../skills/noteboard-authoring/SKILL.md?raw';
import { parseAuthoring } from '../../src/features/declarative/authoring';

const flatten = (node: JSONContent): JSONContent[] => [node, ...(node.content ?? []).flatMap(flatten)];

describe('AI authoring skill examples', () => {
  it('produces modeled layouts and explanations through the actual document parser', () => {
    const examples = [...skill.matchAll(/```noteboard\n([\s\S]*?)\n```/g)].map(match => match[1]);
    expect(examples.length).toBeGreaterThan(0);
    const parsed = parseAuthoring(examples.join('\n\n'));
    expect(parsed.diagnostics).toEqual([]);
    const nodes = flatten(parsed.document);
    const types = nodes.map(node => node.type);
    expect(types).not.toContain('authoringRaw');
    for (const type of ['table', 'image', 'disclosure', 'githubAlert', 'annotationStore']) expect(types).toContain(type);
    const collections = nodes.filter(node => node.type === 'imageCollection');
    expect(collections.map(node => node.attrs?.layout)).toEqual(['grid', 'carousel']);
    expect(collections[0].content).toHaveLength(4);
    expect(collections[0].content?.[1].content ?? []).toEqual([]);
    expect(collections[1].attrs?.columns).toBe(2);
    expect(nodes.some(node => node.attrs?.annotationId)).toBe(true);
    expect(nodes.some(node => node.marks?.some(mark => mark.type === 'annotationReference'))).toBe(true);
  });

  it('supports the exact inline boundaries and nested colors described by the guide', () => {
    const parsed = parseAuthoring(String.raw`\b{添加与整理：}空行 \i{斜体} \s{删除} \u{下划线} \blur{答案} \bg[rgb(254, 240, 138)]{底色} \color[red]{甲\color[blue]{乙}丙}`);
    expect(parsed.diagnostics).toEqual([]);
    const nodes = flatten(parsed.document);
    const marks = nodes.flatMap(node => node.marks?.map(mark => mark.type) ?? []);
    for (const type of ['bold', 'italic', 'strike', 'underline', 'conceal', 'highlight', 'textColor']) expect(marks).toContain(type);
    const inner = nodes.find(node => node.text === '乙');
    expect(inner?.marks?.find(mark => mark.type === 'textColor')?.attrs?.color).toBe('#0000ff');
  });
});
