// indexer/worker/db/search.js
const { openDb } = require('./openDb');
const { getMergedIndexerState } = require('./merge');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/**
 * Normalize a file row (with optional media metadata) into a search result.
 */
function normalizeFileRow(row, machineId) {
  return {
    type: 'file',
    machineId,
    volume_uuid: row.volume_uuid,
    root_path: row.root_path,
    relative_path: row.relative_path,
    name: row.name,
    ext: row.ext || null,
    size_bytes: row.size_bytes || null,
    mtime: row.mtime || null,
    ctime: row.ctime || null,
    is_dir: !!row.is_dir,
    file_type: row.file_type || null,
    offshoot_status: row.offshoot_status || null,
    offshoot_message: row.offshoot_message || null,
    path: row.root_path
      ? `${row.root_path}/${row.relative_path}`.replace(/\/+/g, '/')
      : row.relative_path,
    // Media metadata fields
    duration_sec: row.duration_sec || null,
    width: row.width || null,
    height: row.height || null,
    video_codec: row.video_codec || null,
    audio_codec: row.audio_codec || null,
    audio_sample_rate: row.audio_sample_rate || null,
    audio_channels: row.audio_channels || null,
    bitrate: row.bitrate || null,
    format_name: row.format_name || null
  };
}

/**
 * Score a row based on token matches across all searchable fields.
 */
function scoreRow(row, tokens) {
  let score = 0;

  // Text fields to search with their weights
  const fields = [
    { value: row.name, weight: 10, startBonus: 5 },
    { value: row.relative_path, weight: 5, startBonus: 0 },
    { value: row.ext, weight: 8, startBonus: 3 },
    { value: row.file_type, weight: 4, startBonus: 0 },
    { value: row.video_codec, weight: 6, startBonus: 2 },
    { value: row.audio_codec, weight: 6, startBonus: 2 },
    { value: row.format_name, weight: 4, startBonus: 0 },
    { value: row.root_path, weight: 2, startBonus: 0 }
  ];

  for (const token of tokens) {
    for (const field of fields) {
      if (!field.value) continue;
      const valueLower = String(field.value).toLowerCase();
      if (valueLower.includes(token)) {
        score += field.weight;
        if (field.startBonus && valueLower.startsWith(token)) {
          score += field.startBonus;
        }
      }
    }

    // Special handling for size searches (e.g., "1080" matches height)
    if (/^\d+$/.test(token)) {
      const num = parseInt(token, 10);
      if (row.width === num || row.height === num) score += 8;
    }
  }

  return score;
}

/**
 * Parse size filter from query (e.g., ">1gb", "<500mb", "size:large")
 */
function parseSizeFilter(token) {
  // Match patterns like >1gb, <500mb, >=2gb
  const sizeMatch = token.match(/^([<>]=?)(\d+(?:\.\d+)?)(kb|mb|gb|tb)?$/i);
  if (sizeMatch) {
    const [, op, numStr, unit = 'b'] = sizeMatch;
    let bytes = parseFloat(numStr);
    const multipliers = { kb: 1024, mb: 1024**2, gb: 1024**3, tb: 1024**4, b: 1 };
    bytes *= multipliers[unit.toLowerCase()] || 1;
    return { op, bytes };
  }
  return null;
}

/**
 * Search the given DB using token-based matching across all fields.
 * Joins with media_metadata table for codec/duration/resolution searches.
 */
