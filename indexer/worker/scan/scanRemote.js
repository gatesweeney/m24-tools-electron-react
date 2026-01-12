// indexer/worker/scan/scanRemote.js
const fs = require('fs');
const path = require('path');
const { bfsWalk } = require('./util/bfsWalker');
const { upsertState, getDeviceId } = require('../remoteApi');
const crypto = require('crypto');
const { fileThumbTarget, generateFileThumbMid } = require('../tools/thumbs');

function nowIso() {
  return new Date().toISOString();
}

function classifyFileType(ext) {
  const e = (ext || '').toLowerCase();
  if (['.mov', '.mp4', '.mxf', '.mts', '.m2ts', '.avi', '.mkv', '.webm', '.r3d', '.braw'].includes(e)) return 'video';
  if (['.wav', '.aif', '.aiff', '.mp3', '.m4a', '.flac'].includes(e)) return 'audio';
  if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.bmp', '.gif'].includes(e)) return 'image';
  if (['.drp', '.prproj', '.aep', '.fcpxml', '.xml'].includes(e)) return 'project';
  return 'other';
}

function makeManualRootId(rootPath) {
  const deviceId = getDeviceId();
  const hash = crypto.createHash('sha256').update(`${deviceId}::${rootPath}`).digest('hex');
  const raw = BigInt(`0x${hash.slice(0, 16)}`);
  const max = BigInt('9223372036854775807');
  const id = raw % max;
  return (id === BigInt(0) ? BigInt(1) : id).toString();
}

function normalizeManualRootId(id, rootPath) {
  if (typeof id === 'string' && /^\d+$/.test(id)) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(Math.floor(id));
  return makeManualRootId(rootPath);
}

async function scanPathToRemote({ volume, rootPath, cancelToken, progress, generateThumbs = false }) {
  const volumeUuid = volume.volume_uuid;
  const startedAt = Date.now();
  const scanTs = nowIso();

  console.log('[scan-remote] start', { volumeUuid, rootPath });
  progress?.({ stage: 'A2_files_start', volume_uuid: volumeUuid, rootPath });

  let fileCount = 0;
  let dirCount = 0;
  let totalBytes = 0;

  const batchSize = 2000;
  let batch = [];
  let thumbsGenerated = 0;
  const maxThumbs = 200;

  const topFolders = new Map();
  const signatureDepth = 2;

  const flushBatch = async () => {
    if (!batch.length) return;
    await upsertState({
      deviceId: getDeviceId(),
      volumes: [],
      manualRoots: [],
      files: batch
    });
    batch = [];
  };

  await bfsWalk(
    rootPath,
    { depthLimit: null, dirsOnly: false, yieldEvery: 500, yieldMs: 10 },
    async ({ relPath, name, isDir, depth }) => {
      if (cancelToken.cancelled) return;

      if (depth <= signatureDepth && isDir) {
        topFolders.set(name, (topFolders.get(name) || 0) + 1);
      }

      const ext = isDir ? '' : path.extname(name);
      const fileType = isDir ? 'dir' : classifyFileType(ext);
      let sizeBytes = null;
      let mtime = null;
      let ctime = null;

      if (!isDir) {
        try {
          const st = await fs.promises.lstat(path.join(rootPath, relPath));
          sizeBytes = st.size;
          mtime = Math.floor(st.mtimeMs / 1000);
          ctime = Math.floor(st.ctimeMs / 1000);
          totalBytes += sizeBytes || 0;
        } catch {}
      }

      let thumbPath = null;
      if (generateThumbs && !isDir && fileType === 'video' && thumbsGenerated < maxThumbs) {
        const absPath = path.join(rootPath, relPath);
        const target = fileThumbTarget(volumeUuid, rootPath, relPath);
        if (fs.existsSync(absPath)) {
          if (fs.existsSync(target)) {
            thumbPath = target;
          } else {
            const ok = await generateFileThumbMid(absPath, target);
            if (ok) {
              thumbPath = target;
              thumbsGenerated += 1;
            }
          }
        }
      }

      batch.push({
        volume_uuid: volumeUuid,
        root_path: rootPath,
        relative_path: relPath,
        name,
        ext,
        is_dir: isDir ? 1 : 0,
        file_type: fileType,
        size_bytes: sizeBytes,
        mtime,
        ctime,
        last_seen_at: scanTs,
        status: 'present',
        thumb_path: thumbPath
      });

      if (isDir) dirCount++;
      else fileCount++;

      if ((fileCount + dirCount) % 1000 === 0) {
        progress?.({
          stage: 'A2_files_progress',
          volume_uuid: volumeUuid,
          dirs: dirCount,
          files: fileCount
        });
        console.log('[scan-remote] progress', { volumeUuid, dirs: dirCount, files: fileCount });
      }

      if (batch.length >= batchSize) {
        await flushBatch();
      }
    },
    cancelToken
  );

  await flushBatch();

  const signature_hint = JSON.stringify({
    depthLimit: null,
    topFolders: Array.from(topFolders.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([n]) => n)
  });

  progress?.({
    stage: 'A2_files_end',
    volume_uuid: volumeUuid,
    dirs: dirCount,
    files: fileCount
  });
  console.log('[scan-remote] end', { volumeUuid, dirs: dirCount, files: fileCount, totalBytes });

  return {
    scanTs,
    fileCount,
    dirCount,
    totalBytes,
    signature_hint,
    durationMs: Date.now() - startedAt
  };
}

