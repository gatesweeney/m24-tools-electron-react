// indexer/worker/tools/foolcat.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

function hashId(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

// Stable “random” selection using a hash seed
function pickStableIndices(seedStr, count, max) {
  if (max <= 0) return [];
  const seed = crypto.createHash('sha1').update(seedStr).digest();
  let x = seed.readUInt32BE(0);
  const picked = new Set();
  while (picked.size < Math.min(count, max)) {
    x = (x * 1664525 + 1013904223) >>> 0;
    picked.add(x % max);
  }
  return Array.from(picked);
}

async function findReportsFolders(rootPath, cancelToken) {
  const found = [];
  const queue = [rootPath];

  while (queue.length) {
    if (cancelToken?.cancelled) break;
    const dir = queue.shift();

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (cancelToken?.cancelled) break;
      if (!e.isDirectory()) continue;

      const p = path.join(dir, e.name);
      if (e.name === 'Reports') {
        found.push(p);
      } else {
        queue.push(p);
      }
    }
  }
  return found;
}

async function parseReportJs(reportJsPath) {
  const raw = await fsp.readFile(reportJsPath, 'utf8');
  let content = raw.trim();
  if (content.startsWith('report =')) content = content.slice('report ='.length).trim();
  if (content.endsWith(';')) content = content.slice(0, -1);
  return JSON.parse(content);
}

function decodeMaybe(str) {
  try { return decodeURIComponent(str); } catch { return str; }
}

function clipThumbPath(reportRoot, stillEncoded) {
  // stillEncoded like "Report%20Data/images/stills/CLIP_1.jpg"
  const rel = decodeMaybe(stillEncoded);
  return path.join(reportRoot, rel);
}

async function parseFoolcatReport(reportRoot) {
  const reportJsPath = path.join(reportRoot, 'Report Data', 'report.js');
  const data = await parseReportJs(reportJsPath);

  const reportName = data.reportName || null;
  const summary = data.summary || {};
  const folders = data.folders || [];

  // Flatten clips
  const clips = [];
  for (const folder of folders) {
    const media = folder.media || [];
    for (const m of media) {
      clips.push(m);
    }
  }

  const reportId = hashId(`${reportJsPath}|${reportName || ''}`);
  const indices = pickStableIndices(reportId, 3, clips.length);

  // Pick 3 representative thumbs (prefer still index 1)
  const thumbs = indices.map((i) => {
    const m = clips[i];
    const stills = Array.isArray(m.stills) ? m.stills : [];
    const still = stills[1] || stills[0] || null;
    return still ? clipThumbPath(reportRoot, still) : null;
  }).filter(Boolean);

  return {
    id: reportId,
    report_name: reportName,
    report_root: reportRoot,
    report_js_path: reportJsPath,
    created_at: null, // optional later
    clip_count: summary.clipCount || clips.length || null,
    duration_sec: summary.duration || null,
    total_bytes: summary.size || null,
    thumb1_path: thumbs[0] || null,
    thumb2_path: thumbs[1] || null,
    thumb3_path: thumbs[2] || null
  };
}

module.exports = {
  findReportsFolders,
  parseFoolcatReport
};