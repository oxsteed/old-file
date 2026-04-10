FROM node:22-slim

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# ── Client build ──────────────────────────────────────────────────────────────
COPY client/package*.json ./client/
RUN cd client && npm ci

COPY client/ ./client/
RUN cd client && npm run build

# ── Server dependencies ───────────────────────────────────────────────────────
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/

# ── Non-root user (security hardening) ───────────────────────────────────────
RUN addgroup --system --gid 1001 oxsteed && \
    adduser  --system --uid 1001 --ingroup oxsteed oxsteed && \
    chown -R oxsteed:oxsteed /app

USER oxsteed

WORKDIR /app/server

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:5000/api/health || exit 1

# Migrations run as a Coolify pre-deploy command, not on every container start
CMD ["node", "index.js"]
