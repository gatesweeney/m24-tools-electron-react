// indexer/worker/scan/util/bfsWalker.js
const fs = require('fs');
const path = require('path');
const { maybeYield } = require('./throttle');

const SKIP_NAMES = new Set([
  '.Spotlight-V100',
  '.fseventsd',
  '.Trashes',
  '.Trash',
  '.DS_Store',
  'node_modules',
  '.git'
]);

function shouldSkip(name) {
  if (!name) return true;
  if (name.startsWith('.DS_Store')) return true;
  return SKIP_NAMES.has(name);
}

/**
 * Breadth-first walk.
 * - startPath: absolute root, like /Volumes/BD_SHUTTLE_A
 * - options:
 *   - depthLimit: number | null (null => unlimited)
 *   - dirsOnly: boolean
 *   - yieldEvery / yieldMs
 * - onEntry: async ({ fullPath, relPath, name, isDir, depth, parentRel }) => void
 * - cancelToken: { cancelled: boolean }
 */
async function bfsWalk(startPath, options, onEntry, cancelToken) {
  const {
    depthLimit = null,
    dirsOnly = false,
    yieldEvery = 500,
    yieldMs = 10
  } = options || {};

  const queue = [];
  queue.push({ fullPath: startPath, relPath: '.', depth: 0, parentRel: null });

  let processed = 0;

  while (queue.length > 0) {
    if (cancelToken?.cancelled) return;

    const node = queue.shift();
    const { fullPath, relPath, depth, parentRel } = node;

    let entries;
    try {
      entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (cancelToken?.cancelled) return;

      const name = entry.name;
      if (shouldSkip(name)) continue;

      const childFull = path.join(fullPath, name);
      const childRel = relPath === '.' ? name : path.join(relPath, name);
      const isDir = entry.isDirectory();

      // Emit entry
      if (!dirsOnly || isDir) {
        await onEntry({
          fullPath: childFull,
          relPath: childRel,
          name,
          isDir,
          depth: depth + 1,
          parentRel: relPath === '.' ? null : relPath
        });
      }

      // Enqueue child dir if allowed
      if (isDir) {
        const nextDepth = depth + 1;
        if (depthLimit == null || nextDepth <= depthLimit) {
          queue.push({
            fullPath: childFull,
            relPath: childRel,
            depth: nextDepth,
            parentRel: relPath === '.' ? null : relPath
          });
        }
      }

      processed++;
      await maybeYield(processed, { every: yieldEvery, ms: yieldMs });
    }
  }
}

module.exports = { bfsWalk };