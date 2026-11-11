import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  type PDFRef,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
} from '@cantoo/pdf-lib';
import type { PageBox } from '../pdf-editor.types';
import { hexToRgb01, normalizeRotation, parsePageRanges } from './geometry';

export async function loadPdfLib(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

export async function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}

export function isEncrypted(bytes: Uint8Array): boolean {
  // An encrypted PDF has an /Encrypt entry in its trailer; scanning the tail is enough in practice
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  return /\/Encrypt\s/.test(tail) || /\/Encrypt\s/.test(head);
}

// Remove the encryption of a password-protected PDF (the password must be known)
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false } as any);
  return doc.save({ useObjectStreams: true });
}

export interface EncryptOptions {
  userPassword: string
  ownerPassword: string
  allowPrinting: boolean
  allowCopying: boolean
  allowModifying: boolean
  allowAnnotating: boolean
  allowFillingForms: boolean
}

export async function encryptPdf(bytes: Uint8Array, options: EncryptOptions): Promise<Uint8Array> {
  const doc = await loadPdfLib(bytes);
  const ownerPassword = options.ownerPassword || options.userPassword;
  (doc as any).encrypt({
    userPassword: options.userPassword,
    ownerPassword,
    permissions: {
      printing: options.allowPrinting ? 'highResolution' : false,
      modifying: options.allowModifying,
      copying: options.allowCopying,
      annotating: options.allowAnnotating,
      fillingForms: options.allowFillingForms,
      contentAccessibility: true,
      documentAssembly: options.allowModifying,
    },
  });
  return doc.save({ useObjectStreams: false });
}

export function getPageBoxes(doc: PDFDocument): PageBox[] {
  return doc.getPages().map((page) => {
    const crop = page.getCropBox();
    const media = page.getMediaBox();
    // pdf.js displays the intersection of crop and media box
    const x0 = Math.max(crop.x, media.x);
    const y0 = Math.max(crop.y, media.y);
    const x1 = Math.min(crop.x + crop.width, media.x + media.width);
    const y1 = Math.min(crop.y + crop.height, media.y + media.height);
    return { x0, y0, x1, y1, rotation: normalizeRotation(page.getRotation().angle) };
  });
}

// ---- Organize ----

// Rebuild the page order from a list of source indexes. Indexes may be omitted (deleted) or
// repeated (duplicated). Pages stay in the same document, so form fields and links survive.
export async function arrangePages(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  if (order.length === 0) {
    throw new Error('A PDF must keep at least one page.');
  }
  const doc = await loadPdfLib(bytes);
  const pages = doc.getPages();
  const used = new Set<number>();
  const targets = [];
  for (const index of order) {
    if (!used.has(index)) {
      used.add(index);
      targets.push(pages[index]);
    }
    else {
      const [copy] = await doc.copyPages(doc, [index]);
      targets.push(copy);
    }
  }
  // Rebuild the page tree as one flat list. Attributes that pages inherit from
  // intermediate tree nodes are copied onto the page first, so nothing is lost.
  const inheritable = ['Resources', 'MediaBox', 'CropBox', 'Rotate'].map(n => PDFName.of(n));
  for (const page of targets) {
    for (const key of inheritable) {
      const value = page.node.getInheritableAttribute(key);
      if (value && !page.node.has(key)) {
        page.node.set(key, value);
      }
    }
  }
  const rootRef = doc.catalog.get(PDFName.of('Pages')) as PDFRef;
  const root = doc.catalog.Pages();
  root.set(PDFName.of('Kids'), doc.context.obj(targets.map(p => p.ref)));
  root.set(PDFName.of('Count'), PDFNumber.of(targets.length));
  targets.forEach(page => page.node.setParent(rootRef));
  return savePdf(doc);
}

export async function rotatePages(bytes: Uint8Array, indexes: number[], delta: number): Promise<Uint8Array> {
  const doc = await loadPdfLib(bytes);
  const pages = doc.getPages();
  for (const i of indexes) {
    pages[i].setRotation(degrees(normalizeRotation(pages[i].getRotation().angle + delta)));
  }
  return savePdf(doc);
}

export async function insertBlankPage(bytes: Uint8Array, atIndex: number): Promise<Uint8Array> {
  const doc = await loadPdfLib(bytes);
  const pages = doc.getPages();
  const ref = pages[Math.min(Math.max(atIndex - 1, 0), pages.length - 1)];
  const { width, height } = ref ? ref.getSize() : { width: 595.28, height: 841.89 };
  doc.insertPage(atIndex, [width, height]);
  return savePdf(doc);
}

export async function extractPages(bytes: Uint8Array, indexes: number[]): Promise<Uint8Array> {
  const source = await loadPdfLib(bytes);
  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, indexes);
  pages.forEach(p => target.addPage(p));
  return savePdf(target);
}

export type SplitMode = { kind: 'every'; size: number } | { kind: 'ranges'; ranges: string };

