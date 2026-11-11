import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// pdf.js data files are served from our own origin (copied by scripts/copy-vendor-assets.mjs)
const vendor = `${import.meta.env.BASE_URL}vendor/pdfjs/`;

export class PdfPasswordError extends Error {
  constructor(public incorrect: boolean) {
    super(incorrect ? 'Incorrect password' : 'This PDF is password protected');
  }
}

export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    // pdf.js transfers the buffer to its worker, so always hand it a copy
    data: bytes.slice(),
    password,
    cMapUrl: `${vendor}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${vendor}standard_fonts/`,
    wasmUrl: `${vendor}wasm/`,
    isEvalSupported: false,
    enableXfa: false,
  } as any);
  try {
    return await task.promise;
  }
  catch (error: any) {
    if (error?.name === 'PasswordException') {
      throw new PdfPasswordError(error.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    }
    throw error;
  }
}

const runningRenders = new WeakMap<HTMLCanvasElement, RenderTask>();

// Render a page into a canvas at the given zoom (1 = 72 dpi), sharp on HiDPI screens
export async function renderPage(doc: PDFDocumentProxy, pageIndex: number, zoom: number, canvas: HTMLCanvasElement, pixelRatio = window.devicePixelRatio || 1) {
  runningRenders.get(canvas)?.cancel();
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: zoom * pixelRatio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`;
  const task = page.render({
    canvas,
    canvasContext: canvas.getContext('2d')!,
    viewport,
    annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
  } as any);
  runningRenders.set(canvas, task);
  try {
    await task.promise;
  }
  catch (error: any) {
    if (error?.name !== 'RenderingCancelledException') {
      throw error;
    }
  }
}

export async function renderPageToCanvas(doc: PDFDocumentProxy, pageIndex: number, dpi: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  await renderPage(doc, pageIndex, dpi / 72, canvas, 1);
  return canvas;
}

export async function renderThumbnail(doc: PDFDocumentProxy, pageIndex: number, width = 140): Promise<string> {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const canvas = document.createElement('canvas');
  await renderPage(doc, pageIndex, width / base.width, canvas, 1);
  return canvas.toDataURL('image/jpeg', 0.7);
}

export async function pageViewportSize(doc: PDFDocumentProxy, pageIndex: number) {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

export interface TextRun {
  text: string
  // viewport coordinates at zoom 1 (top-left origin)
  x: number
  y: number
  w: number
  h: number
  fontSize: number
  fontFamily: string
}

export async function getTextRuns(doc: PDFDocumentProxy, pageIndex: number): Promise<TextRun[]> {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const runs: TextRun[] = [];
  for (const item of content.items as any[]) {
    if (!item.str || !item.str.trim()) {
      continue;
    }
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.hypot(tx[2], tx[3]);
    const vertical = Math.abs(tx[1]) > Math.abs(tx[0]);
    const width = item.width * viewport.scale;
    runs.push({
      text: item.str,
      x: vertical ? tx[4] - fontSize : tx[4],
      y: tx[5] - fontSize,
      w: vertical ? fontSize : width,
      h: vertical ? width : fontSize * 1.15,
      fontSize,
      fontFamily: content.styles?.[item.fontName]?.fontFamily ?? 'sans-serif',
    });
  }
  return runs;
}

export async function getPageText(doc: PDFDocumentProxy, pageIndex: number): Promise<string> {
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  let text = '';
  for (const item of content.items as any[]) {
    text += item.str;
    if (item.hasEOL) {
      text += '\n';
    }
  }
  return text;
}

export interface SearchMatch {
  pageIndex: number
  x: number
  y: number
  w: number
  h: number
  context: string
}

export async function searchText(doc: PDFDocumentProxy, query: string, options: { caseSensitive: boolean; regex: boolean }): Promise<SearchMatch[]> {
  if (!query) {
    return [];
  }
  const pattern = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi');
  const matches: SearchMatch[] = [];
  for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex++) {
    for (const run of await getTextRuns(doc, pageIndex)) {
      for (const m of run.text.matchAll(re)) {
        if (!m[0]) {
          continue;
        }
        // approximate the match position by its share of the run's characters
        const start = m.index ?? 0;
        const charWidth = run.w / Math.max(run.text.length, 1);
        matches.push({
          pageIndex,
          x: run.x + start * charWidth,
          y: run.y,
          w: m[0].length * charWidth,
          h: run.h,
          context: run.text,
        });
      }
    }
  }
  return matches;
}
