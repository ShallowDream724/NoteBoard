import { describe, expect, it } from 'vitest';
import { compositeColor, contrastRatio, parseColorWithAlpha, relativeLuminance } from '../../src/core/theme/contrast';
import { documentColor, readableBlockText } from '../../src/features/document-style/colors';
import { darkBackground, readableInkVariables } from '../../src/features/document-style/readableInk';
import { calloutAttributes, calloutStyle, isCalloutColor } from '../../src/features/editor-md/calloutPresentation';

describe('transparent document colors', () => {
  it('normalizes canonical HEX8 without discarding opacity and validates callout colors consistently', () => {
    expect(documentColor('#ABCDEF80')).toBe('#abcdef80');
    expect(documentColor('#ABCDEF')).toBe('#abcdef');
    for (const value of ['#12345', '#gggggg', '#123456789', 'rgba(0,0,0,.5)', '#abcd']) expect(documentColor(value)).toBeNull();
    expect(isCalloutColor('#ABCDEF00')).toBe(true);
    expect(calloutAttributes({ textColor: '#FFFFFF40', borderColor: '#00000080', backgroundColor: '#ABCDEF00' })).toMatchObject({ textColor: '#ffffff40', borderColor: '#00000080', backgroundColor: '#abcdef00' });
    expect(calloutStyle({ textColor: '#FFFFFF40', backgroundColor: '#ABCDEF00' })).toMatchObject({ '--callout-text': '#ffffff40', '--callout-background': '#abcdef00' });
  });
  it('parses long and short hexadecimal alpha equivalently to RGB functions', () => {
    expect(parseColorWithAlpha('#1234')).toEqual([17, 34, 51, 68 / 255]);
    expect(parseColorWithAlpha('#11223344')).toEqual([17, 34, 51, 68 / 255]);
    expect(parseColorWithAlpha('rgba(17, 34, 51, .25)')).toEqual([17, 34, 51, .25]);
    expect(parseColorWithAlpha('rgb(100% 0% 0% / 50%)')).toEqual([255, 0, 0, .5]);
    expect(() => parseColorWithAlpha('#xyzxyz')).toThrow();
  });
  it('composites both layers over the actual canvas before calculating contrast', () => {
    expect(compositeColor('#00000000', '#ffffff')).toBe('#ffffff');
    expect(compositeColor('#ffffff00', '#000000')).toBe('#000000');
    expect(compositeColor('#ff000080', '#0000ff')).toBe('#80007f');
    const background = '#ffffff80', foreground = '#00000080', canvas = '#0f172a';
    const visibleBackground = compositeColor(background, canvas), visibleForeground = compositeColor(foreground, visibleBackground);
    expect(contrastRatio(foreground, background, canvas)).toBeCloseTo(contrastRatio(visibleForeground, visibleBackground), 12);
    expect(contrastRatio('#00000000', '#abcdef80', canvas)).toBe(1);
    expect(relativeLuminance('#ffffff00', '#000000')).toBe(0);
    expect(contrastRatio('#ffffff80', '#00000000', '#000000')).toBeCloseTo(contrastRatio('rgba(255,255,255,0.5019607843137255)', '#000000'), 12);
  });
  it('retains authored alpha in theme fills and compensates only rendered ink against a dark canvas', () => {
    const background = '#fef08a40', color = '#00000030', darkFill = darkBackground(background);
    expect(parseColorWithAlpha(darkFill)[3]).toBe(64 / 255);
    const rendered = readableInkVariables(color, background);
    expect(contrastRatio(rendered['--nb-ink-light'], background, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(rendered['--nb-ink-dark'], darkFill, '#1e293b')).toBeGreaterThanOrEqual(4.5);
    expect(readableBlockText('#ffffff00', '#000000')).toBe('#f8fafc');
    expect(readableBlockText('#00000000', '#ffffff')).toBe('#18202b');
    expect(background).toBe('#fef08a40'); expect(color).toBe('#00000030');
  });
});
