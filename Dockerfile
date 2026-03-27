FROM node:22-slim

WORKDIR /app

# Install client dependencies and build
COPY client/package*.json ./client/
RUN cd client && npm install

COPY client/ ./client/
RUN cd client && npm run build

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm install --production

COPY server/ ./server/

WORKDIR /app/server

EXPOSE 5000

CMD ["node", "index.js"]
