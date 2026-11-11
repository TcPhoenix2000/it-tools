import type { PageBox } from '../pdf-editor.types';

export function normalizeRotation(rotation: number): number {
  return (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
}

// Size of the page as displayed (viewport at scale 1), in points
export function viewportSize(box: PageBox): { width: number; height: number } {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  return box.rotation % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

// Viewport point (top-left origin, y down, as displayed) -> PDF user space point.
// Mirrors pdf.js PageViewport for each /Rotate value.
export function viewportToPdf(box: PageBox, vx: number, vy: number): { x: number; y: number } {
  switch (box.rotation) {
    case 90:
      return { x: box.x0 + vy, y: box.y0 + vx };
    case 180:
      return { x: box.x1 - vx, y: box.y0 + vy };
    case 270:
      return { x: box.x1 - vy, y: box.y1 - vx };
    default:
      return { x: box.x0 + vx, y: box.y1 - vy };
  }
}

// PDF user space point -> viewport point (inverse of viewportToPdf)
export function pdfToViewport(box: PageBox, px: number, py: number): { x: number; y: number } {
  switch (box.rotation) {
    case 90:
      return { x: py - box.y0, y: px - box.x0 };
    case 180:
      return { x: box.x1 - px, y: py - box.y0 };
    case 270:
      return { x: box.y1 - py, y: box.x1 - px };
    default:
      return { x: px - box.x0, y: box.y1 - py };
  }
}

// Anchor (bottom-left corner as seen on screen) and rotation for drawing an upright box with pdf-lib.
// pdf-lib rotates counter-clockwise around the anchor; displaying a page with /Rotate r turns it
// clockwise by r, so content rotated by r appears upright.
export function uprightBox(box: PageBox, rect: { x: number; y: number; w: number; h: number }) {
  const anchor = viewportToPdf(box, rect.x, rect.y + rect.h);
  return { x: anchor.x, y: anchor.y, width: rect.w, height: rect.h, rotation: box.rotation };
}

// Axis-aligned PDF-space rectangle covering a viewport rectangle (for annotation /Rect)
export function pdfRect(box: PageBox, rect: { x: number; y: number; w: number; h: number }): [number, number, number, number] {
  const a = viewportToPdf(box, rect.x, rect.y);
  const b = viewportToPdf(box, rect.x + rect.w, rect.y + rect.h);
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}

export function normalizeRect(x1: number, y1: number, x2: number, y2: number) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean.padEnd(6, '0').slice(0, 6);
  const n = Number.parseInt(full, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

// Parse page ranges like "1-3, 5, 8-" (1-based, inclusive) into 0-based indexes, in order, without duplicates
export function parsePageRanges(input: string, pageCount: number): number[] {
  const result: number[] = [];
  const seen = new Set<number>();
  for (const part of input.split(',').map(p => p.trim()).filter(Boolean)) {
    const match = part.match(/^(\d*)\s*(-)?\s*(\d*)$/);
    if (!match) {
      throw new Error(`Invalid page range: "${part}"`);
    }
    const [, startRaw, dash, endRaw] = match;
    const start = startRaw ? Number(startRaw) : 1;
    const end = dash ? (endRaw ? Number(endRaw) : pageCount) : start;
    if (start < 1 || end > pageCount || start > end) {
      throw new Error(`Page range out of bounds: "${part}" (document has ${pageCount} pages)`);
    }
    for (let p = start; p <= end; p++) {
      if (!seen.has(p - 1)) {
        seen.add(p - 1);
        result.push(p - 1);
      }
    }
  }
  return result;
}