export async function splitPdf(bytes: Uint8Array, mode: SplitMode): Promise<{ name: string; bytes: Uint8Array }[]> {
  const source = await loadPdfLib(bytes);
  const count = source.getPageCount();
  const groups: number[][] = [];
  if (mode.kind === 'every') {
    const size = Math.max(1, Math.floor(mode.size));
    for (let i = 0; i < count; i += size) {
      groups.push(Array.from({ length: Math.min(size, count - i) }, (_, k) => i + k));
    }
  }
  else {
    for (const part of mode.ranges.split(';').map(p => p.trim()).filter(Boolean)) {
      groups.push(parsePageRanges(part, count));
    }
  }
  const result = [];
  for (const group of groups) {
    const label = group.length === 1 ? `page-${group[0] + 1}` : `pages-${group[0] + 1}-${group[group.length - 1] + 1}`;
    result.push({ name: label, bytes: await extractPages(bytes, group) });
  }
  return result;
}

export interface IncomingFile {
  name: string
  type: string
  bytes: Uint8Array
}

async function imageToPngOrJpeg(file: IncomingFile): Promise<{ bytes: Uint8Array; kind: 'png' | 'jpg' }> {
  if (file.type === 'image/png') {
    return { bytes: file.bytes, kind: 'png' };
  }
  if (file.type === 'image/jpeg') {
    return { bytes: file.bytes, kind: 'jpg' };
  }
  // Other formats (webp, gif, bmp...) are converted through a canvas
  const bitmap = await createImageBitmap(new Blob([file.bytes], { type: file.type }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Image conversion failed'))), 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), kind: 'png' };
}

// Insert PDFs and images (as one page each) at the given index; returns the new document
export async function insertFiles(bytes: Uint8Array | null, files: IncomingFile[], atIndex?: number): Promise<Uint8Array> {
  const doc = bytes ? await loadPdfLib(bytes) : await PDFDocument.create();
  let index = atIndex ?? doc.getPageCount();
  for (const file of files) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const source = await PDFDocument.load(file.bytes, { updateMetadata: false });
      const pages = await doc.copyPages(source, source.getPageIndices());
      for (const page of pages) {
        doc.insertPage(index++, page);
      }
    }
    else if (file.type.startsWith('image/')) {
      const image = await imageToPngOrJpeg(file);
      const embedded = image.kind === 'png' ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
      // 96 dpi -> points
      const width = embedded.width * 0.75;
      const height = embedded.height * 0.75;
      const page = doc.insertPage(index++, [width, height]);
      page.drawImage(embedded, { x: 0, y: 0, width, height });
    }
    else {
      throw new Error(`Unsupported file type: ${file.name}`);
    }
  }
  return savePdf(doc);
}

// ---- Stamps: watermark, header/footer, page numbers, Bates numbering ----

export interface WatermarkOptions {
  text: string
  fontSize: number
  color: string
  opacity: number
  angle: number
  pages: number[] | null
}

