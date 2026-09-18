const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const VIDEO_EXTENSIONS = new Set([
  '.mov',
  '.mp4',
  '.mxf',
  '.mkv',
  '.avi',
  '.webm',
  '.wmv',
  '.mpg',
  '.mpeg',
  '.m4v',
  '.mts',
  '.m2ts',
  '.ts',
  '.r3d',
  '.braw',
  '.ari',
  '.crm'
]);

const SEPARATOR_TRIM_RE = /^[\s._-]+|[\s._-]+$/g;
const SEPARATOR_COLLAPSE_RE = /[\s._-]+/g;

function parseRuleList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
  }

  return [...new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  )];
}

function trimSeparators(value) {
  return String(value || '').replace(SEPARATOR_TRIM_RE, '');
}

function stripPrefixes(stem, prefixes) {
  let current = stem;
  let changed = true;

  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (prefix && current.startsWith(prefix)) {
        current = trimSeparators(current.slice(prefix.length));
        changed = true;
        break;
      }
    }
  }

  return current;
}

function stripSuffixes(stem, suffixes) {
  let current = stem;
  let changed = true;

  while (changed) {
    changed = false;
    for (const suffix of suffixes) {
      if (suffix && current.endsWith(suffix)) {
        current = trimSeparators(current.slice(0, current.length - suffix.length));
        changed = true;
        break;
      }
    }
  }

  return current;
}

function stripFileNameEndings(fileName, endings) {
  let current = fileName;
  let changed = true;

  while (changed) {
    changed = false;
    for (const ending of endings) {
      if (ending && current.endsWith(ending)) {
        current = trimSeparators(current.slice(0, current.length - ending.length));
        changed = true;
        break;
      }
    }
  }

  return current;
}

function isVideoFile(fileName) {
  return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function buildComparisonKey(fileName, detectionRules) {
  const loweredName = String(fileName || '').toLowerCase();
  const withoutEnding = stripFileNameEndings(loweredName, detectionRules.fileNameEndings);
  const parsed = path.parse(withoutEnding);
  let stem = trimSeparators(parsed.name || parsed.base || '');

  stem = stripPrefixes(stem, detectionRules.namePrefixes);
  stem = stripSuffixes(stem, detectionRules.nameSuffixes);

  return stem.replace(SEPARATOR_COLLAPSE_RE, '');
}

function fileMatchesNextToRules(fileName, detectionRules) {
  const loweredName = String(fileName || '').toLowerCase();
  const loweredStem = path.parse(loweredName).name;

  return (
    loweredStem.includes('proxy') ||
    detectionRules.namePrefixes.some((prefix) => prefix && loweredStem.startsWith(prefix)) ||
    detectionRules.nameSuffixes.some((suffix) => suffix && loweredStem.endsWith(suffix)) ||
    detectionRules.fileNameEndings.some((ending) => ending && loweredName.endsWith(ending))
  );
}

async function collectNextToProxyFiles(files, detectionRules) {
  const matches = new Map();

  for (const file of files) {
    if (fileMatchesNextToRules(file.name, detectionRules)) {
      matches.set(file.abs, file);
    }
  }

  if (!detectionRules.preferSmallestVideo) {
    return [...matches.values()];
  }

  const groups = new Map();

  for (const file of files) {
    if (!isVideoFile(file.name)) continue;

    const key = buildComparisonKey(file.name, detectionRules);
    if (!key) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const sizedFiles = (
      await Promise.all(
        group.map(async (file) => {
          try {
            const stats = await fsp.stat(file.abs);
            return { file, size: stats.size };
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);

    if (sizedFiles.length < 2) continue;

    sizedFiles.sort((a, b) => {
      if (a.size !== b.size) return a.size - b.size;
      return a.file.name.localeCompare(b.file.name);
    });

    if (sizedFiles[0].size === sizedFiles[1].size) {
      continue;
    }

    matches.set(sizedFiles[0].file.abs, sizedFiles[0].file);
  }

  return [...matches.values()];
}

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
 *   nextToNamePrefixes: string,     // comma-separated, only if nextTo
 *   nextToNameSuffixes: string,     // comma-separated, only if nextTo
 *   nextToFileNameEndings: string,  // comma-separated, only if nextTo
 *   nextToPreferSmallestVideo: boolean,
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
    nextToNamePrefixes,
    nextToNameSuffixes,
    nextToFileNameEndings,
    nextToPreferSmallestVideo,
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
  const nextToDetectionRules = {
    namePrefixes: parseRuleList(nextToNamePrefixes),
    nameSuffixes: parseRuleList(nextToNameSuffixes),
    fileNameEndings: parseRuleList(nextToFileNameEndings),
    preferSmallestVideo: Boolean(nextToPreferSmallestVideo)
  };

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

    const currentLevelFiles = [];

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
        currentLevelFiles.push({ abs: entryAbs, rel: entryRel, name: entry.name });
      }
    }

    if (proxiesLocationType === 'nextTo' && currentLevelFiles.length > 0) {
      const matchedFiles = await collectNextToProxyFiles(currentLevelFiles, nextToDetectionRules);
      proxies.push(...matchedFiles.map(({ abs, rel }) => ({ abs, rel })));
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
    nextToNamePrefixes: proxiesLocationType === 'nextTo' ? nextToNamePrefixes || '' : null,
    nextToNameSuffixes: proxiesLocationType === 'nextTo' ? nextToNameSuffixes || '' : null,
    nextToFileNameEndings: proxiesLocationType === 'nextTo' ? nextToFileNameEndings || '' : null,
    nextToPreferSmallestVideo: proxiesLocationType === 'nextTo' ? Boolean(nextToPreferSmallestVideo) : false,
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