async function scanVolumeRemote({ volume, cancelToken, progress, generateThumbs = false }) {
  const rootPath = volume.mount_point;
  const volumeUuid = volume.volume_uuid;

  const deviceId = getDeviceId();
  const baseVolume = {
    volume_uuid: volumeUuid,
    volume_name: volume.volume_name,
    mount_point_last: rootPath,
    scan_interval_ms: volume.scan_interval_ms ?? 20 * 60 * 1000,
    is_active: volume.is_active ?? 1,
    auto_purge: volume.auto_purge ?? 1,
    device_id: deviceId
  };

  await upsertState({ deviceId, volumes: [baseVolume], manualRoots: [], files: [] });
  console.log('[scan-remote] volume upserted', { volumeUuid, rootPath });

  const result = await scanPathToRemote({ volume, rootPath, cancelToken, progress, generateThumbs });

  await upsertState({
    deviceId,
    volumes: [
      {
        ...baseVolume,
        last_scan_at: result.scanTs,
        signature_hint: result.signature_hint,
        dir_count: result.dirCount,
        file_count: result.fileCount,
        total_bytes: result.totalBytes
      }
    ],
    manualRoots: [],
    files: []
  });
  console.log('[scan-remote] volume stats upserted', { volumeUuid });

  return result;
}

async function scanManualRootRemote({ root, cancelToken, progress, generateThumbs = false }) {
  const normalizedId = normalizeManualRootId(root.id, root.path);
  const volumeUuid = `manual:${normalizedId}`;
  const rootPath = root.path;
  const deviceId = getDeviceId();

  await upsertState({
    deviceId,
    volumes: [],
    manualRoots: [
      {
        ...root,
        id: normalizedId,
        path: root.path,
        label: root.label || root.path,
        scan_interval_ms: root.scan_interval_ms ?? null,
        is_active: root.is_active ?? 1,
        device_id: deviceId
      }
    ],
    files: []
  });
  console.log('[scan-remote] manual root upserted', { rootPath, id: normalizedId });

  const result = await scanPathToRemote({
    volume: { volume_uuid: volumeUuid },
    rootPath,
    cancelToken,
    progress,
    generateThumbs
  });

  await upsertState({
    deviceId,
    volumes: [],
    manualRoots: [
      {
        ...root,
        id: normalizedId,
        path: root.path,
        label: root.label || root.path,
        last_scan_at: result.scanTs,
        dir_count: result.dirCount,
        file_count: result.fileCount,
        total_bytes: result.totalBytes,
        is_active: root.is_active ?? 1,
        device_id: deviceId
      }
    ],
    files: []
  });
  console.log('[scan-remote] manual root stats upserted', { rootPath, id: normalizedId });

  return result;
}

module.exports = {
  scanVolumeRemote,
  scanManualRootRemote
};
