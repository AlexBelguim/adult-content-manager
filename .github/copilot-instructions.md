# Adult Content Manager - AI Coding Agent Instructions

## Project Architecture

This is a **full-stack Express.js + React application** for managing adult content with specific folder structures and device integration. The backend serves a built React frontend and provides REST APIs.

### Core Folder Structure Pattern
```
base-path/
├── before filter performer/    # Incoming content to be processed
├── content/                   # Organized content by genre
└── after filter performer/    # Filtered and approved content
```

### Key Components

**Backend (`backend/`):**
- `index.js` - Express server serving React build + API routes
- `db.js` - SQLite schema with better-sqlite3 (performers, content_items, filter_actions, tags)
- `services/` - Business logic modules (fileScanner, importer, filterService, merger, handy)
- `routes/` - API endpoints grouped by feature

**Frontend (`frontend/src/`):**
- `App.js` - Main app with Handy device connection state
- `pages/MainPage.js` - Primary interface with performer scanning/import
- `components/` - Material-UI components for different workflows

## Development Workflow

### Build & Run Commands (PowerShell)
**IMPORTANT**: Always use PowerShell syntax - no `&&` operators, use `;` for command chaining or separate commands.

```powershell
# Backend server (serves built frontend)
npm start

# Frontend development
cd frontend; npm run build

# Install frontend dependencies when needed
cd frontend; npm install @mui/icons-material

# Multiple commands example (use ; not &&)
cd frontend; npm install; npm run build
```

### Critical Path: Frontend → Backend Integration
1. Frontend builds to `frontend/build/`
2. Backend serves static files from `../frontend/build`
3. API calls use relative paths like `/api/folders/scan`
4. Frontend must be rebuilt after changes (`npm run build` in frontend/)

## Project-Specific Patterns

### File Service Pattern
The `routes/files.js` serves media with different endpoints:
- `/api/files/preview` - Image thumbnails (sharp processing)
- `/api/files/video-thumbnail` - Video preview images
- `/api/files/raw` - Full file serving

### Database Integration
Uses synchronous better-sqlite3 patterns:
```javascript
const folders = db.prepare('SELECT * FROM folders').all();
db.prepare('INSERT OR IGNORE INTO folders (path) VALUES (?)').run(basePath);
```

### Import Modal Architecture
`ImportModal.js` uses Material-UI with:
- Tabbed interface (Pictures/Videos/Funscript)
- Grid layout (3 items per row: `xs={12} sm={4} md={4}`)
- Click-to-enlarge dialog system
- File preview integration with backend file service

### Error Handling Convention
Backend routes use consistent error patterns:
```javascript
try {
  // operation
  res.send(result);
} catch (err) {
  res.status(500).send({ error: err.message });
}
```

### Device Integration
Handy device service (`services/handy.js`) provides WebSocket-based communication with singleton pattern. Frontend manages connection state in `App.js`.

## Integration Points

### File System Watchers
`fileScanner.js` uses chokidar to watch `before filter performer/` for new content and auto-discovers performers.

### Image Processing
Sharp library handles thumbnail generation in `files.js` with fallback to original file serving.

### State Management
Frontend uses local component state (no Redux store active), with props drilling for shared state like `basePath`.

## Common Debugging Points

1. **Server crashes**: Check for undefined object access in API responses
2. **Frontend build issues**: Missing Material-UI dependencies require `npm install` in frontend/
3. **File serving**: Ensure proper URL encoding for file paths with special characters
4. **Modal errors**: ImportModal expects specific props structure from MainPage

## Key Files for Understanding
- `backend/index.js` - Server setup and route registration
- `backend/services/fileScanner.js` - Core file discovery logic
- `frontend/src/components/ImportModal.js` - Main UI component pattern
- `backend/db.js` - Database schema and relationships