function searchLocalDb(db, q, opts = {}) {
  const limit = opts.limit || 200;
  const rawTokens = q.toLowerCase().split(/\s+/).filter(Boolean);

  if (!rawTokens.length) return [];

  // Separate size filters from text tokens
  const sizeFilters = [];
  const tokens = [];

  for (const t of rawTokens) {
    const sizeFilter = parseSizeFilter(t);
    if (sizeFilter) {
      sizeFilters.push(sizeFilter);
    } else {
      tokens.push(t);
    }
  }

  // Build WHERE clause - search across multiple fields
  // Each token must match at least one of these fields
  const searchFields = [
    'f.name',
    'f.relative_path',
    'f.ext',
    'f.file_type',
    'f.root_path',
    'm.video_codec',
    'm.audio_codec',
    'm.format_name',
    'CAST(m.width AS TEXT)',
    'CAST(m.height AS TEXT)'
  ];

  const whereClauses = [];
  const params = [];

  // Text token matching
  for (const t of tokens) {
    const pattern = `%${t}%`;
    const fieldClauses = searchFields.map(f => `${f} LIKE ?`).join(' OR ');
    whereClauses.push(`(${fieldClauses})`);
    for (let i = 0; i < searchFields.length; i++) {
      params.push(pattern);
    }
  }

  // Size filters
  for (const sf of sizeFilters) {
    const opMap = { '>': '>', '<': '<', '>=': '>=', '<=': '<=' };
    const sqlOp = opMap[sf.op] || '>';
    whereClauses.push(`f.size_bytes ${sqlOp} ?`);
    params.push(sf.bytes);
  }

  const whereClause = whereClauses.length > 0
    ? `WHERE ${whereClauses.join(' AND ')}`
    : '';

  const sql = `
    SELECT
      f.*,
      m.duration_sec, m.width, m.height, m.video_codec, m.audio_codec,
      m.audio_sample_rate, m.audio_channels, m.bitrate, m.format_name,
      CASE
        WHEN f.is_dir = 1 THEN
          CASE
            WHEN EXISTS (
              SELECT 1 FROM offshoot_files of
              WHERE of.volume_uuid = f.volume_uuid
                AND of.root_path = f.root_path
                AND of.relative_path LIKE f.relative_path || '/%'
                AND of.status = 'error'
            ) THEN 'error'
            WHEN EXISTS (
              SELECT 1 FROM offshoot_files of
              WHERE of.volume_uuid = f.volume_uuid
                AND of.root_path = f.root_path
                AND of.relative_path LIKE f.relative_path || '/%'
                AND of.status = 'warn'
            ) THEN 'warn'
            WHEN EXISTS (
              SELECT 1 FROM offshoot_files of
              WHERE of.volume_uuid = f.volume_uuid
                AND of.root_path = f.root_path
                AND of.relative_path LIKE f.relative_path || '/%'
                AND of.status = 'ok'
            ) THEN 'ok'
            ELSE NULL
          END
        ELSE of.status
      END AS offshoot_status,
      CASE
        WHEN f.is_dir = 1 THEN (
          SELECT message FROM offshoot_files of
          WHERE of.volume_uuid = f.volume_uuid
            AND of.root_path = f.root_path
            AND of.relative_path LIKE f.relative_path || '/%'
            AND of.status IN ('error', 'warn')
          LIMIT 1
        )
        ELSE of.message
      END AS offshoot_message
    FROM files f
    LEFT JOIN media_metadata m ON m.file_id = f.id
    LEFT JOIN offshoot_files of ON
      of.volume_uuid = f.volume_uuid AND of.root_path = f.root_path AND of.relative_path = f.relative_path
    ${whereClause}
    LIMIT ?
  `;

  let rows = [];
  try {
    rows = db.prepare(sql).all(...params, limit * 2); // fetch extra for scoring
  } catch (e) {
    console.error('[search] query error:', e.message);
    return [];
  }

  // Score and normalize results
  const results = rows.map(row => ({
    ...normalizeFileRow(row, null),
    _score: scoreRow(row, tokens)
  }));

  // Sort by score descending and limit
  return results
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

/**
 * Search across merged DBs (per-machine index.db files).
 * Opens each merged DB and collects results.
 */
function searchMerged(q, opts = {}) {
  const limit = opts.limit || 200;
  const mergedState = getMergedIndexerState();
  // If merged state is not ready or empty, return empty
  if (!mergedState) return [];

  const baseDir = path.join(
    require('os').homedir(),
    'Documents',
    'M24Index'
  );

  let machineDirs = [];
  try {
    machineDirs = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const dirent of machineDirs) {
    if (!dirent.isDirectory()) continue;
    const machineId = dirent.name;
    const dbPath = path.join(baseDir, machineId, 'index.db');
    if (!fs.existsSync(dbPath)) continue;

    let db;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      continue;
    }

    try {
      let machineName = machineId;
      try {
        const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get('machine_name');
        if (row?.value) machineName = row.value;
      } catch {}
      const localResults = searchLocalDb(db, q, opts);
      for (const r of localResults) {
        results.push({ ...r, machineId, machineName });
      }
    } catch {
      // ignore errors per DB
    } finally {
      try { db.close(); } catch {}
    }
  }

  // Deduplicate by machine + volume_uuid + path (case sensitive)
  const seen = new Set();
  const uniqueResults = [];
  for (const r of results) {
    const key = `${r.machineId}::${r.volume_uuid}::${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueResults.push(r);
  }

  // Sort by score descending and limit
  uniqueResults.sort((a, b) => b._score - a._score);
  return uniqueResults.slice(0, limit);
}

/**
 * Main exported function.
 * Searches merged DBs if M24_MERGE_STATE=1, else local DB.
 * Returns normalized and scored results.
 */
function searchIndexer(q, opts = {}) {
  if (!q || !q.trim()) return [];

  if (process.env.M24_MERGE_STATE === '1') {
    return searchMerged(q, opts);
  }

  const db = openDb();
  try {
    return searchLocalDb(db, q, opts);
  } finally {
    try { db.close(); } catch {}
  }
}

module.exports = {
  searchIndexer
};
