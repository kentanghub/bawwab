# syntax=docker/dockerfile:1

# ─── Stage 1: Build dashboard ────────────────────────────────────────────────
FROM node:20-alpine AS dashboard-builder
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# ─── Stage 2: Build API ─────────────────────────────────────────────────────
FROM node:20-alpine AS api-builder
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci
COPY api/ ./
RUN npm run build

# ─── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Install production dependencies for API + curl for healthcheck
COPY api/package*.json ./api/
RUN cd api && npm ci --omit=dev && apk add --no-cache curl

# Copy built API
COPY --from=api-builder /app/api/dist ./api/dist

# Copy built dashboard into API's expected location
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist

# Data directory for SQLite
RUN mkdir -p /data/bawwab

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
ENV BAWWAB_DATA_DIR=/data/bawwab

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "api/dist/index.js"]
