// indexer/worker/tools/offshoot.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

async function findTransferLogs(rootPath, cancelToken) {
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
      if (e.name === 'Transfer Logs') {
        found.push(p);
      } else {
        queue.push(p);
      }
    }
  }

  return found;
}

async function listTxtLogs(transferLogsDir) {
  try {
    const entries = await fsp.readdir(transferLogsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => n.toLowerCase().endsWith('.txt'))
      .map((n) => path.join(transferLogsDir, n));
  } catch {
    return [];
  }
}

function normalizeSourceName(s) {
  if (!s) return null;
  const t = s.trim();
  return t.startsWith('/') ? t.slice(1) : t;
}

function stripStatusPrefix(s) {
  if (!s) return s;
  return s
    .replace(/^(ok|success|verified|warning|warn|error|failed)\s*[:\\-–|]\\s*/i, '')
    .replace(/^\\[[^\\]]+\\]\\s*/, '')
    .trim();
}

function normalizeRelativePath(entry, sourceName, rootPath) {
  if (!entry) return null;
  let p = entry.trim();

  if (p.includes('->')) {
    p = p.split('->')[0].trim();
  }

  p = stripStatusPrefix(p);
  if (!p) return null;

  if (rootPath && p.startsWith(rootPath)) {
    p = p.slice(rootPath.length);
  }

  if (sourceName) {
    if (p.startsWith(sourceName)) {
      p = p.slice(sourceName.length);
    }
    if (p.startsWith(`/${sourceName}`)) {
      p = p.slice(sourceName.length + 1);
    }
  }

  p = p.replace(/^\/+/, '');
  return p || null;
}

function statusFromLine(line) {
  const l = (line || '').toLowerCase();
  if (l.includes('error') || l.includes('failed')) return 'error';
  if (l.includes('warning') || l.includes('warn')) return 'warn';
  return 'ok';
}

function extractVolumeName(destPath) {
  if (!destPath) return null;
  const parts = destPath.split('/').filter(Boolean);
  return parts[0] || destPath;
}

function hashId(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

async function parseOffshootLog(logPath, opts = {}) {
  const rootPath = opts.rootPath || null;
  const raw = await fsp.readFile(logPath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const out = {
    log_path: logPath,
    source_name: null,
    dest_volume: null,
    started_at: null,
    finished_at: null,
    duration: null,
    total_files: null,
    total_bytes: null, // usually not present; keep null
    size_string: null,
    hash_type: null,
    verification_mode: null,
    status: 'success',
    error_count: 0,
    error_excerpt: null,
    transferred_files: []
  };

  const errors = [];

  let inTransferredBlock = false;

  for (const line of lines) {
    const l = line.trim();

    // Common OffShoot fields (best-effort)
    if (l.startsWith('Source Name:')) out.source_name = normalizeSourceName(l.replace('Source Name:', '').trim());
    if (l.startsWith('Source:') && !out.source_name) out.source_name = normalizeSourceName(l.replace('Source:', '').trim());

    if (l.startsWith('Destination:')) out.dest_volume = extractVolumeName(l.replace('Destination:', '').trim());

    if (l.startsWith('Started:')) out.started_at = l.replace('Started:', '').trim();
    if (l.startsWith('Finished:')) out.finished_at = l.replace('Finished:', '').trim();
    if (l.startsWith('Duration:')) out.duration = l.replace('Duration:', '').trim();

    if (l.startsWith('Total Files Transferred:')) {
      const n = parseInt(l.replace('Total Files Transferred:', '').trim(), 10);
      out.total_files = Number.isNaN(n) ? null : n;
    }

    if (l.startsWith('Total Size:')) {
      const sizeString = l.replace('Total Size:', '').trim();
      out.size_string = sizeString.split('(')[0].trim();
    }

    if (l.startsWith('Hash type:')) out.hash_type = l.replace('Hash type:', '').trim();
    if (l.startsWith('Verification Mode:')) out.verification_mode = l.replace('Verification Mode:', '').trim();

    if (l.startsWith('-- Transferred files --')) {
      inTransferredBlock = true;
      continue;
    }
    if (l.startsWith('--')) {
      inTransferredBlock = false;
    }

    if (inTransferredBlock && l.length > 0) {
      const status = statusFromLine(l);
      const rel = normalizeRelativePath(l, out.source_name, rootPath);
      out.transferred_files.push({
        raw: l,
        relative_path: rel,
        status,
        message: status === 'ok' ? null : l
      });
    }

    // Error-ish detection
    if (l.toLowerCase().includes('error') || l.toLowerCase().includes('failed') || l.toLowerCase().includes('warning')) {
      // avoid overly noisy lines
      if (l.length > 0 && l.length < 500) {
        errors.push(l);
      }
    }
  }

  if (errors.length) {
    out.status = 'warn';
    out.error_count = errors.length;
    out.error_excerpt = errors.slice(0, 8).join('\n');
  }

  // id based on path + started + source (stable enough)
  const idStr = `${logPath}|${out.started_at || ''}|${out.source_name || ''}|${out.dest_volume || ''}`;
  out.id = hashId(idStr);

  return out;
}

module.exports = {
  findTransferLogs,
  listTxtLogs,
  parseOffshootLog
};
