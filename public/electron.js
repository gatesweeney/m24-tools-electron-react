// This is the entry file that electron-builder's CRA preset expects.
// It runs INSIDE Electron as the main process entry in the packaged app.
// We just forward to our real main process file in electron/main.js.

require('../electron/main.js');