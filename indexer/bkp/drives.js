// indexer/drives.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { openDb } = require('./db');
const { getMachineId } = require('./config');

/**
 * Run `diskutil list -plist` and convert to JSON.
 * This gets *all* disks and partitions in one safe, fast call.
 */
function getDiskutilList() {
  try {
    const list = spawnSync('diskutil', ['list', '-plist'], {
      encoding: 'utf8',
      timeout: 5000
    });

    if (list.status !== 0) {
      console.warn('[indexer] diskutil list -plist failed:', list.stderr);
      return null;
    }

    const plistXml = list.stdout;
    if (!plistXml || !plistXml.trim()) {
      console.warn('[indexer] diskutil list -plist returned empty output');
      return null;
    }

    // Convert plist → JSON
    const plutil = spawnSync('plutil', ['-convert', 'json', '-o', '-', '-'], {
      encoding: 'utf8',
      timeout: 5000,
      input: plistXml
    });

    if (plutil.status !== 0) {
      console.warn('[indexer] plutil conversion failed:', plutil.stderr);
      return null;
    }

    return JSON.parse(plutil.stdout);
  } catch (err) {
    console.error('[indexer] Error executing diskutil list -plist', err);
    return null;
  }
}

/**
 * Build a map: MountPoint -> diskutil node
 */
function buildMountMap(listInfo) {
  const map = new Map();
  if (!listInfo || !Array.isArray(listInfo.AllDisksAndPartitions)) return map;

  const stack = [...listInfo.AllDisksAndPartitions];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    // If this node has a MountPoint, record it
    if (node.MountPoint) {
      map.set(node.MountPoint, node);
    }

    // Standard partition lists
    if (Array.isArray(node.Partitions)) {
      for (const p of node.Partitions) stack.push(p);
    }

    // Some formats use "Volumes" (rare)
    if (Array.isArray(node.Volumes)) {
      for (const v of node.Volumes) stack.push(v);
    }

    // APFS uses "APFSVolumes"
    if (Array.isArray(node.APFSVolumes)) {
      for (const v of node.APFSVolumes) stack.push(v);
    }
  }

  return map;
}

/**
 * Enumerate /Volumes entries + enrich using diskutil list map.
 */
function getMountedDrives() {
  const volumesRoot = '/Volumes';
  let entries = [];
  try {
    entries = fs.readdirSync(volumesRoot, { withFileTypes: true });
  } catch (err) {
    console.error('[indexer] Error reading /Volumes:', err);
    return [];
  }

  // One safe diskutil call for all volumes
  const listInfo = getDiskutilList();
  const mountMap = buildMountMap(listInfo);

  const drives = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // skip .hidden entries

    const mountPoint = path.join(volumesRoot, entry.name);

    // Default: minimal info
    let volumeUuid = mountPoint; // fallback pseudo-UUID
    let volumeName = entry.name;
    let fsType = null;
    let sizeBytes = null;

    let protocol = null;
    let deviceModel = null;
    let rotationRate = null;
    let smartStatus = null;
    let hardwareSerial = null;

    let rawInfoJson = null;

    // If diskutil knows this mount point...
    const node = mountMap.get(mountPoint);
    if (node) {
      volumeName = node.VolumeName || volumeName;
      volumeUuid = node.VolumeUUID || volumeUuid;
      sizeBytes = node.VolumeTotalSize || sizeBytes;

      // Note: diskutil list doesn't reliably show protocol/SMART
      // We'll fill these later via diskutil info if needed.

      rawInfoJson = JSON.stringify(node);
    }

    drives.push({
      volume_uuid: volumeUuid,
      volume_name: volumeName,
      mount_point: mountPoint,
      device_model: deviceModel,
      fs_type: fsType,
      size_bytes: sizeBytes,
      protocol: protocol,
      rotation_rate: rotationRate,
      smart_status: smartStatus,
      hardware_serial: hardwareSerial,
      raw_diskutil_info: rawInfoJson
    });
  }

  console.log(
    '[indexer] getMountedDrives: found',
    drives.length,
    'entries from /Volumes; diskutil knew about',
    mountMap.size,
    'mounts'
  );

  return drives;
}

/**
 * Insert or update drive records.
 */
