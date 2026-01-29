// indexer/worker/db/merge.js
// Merge helper to read all per-machine SQLite DBs under ~/Documents/M24Index/<machineId>/index.db
// and produce a merged view (one row per volume_uuid / manual root path).
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

function getBaseDir() {
  const override = process.env.M24_INDEX_DIR && process.env.M24_INDEX_DIR.trim();
  if (override) return override;
  return path.join(os.homedir(), 'Documents', 'M24Index');
}

function safeParseTime(v) {
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Returns an array of { machineId, dbPath } for each index.db found.
 */
function listMachineDbPaths() {
  const baseDir = getBaseDir();
  let entries = [];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const machineId = entry.name;
    const dbPath = path.join(baseDir, machineId, 'index.db');
    if (fs.existsSync(dbPath)) results.push({ machineId, dbPath });
  }
  return results;
}

function getSetting(db, key) {
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
    return row ? row.value : null;
  } catch {
    return null;
  }
}

function getTableNames(db) {
  try {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
  } catch {
    return [];
  }
}

function hasTables(db, names) {
  const rows = getTableNames(db);
  return names.every((n) => rows.includes(n));
}

function getLatestScanRuns(db) {
  // latest row per target_type/target_id
  return db.prepare(`
    SELECT sr.*
    FROM scan_runs sr
    JOIN (
      SELECT target_type, target_id, MAX(id) AS max_id
      FROM scan_runs
      GROUP BY target_type, target_id
    ) latest
    ON sr.id = latest.max_id
  `).all();
}

/**
 * Returns { drives, roots } merged from all per-machine DBs.
 * - drives merged by volume_uuid
 * - roots merged by exact root path
 */
