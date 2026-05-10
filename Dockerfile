# Multi-stage production build for OxSteed (Node.js + React SPA)
# Stage 1: Build client (Vite)
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ .
RUN npm run build

# Stage 2: Build and run server + client
FROM node:20-alpine
LABEL maintainer="OxSteed Team"

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init curl

WORKDIR /app

# Copy server dependencies
COPY server/package*.json server/
WORKDIR /app/server
RUN npm ci
# Copy server code
COPY server/ .

# Copy built client to correct location expected by server (../client/dist)
COPY --from=client-build /app/client/dist /app/client/dist

WORKDIR /app/server

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 5000) + '/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start server (runs migrations automatically via npm start)
CMD ["npm", "start"]

# Port
EXPOSE 5000
