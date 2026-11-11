import { describe, expect, it } from 'vitest';
import { hexToRgb01, normalizeRotation, parsePageRanges, pdfRect, pdfToViewport, viewportSize, viewportToPdf } from './geometry';

const a4 = (rotation: number) => ({ x0: 0, y0: 0, x1: 595, y1: 842, rotation });

describe('pdf-editor geometry', () => {
  it('normalizes rotations', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(0)).toBe(0);
  });

  it('swaps viewport size for 90/270 rotations', () => {
    expect(viewportSize(a4(0))).toEqual({ width: 595, height: 842 });
    expect(viewportSize(a4(90))).toEqual({ width: 842, height: 595 });
  });

  it('maps the viewport top-left corner to the right PDF corner for each rotation', () => {
    expect(viewportToPdf(a4(0), 0, 0)).toEqual({ x: 0, y: 842 });
    expect(viewportToPdf(a4(90), 0, 0)).toEqual({ x: 0, y: 0 });
    expect(viewportToPdf(a4(180), 0, 0)).toEqual({ x: 595, y: 0 });
    expect(viewportToPdf(a4(270), 0, 0)).toEqual({ x: 595, y: 842 });
  });

  it('round-trips viewport <-> pdf for every rotation, including offset crop boxes', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const box = { x0: 10, y0: 20, x1: 610, y1: 820, rotation };
      const p = viewportToPdf(box, 123, 45);
      expect(pdfToViewport(box, p.x, p.y)).toEqual({ x: 123, y: 45 });
    }
  });

  it('computes an axis-aligned pdf rect', () => {
    expect(pdfRect(a4(0), { x: 10, y: 10, w: 100, h: 50 })).toEqual([10, 782, 110, 832]);
  });

  it('parses page ranges', () => {
    expect(parsePageRanges('1-3, 5, 8-', 10)).toEqual([0, 1, 2, 4, 7, 8, 9]);
    expect(parsePageRanges('2,2,1', 3)).toEqual([1, 0]);
    expect(() => parsePageRanges('4', 3)).toThrow();
    expect(() => parsePageRanges('a', 3)).toThrow();
  });

  it('converts hex colors', () => {
    expect(hexToRgb01('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
    expect(hexToRgb01('#fff')).toEqual({ r: 1, g: 1, b: 1 });
  });
});
