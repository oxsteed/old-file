FROM node:22-slim

WORKDIR /app

# Install curl for healthcheck and canvas dependencies (Cairo, Pango, libjpeg, libgif, librsvg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
  curl \
  build-essential \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

# Install client dependencies and build
COPY client/package*.json ./client/
RUN cd client && npm ci

COPY client/ ./client/
RUN cd client && npm run build

# Install server dependencies (lockfile must match package.json for reproducible builds)
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/

WORKDIR /app/server

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:5000/api/health || exit 1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nodeuser && \
    mkdir -p /app/public && \
    chown -R nodeuser:nodejs /app/public
USER nodeuser

# Run migrations then start the server
CMD ["sh", "-c", "node migrate.js && node index.js"]
