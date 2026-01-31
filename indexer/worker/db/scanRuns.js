// indexer/worker/db/scanRuns.js
function nowIso() {
  return new Date().toISOString();
}

function startScanRun(db, { targetType, targetId, stage }) {
  const started = nowIso();
  const info = db.prepare(`
    INSERT INTO scan_runs (target_type, target_id, started_at, status, stage)
    VALUES (?, ?, ?, 'running', ?)
  `).run(targetType, targetId, started, stage || null);

  return { id: info.lastInsertRowid, started_at: started };
}

function finishScanRun(db, runId, { status, stage, error, startedAt }) {
  const finished = nowIso();
  const durationMs = startedAt ? (Date.now() - Date.parse(startedAt)) : null;

  db.prepare(`
    UPDATE scan_runs
    SET finished_at = ?,
        duration_ms = ?,
        status = ?,
        stage = ?,
        error = ?
    WHERE id = ?
  `).run(finished, durationMs, status, stage || null, error || null, runId);
}

module.exports = { startScanRun, finishScanRun };