# =============================================================================
# Adult Content Manager - Production Dockerfile
# Multi-stage build: React frontend build → Node.js production image
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build the React frontend
# ---------------------------------------------------------------------------
FROM node:20-slim AS frontend-build

WORKDIR /build

# Copy frontend package files and install deps
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci --ignore-scripts

# Copy frontend source and build
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ---------------------------------------------------------------------------
# Stage 2: Production image
# ---------------------------------------------------------------------------
FROM node:20-slim AS production

# Install system dependencies:
#   ffmpeg        - video processing / thumbnail generation
#   python3       - needed by some native module builds (node-gyp)
#   build-essential - compile native addons (better-sqlite3, sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root package files and install production deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy backend source
COPY backend/ ./backend/

# Copy the built React frontend from stage 1
COPY --from=frontend-build /build/frontend/build ./frontend/build

# Create persistent directories
RUN mkdir -p /app/data /app/media /app/content

# Make start script executable
RUN chmod +x /app/backend/start.sh

# Environment defaults
ENV NODE_ENV=production \
    PORT=4069 \
    DB_PATH=/app/data/app.db \
    MEDIA_BASE_PATH=/media \
    CONTENT_BASE_PATH=/app/content \
    DATA_PATH=/app/data \
    CONTAINER=true

EXPOSE 4069

# Health check — hit the /health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "const http=require('http');const r=http.get('http://localhost:4069/health',res=>{process.exit(res.statusCode===200?0:1)});r.on('error',()=>process.exit(1))"

ENTRYPOINT ["/app/backend/start.sh"]
