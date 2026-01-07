// indexer/worker/scheduler/due.js
const { openDb } = require('../db/openDb');

function msNow() {
  return Date.now();
}

function parseIso(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function getDueVolumes({ mountedVolumeUuids, onlyMounted = true } = {}) {
  const db = openDb();
  const now = msNow();

  const rows = db.prepare(`
    SELECT
      volume_uuid,
      mount_point_last,
      is_active,
      scan_interval_ms,
      last_scan_at
    FROM volumes
  `).all();

  db.close();

  const mountedSet = new Set(mountedVolumeUuids || []);

  return rows
    .filter((v) => v.is_active === 1)
    .filter((v) => (onlyMounted ? mountedSet.has(v.volume_uuid) : true))
    .filter((v) => {
      const interval = (v.scan_interval_ms == null) ? 20 * 60 * 1000 : v.scan_interval_ms;

      // interval rules:
      // 0 = on mount only (no periodic)
      // -1 = manual only
      if (interval === 0 || interval < 0) return false;

      const last = parseIso(v.last_scan_at);
      return (now - last) >= interval;
    })
    .sort((a, b) => {
      const aLast = parseIso(a.last_scan_at);
      const bLast = parseIso(b.last_scan_at);
      return aLast - bLast; // oldest scanned first
    });
}

function getDueManualRoots({ mountedMountPoints } = {}) {
  const db = openDb();
  const now = msNow();

  const rows = db.prepare(`
    SELECT
      id,
      path,
      is_active,
      scan_interval_ms,
      last_scan_at
    FROM manual_roots
  `).all();

  db.close();

  const mountedSet = new Set(mountedMountPoints || []);

  return rows
    .filter((r) => r.is_active === 1)
    // manual roots can be network mounts; only scan if path is currently available/mounted
    .filter((r) => {
      // if it's under /Volumes, require it to be currently mounted
      if (r.path.startsWith('/Volumes/')) return mountedSet.has(r.path);
      // local paths: assume accessible if exists; we’ll handle errors in scanner
      return true;
    })
    .filter((r) => {
      const interval = r.scan_interval_ms;
      if (interval == null) return false;      // default: no schedule unless set
      if (interval === 0 || interval < 0) return false;

      const last = parseIso(r.last_scan_at);
      return (now - last) >= interval;
    })
    .sort((a, b) => parseIso(a.last_scan_at) - parseIso(b.last_scan_at));
}

module.exports = {
  getDueVolumes,
  getDueManualRoots
};