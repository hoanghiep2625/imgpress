# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --only=production

# Stage 2: Build Sharp (requires build tools)
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev pixman-dev
COPY server/package*.json ./
RUN npm ci

# Stage 3: Runtime (minimal)
FROM node:20-alpine
WORKDIR /app

# Install only runtime dependencies (no build tools)
RUN apk add --no-cache libstdc++ cairo jpeg pango giflib pixman tini

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy app files
COPY server/server.js ./
COPY index.html styles.css script.js ./

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => {if (r.statusCode !== 404) throw new Error(r.statusCode)})" || exit 1

# Non-root user (optional)
USER node

EXPOSE 3000

# Proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]