export async function addWatermark(bytes: Uint8Array, options: WatermarkOptions): Promise<Uint8Array> {
  const doc = await loadPdfLib(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const { r, g, b } = hexToRgb01(options.color);
  doc.getPages().forEach((page, index) => {
    if (options.pages && !options.pages.includes(index)) {
      return;
    }
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(options.text, options.fontSize);
    const rad = (options.angle * Math.PI) / 180;
    // center the rotated text on the page
    const x = width / 2 - (Math.cos(rad) * textWidth) / 2 + (Math.sin(rad) * options.fontSize) / 3;
    const y = height / 2 - (Math.sin(rad) * textWidth) / 2 - (Math.cos(rad) * options.fontSize) / 3;
    page.drawText(options.text, { x, y, size: options.fontSize, font, color: rgb(r, g, b), opacity: options.opacity, rotate: degrees(options.angle) });
  });
  return savePdf(doc);
}

export type StampPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface HeaderFooterOptions {
  // Supports {page}, {total}, {bates} and {date} placeholders
  template: string
  position: StampPosition
  fontSize: number
  color: string
  margin: number
  startNumber: number
  batesPrefix: string
  batesDigits: number
  skipFirstPage: boolean
}

export function formatStamp(template: string, values: { page: number; total: number; bates: string; date: string }) {
  return template
    .replace(/{page}/g, String(values.page))
    .replace(/{total}/g, String(values.total))
    .replace(/{bates}/g, values.bates)
    .replace(/{date}/g, values.date);
}

export async function addHeaderFooter(bytes: Uint8Array, options: HeaderFooterOptions): Promise<Uint8Array> {
  const doc = await loadPdfLib(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const { r, g, b } = hexToRgb01(options.color);
  const pages = doc.getPages();
  const date = new Date().toLocaleDateString();
  pages.forEach((page, index) => {
    if (options.skipFirstPage && index === 0) {
      return;
    }
    const number = options.startNumber + index;
    const bates = `${options.batesPrefix}${String(number).padStart(options.batesDigits, '0')}`;
    const text = formatStamp(options.template, { page: number, total: pages.length + options.startNumber - 1, bates, date });
    const box = page.getCropBox();
    const textWidth = font.widthOfTextAtSize(text, options.fontSize);
    const [vertical, horizontal] = options.position.split('-');
    const x = horizontal === 'left'
      ? box.x + options.margin
      : horizontal === 'right' ? box.x + box.width - options.margin - textWidth : box.x + (box.width - textWidth) / 2;
    const y = vertical === 'top' ? box.y + box.height - options.margin - options.fontSize : box.y + options.margin;
    page.drawText(text, { x, y, size: options.fontSize, font, color: rgb(r, g, b) });
  });
  return savePdf(doc);
}

// ---- Metadata ----

export interface PdfMetadata {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
}

export function readMetadata(doc: PDFDocument): PdfMetadata {
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
  };
}

export async function writeMetadata(bytes: Uint8Array, meta: PdfMetadata): Promise<Uint8Array> {
  const doc = await loadPdfLib(bytes);
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  doc.setKeywords(meta.keywords.split(',').map(k => k.trim()).filter(Boolean));
  doc.setCreator(meta.creator);
  doc.setProducer(meta.producer);
  return savePdf(doc);
}

// Remove hidden information: document info, XMP metadata, JavaScript, auto-run actions and attachments
export async function sanitizePdf(bytes: Uint8Array): Promise<{ bytes: Uint8Array; removed: string[] }> {
  const doc = await loadPdfLib(bytes);
  const removed: string[] = [];
  const catalog = doc.catalog;
  for (const key of ['Metadata', 'OpenAction', 'AA', 'PieceInfo']) {
    if (catalog.has(PDFName.of(key))) {
      catalog.delete(PDFName.of(key));
      removed.push(key === 'Metadata' ? 'XMP metadata' : key === 'PieceInfo' ? 'application private data' : 'auto-run actions');
    }
  }
  const names = catalog.lookupMaybe(PDFName.of('Names'), (await import('@cantoo/pdf-lib')).PDFDict);
  if (names) {
    for (const key of ['JavaScript', 'EmbeddedFiles']) {
      if (names.has(PDFName.of(key))) {
        names.delete(PDFName.of(key));
        removed.push(key === 'JavaScript' ? 'JavaScript' : 'embedded attachments');
      }
    }
  }
  for (const page of doc.getPages()) {
    if (page.node.has(PDFName.of('AA'))) {
      page.node.delete(PDFName.of('AA'));
      removed.push('page actions');
    }
  }
  const info = readMetadata(doc);
  if (Object.values(info).some(Boolean)) {
    removed.push('document properties');
  }
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setCreator('');
  doc.setProducer('');
  return { bytes: await savePdf(doc), removed: [...new Set(removed)] };
}

// ---- Existing form fields ----

export interface FormFieldInfo {
  name: string
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'listbox' | 'other'
  value: string | boolean | string[]
  options: string[]
  multiline: boolean
  readOnly: boolean
}

export function listFormFields(doc: PDFDocument): FormFieldInfo[] {
  return doc.getForm().getFields().map((field) => {
    const base = { name: field.getName(), options: [] as string[], multiline: false, readOnly: field.isReadOnly() };
    if (field instanceof PDFTextField) {
      return { ...base, type: 'text' as const, value: field.getText() ?? '', multiline: field.isMultiline() };
    }
    if (field instanceof PDFCheckBox) {
      return { ...base, type: 'checkbox' as const, value: field.isChecked() };
    }
    if (field instanceof PDFRadioGroup) {
      return { ...base, type: 'radio' as const, value: field.getSelected() ?? '', options: field.getOptions() };
    }
    if (field instanceof PDFDropdown) {
      return { ...base, type: 'dropdown' as const, value: field.getSelected()[0] ?? '', options: field.getOptions() };
    }
    if (field instanceof PDFOptionList) {
      return { ...base, type: 'listbox' as const, value: field.getSelected(), options: field.getOptions() };
    }
    return { ...base, type: 'other' as const, value: '' };
  });
}

export async function fillFormFields(bytes: Uint8Array, values: Record<string, string | boolean | string[]>, flatten: boolean): Promise<Uint8Array> {
  const doc = await loadPdfLib(bytes);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field || field.isReadOnly()) {
      continue;
    }
    if (field instanceof PDFTextField) {
      field.setText(String(value));
    }
    else if (field instanceof PDFCheckBox) {
      value ? field.check() : field.uncheck();
    }
    else if (field instanceof PDFRadioGroup && value) {
      field.select(String(value));
    }
    else if (field instanceof PDFDropdown && value) {
      field.select(String(value));
    }
    else if (field instanceof PDFOptionList) {
      field.select(Array.isArray(value) ? value : [String(value)]);
    }
  }
  if (flatten) {
    form.flatten();
  }
  return savePdf(doc);
}

export async function flattenForm(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await loadPdfLib(bytes);
  doc.getForm().flatten();
  return savePdf(doc);
}
