<picture>
    <source srcset="./.github/logo-dark.png" media="(prefers-color-scheme: light)">
    <source srcset="./.github/logo-white.png" media="(prefers-color-scheme: dark)">
    <img src="./.github/logo-dark.png" alt="logo">
</picture>

<p align="center">
Useful tools for developer and people working in IT. Self-hosted, security-hardened build maintained by <a href="https://github.com/TcPhoenix2000">TcPhoenix2000</a>.
</p>

> This is a maintained fork of [CorentinTh/it-tools](https://github.com/CorentinTh/it-tools) by Corentin Thomasset (GPL-3.0).
> It adds dependency security updates, a hardened container image and a vulnerability-gated release pipeline.

## Functionalities and roadmap

Please check the [issues](https://github.com/TcPhoenix2000/it-tools/issues) to see if some feature listed to be implemented.

You have an idea of a tool? Submit a [feature request](https://github.com/TcPhoenix2000/it-tools/issues/new/choose)!

## Self host

Self host solutions for your homelab. The image runs nginx as a **non-root** user and listens on port **8080** inside the container.

**From GitHub packages:**

```sh
docker run -d --name it-tools --restart unless-stopped -p 8080:8080 ghcr.io/tcphoenix2000/it-tools:latest
```

**From Docker Hub** (when published there):

```sh
docker run -d --name it-tools --restart unless-stopped -p 8080:8080 <dockerhub-user>/it-tools:latest
```

**Docker Compose:**

```yaml
services:
  it-tools:
    image: ghcr.io/tcphoenix2000/it-tools:latest
    container_name: it-tools
    restart: unless-stopped
    ports:
      - 8080:8080
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
```

Some tools (like the camera recorder) only work when the site is served over **HTTPS** or from `localhost`, so put it behind a TLS reverse proxy for full functionality.

### Image security

- Every image is scanned with [Grype](https://github.com/anchore/grype) before it is pushed; the release fails on any fixable high or critical vulnerability.
- Images ship with SBOM and build-provenance attestations.
- Strict HTTP security headers (Content-Security-Policy, X-Frame-Options, etc.) are set by nginx.

### Release pipeline

- `nightly` tag: built daily from `main` (when there were new commits).
- `latest` and `<version>` tags: built when a `v*.*.*` git tag is pushed (`pnpm release`).
- Images go to `ghcr.io/<owner>/it-tools`, plus Docker Hub when the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository secrets are set.

## Contribute

### Recommended IDE Setup

[VSCode](https://code.visualstudio.com/) with the following extensions:

- [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur)
- [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin).
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [i18n Ally](https://marketplace.visualstudio.com/items?itemName=lokalise.i18n-ally)

with the following settings:

```json
{
  "editor.formatOnSave": false,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "i18n-ally.localesPaths": ["locales", "src/tools/*/locales"],
  "i18n-ally.keystyle": "nested"
}
```

### Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin) to make the TypeScript language service aware of `.vue` types.

If the standalone TypeScript plugin doesn't feel fast enough to you, Volar has also implemented a [Take Over Mode](https://github.com/johnsoncodehk/volar/discussions/471#discussioncomment-1361669) that is more performant. You can enable it by the following steps:

1. Disable the built-in TypeScript Extension
   1. Run `Extensions: Show Built-in Extensions` from VSCode's command palette
   2. Find `TypeScript and JavaScript Language Features`, right click and select `Disable (Workspace)`
2. Reload the VSCode window by running `Developer: Reload Window` from the command palette.

### Project Setup

```sh
pnpm install
```

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

### Type-Check, Compile and Minify for Production

```sh
pnpm build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
pnpm test
```

### Lint with [ESLint](https://eslint.org/)

```sh
pnpm lint
```

### Create a new tool

To create a new tool, there is a script that generate the boilerplate of the new tool, simply run:

```sh
pnpm run script:create:tool my-tool-name
```

It will create a directory in `src/tools` with the correct files, and a the import in `src/tools/index.ts`. You will just need to add the imported tool in the proper category and develop the tool.

## Credits

IT-Tools was created and is maintained upstream by [Corentin Thomasset](https://corentin.tech) and [its contributors](https://github.com/CorentinTh/it-tools/graphs/contributors). If you like it, consider [supporting the original author](https://www.buymeacoffee.com/cthmsst).

This fork is maintained by [TcPhoenix2000](https://github.com/TcPhoenix2000).

## License

This project is under the [GNU GPLv3](LICENSE).
