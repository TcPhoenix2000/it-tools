# Security

## Reporting a vulnerability

Please open a [private security advisory](https://github.com/TcPhoenix2000/it-tools/security/advisories/new) instead of a public issue.

## How this fork is hardened

**Application**
- All randomness (tokens, passwords, OTP secrets) comes from the Web Crypto CSPRNG (`crypto.getRandomValues`), not `Math.random`.
- No runtime calls to third-party hosts: ASCII-art fonts are bundled, analytics are disabled by default.
- Vulnerable dependencies upgraded or pinned via `pnpm.overrides` (`package.json`).

**Container image**
- nginx runs as a non-root user (uid 101) on port 8080, with OS packages upgraded at build time.
- Strict security headers, including a Content-Security-Policy without `unsafe-inline`/`unsafe-eval` scripts (`nginx-security-headers.conf`).
- Dotfiles are never served, the nginx version is hidden, and a healthcheck is included.

**Release pipeline**
- Every image is scanned with Grype before it is pushed. Any fixable high or critical vulnerability fails the release.
- Images are published with SBOM and provenance attestations.
- All GitHub Actions are pinned to commit SHAs, workflows use least-privilege permissions, and release artifacts are built without restored caches. Workflows are linted with zizmor and actionlint.
- Renovate keeps action SHAs, base-image digests and dependencies up to date.

## Known residual advisories (audit of 2026-11-09)

`pnpm audit` went from 246 to 48 advisories. The remaining ones were reviewed:

| Package | Where | Why it is accepted |
|---|---|---|
| vitest 0.34, tinypool, vite 4 dev server, esbuild, launch-editor, zx, hygen deps | Dev / build tooling only | Never shipped in the image. The dev server and vitest UI are not exposed. Fixing needs major tooling upgrades (planned). |
| vue-i18n / @intlify 9.x (`escapeParameter` XSS) | Browser | No patched version exists in any release. The app does not use `escapeParameter`, and translations are bundled at build time (not attacker-controlled). |
| unhead (`useHeadSafe` bypass) | Browser | The app only uses `useHead` with static values, never `useHeadSafe` with user input. |
| @tiptap/core (`mergeAttributes` `__proto__`) | Browser (WYSIWYG tool) | Needs attacker-controlled node attributes. Content only comes from the local user's own input. Fix requires tiptap v3. |
| ip-address, deepmerge-ts (via composerize-ts) | Browser (docker-run → compose tool) | Worst case is a slow parse of the user's own input in their own tab. No newer composerize-ts release exists. |
| markdown-it 13, linkify-it 4 | Build-time markdown plugin | Only processes the repo's own markdown during the build. |
