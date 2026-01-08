# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

```bash
# Install dependencies
npm install

# Development mode (React dev server + Electron)
npm run dev

# Run only Electron (assumes React dev server already running on :3000)
npm run electron-start

# Run only React in browser (uses simulated backend)
npm run react-start

# Build React for production
npm run react-build

# Package for macOS
npm run dist:mac
```

Requires Node.js 24 (see `.nvmrc`).

## Architecture Overview

This is an Electron + React application for media file tools. The codebase uses pure JavaScript (no TypeScript).

### Process Model

- **Main Process** (`electron/main.js`): Electron entry point, manages windows, tray icon, and IPC handlers
- **Preload** (`electron/preload.js`): Exposes `window.electronAPI` to renderer via `contextBridge`
- **Renderer** (`src/`): React app using Material UI and React Router

### IPC Communication Pattern

All main process functionality is exposed through `ipcMain.handle()` in `electron/main.js` and consumed via `window.electronAPI` in the renderer:
- File dialogs: `dialog:openDirectory`
- Proxy operations: `proxy:start`, `proxy:progress`
- YouTube downloads: `ytdlp:*`, `yt:*`
- Indexer operations: `indexer:*`, `search:query`

### Indexer Worker Architecture

The indexer runs as a forked child process (`indexer/worker/main.js`):
- Launched by `electron/workerLauncher.js`
- Communicates with main process via `process.send()`/`process.on('message')`
- Uses SQLite (`better-sqlite3`) for persistent storage
- Watches for volume mounts/unmounts via `MountWatcher`
- Two scan queues: `mountQueue` (concurrency: 4) for new mounts, `scheduledQueue` (concurrency: 1) for periodic scans

### Scan Pipeline Layers

The indexer scan pipeline in `indexer/worker/scan/layers/`:
- `A1_tree.js`: Directory tree traversal
- `A2_Files.js`: File discovery
- `A3_stats.js`: File statistics/metadata
- `A4_logs.js`: Offshoot log parsing
- `A5_thumbs.js`: Thumbnail generation

### React App Structure

- `src/App.js`: Main routes and indexer progress state
- `src/context/JobContext.js`: Global job state for progress tracking
- `src/pages/`: Page components for each tool (ProxyTool, YouTube, Indexer, Search)
- `src/components/`: Shared UI components (NavBar, progress bars, modals)

### Bundled Binaries

Located in `electron/bin/`:
- `yt-dlp-macos-arm64`: YouTube downloader
- `ffmpeg-macos-arm64`, `ffprobe-macos-arm64`: Media processing

Binary paths resolved at runtime via `electron/binPath.js` and `electron/binResolver.js`.

### Database

SQLite database managed by `indexer/worker/db/`:
- `openDb.js`: Database connection
- `queries.js`: State and settings queries
- `search.js`: Full-text search implementation