# M24 Tools (React + Electron)

React + Material UI frontend with Electron backend for media tools.

## Structure

- `src/` – React app (MUI, React Router, JobContext, Proxy Tool UI).
- `electron/` – Electron main process, preload, and filesystem operations.
- Single `package.json` at root for both React and Electron.

## Scripts

```bash
# Install deps
npm install

# Start React dev server + Electron (dev mode)
npm run dev

# Just Electron (assumes React dev server is already running on :3000)
npm run electron-start

# Just React (browser-only, uses simulated backend)
npm run react-start

# Build React for production (Electron will load from ./build)
npm run build
```

## Dev modes

### 1. Electron + real filesystem (recommended)

```bash
npm install
npm run dev
```

- React dev server runs on `http://localhost:3000`.
- Electron loads that URL.
- The Proxy Tool uses real filesystem operations via Electron:
  - Recursively scans media directory.
  - Detects proxies:
    - In subfolder named `Proxy` (or your provided name), or
    - Any file with "proxy" in its name when set to "next to".
  - Copies / moves / deletes proxies according to your config.
  - Reports progress back to the renderer so the global bottom progress bar updates.

### 2. Browser-only (no Electron)

```bash
npm run react-start
```

- The UI runs in the browser.
- `proxyService` falls back to a simulated backend:
  - It fakes progress and file counts so you can work on the UI without touching the filesystem.

## Building for packaged Electron

This project is wired for dev and for loading the built React app inside Electron.
For packaging into installable apps (macOS `.dmg`, Windows `.exe`, etc.), you would
add a tool such as `electron-builder` or `electron-forge` and point it at:

- `main`: `electron/main.js`
- Renderer content: `build/` (created by `npm run build`).

The codebase is pure JavaScript (no TypeScript).
