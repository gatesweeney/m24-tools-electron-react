// indexer/initRoot.js
const path = require('path');
const { openDb } = require('./db');
const { getMachineId } = require('./config');

/**
 * Usage:
 *   node initRoot.js /Volumes/BD_SHUTTLE_B "Shuttle B root" deep 1
 *
 * Args:
 *   [2] root_path (absolute)
 *   [3] label (optional)
 *   [4] deep_scan_mode: none | quick | deep  (optional, default 'none')
 *   [5] priority: 0 | 1  (optional, default 0)
 */
async function main() {
  const rootPath = process.argv[2];
  if (!rootPath) {
    console.error('Usage: node initRoot.js <root_path> [label] [deep_scan_mode] [priority]');
    process.exit(1);
  }

  const label = process.argv[3] || path.basename(rootPath);
  const deepScanMode = process.argv[4] || 'none'; // 'none' | 'quick' | 'deep'
  const priority = parseInt(process.argv[5] || '0', 10) || 0;

  const db = openDb();

  // For now we infer drive_uuid from the mount point (e.g. /Volumes/NAME)
  // by matching drives.mount_point.
  const machineId = getMachineId();
  const drive = db.prepare(`
    SELECT * FROM drives
    WHERE machine_id = ? AND ? LIKE (mount_point || '%')
    ORDER BY LENGTH(mount_point) DESC
    LIMIT 1
  `).get(machineId, rootPath);

  let driveUuid = null;
  if (drive) {
    driveUuid = drive.volume_uuid;
    console.log(`Found drive ${drive.primary_name} (${drive.volume_uuid}) for root ${rootPath}`);
  } else {
    console.warn(`Warning: no matching drive found for root ${rootPath}. drive_uuid will be NULL.`);
  }

  db.prepare(`
    INSERT INTO watched_roots (
      drive_uuid, root_path, label, is_active, deep_scan_mode, priority
    ) VALUES (?, ?, ?, 1, ?, ?)
  `).run(
    driveUuid,
    rootPath,
    label,
    deepScanMode,
    priority
  );

  console.log('Inserted watched root:', { driveUuid, rootPath, label, deepScanMode, priority });

  db.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('initRoot error:', err);
    process.exit(1);
  });
}