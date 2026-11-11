# Patch plan

Status after adding the PDF editor (2026-11-11). Source: `pnpm audit` (production and full dependency tree), plus review of the new PDF code and its CSP behaviour.

## Where we stand

- **New PDF libraries are clean.** `pdfjs-dist` 6.5.438, `@cantoo/pdf-lib` 2.11.1, `tesseract.js` 7, `signature_pad` 5 and `fflate` have no open advisories. fflate was bumped to 0.8.3 and pinned through an override.
- **pdf.js hardening:** runs with `isEvalSupported: false` and without XFA. Fonts, cmaps, wasm and OCR data are self-hosted under `/vendor/`, so no CDN calls are made.
- **CSP:** the CSP stays strict: `script-src 'self' 'wasm-unsafe-eval'`, with no `unsafe-eval` and no inline scripts. The PDF feature test (redaction, compression, OCR, signature) passed against the production build with zero CSP violations.
- **Redaction:** redaction rasterises the affected pages, so redacted text is gone from the bytes. The e2e test verifies this.
- **Pre-existing advisories remain:** 18 in production dependencies and 50 across the whole tree. All come from dependencies that predate this module. They are planned below, most important first.

## P1 – shipped to the browser

| # | Package (via) | Severity | Real exposure here | Fix |
|---|---|---|---|---|
| 1 | `vue-i18n` 9.14.5 (+ `@intlify/*`) | high | Low. The XSS needs `escapeParameter` plus `srcdoc`, and the app uses neither. Translations are our own strings. | Upgrade to vue-i18n 11.4.14+ and `@intlify/unplugin-vue-i18n` to match, then switch to the Composition API mode and check every `$t` and `useI18n` call. |
| 2 | `ip-address` 7, `deepmerge-ts` 5 (via `composerize-ts` 0.6.2) | high | Low. Only the "Docker run → compose" tool uses them, client-side, on the user's own input. | Override `ip-cidr` to 4.x and `ip-address` to 10.7.4+, and `deepmerge-ts` to 8, then e2e-test that tool. If it breaks, vendor or replace `composerize-ts`. |
| 3 | `unhead` 1.11 (via `@vueuse/head` 2) | moderate | Low. `useHead` is only given static strings, and `useHeadSafe` isn't used. | Replace `@vueuse/head` with `@unhead/vue` 2.1.13+ (`createHead` and `useHead` from the new package). |
| 4 | `@tiptap/*` 2.27 | moderate | Low. Prototype pollution in `mergeAttributes`, in the HTML WYSIWYG tool. | Upgrade to tiptap 3.30.4+ (StarterKit API changes). |

## P2 – build and dev toolchain (not in the image)

| # | Package | Severity | Fix |
|---|---|---|---|
| 5 | `vitest` 0.34 / `tinypool` | critical | Only exploitable while the Vitest UI server is running. Upgrade to vitest 3.2.6+. |
| 6 | `vite` 4.5 / `launch-editor` | high | Dev server only. Upgrade to Vite 6.4.4+ (or 7) with `@vitejs/plugin-vue` 5. **Afterwards, remove the `@cantoo/pdf-lib` alias in `vite.config.ts`**: newer esbuild parses JSON import attributes. |
| 7 | `serialize-javascript`, `deepmerge` (via `vite-plugin-pwa` 0.16) | high / low | Upgrade to vite-plugin-pwa 1.x (do it together with #6). |
| 8 | `markdown-it` 13, `linkify-it` 4 (via `vite-plugin-vue-markdown`) | high | Build-time, and only on our own markdown. Replace with `unplugin-vue-markdown`. |
| 9 | `esbuild` (via `unocss` 0.65), `minimatch`, `glob` | moderate | Upgrade unocss and the test utils together with #6. |
| 10 | `zx` 7 | moderate | Release script only. Upgrade to zx 8.8.5+. |
| 11 | `vue-template-compiler` (via `vue-tsc` 1.8) | moderate | Upgrade to vue-tsc 2 and TypeScript 5.6+ once the Vite upgrade is done. |

Suggested order: **#6 → #7 → #8 → #9 → #5 → #11 → #10** (as one toolchain PR), then **#1**, **#3**, **#4** and **#2** as separate PRs, each with its e2e test.

## P3 – PDF editor follow-ups

- **Certificate-based digital signatures** (PAdES): today's signatures are visual only. This needs a PKCS#7/CMS signer (for example `@signpdf` with a P12 the user loads locally). The existing "PDF signature checker" tool can verify the result.
- **Bundle size:** the editor chunk is 1.25 MB (459 KB gzipped). Load the heavier panels (Compare, OCR, Sign) with `defineAsyncComponent`.
- **More OCR languages:** French and German are about 2–4 MB each. Add them to `scripts/copy-vendor-assets.mjs` and the OCR panel.
- **"Maximum" compression** rasterises pages, so a small text-only file can grow. The UI now says "% larger" honestly. Consider warning before running it on text-only documents.
- **`c-modal` doesn't close on Escape:** a shared UI component, so this is an accessibility fix for every tool.

## Ops

- **Done by the CI pipeline on every release:** Grype image scan, SBOM and provenance.
- **Docker Hub:** optional. Add the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets if a Docker Hub mirror is wanted.
- **Renovate:** install the GitHub app so `renovate.json` takes effect and the P2 bumps arrive as PRs.
- **Failed release tag:** delete `v2026.11.10-1bc4c73` and its draft release by hand. It was a failed release, and the automation isn't allowed to delete remote tags.
- **Docker Desktop:** fix it locally (stale `sailor-ingest.sock`, so `wsl --shutdown`) so images can be scanned before pushing.
