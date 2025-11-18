const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/**
 * Recursively walk the media directory and find proxy files,
 * then copy/move/delete according to config, reporting progress
 * via the onProgress callback.
 *
 * Config shape:
 * {
 *   mediaDir: string,
 *   proxiesLocationType: 'subfolder' | 'nextTo',
 *   proxiesSubfolderName: string,   // only if subfolder
 *   operation: 'copy' | 'move' | 'delete',
 *   destinationDir: string | null,  // not used for delete
 *   preserveStructure: 'preserve' | 'flatten'
 * }
 */
async function runProxyJob(config, onProgress) {
  const {
    mediaDir,
    proxiesLocationType,
    proxiesSubfolderName,
    operation,
    destinationDir,
    preserveStructure
  } = config;

  if (!mediaDir) {
    throw new Error('Media directory is required.');
  }

  if (operation !== 'delete' && !destinationDir) {
    throw new Error('Destination directory is required for copy/move operations.');
  }

  const proxies = [];

  async function walk(currentAbs, currentRel) {
    // Skip common macOS / system / metadata folders that can cause EPERM/EACCES
    const baseName = path.basename(currentAbs);
    const skipNames = new Set([
      '.Spotlight-V100',
      '.fseventsd',
      '.Trashes',
      '.Trash',
      '.TemporaryItems',
      '.DocumentRevisions-V100',
      '.DS_Store'
    ]);
    if (baseName.startsWith('.') && skipNames.has(baseName)) {
      return;
    }

    let entries;
    try {
      entries = await fsp.readdir(currentAbs, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        return;
      }
      throw err;
    }

    for (const entry of entries) {
      const entryAbs = path.join(currentAbs, entry.name);
      const entryRel = path.join(currentRel, entry.name);

      if (entry.isDirectory()) {
        if (proxiesLocationType === 'subfolder' && entry.name === proxiesSubfolderName) {
          // Collect all files inside this subfolder as proxies
          let proxyEntries;
          try {
            proxyEntries = await fsp.readdir(entryAbs, { withFileTypes: true });
          } catch (err) {
            if (err.code === 'EPERM' || err.code === 'EACCES') {
              continue;
            }
            throw err;
          }
          for (const subEntry of proxyEntries) {
            if (subEntry.isFile()) {
              const proxyAbs = path.join(entryAbs, subEntry.name);
              const proxyRel = path.join(entryRel, subEntry.name);
              proxies.push({ abs: proxyAbs, rel: proxyRel });
            }
          }
        } else {
          await walk(entryAbs, entryRel);
        }
      } else if (entry.isFile() && proxiesLocationType === 'nextTo') {
        const lower = entry.name.toLowerCase();
        if (lower.includes('proxy')) {
          proxies.push({ abs: entryAbs, rel: entryRel });
        }
      }
    }
  }

  await walk(mediaDir, '');

  const total = proxies.length;
  let copied = 0;
  let moved = 0;
  let deleted = 0;
  let skippedExisting = 0;
  const errors = [];

  function reportProgress(processed, currentFile) {
    const progress = total > 0 ? (processed / total) * 100 : 100;
    if (typeof onProgress === 'function') {
      onProgress({
        totalFiles: total,
        processedFiles: processed,
        progress,
        currentFile
      });
    }
  }

  reportProgress(0, null);

  let processed = 0;

  for (const proxy of proxies) {
    let currentFile = proxy.rel;
    try {
      if (operation === 'delete') {
        // (You’ve disabled delete in the UI, but keep behavior here for later)
        await fsp.unlink(proxy.abs);
        deleted++;
      } else {
        const baseName = path.basename(proxy.abs);
        let targetAbs;

        if (preserveStructure === 'preserve') {
          const relDir = path.dirname(proxy.rel);
          const destDir = path.join(destinationDir, relDir);
          await fsp.mkdir(destDir, { recursive: true });
          targetAbs = path.join(destDir, baseName);
        } else {
          await fsp.mkdir(destinationDir, { recursive: true });
          targetAbs = path.join(destinationDir, baseName);
        }

        // Skip if file already exists at destination
        let targetExists = false;
        try {
          await fsp.access(targetAbs, fs.constants.F_OK);
          targetExists = true;
        } catch {
          targetExists = false;
        }

        if (targetExists) {
          skippedExisting++;
          currentFile = `${proxy.rel} (skipped; already at destination)`;
        } else if (operation === 'copy') {
          await fsp.copyFile(proxy.abs, targetAbs);
          copied++;
        } else if (operation === 'move') {
          try {
            await fsp.rename(proxy.abs, targetAbs);
          } catch (err) {
            if (err.code === 'EXDEV') {
              await fsp.copyFile(proxy.abs, targetAbs);
              await fsp.unlink(proxy.abs);
            } else {
              throw err;
            }
          }
          moved++;
        }
      }
    } catch (err) {
      errors.push({ file: proxy.abs, error: err.message || String(err) });
      currentFile = `${proxy.rel} (error)`;
    } finally {
      processed++;
      reportProgress(processed, currentFile);
    }
  }

  return {
    mediaDir,
    destinationDir: operation === 'delete' ? null : destinationDir,
    operation,
    proxiesLocationType,
    proxiesSubfolderName: proxiesLocationType === 'subfolder' ? proxiesSubfolderName : null,
    preserveStructure,
    totalFound: total,
    copied,
    moved,
    deleted,
    skippedExisting,
    errorCount: errors.length,
    errors
  };
}

module.exports = { runProxyJob };