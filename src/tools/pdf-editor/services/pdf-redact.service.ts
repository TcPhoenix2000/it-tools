import type { EditorObject } from '../pdf-editor.types';
import { loadPdfLib, savePdf } from './pdf-document.service';
import { openPdf, renderPageToCanvas } from './pdf-render.service';

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Rendering failed'))), 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}

// Replace a page by a raster image of itself. Used by redaction and by maximum compression.
export async function rasterizePages(
  bytes: Uint8Array,
  pageIndexes: number[],
  options: { dpi: number; quality: number; paint?: (ctx: CanvasRenderingContext2D, pageIndex: number, scale: number) => void },
): Promise<Uint8Array> {
  if (pageIndexes.length === 0) {
    return bytes;
  }
  const pdf = await openPdf(bytes);
  const doc = await loadPdfLib(bytes);
  try {
    for (const pageIndex of pageIndexes) {
      const canvas = await renderPageToCanvas(pdf, pageIndex, options.dpi);
      const scale = options.dpi / 72;
      options.paint?.(canvas.getContext('2d')!, pageIndex, scale);
      const image = await doc.embedJpg(await canvasToJpeg(canvas, options.quality));
      // the rendered image already has the page rotation applied, so the new page is unrotated
      const width = canvas.width / scale;
      const height = canvas.height / scale;
      const page = doc.insertPage(pageIndex, [width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });
      doc.removePage(pageIndex + 1);
    }
  }
  finally {
    await pdf.loadingTask.destroy();
  }
  return savePdf(doc);
}

// True redaction: everything under the boxes (text, images, vectors) is removed from the file,
// not just covered. Affected pages become images; run OCR afterwards to make them searchable again.
export async function applyRedactions(bytes: Uint8Array, redactions: Record<number, EditorObject[]>, dpi = 200): Promise<Uint8Array> {
  const pages = Object.keys(redactions).map(Number).sort((a, b) => a - b);
  return rasterizePages(bytes, pages, {
    dpi,
    quality: 0.92,
    paint: (ctx, pageIndex, scale) => {
      ctx.fillStyle = '#000';
      for (const box of redactions[pageIndex]) {
        ctx.fillRect(Math.floor(box.x * scale), Math.floor(box.y * scale), Math.ceil(box.w * scale), Math.ceil(box.h * scale));
      }
    },
  });
}
