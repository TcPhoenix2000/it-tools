# syntax=docker/dockerfile:1

# ---- build stage ----
FROM node:22-alpine AS build-stage
ENV NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    CI=true
WORKDIR /app

# Pinned to the packageManager version in package.json so the lockfile is honoured exactly
RUN npm install -g pnpm@9.11.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- production stage ----
# Unprivileged nginx: runs as uid 101 and listens on 8080 (no root, no privileged port)
FROM nginxinc/nginx-unprivileged:stable-alpine AS production-stage

LABEL org.opencontainers.image.title="it-tools" \
      org.opencontainers.image.description="Collection of handy online tools for developers, with great UX." \
      org.opencontainers.image.source="https://github.com/TcPhoenix2000/it-tools" \
      org.opencontainers.image.licenses="GPL-3.0"

# Pick up OS security patches released after the base image was built
USER root
RUN apk upgrade --no-cache
USER 101

COPY --chown=101:101 nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build-stage --chown=101:101 /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
