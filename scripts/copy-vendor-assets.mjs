// Copies runtime assets of the PDF editor (pdf.js data files, OCR engine and language data)
// into public/vendor so they are served from our own origin: no CDN calls, works offline,
// and stays within the Content-Security-Policy. Runs before `dev` and `build`.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const out = join(root, 'public', 'vendor');

const pkgDir = (name, from = require) => dirname(from.resolve(`${name}/package.json`));

rmSync(out, { recursive: true, force: true });

// pdf.js: character maps (CJK documents), standard fonts (non-embedded fonts) and wasm image decoders
const pdfjs = pkgDir('pdfjs-dist');
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  if (existsSync(join(pdfjs, dir))) {
    cpSync(join(pdfjs, dir), join(out, 'pdfjs', dir), { recursive: true });
  }
}

// tesseract.js: worker, core (wasm builds) and language data
const tesseract = pkgDir('tesseract.js');
const tesseractRequire = createRequire(join(tesseract, 'package.json'));
const tesseractCore = pkgDir('tesseract.js-core', tesseractRequire);
mkdirSync(join(out, 'tesseract', 'core'), { recursive: true });
cpSync(join(tesseract, 'dist', 'worker.min.js'), join(out, 'tesseract', 'worker.min.js'));
// OCR runs in LSTM-only mode, which only ever loads these single-file (wasm inlined) builds:
// plain, SIMD and relaxed-SIMD, picked by browser support. The other builds would add ~30 MB.
for (const file of readdirSync(tesseractCore).filter(f => /^tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(f))) {
  cpSync(join(tesseractCore, file), join(out, 'tesseract', 'core', file));
}

for (const lang of ['eng', 'nld']) {
  const langDir = pkgDir(`@tesseract.js-data/${lang}`);
  const variant = readdirSync(langDir).find(d => d.endsWith('best_int')) ?? readdirSync(langDir).find(d => /^\d/.test(d));
  cpSync(join(langDir, variant, `${lang}.traineddata.gz`), join(out, 'tesseract', 'lang', `${lang}.traineddata.gz`));
}

console.log(`Vendor assets copied to ${out}`);
