FROM node:20-alpine

LABEL maintainer="OpenClaw Kanban"
LABEL description="Kanban board for OpenClaw AI agent task tracking"

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy application code
COPY server.js ./
COPY public/ ./public/

# Create data directory for persistent storage
RUN mkdir -p /app/data

# Default seed data (will be overridden by volume mount if exists)
COPY data/tasks.json ./data/tasks.json

# Expose port
EXPOSE 3000

# Health check - verify API is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/stats || exit 1

# Run as non-root user for security
RUN addgroup -g 1001 -S kanban && \
    adduser -S kanban -u 1001 -G kanban && \
    chown -R kanban:kanban /app

USER kanban

CMD ["node", "server.js"]
