// electron/offshoot-logs.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/**
 * Recursively find OffShoot logs under any "Transfer Logs" folder.
 */
async function findOffshootLogs(rootDir) {
  const logs = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'Transfer Logs') {
          // Collect all .txt logs inside
          let files;
          try {
            files = await fsp.readdir(entryPath);
          } catch {
            continue;
          }
          for (const file of files) {
            if (file.toLowerCase().endsWith('.txt')) {
              logs.push(path.join(entryPath, file));
            }
          }
        } else {
          await walk(entryPath);
        }
      }
    }
  }

  await walk(rootDir);
  return logs;
}

/**
 * Parse a single OffShoot .txt log into a structured object.
 */
async function parseOffshootLog(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const output = {
    id: filePath,
    filePath,
    date: null,
    source: null,
    destination: null,
    preset: null,
    sourceName: null,
    started: null,
    finished: null,
    duration: null,
    files: null,
    size: null,
    hash: null,
    verification: null,
    status: 'Success',
    transferredFiles: []
  };

  let inTransferredBlock = false;

  for (const line of lines) {
    const l = line.trim();

    if (l.startsWith('Source:')) {
      output.source = l.replace('Source:', '').trim();
    }

    if (l.startsWith('Destination:')) {
      const dest = l.replace('Destination:', '').trim();
      output.destination = extractVolumeName(dest);
    }

    if (l.startsWith('Preset:')) {
      output.preset = l.replace('Preset:', '').trim();
    }

    if (l.startsWith('Source Name:')) {
      output.sourceName = l.replace('Source Name:', '').trim();
    }

    if (l.startsWith('Started:')) {
      output.started = l.replace('Started:', '').trim();
      output.date = output.started;
    }

    if (l.startsWith('Finished:')) {
      output.finished = l.replace('Finished:', '').trim();
    }

    if (l.startsWith('Duration:')) {
      output.duration = l.replace('Duration:', '').trim();
    }

    if (l.startsWith('Total Files Transferred:')) {
      const n = parseInt(l.replace('Total Files Transferred:', '').trim(), 10);
      output.files = Number.isNaN(n) ? null : n;
    }

    if (l.startsWith('Total Size:')) {
      const sizeString = l.replace('Total Size:', '').trim();
      output.size = sizeString.split('(')[0].trim();
    }

    if (l.startsWith('Hash type:')) {
      output.hash = l.replace('Hash type:', '').trim();
    }

    if (l.startsWith('Verification Mode:')) {
      output.verification = l.replace('Verification Mode:', '').trim();
    }

    if (l.startsWith('-- Transferred files --')) {
      inTransferredBlock = true;
      continue;
    }
    if (l.startsWith('--')) {
      inTransferredBlock = false;
    }

    if (inTransferredBlock && l.length > 0) {
      output.transferredFiles.push(l);
    }
  }

  return output;
}

function extractVolumeName(destPath) {
  const parts = destPath.split('/').filter(Boolean);
  return parts.length > 0 ? parts[0] : destPath;
}

/**
 * Scan for Foolcat "Reports" under any "Reports" folder in rootDir.
 * Map key: reportName (e.g. "A001CV0Z", "CanonB_0008").
 */
async function scanFoolcatReports(rootDir) {
  const reports = new Map();

  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;

      if (entry.name === 'Reports') {
        // Each subfolder is a report folder - e.g. "Report - A001CV0Z - 2025-11-15 at 23.28.34 - BD_SHUTTLE_B"
        let rf;
        try {
          rf = await fsp.readdir(entryPath, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const reportDir of rf) {
          if (!reportDir.isDirectory()) continue;
          const reportRoot = path.join(entryPath, reportDir.name);
          const reportJs = path.join(reportRoot, 'Report Data', 'report.js');
          try {
            const data = await parseFoolcatReport(reportJs, reportRoot);
            if (data && data.reportName) {
              reports.set(data.reportName, data);
            }
          } catch (err) {
            console.warn('[foolcat] Failed to parse report:', reportJs, err.message || err);
          }
        }
      } else {
        await walk(entryPath);
      }
    }
  }

  await walk(rootDir);
  return reports;
}

/**
 * Parse Foolcat report.js
 * File shape: "report = { ... };"
 */
async function parseFoolcatReport(reportJsPath, reportRootDir) {
  let raw;
  try {
    raw = await fsp.readFile(reportJsPath, 'utf8');
  } catch {
    return null;
  }

  let content = raw.trim();
  if (content.startsWith('report =')) {
    content = content.slice('report ='.length).trim();
  }
  if (content.endsWith(';')) {
    content = content.slice(0, -1);
  }

  let data;
  try {
    data = JSON.parse(content);
  } catch (err) {
    console.warn('[foolcat] JSON parse error for', reportJsPath, err.message || err);
    return null;
  }

  const summary = data.summary || {};
  const folders = data.folders || [];

  const clips = [];

  for (const folder of folders) {
    const mediaList = folder.media || [];
    for (const media of mediaList) {
      clips.push(normalizeFoolcatClip(media, reportRootDir));
    }
  }

  return {
    reportName: data.reportName || null,
    reportPath: reportJsPath,
    summary: {
      durationSec: summary.duration,
      sizeBytes: summary.size,
      clipCount: summary.clipCount,
      frames: summary.frames,
      codec: summary.codec,
      frameRates: summary.frameRates,
      fileTypes: summary.fileTypes
    },
    clips
  };
}

function normalizeFoolcatClip(media, reportRootDir) {
  const stills = media.stills || [];
  let thumbnailPath = null;

  if (stills.length > 0) {
    const index = stills[1] ? 1 : 0; // prefer second still, fallback to first
    const relativeEncoded = stills[index]; // e.g. "Report%20Data/images/stills/A001C001_..._1.jpg"
    const relative = decodeURIComponent(relativeEncoded);
    thumbnailPath = path.join(reportRootDir, relative);
  }

  const cameraInfo = media.cameraInfo || {};

  return {
    clipName: media.clipName,
    fileName: media.fileName,
    fps: media.fps,
    durationSec: media.duration,
    frameCount: media.frameCount,
    sizeBytes: media.size,
    codec: media.codec,
    bitRate: media.bitRate,
    width: media.horizontalResolution,
    height: media.verticalResolution,
    aspectRatio: media.aspectRatio,
    creationDate: media.creationDate,
    cameraName: cameraInfo.cameraName,
    cameraSerial: cameraInfo.cameraSerial,
    whiteBalance: cameraInfo.whiteBalance,
    shutterAngle: cameraInfo.shutterAngle,
    iso: cameraInfo.iso,
    timecodeStart: cameraInfo.timecodeStart,
    thumbnailPath
  };
}

/**
 * Main entry: scan OffShoot logs, attach Foolcat info when available.
 */
async function scanOffshootLogs(rootFolder) {
  const logPaths = await findOffshootLogs(rootFolder);
  const reportsByName = await scanFoolcatReports(rootFolder);

  const results = [];

  for (const fullPath of logPaths) {
    try {
      const off = await parseOffshootLog(fullPath);

      // Use Source Name (best) or strip leading "/" from Source path to match Foolcat reportName
      const key = off.sourceName || normalizeSourceKey(off.source);
      const fc = key ? reportsByName.get(key) : null;

      if (fc) {
        off.foolcat = fc;
      }

      results.push(off);
    } catch (err) {
      console.error('[offshoot] Error parsing log', fullPath, err.message || err);
    }
  }

  return results;
}

function normalizeSourceKey(source) {
  if (!source) return null;
  const trimmed = source.trim();
  return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
}

module.exports = {
  scanOffshootLogs
};