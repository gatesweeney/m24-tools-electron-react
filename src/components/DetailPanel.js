import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Checkbox from '@mui/material/Checkbox';
import Tooltip from '@mui/material/Tooltip';
import Skeleton from '@mui/material/Skeleton';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Collapse from '@mui/material/Collapse';
import Alert from '@mui/material/Alert';
import CloseIcon from '@mui/icons-material/Close';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { formatBytes, formatDateTime, formatDurationSec, formatBitrate } from '../utils/formatters';

const VIDEO_EXTS = [
  'mp4', 'mov', 'mxf', 'mkv', 'avi', 'webm', 'mts', 'm2ts', 'mpg', 'mpeg', 'flv',
  'f4v', '3gp', '3g2', 'wmv', 'hevc', 'ts', 'vob', 'rmvb', 'divx', 'm4v', 'ogv',
  'braw', 'r3d', 'crm', 'cin', 'dpx', 'm2v', 'm2p', 'avc', 'h264', 'h265', 'prores'
];
const AUDIO_EXTS = [
  'wav', 'mp3', 'aac', 'flac', 'm4a', 'ogg', 'wma', 'aiff', 'alac', 'opus', 'aif',
  'caf', 'ac3', 'dts', 'mka', 'mp2', 'au', 'mid', 'midi'
];
const IMAGE_EXTS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp', 'heic', 'heif', 'svg', 'raw',
  'cr2', 'nef', 'arw', 'orf', 'raf', 'dng', 'sr2', 'pef', 'rw2', '3fr'
];
const RECURSIVE_PAGE_SIZE = 250;


function DetailRow({ label, value }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 90, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'right', wordBreak: 'break-word', ml: 1 }}>
        {value || '—'}
      </Typography>
    </Box>
  );
}

function SectionTitle({ children }) {
  return (
    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: 'primary.main' }}>
      {children}
    </Typography>
  );
}

function OffshootChip({ status, message }) {
  if (!status) return null;
  const label = status === 'ok' ? 'Verified' : status === 'warn' ? 'Warning' : 'Error';
  const color = status === 'ok' ? 'success' : status === 'warn' ? 'warning' : 'error';
  const chip = (
    <Chip
      label={label}
      size="small"
      color={color}
      variant="outlined"
      sx={{ ml: 1 }}
    />
  );
  if (!message) return chip;
  return (
    <Tooltip title={message}>
      <Box sx={{ display: 'inline-flex' }}>{chip}</Box>
    </Tooltip>
  );
}

/**
 * DetailPanel - shows either directory contents or file details
 * Finder column-view style navigation
 */
