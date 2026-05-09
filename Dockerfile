# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY api/package*.json ./api/
COPY dashboard/package*.json ./dashboard/

# Install dependencies
RUN npm install
RUN cd api && npm install
RUN cd dashboard && npm install

# Copy source
COPY . .

# Build
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy built files
COPY --from=builder /app/api/dist ./api/dist
COPY --from=builder /app/dashboard/dist ./dashboard/dist
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/api/package*.json ./api/
COPY --from=builder /app/dashboard/package*.json ./dashboard/

# Install production dependencies only
RUN npm install --production && \
    cd api && npm install --production && \
    cd ../dashboard && npm install --production

# Environment
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

# Expose port
EXPOSE 20128 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start
CMD ["node", "bin/bawwab.js"]
