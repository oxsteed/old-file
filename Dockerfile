# Multi-stage production build for OxSteed (Node.js + React SPA)
# Stage 1: Resolve one release identity for both browser and server artifacts.
FROM node:22-alpine AS release-meta
WORKDIR /source
COPY . .
ARG SENTRY_RELEASE
ARG COMMIT_SHA
ARG SOURCE_COMMIT
RUN release="${SENTRY_RELEASE:-${COMMIT_SHA:-$SOURCE_COMMIT}}"; \
    if [ -z "$release" ]; then release="$(node scripts/compute-content-release.cjs)"; fi; \
    printf '%s\n' "$release" > /release

# Stage 2: Build client (Vite)
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ .
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_SEND_DEFAULT_PII=false
ARG SENTRY_RELEASE
ARG COMMIT_SHA
ARG SOURCE_COMMIT
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
ENV VITE_SENTRY_SEND_DEFAULT_PII=${VITE_SENTRY_SEND_DEFAULT_PII}
ENV SENTRY_RELEASE=${SENTRY_RELEASE}
ENV COMMIT_SHA=${COMMIT_SHA}
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
COPY --from=release-meta /release /tmp/oxsteed-release
RUN release="$(cat /tmp/oxsteed-release)"; \
    SENTRY_RELEASE="$release" VITE_SENTRY_RELEASE="$release" npm run build

# Stage 3: Build and run server + client
FROM node:22-alpine
LABEL maintainer="OxSteed Team"
ARG SENTRY_RELEASE
ARG COMMIT_SHA
ARG SOURCE_COMMIT
ENV SENTRY_RELEASE=${SENTRY_RELEASE}
ENV COMMIT_SHA=${COMMIT_SHA}
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
LABEL org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.version="${SENTRY_RELEASE}"

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init curl

WORKDIR /app

# Copy server dependencies
COPY server/package*.json server/
WORKDIR /app/server
# Keep test and development tooling out of the production runtime image.
RUN npm ci --omit=dev
# Copy server code
COPY server/ .

# Copy built client to correct location expected by server (../client/dist)
COPY --from=client-build /app/client/dist /app/client/dist
# Keep the source locale catalogs available for server-rendered SEO metadata.
COPY --from=client-build /app/client/src/locales /app/client/src/locales
COPY --from=client-build /app/client/src/i18n/locales /app/client/src/i18n/locales
# Keep a non-secret content release when Coolify does not inject commit metadata.
COPY --from=release-meta /release /app/server/.release

WORKDIR /app/server

# Readiness check: migrations, database, configured Redis, realtime, and workers.
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD curl -fsS "http://localhost:${PORT:-5000}/ready" || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start server (runs migrations automatically via npm start)
CMD ["npm", "start"]

# Port
EXPOSE 5000