export default function DetailPanel({
  item,
  onItemClick,
  onClose,
  selectedChildId,
  width = 630,
  height = '100%',
  onExpand
}) {
  const [loading, setLoading] = useState(false);
  const [contents, setContents] = useState([]);
  const [recursiveContents, setRecursiveContents] = useState([]);
  const [stats, setStats] = useState(null);
  const [extendedData, setExtendedData] = useState(null);
  const [thumbnails, setThumbnails] = useState({});
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [recursiveEnabled, setRecursiveEnabled] = useState(true);
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [batchMessage, setBatchMessage] = useState(null);
  const [recursiveOffset, setRecursiveOffset] = useState(0);
  const [recursiveHasMore, setRecursiveHasMore] = useState(false);
  const [recursiveLoading, setRecursiveLoading] = useState(false);
  const [autoLoadAttempts, setAutoLoadAttempts] = useState(0);

  // Transcription state
  const [transcription, setTranscription] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState(null);
  const [transcribeError, setTranscribeError] = useState(null);
  const [transcriptionExpanded, setTranscriptionExpanded] = useState(true);
  const [whisperAvailable, setWhisperAvailable] = useState(null);
  const [pathAvailable, setPathAvailable] = useState(true);

  const isDirectory = item?.is_dir;
  const itemExt = (item?.ext || item?.name?.split('.').pop() || '').toLowerCase();
  const canTranscribe = itemExt && (VIDEO_EXTS.includes(itemExt) || AUDIO_EXTS.includes(itemExt));
  const relativePath = item?.relative_path || '';
  const pathSegments = relativePath.split('/').filter(Boolean);
  const dirSegments = isDirectory ? pathSegments : pathSegments.slice(0, -1);
  const fileSegment = !isDirectory ? pathSegments[pathSegments.length - 1] : null;
  const rootLabel = item?.root_path ? item.root_path.split('/').filter(Boolean).pop() : 'Root';
  const hasParent = dirSegments.length > 0;
  const isFilterActive = !!filterText.trim() || filterType !== 'all';

  const buildPath = useCallback((rootPath, relPath) => {
    const cleanRel = (relPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!rootPath) return null;
    return cleanRel ? `${rootPath}/${cleanRel}` : rootPath;
  }, []);

  const itemPath = item?.path || buildPath(item?.root_path, item?.relative_path);
  const resolvedItem = itemPath ? { ...item, path: itemPath } : item;

  // Check if whisper is available
  useEffect(() => {
    if (window.electronAPI?.transcribeCheckAvailable) {
      window.electronAPI.transcribeCheckAvailable().then(res => {
        setWhisperAvailable(res?.available || false);
      });
    }
  }, []);

  // Listen for transcription progress
  useEffect(() => {
    if (!window.electronAPI?.onTranscribeProgress) return;

    const unsubscribe = window.electronAPI.onTranscribeProgress((data) => {
      if (data.filePath === item?.path) {
        setTranscribeProgress(data);
      }
    });

    return () => unsubscribe();
  }, [item?.path]);

  // Check for cached transcription when item changes
  useEffect(() => {
    if (!item?.path || isDirectory || !canTranscribe) {
      setTranscription(null);
      setTranscribeError(null);
      return;
    }

    if (window.electronAPI?.transcribeGetCached) {
      window.electronAPI.transcribeGetCached(item.path).then(res => {
        if (res?.ok) {
          setTranscription({
            text: res.text,
            language: res.language,
            transcribedAt: res.transcribedAt
          });
        } else {
          setTranscription(null);
        }
      });
    }
  }, [item?.path, isDirectory, canTranscribe]);

  // Fetch directory contents or file details when item changes
  useEffect(() => {
    if (!item) {
      setContents([]);
      setRecursiveContents([]);
      setStats(null);
      setExtendedData(null);
      setThumbnails({});
      setTranscription(null);
      setTranscribeError(null);
      setFilterText('');
      setFilterType('all');
      setRecursiveEnabled(true);
      setSelectedPaths([]);
      setRecursiveOffset(0);
      setRecursiveHasMore(false);
      setRecursiveLoading(false);
      setAutoLoadAttempts(0);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setThumbnails({});

      try {
        if (isDirectory) {
          // Fetch directory contents
          let files = [];
          if (window.electronAPI?.getDirectoryContents) {
            const res = await window.electronAPI.getDirectoryContents(
              item.volume_uuid,
              item.root_path,
              item.relative_path,
              item.device_id
            );
            if (res?.ok) {
              files = (res.files || []).map((f) => ({
                ...f,
                device_id: f.device_id || item?.device_id,
                path: f.path || buildPath(f.root_path || item?.root_path, f.relative_path)
              }));
              setContents(files);
            }
          }

          // Fetch directory stats
          if (window.electronAPI?.getDirectoryStats) {
            const statsRes = await window.electronAPI.getDirectoryStats(
              item.volume_uuid,
              item.root_path,
              item.relative_path,
              item.device_id
            );
            if (statsRes?.ok) {
              setStats(statsRes.stats);
            }
          }

          // Fetch thumbnails for media files in directory (async, after main load)
          if (files.length > 0 && window.electronAPI?.generateBatchThumbnails) {
            const mediaFiles = files.filter(f => !f.is_dir && f.path);
            if (mediaFiles.length > 0) {
              // Don't await - let thumbnails load in background
              window.electronAPI.generateBatchThumbnails(mediaFiles).then(thumbRes => {
                if (thumbRes?.ok) {
                  setThumbnails(thumbRes.thumbnails || {});
                }
              });
            }
          }
        } else {
          // Fetch file details (volume, ffprobe, thumbnails)
          let volume = null;
          let ffprobeData = null;

          if (item.volume_uuid && window.electronAPI?.getVolumeInfo) {
            const volumeRes = await window.electronAPI.getVolumeInfo(item.volume_uuid, item.device_id);
            if (volumeRes?.ok) volume = volumeRes.volume;
          }

          if (item.path && window.electronAPI?.getMediaInfo) {
            const mediaRes = await window.electronAPI.getMediaInfo(item.path);
            if (mediaRes?.ok) ffprobeData = mediaRes.mediaInfo;
          }

          setExtendedData({ volume, ffprobeData });
        }
      } catch (e) {
        console.error('DetailPanel fetch error:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [item, isDirectory]);

  // Check path availability for reveal button
  useEffect(() => {
    setRecursiveContents([]);
    setRecursiveOffset(0);
    setRecursiveHasMore(false);
    let cancelled = false;
    const run = async () => {
      if (!window.electronAPI?.pathExists || !itemPath) {
        setPathAvailable(false);
        return;
      }
      const res = await window.electronAPI.pathExists(itemPath);
      if (!cancelled) setPathAvailable(!!res?.exists);
    };
    run();
    return () => { cancelled = true; };
  }, [itemPath]);

  // Fetch recursive contents when filters are active
  useEffect(() => {
    if (!item?.is_dir || !window.electronAPI?.getDirectoryContentsRecursive) {
      setRecursiveContents([]);
      setRecursiveOffset(0);
      setRecursiveHasMore(false);
      setRecursiveLoading(false);
      return;
    }
    if (!isFilterActive || !recursiveEnabled) {
      setRecursiveContents([]);
      setRecursiveOffset(0);
      setRecursiveHasMore(false);
      setRecursiveLoading(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        setRecursiveLoading(true);
        const res = await window.electronAPI.getDirectoryContentsRecursive(
          item.volume_uuid,
          item.root_path,
          item.relative_path,
          RECURSIVE_PAGE_SIZE,
          0,
          item.device_id
        );
        if (!cancelled && res?.ok) {
          const files = (res.files || []).map((f) => ({
            ...f,
            device_id: f.device_id || item?.device_id,
            path: f.path || buildPath(f.root_path || item?.root_path, f.relative_path)
          }));
          setRecursiveContents(files);
          setRecursiveOffset(files.length);
          setRecursiveHasMore(files.length >= 250);
        }
      } catch {
        if (!cancelled) {
          setRecursiveContents([]);
          setRecursiveOffset(0);
          setRecursiveHasMore(false);
        }
      } finally {
        if (!cancelled) setRecursiveLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [
    item?.is_dir,
    item?.volume_uuid,
    item?.root_path,
    item?.relative_path,
    isFilterActive,
    filterText,
    filterType,
    recursiveEnabled
  ]);

  // Clear selection when navigating
  useEffect(() => {
    setSelectedPaths([]);
    setBatchMessage(null);
    setAutoLoadAttempts(0);
  }, [itemPath]);

  const buildDirItem = useCallback((relPath) => {
    const cleanRel = (relPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
    const name = cleanRel ? cleanRel.split('/').pop() : rootLabel;
    const path = item?.root_path ? [item.root_path, cleanRel].filter(Boolean).join('/') : item?.path;
    return {
      volume_uuid: item?.volume_uuid || null,
      root_path: item?.root_path || null,
      relative_path: cleanRel,
      name,
      path,
      device_id: item?.device_id,
      is_dir: true
    };
  }, [item?.path, item?.root_path, item?.volume_uuid, rootLabel]);

  const handleBreadcrumbClick = useCallback((index) => {
    if (!onItemClick) return;
    const rel = dirSegments.slice(0, index + 1).join('/');
    onItemClick(buildDirItem(rel));
  }, [buildDirItem, dirSegments, onItemClick]);

  const handleGoUp = useCallback(() => {
    if (!onItemClick) return;
    const parentRel = dirSegments.slice(0, -1).join('/');
    onItemClick(buildDirItem(parentRel));
  }, [buildDirItem, dirSegments, onItemClick]);

  const baseContents = (isFilterActive && recursiveEnabled) ? recursiveContents : contents;
  const visibleContents = baseContents.filter((child) => {
    const childExt = (child.ext || child.name?.split('.').pop() || '').toLowerCase();
    const fileType = (child.file_type || '').toLowerCase();
    if (filterType === 'folders' && !child.is_dir) return false;
    if (filterType === 'files' && child.is_dir) return false;
    if (filterType === 'video') {
      return !child.is_dir && (VIDEO_EXTS.includes(childExt) || fileType.includes('video'));
    }
    if (filterType === 'audio') {
      return !child.is_dir && (AUDIO_EXTS.includes(childExt) || fileType.includes('audio'));
    }
    if (filterType === 'images') {
      return !child.is_dir && (IMAGE_EXTS.includes(childExt) || fileType.includes('image'));
    }
    if (!filterText.trim()) return true;
    const q = filterText.trim().toLowerCase();
    return (child.name || '').toLowerCase().includes(q) || childExt.includes(q);
  });

  const selectedItems = baseContents.filter((child) => selectedPaths.includes(child.path));
  const selectedDirs = selectedItems.filter((child) => child.is_dir);

  const previewThumbs = contents
    .filter((child) => !child.is_dir && thumbnails[child.path])
    .slice(0, 6)
    .map((child) => ({
      path: thumbnails[child.path],
      name: child.name
    }));

  const toggleSelected = useCallback((path) => {
    setSelectedPaths((prev) => (
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    ));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPaths([]);
  }, []);

  const handleAddRoots = useCallback(async () => {
    if (!window.electronAPI?.indexerAddManualRoot) return;
    if (selectedDirs.length === 0) return;
    setBatchMessage(null);
    try {
      for (const dir of selectedDirs) {
        await window.electronAPI.indexerAddManualRoot(dir.path);
      }
      setBatchMessage(`Added ${selectedDirs.length} root${selectedDirs.length === 1 ? '' : 's'}.`);
      clearSelection();
    } catch (e) {
      setBatchMessage(e.message || String(e));
    }
  }, [selectedDirs, clearSelection]);

  const handleRevealSelected = useCallback(async () => {
    if (!window.electronAPI?.openInFinder) return;
    if (selectedItems.length === 0) return;
    try {
      for (const entry of selectedItems) {
        if (entry.path) await window.electronAPI.openInFinder(entry.path);
      }
    } catch (e) {
      setBatchMessage(e.message || String(e));
    }
  }, [selectedItems]);

  const handleLoadMoreRecursive = useCallback(async () => {
    if (!window.electronAPI?.getDirectoryContentsRecursive) return;
    if (!recursiveHasMore || recursiveLoading) return;
    setRecursiveLoading(true);
    try {
    const res = await window.electronAPI.getDirectoryContentsRecursive(
      item.volume_uuid,
      item.root_path,
      item.relative_path,
      RECURSIVE_PAGE_SIZE,
      recursiveOffset,
      item.device_id
    );
      if (res?.ok) {
        const files = (res.files || []).map((f) => ({
          ...f,
          device_id: f.device_id || item?.device_id
        }));
        setRecursiveContents((prev) => [...prev, ...files]);
        setRecursiveOffset((prev) => prev + files.length);
        setRecursiveHasMore(files.length >= 250);
      }
    } finally {
      setRecursiveLoading(false);
    }
  }, [item?.volume_uuid, item?.root_path, item?.relative_path, recursiveOffset, recursiveHasMore, recursiveLoading]);

  useEffect(() => {
    setAutoLoadAttempts(0);
  }, [filterText, filterType, recursiveEnabled]);

  useEffect(() => {
    if (!isFilterActive || !recursiveEnabled) return;
    if (recursiveLoading) return;
    if (visibleContents.length > 0) return;
    if (!recursiveHasMore) return;
    if (autoLoadAttempts >= 4) return;
    setAutoLoadAttempts((prev) => prev + 1);
    handleLoadMoreRecursive();
  }, [
    isFilterActive,
    recursiveEnabled,
    recursiveLoading,
    recursiveHasMore,
    visibleContents.length,
    autoLoadAttempts,
    handleLoadMoreRecursive
  ]);

  const handleItemClick = useCallback((childItem) => {
    if (onItemClick) {
      const next = {
        ...childItem,
        path: childItem?.path || buildPath(childItem?.root_path || item?.root_path, childItem?.relative_path)
      };
      onItemClick(next);
    }
  }, [buildPath, item?.root_path, onItemClick]);

  const handleRevealInFinder = useCallback(async () => {
    if (window.electronAPI?.openInFinder && itemPath) {
      await window.electronAPI.openInFinder(itemPath);
    }
  }, [itemPath]);

  const handleTranscribe = useCallback(async () => {
    if (!window.electronAPI?.transcribeRequest || !itemPath) return;

    setTranscribing(true);
    setTranscribeError(null);
    setTranscribeProgress(null);

    try {
      const res = await window.electronAPI.transcribeRequest(itemPath);
      if (res?.ok) {
        setTranscription({
          text: res.text,
          language: res.language,
          cached: res.cached
        });
      } else {
        setTranscribeError(res?.error || 'Transcription failed');
      }
    } catch (e) {
      setTranscribeError(e.message || String(e));
    } finally {
      setTranscribing(false);
      setTranscribeProgress(null);
    }
  }, [item?.path]);

  if (!item) return null;

  const volume = extendedData?.volume;
  const ffprobeData = extendedData?.ffprobeData;
  const fileType = (item?.file_type || '').toLowerCase();
  const isVideoFile = !isDirectory && (VIDEO_EXTS.includes(itemExt) || fileType.includes('video'));
  const isAudioFile = !isDirectory && (AUDIO_EXTS.includes(itemExt) || fileType.includes('audio'));

  return (
    <Paper
      elevation={0}
      sx={{
        width,
        height,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 0,
        borderLeft: 0,
        borderColor: 'divider'
      }}
    >
      {/* Panel Header */}
      <Box
        sx={{
          p: 2,
          borderBottom: 1,
          borderColor: 'divider',
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          zIndex: 1,
          bgcolor: 'background.paper'
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, mr: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
            {isDirectory ? (
              <FolderIcon sx={{ color: 'primary.main', fontSize: 24, flexShrink: 0 }} />
            ) : (
              <InsertDriveFileIcon sx={{ color: 'text.secondary', fontSize: 22, flexShrink: 0 }} />
            )}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
                {item.name || '(no name)'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all', display: 'block' }}>
                {item.path}
              </Typography>
            </Box>
          </Box>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            {onExpand && (
              <IconButton onClick={() => onExpand(item)} size="small">
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            )}
            <IconButton onClick={onClose} size="small">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>

        {/* Breadcrumbs + Up */}
        <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Up one level">
            <span>
              <IconButton size="small" onClick={handleGoUp} disabled={!hasParent && isDirectory}>
                <ArrowUpwardIcon fontSize="inherit" />
              </IconButton>
            </span>
          </Tooltip>
          <Breadcrumbs sx={{ fontSize: '0.8rem', flex: 1, minWidth: 0 }}>
            <Link
              underline="hover"
              color="inherit"
              sx={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
              onClick={() => {
                if (!onItemClick || (dirSegments.length === 0 && isDirectory)) return;
                onItemClick(buildDirItem(''));
              }}
            >
              {rootLabel}
            </Link>
            {dirSegments.map((seg, idx) => (
              <Link
                key={`${seg}-${idx}`}
                underline="hover"
                color="inherit"
                sx={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
                onClick={() => handleBreadcrumbClick(idx)}
              >
                {seg}
              </Link>
            ))}
            {fileSegment && (
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                {fileSegment}
              </Typography>
            )}
          </Breadcrumbs>
        </Box>

        {previewThumbs.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
            {previewThumbs.map((thumb, idx) => (
              <Box
                key={`thumb-${idx}`}
                component="img"
                src={`file://${thumb.path}?t=${idx}`}
                alt={thumb.name}
                sx={{
                  width: 80,
                  height: 60,
                  objectFit: 'cover',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'action.hover'
                }}
              />
            ))}
          </Stack>
        )}

        {/* Stats for directories */}
        {isDirectory && stats && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {stats.file_count} files, {stats.dir_count} folders • {formatBytes(stats.total_bytes)}
            {isFilterActive ? ` • ${visibleContents.length} shown${recursiveEnabled ? ' (recursive)' : ''}` : ''}
          </Typography>
        )}

        <Button
          variant="outlined"
          size="small"
          startIcon={<FolderOpenIcon />}
          disabled={!window.electronAPI?.openInFinder || !item.path || !pathAvailable}
          onClick={handleRevealInFinder}
          sx={{ mt: 1.5 }}
        >
          Reveal in Finder
        </Button>
      </Box>

      {/* Panel Content */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading && (
          <Box sx={{ p: 2 }}>
            <Skeleton variant="text" width="60%" />
            <Skeleton variant="text" width="40%" />
            <Skeleton variant="rectangular" height={120} sx={{ mt: 1 }} />
          </Box>
        )}

        {/* Directory Contents */}
        {isDirectory && !loading && (
          <Box>
            <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <Stack spacing={1}>
                <TextField
                  size="small"
                  placeholder="Filter this folder..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  fullWidth
                />
                <Stack direction="row" spacing={1} alignItems="center">
                  <ToggleButtonGroup
                    size="small"
                    value={filterType}
                    exclusive
                    onChange={(_e, val) => {
                      if (val) setFilterType(val);
                    }}
                  >
                    <ToggleButton value="all">All</ToggleButton>
                    <ToggleButton value="folders">Folders</ToggleButton>
                    <ToggleButton value="files">Files</ToggleButton>
                    <ToggleButton value="video">Video</ToggleButton>
                    <ToggleButton value="audio">Audio</ToggleButton>
                    <ToggleButton value="images">Images</ToggleButton>
                  </ToggleButtonGroup>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="caption" color="text.secondary">Recursive</Typography>
                    <Switch
                      size="small"
                      checked={recursiveEnabled}
                      onChange={(e) => setRecursiveEnabled(e.target.checked)}
                    />
                  </Stack>
                </Stack>
              </Stack>
            </Box>

            {batchMessage && (
              <Alert severity="info" sx={{ m: 1.5 }}>
                {batchMessage}
              </Alert>
            )}

            {selectedPaths.length > 0 && (
              <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Typography variant="caption">
                    {selectedPaths.length} selected
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="outlined" onClick={handleRevealSelected}>
                      Reveal
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={handleAddRoots}
                      disabled={selectedDirs.length === 0 || !window.electronAPI?.indexerAddManualRoot}
                    >
                      Add as Roots
                    </Button>
                    <Button size="small" variant="text" onClick={clearSelection}>
                      Clear
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            )}

            <List dense disablePadding>
              {visibleContents.length === 0 ? (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Empty or filtered out
                  </Typography>
                </Box>
              ) : (
                visibleContents.map((child, idx) => {
                  const thumbPath = thumbnails[child.path];
                  const hasThumb = thumbPath && !child.is_dir;
                  const isSelected = selectedPaths.includes(child.path);
                  const secondaryLabel = isFilterActive
                    ? child.relative_path
                    : (child.is_dir ? null : formatBytes(child.size_bytes));

                  return (
                    <ListItemButton
                      key={`${child.relative_path}-${idx}`}
                      onClick={() => handleItemClick(child)}
                      selected={selectedChildId === child.relative_path}
                      sx={{
                        borderBottom: 1,
                        borderColor: 'divider',
                        '&:last-child': { borderBottom: 0 },
                        py: hasThumb ? 0.5 : 1,
                        bgcolor: isSelected ? 'action.selected' : undefined
                      }}
                    >
                      <Checkbox
                        checked={isSelected}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelected(child.path);
                        }}
                        size="small"
                        sx={{ mr: 0.5 }}
                      />
                      {hasThumb ? (
                        <Box
                          component="img"
                          src={`file://${thumbPath}?t=1`}
                          alt=""
                          sx={{
                            width: 40,
                            height: 40,
                            objectFit: 'cover',
                            borderRadius: 0.5,
                            mr: 1.5,
                            flexShrink: 0,
                            bgcolor: 'action.hover'
                          }}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          {child.is_dir ? (
                            <FolderIcon sx={{ color: 'primary.main', fontSize: 20 }} />
                          ) : (
                            <InsertDriveFileIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                          )}
                        </ListItemIcon>
                      )}
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: child.is_dir ? 600 : 400 }}
                              noWrap
                            >
                              {child.name}
                            </Typography>
                            <OffshootChip
                              status={child.offshoot_status}
                              message={child.offshoot_message}
                            />
                          </Box>
                        }
                        secondary={secondaryLabel}
                        secondaryTypographyProps={{
                          variant: 'caption'
                        }}
                      />
                      <ChevronRightIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                    </ListItemButton>
                  );
                })
              )}
            </List>

            {isFilterActive && recursiveEnabled && recursiveHasMore && (
              <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'center' }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleLoadMoreRecursive}
                  disabled={recursiveLoading}
                >
                  {recursiveLoading ? 'Loading…' : 'Load 250 more'}
                </Button>
              </Box>
            )}
          </Box>
        )}

        {/* File Details */}
        {!isDirectory && !loading && (
          <Stack spacing={2.5} sx={{ p: 2 }}>

            {/* FFprobe Data */}
            {ffprobeData && !ffprobeData.error && (
              <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.5 }}>
                <SectionTitle>Media Info</SectionTitle>
                <Stack spacing={0.5}>
                  {ffprobeData.duration && (
                    <DetailRow label="Duration" value={formatDurationSec(ffprobeData.duration)} />
                  )}
                  {ffprobeData.width && ffprobeData.height && (
                    <DetailRow label="Resolution" value={`${ffprobeData.width} × ${ffprobeData.height}`} />
                  )}
                  {ffprobeData.codec && <DetailRow label="Video" value={ffprobeData.codec} />}
                  {ffprobeData.audioCodec && <DetailRow label="Audio" value={ffprobeData.audioCodec} />}
                  {ffprobeData.audioSampleRate && (
                    <DetailRow label="Sample Rate" value={`${(parseInt(ffprobeData.audioSampleRate, 10) / 1000).toFixed(1)} kHz`} />
                  )}
                  {ffprobeData.bitrate && <DetailRow label="Bitrate" value={formatBitrate(ffprobeData.bitrate)} />}
                </Stack>
              </Box>
            )}

            <Divider />

            {/* File Info */}
            <Box>
              <SectionTitle>File</SectionTitle>
              <Stack spacing={0.5}>
                <DetailRow label="Size" value={formatBytes(item.size_bytes)} />
                <DetailRow label="Extension" value={item.ext || '(none)'} />
                <DetailRow label="Modified" value={item.mtime ? formatDateTime(item.mtime * 1000) : '—'} />
                {item.offshoot_status && (
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <OffshootChip status={item.offshoot_status} message={item.offshoot_message} />
                  </Box>
                )}
              </Stack>
            </Box>

            <Divider />

            {/* Volume */}
            <Box>
              <SectionTitle>Volume</SectionTitle>
              <Stack spacing={0.5}>
                <DetailRow label="Name" value={volume?.volume_name} />
                <DetailRow label="UUID" value={item.volume_uuid} />
                <DetailRow label="Mount" value={volume?.mount_point_last} />
              </Stack>
            </Box>

            {/* Transcription - only for audio/video files */}
            {canTranscribe && (
              <>
                <Divider />
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <SectionTitle>Transcription</SectionTitle>
                    {transcription && (
                      <IconButton
                        size="small"
                        onClick={() => setTranscriptionExpanded(!transcriptionExpanded)}
                      >
                        {transcriptionExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    )}
                  </Box>

                  {/* Transcribe button - show if not transcribed yet */}
                  {!transcription && !transcribing && (
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<RecordVoiceOverIcon />}
                      onClick={handleTranscribe}
                      disabled={whisperAvailable === false}
                      fullWidth
                    >
                      {whisperAvailable === false ? 'Whisper not installed' : 'Transcribe Audio'}
                    </Button>
                  )}

                  {/* Progress indicator */}
                  {transcribing && (
                    <Box sx={{ textAlign: 'center', py: 1 }}>
                      <CircularProgress size={24} sx={{ mb: 1 }} />
                      <Typography variant="caption" display="block" color="text.secondary">
                        {transcribeProgress?.message || 'Transcribing...'}
                      </Typography>
                      {transcribeProgress?.progress > 0 && (
                        <LinearProgress
                          variant="determinate"
                          value={transcribeProgress.progress}
                          sx={{ mt: 1 }}
                        />
                      )}
                    </Box>
                  )}

                  {/* Error message */}
                  {transcribeError && (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      {transcribeError}
                    </Alert>
                  )}

                  {/* Transcription result */}
                  {transcription && (
                    <Collapse in={transcriptionExpanded}>
                      <Box
                        sx={{
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          p: 1.5,
                          maxHeight: 200,
                          overflow: 'auto'
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontSize: '0.8rem',
                            lineHeight: 1.5
                          }}
                        >
                          {transcription.text || '(No speech detected)'}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        Language: {transcription.language || 'auto'}
                        {transcription.cached && ' (cached)'}
                      </Typography>
                      {/* Re-transcribe button */}
                      <Button
                        variant="text"
                        size="small"
                        onClick={handleTranscribe}
                        disabled={transcribing || whisperAvailable === false}
                        sx={{ mt: 1 }}
                      >
                        Re-transcribe
                      </Button>
                    </Collapse>
                  )}

                  {/* Hint for installing whisper */}
                  {whisperAvailable === false && !transcription && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      Install whisper.cpp: brew install whisper-cpp
                    </Typography>
                  )}
                </Box>
              </>
            )}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
