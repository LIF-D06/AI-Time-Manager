# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build frontend
RUN npm run build

# Build backend
# Using npx babel directly to avoid "npm run server" which tries to run the server
RUN npx babel server --out-dir server/dist --extensions .ts

# Production stage
FROM node:18-slim

WORKDIR /app

# Install python3 and pip
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

# Install playwright and browser dependencies
RUN pip3 install playwright --break-system-packages
RUN playwright install --with-deps chromium

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --production

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy built backend assets
COPY --from=builder /app/server/dist ./server/dist

# Copy python scripts and other non-compiled backend files
# We need to preserve the structure expected by the code: ./server/Services/ebEmulator/ebridge.py
# The code runs from /app, so it expects /app/server/Services/ebEmulator/ebridge.py
COPY --from=builder /app/server/Services/ebEmulator ./server/Services/ebEmulator

# Expose port
EXPOSE 3000

# Environment variables should be passed at runtime, but we can set defaults
ENV PORT=3000
ENV NODE_ENV=production

# Start command
CMD ["node", "server/dist/index.js"]
