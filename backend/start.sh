#!/bin/bash

# Adult Content Manager - Container Startup Script
# This script ensures proper initialization in container environments

set -e

echo "============================================="
echo "  Adult Content Manager - Container Start"
echo "============================================="
echo "Environment : ${NODE_ENV:-development}"
echo "Port        : ${PORT:-4069}"
echo "Database    : ${DB_PATH:-/app/data/app.db}"
echo "Media path  : ${MEDIA_BASE_PATH:-/media}"
echo "Data path   : ${DATA_PATH:-/app/data}"
echo ""

# Create necessary directories
echo "📁 Ensuring directories exist..."
mkdir -p "${DATA_PATH:-/app/data}"
mkdir -p "${CONTENT_BASE_PATH:-/app/content}"

# Database initialization check
DB_FILE="${DB_PATH:-/app/data/app.db}"
if [ ! -f "$DB_FILE" ]; then
    echo "📊 No database found — a fresh one will be created on first run."
fi

# Verify media mount
if [ ! -d "${MEDIA_BASE_PATH:-/media}" ]; then
    echo "⚠️  Warning: Media path '${MEDIA_BASE_PATH:-/media}' does not exist."
    echo "   Make sure you mounted your media volume in docker-compose.yml"
fi

# Check runtime dependencies
echo ""
echo "🔧 Node.js : $(node --version)"
if command -v ffmpeg &> /dev/null; then
    echo "🔧 ffmpeg  : $(ffmpeg -version 2>&1 | head -1)"
else
    echo "⚠️  Warning: ffmpeg not found in PATH — video thumbnails will fail"
fi

echo ""
echo "🎬 Starting server..."
cd /app/backend
exec node index.js
