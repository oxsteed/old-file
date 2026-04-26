# Multi-stage production build for OxSteed (Node.js + React SPA)
# Stage 1: Build client (React)
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --omit=dev
COPY client/ .
RUN npm run build

# Stage 2: Build and run server + client
FROM node:20-alpine
LABEL maintainer="OxSteed Team"

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy server dependencies
COPY server/package*.json server/
WORKDIR /app/server
RUN npm ci --omit=dev

# Copy server code
COPY server/ .

# Copy built client to be served as static assets
COPY --from=client-build /app/client/dist /app/server/public/dist

WORKDIR /app/server

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 5000) + '/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["/sbin/dumb-init", "--"]

# Start server (runs migrations automatically via npm start)
CMD ["npm", "start"]

# Port
EXPOSE 5000
