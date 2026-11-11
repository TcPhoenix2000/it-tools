import { zipSync } from 'fflate';

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadBytes(bytes: Uint8Array, fileName: string, type = 'application/pdf') {
  downloadBlob(new Blob([bytes], { type }), fileName);
}

export function downloadZip(files: { name: string; bytes: Uint8Array }[], fileName: string) {
  const entries = Object.fromEntries(files.map(f => [f.name, f.bytes]));
  downloadBytes(zipSync(entries, { level: 0 }), fileName, 'application/zip');
}

export function baseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, '') || 'document';
}

export async function canvasToBytes(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 0.92): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Export failed'))), type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}
