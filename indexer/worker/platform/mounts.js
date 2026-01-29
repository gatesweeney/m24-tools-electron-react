// indexer/worker/platform/mounts.js
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { getMountedVolumes } = require('./diskutil');

function listVolumesDir() {
  try {
    const entries = fs.readdirSync('/Volumes', { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => path.join('/Volumes', e.name));
  } catch {
    return [];
  }
}

/**
 * Create a stable key for mounts that don't have a diskutil UUID (network shares, etc.)
 */
function mountKeyFromPath(mountPoint) {
  return `mount:${mountPoint}`;
}

/**
 * Produces a unified list:
 * - diskutil-known volumes use volume_uuid
 * - unknown mounts (network) use mount:<path>
 */
function getUnifiedMounts() {
  const diskutilVolumes = getMountedVolumes(); // physical volumes
  const diskutilByMount = new Map(
    diskutilVolumes.map((v) => [v.mount_point, v])
  );

  const allMountPoints = listVolumesDir();

  const unified = [];

  for (const mp of allMountPoints) {
    const du = diskutilByMount.get(mp);
    if (du) {
      unified.push({
        key: du.volume_uuid,
        kind: 'volume',
        volume_uuid: du.volume_uuid,
        volume_name: du.volume_name,
        mount_point: du.mount_point,
        size_bytes: du.size_bytes || null,
        fs_type: du.fs_type || null
      });
    } else {
      // likely network mount or something diskutil doesn't report
      unified.push({
        key: mountKeyFromPath(mp),
        kind: 'mount',
        volume_uuid: null,
        volume_name: path.basename(mp),
        mount_point: mp,
        size_bytes: null,
        fs_type: null
      });
    }
  }

  // sort for stable output
  unified.sort((a, b) => (a.mount_point || '').localeCompare(b.mount_point || ''));
  return unified;
}

class MountWatcher extends EventEmitter {
  constructor({ intervalMs = 2000 } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.timer = null;
    this.lastKeys = new Map(); // key -> mount object
  }

  start() {
    if (this.timer) return;

    // initial snapshot
    const mounts = getUnifiedMounts();
    this.lastKeys = new Map(mounts.map((m) => [m.key, m]));

    this.timer = setInterval(() => {
      this.tick();
    }, this.intervalMs);

    this.emit('ready', mounts);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    const current = getUnifiedMounts();
    const currentMap = new Map(current.map((m) => [m.key, m]));

    // new mounts
    for (const [key, m] of currentMap.entries()) {
      if (!this.lastKeys.has(key)) {
        this.emit('mounted', m);
      }
    }

    // removed mounts
    for (const [key, old] of this.lastKeys.entries()) {
      if (!currentMap.has(key)) {
        this.emit('unmounted', old);
      }
    }

    this.lastKeys = currentMap;
  }
}

module.exports = {
  MountWatcher,
  getUnifiedMounts
};