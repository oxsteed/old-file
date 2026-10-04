# Multi-stage production build for OxSteed (Node.js + React SPA)
# Stage 1: Resolve one release identity for both browser and server artifacts.
FROM node:22-alpine AS release-meta
WORKDIR /source
COPY . .
ARG SENTRY_RELEASE
ARG COMMIT_SHA
ARG SOURCE_COMMIT
ARG GIT_SHA
RUN node scripts/build-release-metadata.cjs

# Stage 2: Build client (Vite)
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ .
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_SEND_DEFAULT_PII=false
ARG VITE_AWS_LOCATION_API_KEY
ARG VITE_AWS_LOCATION_REGION=us-east-1
ARG SENTRY_RELEASE
ARG COMMIT_SHA
ARG SOURCE_COMMIT
ARG VITE_APP_VERSION
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
ENV VITE_SENTRY_SEND_DEFAULT_PII=${VITE_SENTRY_SEND_DEFAULT_PII}
ENV VITE_AWS_LOCATION_API_KEY=${VITE_AWS_LOCATION_API_KEY}
ENV VITE_AWS_LOCATION_REGION=${VITE_AWS_LOCATION_REGION}
ENV SENTRY_RELEASE=${SENTRY_RELEASE}
ENV COMMIT_SHA=${COMMIT_SHA}
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}
COPY --from=release-meta /release /tmp/oxsteed-release
RUN release="$(cat /tmp/oxsteed-release)"; \
    SENTRY_RELEASE="$release" VITE_SENTRY_RELEASE="$release" VITE_APP_VERSION="$release" npm run build

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

# FFmpeg/ffprobe are required by the quarantine-gated video processing worker.
# Install them in the final runtime stage, not only the CI runner/build stage.
RUN apk add --no-cache dumb-init curl ffmpeg \
    && /usr/bin/ffmpeg -version >/dev/null \
    && /usr/bin/ffprobe -version >/dev/null

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
COPY --from=release-meta /release-metadata.json /app/server/.release-metadata.json

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
