# Changelog

## Unreleased
- Added in-app update dialog (tray “Updates…” entry) with detailed status, progress, and event logging plus IPC bridges to check/install updates.
- Wired updater status propagation from `electron/main.js` and preload so renderer can trigger checks, receive progress, and install downloaded updates.
- Ignoring `.dmg` disk image files during indexing to avoid scanning mounted installers.
- Volume/root management now sends device IDs for remote actions (disable/delete/interval/active toggles) and refreshes state after updates to avoid duplicates/blank rows; removal works across machines.
- Volume/manual root updates now preserve existing fields on the server and use stable root IDs, fixing broken toggles and blank/duplicate rows after interval changes.
- Auto purge toggles now respect boolean values; manual roots show a placeholder where auto purge isn’t supported.
