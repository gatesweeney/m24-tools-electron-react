// indexer/worker/platform/diskutil.js
const { spawnSync } = require('child_process');

function plistToJson(plistXml) {
  const res = spawnSync('plutil', ['-convert', 'json', '-o', '-', '-'], {
    input: plistXml,
    encoding: 'utf8'
  });
  if (res.status !== 0) {
    throw new Error(`plutil failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout);
}

function diskutilListJson() {
  const res = spawnSync('diskutil', ['list', '-plist'], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`diskutil list failed: ${res.stderr || res.stdout}`);
  }
  return plistToJson(res.stdout);
}

function flattenMountNodes(listInfo) {
  const map = new Map(); // mountPoint -> node
  const stack = Array.isArray(listInfo.AllDisksAndPartitions)
    ? [...listInfo.AllDisksAndPartitions]
    : [];

  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;

    if (node.MountPoint) {
      map.set(node.MountPoint, node);
    }
    if (Array.isArray(node.Partitions)) {
      for (const p of node.Partitions) stack.push(p);
    }
    if (Array.isArray(node.APFSVolumes)) {
      for (const v of node.APFSVolumes) stack.push(v);
    }
    if (Array.isArray(node.Volumes)) {
      for (const v of node.Volumes) stack.push(v);
    }
  }
  return map;
}

function isSystemMount(mountPoint, volumeName) {
  const mp = (mountPoint || '').toLowerCase();
  const vn = (volumeName || '').toLowerCase();

  if (!mountPoint) return true;
  if (mp === '/' || mp.startsWith('/system/volumes')) return true;

  // exclude common system roles/names
  const badNames = ['macintosh hd', 'macintosh hd - data', 'preboot', 'recovery', 'vm', 'update', 'hardware', 'xart', 'iscpreboot'];
  if (badNames.includes(vn)) return true;

  return false;
}

function getMountedVolumes() {
  const list = diskutilListJson();
  const mountMap = flattenMountNodes(list);

  const volumes = [];
  for (const [mountPoint, node] of mountMap.entries()) {
    const volumeUuid = node.VolumeUUID || node.DiskUUID || null;
    const volumeName = node.VolumeName || null;

    // Only care about user volumes mounted under /Volumes
    if (!mountPoint.startsWith('/Volumes/')) continue;
    if (isSystemMount(mountPoint, volumeName)) continue;

    volumes.push({
      volume_uuid: volumeUuid || mountPoint, // fallback if missing
      volume_name: volumeName || mountPoint.split('/').pop(),
      mount_point: mountPoint,
      size_bytes: node.Size || node.VolumeTotalSize || null,
      fs_type: node.Content || null,
      os_internal: node.OSInternal === true
    });
  }

  // stable sort by mount point
  volumes.sort((a, b) => (a.mount_point || '').localeCompare(b.mount_point || ''));
  return volumes;
}

module.exports = { getMountedVolumes };