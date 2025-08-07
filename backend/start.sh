#!/bin/bash

# Adult Content Manager - Container Startup Script
# This script ensures proper initialization in container environments

set -e

echo "🚀 Starting Adult Content Manager..."
echo "Environment: ${NODE_ENV:-development}"
echo "Port: ${PORT:-3000}"
echo "Database: ${DB_PATH:-./app.db}"

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p /app/data
mkdir -p /app/media
mkdir -p /app/content

# Check if running as root (not recommended)
if [ "$(id -u)" = "0" ]; then
    echo "⚠️  Warning: Running as root is not recommended"
fi

# Database initialization check
if [ ! -f "${DB_PATH:-/app/data/app.db}" ]; then
    echo "📊 Initializing new database..."
    touch "${DB_PATH:-/app/data/app.db}"
fi

# Set proper permissions for database
if [ -w "$(dirname "${DB_PATH:-/app/data/app.db}")" ]; then
    chmod 644 "${DB_PATH:-/app/data/app.db}" 2>/dev/null || true
fi

# Verify required directories exist
if [ ! -d "${MEDIA_BASE_PATH:-/app/media}" ]; then
    echo "⚠️  Warning: Media base path ${MEDIA_BASE_PATH:-/app/media} does not exist"
fi

if [ ! -d "${CONTENT_BASE_PATH:-/app/content}" ]; then
    echo "⚠️  Warning: Content base path ${CONTENT_BASE_PATH:-/app/content} does not exist"
fi

# Check Node.js version
echo "🔧 Node.js version: $(node --version)"
echo "🔧 NPM version: $(npm --version)"

# Start the application
echo "🎬 Starting Adult Content Manager server..."
exec node index.js
