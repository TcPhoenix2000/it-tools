import { PDFArray, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib';
import { loadPdfLib, savePdf } from './pdf-document.service';
import { rasterizePages } from './pdf-redact.service';

export type CompressionLevel = 'lossless' | 'balanced' | 'strong' | 'maximum';

export interface CompressionResult {
  bytes: Uint8Array
  imagesRecompressed: number
}

const levels = {
  balanced: { maxEdge: 2000, quality: 0.75 },
  strong: { maxEdge: 1400, quality: 0.55 },
};

async function recompressJpeg(data: Uint8Array, maxEdge: number, quality: number) {
  const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Encoding failed'))), 'image/jpeg', quality));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

export async function compressPdf(bytes: Uint8Array, level: CompressionLevel, pageCount: number): Promise<CompressionResult> {
  if (level === 'maximum') {
    // every page becomes a JPEG: smallest result, but text is no longer selectable
    const all = Array.from({ length: pageCount }, (_, i) => i);
    return { bytes: await rasterizePages(bytes, all, { dpi: 110, quality: 0.6 }), imagesRecompressed: 0 };
  }

  const doc = await loadPdfLib(bytes);
  let imagesRecompressed = 0;

  if (level !== 'lossless') {
    const { maxEdge, quality } = levels[level];
    for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream)) {
        continue;
      }
      const dict = object.dict;
      if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) {
        continue;
      }
      const filter = dict.get(PDFName.of('Filter'));
      const isDct = filter === PDFName.of('DCTDecode') || (filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === PDFName.of('DCTDecode'));
      const colorSpace = dict.get(PDFName.of('ColorSpace'));
      // only plain RGB/gray JPEGs: CMYK, indexed and custom-decode images are left untouched
      const simpleColor = colorSpace === PDFName.of('DeviceRGB') || colorSpace === PDFName.of('DeviceGray');
      if (!isDct || !simpleColor || dict.has(PDFName.of('Decode')) || dict.has(PDFName.of('Mask'))) {
        continue;
      }
      try {
        const result = await recompressJpeg(object.contents, maxEdge, quality);
        if (result.bytes.length >= object.contents.length * 0.9) {
          continue;
        }
        const newDict = dict.clone(doc.context);
        newDict.set(PDFName.of('Width'), PDFNumber.of(result.width));
        newDict.set(PDFName.of('Height'), PDFNumber.of(result.height));
        newDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        newDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
        newDict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
        newDict.delete(PDFName.of('DecodeParms'));
        newDict.set(PDFName.of('Length'), PDFNumber.of(result.bytes.length));
        doc.context.assign(ref, PDFRawStream.of(newDict, result.bytes));
        imagesRecompressed++;
      }
      catch {
        // an image the browser cannot decode is kept as is
      }
    }
  }

  return { bytes: await savePdf(doc), imagesRecompressed };
}
