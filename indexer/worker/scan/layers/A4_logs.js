// indexer/worker/scan/layers/A4_logs.js
const fs = require('fs');
const { findTransferLogs, listTxtLogs, parseOffshootLog } = require('../../tools/offshoot');
const { findReportsFolders, parseFoolcatReport } = require('../../tools/foolcat');

function nowIso() {
  return new Date().toISOString();
}

async function runA4Logs({ db, volume, cancelToken, progress }) {
  const rootPath = volume.mount_point;
  const volumeUuid = volume.volume_uuid;

  progress?.({ stage: 'A4_logs_start', volume_uuid: volumeUuid, rootPath });

  // --- OffShoot logs ---
  let offshootCount = 0;

  const transferLogDirs = await findTransferLogs(rootPath, cancelToken);
  for (const d of transferLogDirs) {
    if (cancelToken.cancelled) return;

    const logs = await listTxtLogs(d);
    for (const logPath of logs) {
      if (cancelToken.cancelled) return;

      try {
        const st = fs.statSync(logPath);
        const parsed = await parseOffshootLog(logPath);

        db.prepare(`
          INSERT INTO offshoot_jobs (
            id, volume_uuid, log_path, log_mtime, log_size,
            source_name, dest_volume,
            started_at, finished_at,
            total_files, total_bytes,
            hash_type, verification_mode,
            status, error_count, error_excerpt, last_parsed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            log_mtime=excluded.log_mtime,
            log_size=excluded.log_size,
            source_name=excluded.source_name,
            dest_volume=excluded.dest_volume,
            started_at=excluded.started_at,
            finished_at=excluded.finished_at,
            total_files=excluded.total_files,
            total_bytes=excluded.total_bytes,
            hash_type=excluded.hash_type,
            verification_mode=excluded.verification_mode,
            status=excluded.status,
            error_count=excluded.error_count,
            error_excerpt=excluded.error_excerpt,
            last_parsed_at=excluded.last_parsed_at
        `).run(
          parsed.id,
          volumeUuid,
          logPath,
          Math.floor(st.mtimeMs / 1000),
          st.size,
          parsed.source_name,
          parsed.dest_volume,
          parsed.started_at,
          parsed.finished_at,
          parsed.total_files,
          parsed.total_bytes,
          parsed.hash_type,
          parsed.verification_mode,
          parsed.status,
          parsed.error_count,
          parsed.error_excerpt,
          nowIso()
        );

        offshootCount++;
      } catch {
        // ignore parse errors for now
      }
    }
  }

  // --- Foolcat reports ---
  let reportCount = 0;
  const reportsDirs = await findReportsFolders(rootPath, cancelToken);
  for (const reportsDir of reportsDirs) {
    if (cancelToken.cancelled) return;

    let entries;
    try {
      entries = fs.readdirSync(reportsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (cancelToken.cancelled) return;
      if (!e.isDirectory()) continue;

      const reportRoot = `${reportsDir}/${e.name}`;

      try {
        const rep = await parseFoolcatReport(reportRoot);

        db.prepare(`
          INSERT INTO foolcat_reports (
            id, volume_uuid, report_name, report_root, report_js_path,
            created_at, clip_count, duration_sec, total_bytes,
            thumb1_path, thumb2_path, thumb3_path, last_parsed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            report_name=excluded.report_name,
            report_root=excluded.report_root,
            report_js_path=excluded.report_js_path,
            clip_count=excluded.clip_count,
            duration_sec=excluded.duration_sec,
            total_bytes=excluded.total_bytes,
            thumb1_path=excluded.thumb1_path,
            thumb2_path=excluded.thumb2_path,
            thumb3_path=excluded.thumb3_path,
            last_parsed_at=excluded.last_parsed_at
        `).run(
          rep.id,
          volumeUuid,
          rep.report_name,
          rep.report_root,
          rep.report_js_path,
          rep.created_at,
          rep.clip_count,
          rep.duration_sec,
          rep.total_bytes,
          rep.thumb1_path,
          rep.thumb2_path,
          rep.thumb3_path,
          nowIso()
        );

        reportCount++;
      } catch {
        // ignore parse errors for now
      }
    }
  }

  progress?.({
    stage: 'A4_logs_end',
    volume_uuid: volumeUuid,
    offshoot_jobs: offshootCount,
    foolcat_reports: reportCount
  });
}

module.exports = { runA4Logs };