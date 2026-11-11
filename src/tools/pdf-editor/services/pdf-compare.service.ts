import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getPageText, renderPageToCanvas } from './pdf-render.service';

export async function documentText(doc: PDFDocumentProxy): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    parts.push(`──────── Page ${i + 1} ────────\n${(await getPageText(doc, i)).trim()}`);
  }
  return parts.join('\n\n');
}

export interface VisualDiff {
  // composite image: the newer page, with changed pixels painted red
  dataUrl: string
  changedRatio: number
}

// Pixel comparison of one page of each document, rendered at the same resolution
export async function visualDiff(a: PDFDocumentProxy, b: PDFDocumentProxy, pageIndex: number, dpi = 90): Promise<VisualDiff | null> {
  if (pageIndex >= a.numPages || pageIndex >= b.numPages) {
    return null;
  }
  const [ca, cb] = await Promise.all([renderPageToCanvas(a, pageIndex, dpi), renderPageToCanvas(b, pageIndex, dpi)]);
  const width = Math.max(ca.width, cb.width);
  const height = Math.max(ca.height, cb.height);
  const read = (c: HTMLCanvasElement) => {
    const tmp = document.createElement('canvas');
    tmp.width = width;
    tmp.height = height;
    const ctx = tmp.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(c, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  };
  const da = read(ca);
  const db = read(cb);
  const out = new ImageData(width, height);
  let changed = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const delta = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2]);
    if (delta > 60) {
      changed++;
      out.data.set([230, 30, 30, 255], i);
    }
    else {
      // faded copy of the newer page for context
      const gray = (db.data[i] + db.data[i + 1] + db.data[i + 2]) / 3;
      const faded = 255 - (255 - gray) * 0.35;
      out.data.set([faded, faded, faded, 255], i);
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), changedRatio: changed / (width * height) };
}
