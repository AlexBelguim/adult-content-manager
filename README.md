# Adult Content Manager

A full-stack Express.js + React application for managing adult content with folder organization and device integration.

## Features

- **Content Management**: Organize and filter adult content by performer
- **Device Integration**: Handy device support for interactive content
- **File Processing**: Automatic file scanning and import workflows
- **Funscript Support**: Manage and preview funscript files
- **Filtering System**: Advanced filtering with undo functionality
- **Multi-format Support**: Images, videos, and funscript files

## Development Setup

### Prerequisites
- Node.js 18+ 
- PowerShell (for Windows development)

### Quick Start
```powershell
# Install backend dependencies
npm install

# Install frontend dependencies and build
cd frontend; npm install; npm run build

# Start the application
npm start
```

Access the application at: `http://localhost:3000`

## Deployment Options

### Local Development
- Use `npm start` to run the backend server
- Frontend builds to `frontend/build/` and is served by Express
- Database: SQLite (`backend/app.db`)

### TrueNAS Scale Deployment
For deploying as a custom app on TrueNAS Scale, see the `truenas-build/` folder:

- **Quick Start**: `truenas-build/TRUENAS_QUICKSTART.md`
- **Detailed Guide**: `truenas-build/TRUENAS_DEPLOYMENT.md`
- **Build Script**: `truenas-build/build-for-truenas.ps1`
- **Deploy Script**: `truenas-build/deploy-truenas.sh`

#### TrueNAS Scale Quick Deploy:
```powershell
# Build for TrueNAS (run on any Docker-enabled system)
cd truenas-build
.\build-for-truenas.ps1

# Transfer adult-content-manager.tar.gz to TrueNAS Scale
# Then on TrueNAS Scale:
docker load < adult-content-manager.tar.gz
chmod +x deploy-truenas.sh && ./deploy-truenas.sh
```

## Project Structure

```
adult-content-manager/
├── backend/                 # Express.js server
│   ├── routes/             # API endpoints
│   ├── services/           # Business logic
│   └── utils/              # Utilities
├── frontend/               # React application
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Page components
│   │   └── utils/          # Frontend utilities
│   └── build/              # Production build (served by backend)
└── truenas-build/          # TrueNAS Scale deployment files
    ├── Dockerfile
    ├── docker-compose.yml
    ├── deploy-truenas.sh
    └── documentation
```

## Core Folder Structure Pattern

The application expects this folder organization:

```
base-path/
├── before filter performer/    # Incoming content to be processed
├── content/                   # Organized content by genre
└── after filter performer/    # Filtered and approved content
```

## Technology Stack

**Backend:**
- Express.js with SQLite (better-sqlite3)
- Sharp for image processing
- Chokidar for file watching
- WebSocket support for device integration

**Frontend:**
- React 18 with Material-UI
- Local component state management
- Responsive design with mobile support

**Deployment:**
- Docker with multi-stage builds
- TrueNAS Scale custom app support
- Health checks and monitoring

## Development Commands

```powershell
# Backend server (serves built frontend)
npm start

# Frontend development build
cd frontend; npm run build

# Install dependencies
cd frontend; npm install

# Multiple commands (use ; not &&)
cd frontend; npm install; npm run build
```

## API Overview

- `/api/folders` - Folder management and scanning
- `/api/performers` - Performer data and filtering
- `/api/content` - Content organization
- `/api/filter` - File filtering workflows
- `/api/files` - Media file serving with thumbnails
- `/api/handy` - Device integration
- `/api/scenes` - Scene management
- `/api/funscripts` - Funscript file management

## Configuration

### Environment Variables
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode
- `DB_PATH` - Database file location
- `MEDIA_BASE_PATH` - Base path for media files
- `CONTENT_BASE_PATH` - Base path for processed content

### Database
- SQLite database with better-sqlite3
- Auto-creates schema on startup
- Supports performer stats, filter actions, and content metadata

## Contributing

1. Follow PowerShell syntax for scripts (use `;` not `&&`)
2. Frontend must be built before backend serves it
3. Use the provided coding instructions in `.github/copilot-instructions.md`
4. Test locally before deploying to TrueNAS Scale

## License

[Add your license information here]

## Support

- Local development issues: Check backend console logs
- TrueNAS Scale deployment: See `truenas-build/TRUENAS_DEPLOYMENT.md`
- Container issues: Use `truenas-build/validate-deployment.sh`