function getMergedIndexerState() {
  const dbs = listMachineDbPaths();

  const drivesByUuid = new Map(); // volume_uuid -> records[]
  const rootsByPath = new Map();  // machineId::path -> records[]

  // Aggregates (MAX across machines)
  const volumeAgg = new Map(); // volume_uuid -> {file_count, dir_count, total_bytes}
  const rootAgg = new Map();   // machineId::rootPath -> {file_count, dir_count, total_bytes}

  // Last run info (newest finished_at across machines)
  const volumeLastRun = new Map(); // volume_uuid -> {status, duration_ms, finished_at}
  const rootLastRun = new Map();   // machineId::rootPath -> {status, duration_ms, finished_at}

  for (const { machineId, dbPath } of dbs) {
    let db;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      continue;
    }

    const machineName = getSetting(db, 'machine_name') || machineId;

    const tables = getTableNames(db);
    if (!tables.includes('volumes') || !tables.includes('manual_roots')) {
      try { db.close(); } catch {}
      continue;
    }

    // volumes
    try {
      const volumes = db.prepare('SELECT * FROM volumes').all();
      for (const v of volumes) {
        if (!v.volume_uuid) continue;
        const rec = { ...v, machineId, machineName };
        const list = drivesByUuid.get(v.volume_uuid) || [];
        list.push(rec);
        drivesByUuid.set(v.volume_uuid, list);
      }
    } catch {
      // ignore
    }

    // manual roots
    const rootIdToPath = new Map();
    try {
      const roots = db.prepare('SELECT * FROM manual_roots').all();
      for (const r of roots) {
        if (!r.path) continue;
        rootIdToPath.set(String(r.id), r.path);
        const rec = { ...r, machineId, machineName };
        const key = `${machineId}::${r.path}`;
        const list = rootsByPath.get(key) || [];
        list.push(rec);
        rootsByPath.set(key, list);
      }
    } catch {
      // ignore
    }

    // file aggregates (optional)
    if (tables.includes('files')) {
      // volumes (exclude manual:* uuids)
      try {
        const rows = db.prepare(`
          SELECT
            volume_uuid,
            SUM(CASE WHEN is_dir=0 THEN 1 ELSE 0 END) AS file_count,
            SUM(CASE WHEN is_dir=1 THEN 1 ELSE 0 END) AS dir_count,
            SUM(CASE WHEN is_dir=0 THEN COALESCE(size_bytes, 0) ELSE 0 END) AS total_bytes
          FROM files
          WHERE volume_uuid IS NOT NULL
            AND volume_uuid NOT LIKE 'manual:%'
          GROUP BY volume_uuid
        `).all();

        for (const r of rows) {
          if (!r.volume_uuid) continue;
          const prev = volumeAgg.get(r.volume_uuid) || { file_count: 0, dir_count: 0, total_bytes: 0 };
          volumeAgg.set(r.volume_uuid, {
            file_count: Math.max(prev.file_count, r.file_count || 0),
            dir_count: Math.max(prev.dir_count, r.dir_count || 0),
            total_bytes: Math.max(prev.total_bytes, r.total_bytes || 0)
          });
        }
      } catch {
        // ignore
      }

      // manual roots: aggregate by root_path where volume_uuid starts with manual:
      try {
        const rows = db.prepare(`
          SELECT
            root_path,
            SUM(CASE WHEN is_dir=0 THEN 1 ELSE 0 END) AS file_count,
            SUM(CASE WHEN is_dir=1 THEN 1 ELSE 0 END) AS dir_count,
            SUM(CASE WHEN is_dir=0 THEN COALESCE(size_bytes, 0) ELSE 0 END) AS total_bytes
          FROM files
          WHERE volume_uuid LIKE 'manual:%'
          GROUP BY root_path
        `).all();

        for (const r of rows) {
          if (!r.root_path) continue;
          const key = `${machineId}::${r.root_path}`;
          const prev = rootAgg.get(key) || { file_count: 0, dir_count: 0, total_bytes: 0 };
          rootAgg.set(key, {
            file_count: Math.max(prev.file_count, r.file_count || 0),
            dir_count: Math.max(prev.dir_count, r.dir_count || 0),
            total_bytes: Math.max(prev.total_bytes, r.total_bytes || 0)
          });
        }
      } catch {
        // ignore
      }
    }

    // scan_runs (optional)
    if (tables.includes('scan_runs')) {
      try {
        const runs = getLatestScanRuns(db);

        for (const r of runs) {
          const finishedAt = r.finished_at || r.started_at || null;
          const finishedTs = safeParseTime(finishedAt);
          const durationMs = r.duration_ms == null ? null : r.duration_ms;

          if (r.target_type === 'volume') {
            const volumeUuid = r.target_id;
            if (!volumeUuid) continue;

            const prev = volumeLastRun.get(volumeUuid);
            const prevTs = prev ? safeParseTime(prev.finished_at) : 0;
            if (!prev || finishedTs > prevTs) {
              volumeLastRun.set(volumeUuid, {
                status: r.status || null,
                duration_ms: durationMs,
                finished_at: finishedAt
              });
            }
          }

          if (r.target_type === 'manualRoot') {
            const rootId = String(r.target_id);
            const rootPath = rootIdToPath.get(rootId);
            if (!rootPath) continue;

            const key = `${machineId}::${rootPath}`;
            const prev = rootLastRun.get(key);
            const prevTs = prev ? safeParseTime(prev.finished_at) : 0;
            if (!prev || finishedTs > prevTs) {
              rootLastRun.set(key, {
                status: r.status || null,
                duration_ms: durationMs,
                finished_at: finishedAt
              });
            }
          }
        }
      } catch {
        // ignore
      }
    }

    try { db.close(); } catch {}
  }

  // Merge drives by volume_uuid
  const drives = [];
  for (const [volumeUuid, records] of drivesByUuid.entries()) {
    // Winner: newest last_scan_at, then last_seen_at
    let winner = records[0];
    for (const r of records) {
      const rScan = safeParseTime(r.last_scan_at);
      const wScan = safeParseTime(winner.last_scan_at);
      if (rScan > wScan) {
        winner = r;
        continue;
      }
      if (rScan === wScan) {
        const rSeen = safeParseTime(r.last_seen_at);
        const wSeen = safeParseTime(winner.last_seen_at);
        if (rSeen > wSeen) winner = r;
      }
    }

    const per_machine = {};
    const seen_on = [];
    for (const r of records) {
      seen_on.push(r.machineName || r.machineId);
      per_machine[r.machineId] = {
        machine_name: r.machineName || r.machineId,
        last_scan_at: r.last_scan_at,
        last_seen_at: r.last_seen_at,
        is_active: r.is_active,
        scan_interval_ms: r.scan_interval_ms,
        mount_point_last: r.mount_point_last
      };
    }

    const uniqMachines = Array.from(new Set(seen_on));
    const agg = volumeAgg.get(volumeUuid) || { file_count: 0, dir_count: 0, total_bytes: 0 };
    const lastRun = volumeLastRun.get(volumeUuid) || { status: null, duration_ms: null };

    drives.push({
      ...winner,
      file_count: agg.file_count,
      dir_count: agg.dir_count,
      total_bytes: agg.total_bytes,
      last_run_status: lastRun.status,
      last_run_duration_ms: lastRun.duration_ms,
      seen_on: uniqMachines,
      seen_count: uniqMachines.length,
      per_machine
    });
  }

  // Merge manual roots by path
  const roots = [];
  for (const [rootKey, records] of rootsByPath.entries()) {
    const rootPath = records[0]?.path || '';
    // Winner: newest last_scan_at
    let winner = records[0];
    for (const r of records) {
      const rScan = safeParseTime(r.last_scan_at);
      const wScan = safeParseTime(winner.last_scan_at);
      if (rScan > wScan) winner = r;
    }

    const per_machine = {};
    const seen_on = [];
    for (const r of records) {
      seen_on.push(r.machineName || r.machineId);
      per_machine[r.machineId] = {
        machine_name: r.machineName || r.machineId,
        id: r.id,
        last_scan_at: r.last_scan_at,
        is_active: r.is_active,
        scan_interval_ms: r.scan_interval_ms
      };
    }

    const uniqMachines = Array.from(new Set(seen_on));
    const agg = rootAgg.get(rootKey) || { file_count: 0, dir_count: 0, total_bytes: 0 };
    const lastRun = rootLastRun.get(rootKey) || { status: null, duration_ms: null };

    roots.push({
      ...winner,
      file_count: agg.file_count,
      dir_count: agg.dir_count,
      total_bytes: agg.total_bytes,
      last_run_status: lastRun.status,
      last_run_duration_ms: lastRun.duration_ms,
      seen_on: uniqMachines,
      seen_count: uniqMachines.length,
      per_machine
    });
  }

  // Sort for stable UI: most recently scanned first
  drives.sort((a, b) => safeParseTime(b.last_scan_at) - safeParseTime(a.last_scan_at));
  roots.sort((a, b) => safeParseTime(b.last_scan_at) - safeParseTime(a.last_scan_at));

  return { drives, roots };
}

module.exports = {
  listMachineDbPaths,
  getMergedIndexerState
};
