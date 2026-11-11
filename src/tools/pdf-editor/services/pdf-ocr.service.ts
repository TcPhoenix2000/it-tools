import { StandardFonts, degrees } from '@cantoo/pdf-lib';
import { viewportToPdf } from './geometry';
import { getPageBoxes, loadPdfLib, savePdf } from './pdf-document.service';
import { sanitizeForFont } from './pdf-objects.service';
import { getTextRuns, openPdf, renderPageToCanvas } from './pdf-render.service';

export type OcrLanguage = 'eng' | 'nld' | 'eng+nld';

export interface OcrProgress {
  page: number
  total: number
  status: string
  progress: number
}

const vendor = `${import.meta.env.BASE_URL}vendor/tesseract/`;
const OCR_DPI = 300;

// Adds an invisible, searchable and selectable text layer on top of scanned pages
export async function ocrPdf(
  bytes: Uint8Array,
  options: { language: OcrLanguage; skipPagesWithText: boolean; pages?: number[] },
  onProgress: (p: OcrProgress) => void,
): Promise<{ bytes: Uint8Array; pagesProcessed: number }> {
  // tesseract (engine ~5 MB + language data) is only loaded when OCR is actually used
  const { createWorker, OEM } = await import('tesseract.js');
  const pdf = await openPdf(bytes);
  const doc = await loadPdfLib(bytes);
  const boxes = getPageBoxes(doc);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const targets = options.pages ?? pages.map((_, i) => i);
  let current = 0;

  const worker = await createWorker(options.language, OEM.LSTM_ONLY, {
    workerPath: `${vendor}worker.min.js`,
    corePath: `${vendor}core`,
    langPath: `${vendor}lang`,
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
    logger: (m: { status: string; progress: number }) => onProgress({ page: current, total: targets.length, status: m.status, progress: m.progress }),
  } as any);

  let pagesProcessed = 0;
  try {
    for (const [n, pageIndex] of targets.entries()) {
      current = n + 1;
      if (options.skipPagesWithText) {
        const runs = await getTextRuns(pdf, pageIndex);
        if (runs.reduce((sum, r) => sum + r.text.length, 0) > 20) {
          continue;
        }
      }
      onProgress({ page: current, total: targets.length, status: 'rendering page', progress: 0 });
      const canvas = await renderPageToCanvas(pdf, pageIndex, OCR_DPI);
      const { data } = await worker.recognize(canvas, {}, { blocks: true } as any);
      const scale = OCR_DPI / 72;
      const box = boxes[pageIndex];
      const page = pages[pageIndex];

      for (const block of (data as any).blocks ?? []) {
        for (const paragraph of block.paragraphs ?? []) {
          for (const line of paragraph.lines ?? []) {
            for (const word of line.words ?? []) {
              const text = sanitizeForFont(word.text ?? '', font).trim();
              if (!text || (word.confidence ?? 100) < 30) {
                continue;
              }
              const x = word.bbox.x0 / scale;
              const w = (word.bbox.x1 - word.bbox.x0) / scale;
              const bottom = word.bbox.y1 / scale;
              const h = (word.bbox.y1 - word.bbox.y0) / scale;
              const widthAtOne = font.widthOfTextAtSize(text, 1) || 1;
              const size = Math.max(1, Math.min(h, w / widthAtOne));
              const origin = viewportToPdf(box, x, bottom - h * 0.15);
              // opacity 0: invisible, but found by search and copyable, like Acrobat's OCR layer
              page.drawText(text, { x: origin.x, y: origin.y, size, font, opacity: 0, rotate: degrees(box.rotation) });
            }
          }
        }
      }
      pagesProcessed++;
    }
  }
  finally {
    await worker.terminate();
    await pdf.loadingTask.destroy();
  }

  return { bytes: await savePdf(doc), pagesProcessed };
}