function upsertDrive(db, driveInfo, nowIso) {
  const machineId = getMachineId();
  const existing = db.prepare(`
    SELECT * FROM drives WHERE machine_id = ? AND volume_uuid = ?
  `).get(machineId, driveInfo.volume_uuid);

  const seenNameJson = existing?.seen_names || '[]';
  let seenNames = [];
  try { seenNames = JSON.parse(seenNameJson); } catch { seenNames = []; }

  if (driveInfo.volume_name && !seenNames.includes(driveInfo.volume_name)) {
    seenNames.push(driveInfo.volume_name);
  }

  if (!existing) {
    db.prepare(`
      INSERT INTO drives (
        machine_id, hardware_serial, device_model, volume_uuid,
        primary_name, seen_names, mount_point, fs_type, size_bytes,
        protocol, rotation_rate, smart_status,
        first_seen_at, last_seen_at, last_scan_at,
        total_bytes_written_logical, location_note, tags, raw_diskutil_info
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      machineId,
      driveInfo.hardware_serial || null,
      driveInfo.device_model,
      driveInfo.volume_uuid,
      driveInfo.volume_name,
      JSON.stringify(seenNames),
      driveInfo.mount_point,
      driveInfo.fs_type,
      driveInfo.size_bytes,
      driveInfo.protocol || null,
      driveInfo.rotation_rate || null,
      driveInfo.smart_status || null,
      nowIso,
      nowIso,
      null,
      0,
      null,
      null,
      driveInfo.raw_diskutil_info
    );
  } else {
    db.prepare(`
      UPDATE drives SET
        hardware_serial = COALESCE(?, hardware_serial),
        device_model = ?,
        primary_name = COALESCE(?, primary_name),
        seen_names = ?,
        mount_point = ?,
        fs_type = ?,
        size_bytes = COALESCE(?, size_bytes),
        protocol = COALESCE(?, protocol),
        rotation_rate = COALESCE(?, rotation_rate),
        smart_status = COALESCE(?, smart_status),
        last_seen_at = ?,
        raw_diskutil_info = COALESCE(?, raw_diskutil_info)
      WHERE id = ?
    `).run(
      driveInfo.hardware_serial || existing.hardware_serial,
      driveInfo.device_model,
      driveInfo.volume_name || existing.primary_name,
      JSON.stringify(seenNames),
      driveInfo.mount_point,
      driveInfo.fs_type,
      driveInfo.size_bytes,
      driveInfo.protocol || existing.protocol,
      driveInfo.rotation_rate || existing.rotation_rate,
      driveInfo.smart_status || existing.smart_status,
      nowIso,
      driveInfo.raw_diskutil_info || existing.raw_diskutil_info,
      existing.id
    );
  }
}

/**
 * Auto-add only REAL external drives; skip TM & network volumes.
 */
function ensureAutoRootsForDrives(db) {
  const machineId = getMachineId();

  const drives = db.prepare(`
    SELECT volume_uuid, primary_name, mount_point, protocol, raw_diskutil_info
    FROM drives
    WHERE machine_id = ?
  `).all(machineId);

  const roots = db.prepare(`
    SELECT drive_uuid, root_path
    FROM watched_roots
  `).all();

  const existing = new Set(
    roots.map((r) => `${r.drive_uuid || ''}||${r.root_path}`)
  );

  const insertRoot = db.prepare(`
    INSERT INTO watched_roots (
      drive_uuid, root_path, label, is_active, deep_scan_mode, priority
    ) VALUES (?, ?, ?, 1, 'quick', 0)
  `);

  for (const d of drives) {
    if (!d.mount_point) continue;

    const mountPoint = d.mount_point;

    // Only auto-add /Volumes/* entries
    if (!mountPoint.startsWith('/Volumes/')) continue;

    // 🚫 Skip volumes diskutil doesn't know about (likely network shares like tars)
    if (!d.raw_diskutil_info) {
      console.log('[indexer] Skipping non-diskutil volume for auto-root:', mountPoint);
      continue;
    }

    const name = d.primary_name || path.basename(mountPoint) || '';
    const lowerName = name.toLowerCase();
    const lowerMount = mountPoint.toLowerCase();

    // Skip Time Machine volumes by name/path
    const isTM =
      lowerName.includes('time machine') ||
      lowerMount.includes('time machine') ||
      lowerMount.includes('timemachine');

    if (isTM) {
      console.log('[indexer] Skipping Time Machine volume:', name, mountPoint);
      continue;
    }

    const key = `${d.volume_uuid || ''}||${mountPoint}`;
    if (existing.has(key)) continue;

    console.log('[indexer] Auto-adding watched root:', name, mountPoint);

    insertRoot.run(
      d.volume_uuid,
      mountPoint,
      name
    );

    existing.add(key);
  }
}

function getWatchedRoots(db) {
  return db.prepare(`
    SELECT * FROM watched_roots WHERE is_active = 1
  `).all();
}

module.exports = {
  getMountedDrives,
  upsertDrive,
  getWatchedRoots,
  ensureAutoRootsForDrives
};