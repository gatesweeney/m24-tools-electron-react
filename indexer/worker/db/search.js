// indexer/worker/db/search.js
const { openDb } = require('./openDb');
const { getMergedIndexerState } = require('./merge');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/**
 * Normalize a file row into a search result suitable for a DataGrid.
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
    is_dir: !!row.is_dir,
    path: row.root_path
      ? `${row.root_path}/${row.relative_path}`.replace(/\/+/g, '/')
      : row.relative_path
  };
}

/**
 * Simple token-based fuzzy search using LIKE and scoring.
 * Score is based on presence and position of tokens in name and relative_path.
 */
function scoreRow(row, tokens) {
  let score = 0;
  const nameLower = (row.name || '').toLowerCase();
  const pathLower = (row.relative_path || '').toLowerCase();

  for (const token of tokens) {
    if (nameLower.includes(token)) score += 10;
    if (pathLower.includes(token)) score += 5;
    if (nameLower.startsWith(token)) score += 3;
  }
  return score;
}

/**
 * Search the given DB using simple token-based fuzzy matching with LIKE.
 * Returns normalized and scored results.
 */
function searchLocalDb(db, q, opts = {}) {
  const limit = opts.limit || 200;
  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (!tokens.length) return [];

  // Build WHERE clause with AND of tokens, each token matching name OR relative_path LIKE
  const whereClauses = tokens.map(() => '(name LIKE ? OR relative_path LIKE ?)').join(' AND ');
  const params = [];
  for (const t of tokens) {
    const pattern = `%${t}%`;
    params.push(pattern, pattern);
  }

  const sql = `
    SELECT f.*
    FROM files f
    WHERE ${whereClauses}
    LIMIT ?
  `;

  let rows = [];
  try {
    rows = db.prepare(sql).all(...params, limit);
  } catch {
    // In case of any error, return empty array
    return [];
  }

  // Score and normalize results
  const results = rows.map(row => {
    return {
      ...normalizeFileRow(row, null),
      _score: scoreRow(row, tokens)
    };
  });

  // Filter out zero scores and sort descending by score
  return results
    .filter(r => r._score > 0)
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
      const localResults = searchLocalDb(db, q, opts);
      for (const r of localResults) {
        results.push({ ...r, machineId });
      }
    } catch {
      // ignore errors per DB
    } finally {
      try { db.close(); } catch {}
    }
  }

  // Deduplicate by volume_uuid + path (case sensitive)
  const seen = new Set();
  const uniqueResults = [];
  for (const r of results) {
    const key = `${r.volume_uuid}::${r.path}`;
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
