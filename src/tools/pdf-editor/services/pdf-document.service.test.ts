import { PDFDocument, PDFName, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  addHeaderFooter,
  addWatermark,
  arrangePages,
  decryptPdf,
  encryptPdf,
  extractPages,
  fillFormFields,
  formatStamp,
  getPageBoxes,
  insertBlankPage,
  insertFiles,
  isEncrypted,
  listFormFields,
  loadPdfLib,
  readMetadata,
  rotatePages,
  sanitizePdf,
  splitPdf,
  writeMetadata,
} from './pdf-document.service';
import { applyObjects } from './pdf-objects.service';

// A small PDF whose pages have different sizes, so the order of pages can be checked
async function samplePdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200 + i * 10, 300]);
    page.drawText(`Page ${i + 1}`, { x: 20, y: 250, size: 12, font });
  }
  return doc.save();
}

const widths = async (bytes: Uint8Array) => (await loadPdfLib(bytes)).getPages().map(p => p.getWidth());

describe('pdf-document.service', () => {
  it('reorders, deletes and duplicates pages', async () => {
    const pdf = await samplePdf(3);
    expect(await widths(await arrangePages(pdf, [2, 0, 1]))).toEqual([220, 200, 210]);
    expect(await widths(await arrangePages(pdf, [0, 2]))).toEqual([200, 220]);
    expect(await widths(await arrangePages(pdf, [0, 0, 1, 2]))).toEqual([200, 200, 210, 220]);
    await expect(arrangePages(pdf, [])).rejects.toThrow();
  });

  it('rotates pages and normalises the angle', async () => {
    const out = await rotatePages(await samplePdf(2), [1], -90);
    const pages = (await loadPdfLib(out)).getPages();
    expect(pages[0].getRotation().angle).toBe(0);
    expect(pages[1].getRotation().angle).toBe(270);
  });

  it('inserts a blank page with the size of its neighbour', async () => {
    expect(await widths(await insertBlankPage(await samplePdf(2), 1))).toEqual([200, 200, 210]);
  });

  it('extracts and splits pages', async () => {
    const pdf = await samplePdf(5);
    expect(await widths(await extractPages(pdf, [4, 1]))).toEqual([240, 210]);
    const parts = await splitPdf(pdf, { kind: 'every', size: 2 });
    expect(parts.map(p => p.name)).toEqual(['pages-1-2', 'pages-3-4', 'page-5']);
    const ranges = await splitPdf(pdf, { kind: 'ranges', ranges: '1-2; 4-' });
    expect(await Promise.all(ranges.map(async r => (await widths(r.bytes)).length))).toEqual([2, 2]);
  });

  it('merges PDFs at a position', async () => {
    const merged = await insertFiles(await samplePdf(2), [{ name: 'b.pdf', type: 'application/pdf', bytes: await samplePdf(1) }], 1);
    expect(await widths(merged)).toEqual([200, 200, 210]);
  });

  it('adds watermark and page numbers without failing', async () => {
    const pdf = await samplePdf(2);
    const watermarked = await addWatermark(pdf, { text: 'DRAFT', fontSize: 40, color: '#ff0000', opacity: 0.3, angle: 45, pages: null });
    expect(watermarked.length).toBeGreaterThan(pdf.length);
    const numbered = await addHeaderFooter(pdf, {
      template: '{bates} - Page {page} of {total}',
      position: 'bottom-right',
      fontSize: 9,
      color: '#000000',
      margin: 20,
      startNumber: 1,
      batesPrefix: 'ABC',
      batesDigits: 4,
      skipFirstPage: false,
    });
    expect(numbered.length).toBeGreaterThan(pdf.length);
  });

  it('formats stamp placeholders', () => {
    expect(formatStamp('{bates} p{page}/{total} {date}', { page: 3, total: 9, bates: 'X0003', date: 'today' })).toBe('X0003 p3/9 today');
  });

  it('reads and writes metadata, and sanitizes hidden information', async () => {
    const withMeta = await writeMetadata(await samplePdf(1), { title: 'Secret plan', author: 'Tibo', subject: '', keywords: 'a, b', creator: 'x', producer: 'y' });
    expect(readMetadata(await loadPdfLib(withMeta)).title).toBe('Secret plan');

    const doc = await loadPdfLib(withMeta);
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'JavaScript', JS: 'app.alert(1)' }));
    const { bytes, removed } = await sanitizePdf(await doc.save());
    const cleaned = await loadPdfLib(bytes);
    expect(readMetadata(cleaned).title).toBe('');
    expect(readMetadata(cleaned).author).toBe('');
    expect(cleaned.catalog.has(PDFName.of('OpenAction'))).toBe(false);
    expect(removed).toContain('auto-run actions');
  });

  it('creates, lists, fills and flattens form fields', async () => {
    const pdf = await samplePdf(1);
    const withFields = await applyObjects(pdf, {
      0: [
        { id: 'a', type: 'field', fieldType: 'text', name: 'fullName', options: [], defaultValue: '', fontSize: 10, required: true, x: 20, y: 20, w: 120, h: 18 },
        { id: 'b', type: 'field', fieldType: 'checkbox', name: 'agree', options: [], defaultValue: '', fontSize: 10, required: false, x: 20, y: 50, w: 12, h: 12 },
        { id: 'c', type: 'field', fieldType: 'dropdown', name: 'country', options: ['BE', 'NL'], defaultValue: 'BE', fontSize: 10, required: false, x: 20, y: 80, w: 80, h: 18 },
        { id: 'd', type: 'field', fieldType: 'radio', name: 'size', options: ['S'], defaultValue: '', fontSize: 10, required: false, x: 20, y: 110, w: 12, h: 12 },
        { id: 'e', type: 'field', fieldType: 'radio', name: 'size', options: ['L'], defaultValue: '', fontSize: 10, required: false, x: 40, y: 110, w: 12, h: 12 },
      ],
    });
    const fields = listFormFields(await loadPdfLib(withFields));
    expect(fields.map(f => [f.name, f.type])).toEqual([['fullName', 'text'], ['agree', 'checkbox'], ['country', 'dropdown'], ['size', 'radio']]);
    expect(fields.find(f => f.name === 'size')!.options).toEqual(['S', 'L']);

    const filled = await fillFormFields(withFields, { fullName: 'Tibo', agree: true, size: 'L' }, false);
    const values = Object.fromEntries(listFormFields(await loadPdfLib(filled)).map(f => [f.name, f.value]));
    expect(values).toMatchObject({ fullName: 'Tibo', agree: true, country: 'BE', size: 'L' });

    const flattened = await fillFormFields(withFields, { fullName: 'Tibo' }, true);
    expect(listFormFields(await loadPdfLib(flattened))).toHaveLength(0);
  });

  it('draws editor objects on rotated pages', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 300]).setRotation(degrees(90));
    const out = await applyObjects(await doc.save(), {
      0: [
        { id: 't', type: 'text', text: 'Hello\nWorld €', fontSize: 12, font: 'Helvetica', bold: true, italic: false, color: '#112233', background: '#ffffff', x: 10, y: 10, w: 60, h: 30 },
        { id: 'r', type: 'rect', stroke: '#ff0000', fill: null, strokeWidth: 2, opacity: 1, x: 50, y: 50, w: 40, h: 20 },
        { id: 'l', type: 'arrow', x1: 5, y1: 5, x2: 80, y2: 60, stroke: '#000000', strokeWidth: 1, x: 5, y: 5, w: 75, h: 55 },
        { id: 'n', type: 'note', text: 'Check this', color: '#ffd400', author: 'me', x: 100, y: 100, w: 20, h: 20 },
      ],
    });
    const page = (await loadPdfLib(out)).getPages()[0];
    expect(getPageBoxes(await loadPdfLib(out))[0].rotation).toBe(90);
    expect(page.node.Annots()?.size()).toBe(1);
  });

  it('encrypts with a password and decrypts again', async () => {
    const pdf = await samplePdf(2);
    const encrypted = await encryptPdf(pdf, {
      userPassword: 'open-sesame',
      ownerPassword: 'owner',
      allowPrinting: true,
      allowCopying: false,
      allowModifying: false,
      allowAnnotating: false,
      allowFillingForms: true,
    });
    expect(isEncrypted(encrypted)).toBe(true);
    expect(isEncrypted(pdf)).toBe(false);
    const decrypted = await decryptPdf(encrypted, 'open-sesame');
    expect(isEncrypted(decrypted)).toBe(false);
    expect(await widths(decrypted)).toEqual([200, 210]);
  });
});
