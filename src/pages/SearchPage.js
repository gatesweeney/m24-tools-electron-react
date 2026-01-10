import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import Slide from '@mui/material/Slide';
import Stack from '@mui/material/Stack';
import Slider from '@mui/material/Slider';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';
import { formatBytes, formatDateTime } from '../utils/formatters';
import DetailPanel from '../components/DetailPanel';

const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const VIDEO_EXTS = new Set([
  'mp4', 'mov', 'mxf', 'mkv', 'avi', 'webm', 'mts', 'm2ts', 'mpg', 'mpeg', 'flv',
  'f4v', '3gp', '3g2', 'wmv', 'hevc', 'ts', 'vob', 'rmvb', 'divx', 'm4v', 'ogv',
  'braw', 'r3d', 'crm', 'cin', 'dpx', 'm2v', 'm2p', 'avc', 'h264', 'h265', 'prores'
]);
const AUDIO_EXTS = new Set([
  'wav', 'mp3', 'aac', 'flac', 'm4a', 'ogg', 'wma', 'aiff', 'alac', 'opus', 'aif',
  'caf', 'ac3', 'dts', 'mka', 'mp2', 'au', 'mid', 'midi'
]);
const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp', 'heic', 'heif', 'svg', 'raw',
  'cr2', 'nef', 'arw', 'orf', 'raf', 'dng', 'sr2', 'pef', 'rw2', '3fr'
]);
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz']);
const PROJECT_EXTS = new Set(['prproj', 'drp', 'drt', 'aep', 'cpr', 'fcpxml', 'edl', 'xml', 'ale']);
const DOC_EXTS = new Set(['pdf', 'txt', 'csv', 'md', 'doc', 'docx', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx']);

function getExt(row) {
  return (row.ext || row.name?.split('.').pop() || '').toLowerCase();
}

function getMediaType(row) {
  if (row.is_dir) return 'folder';
  const ext = getExt(row);
  const fileType = (row.file_type || '').toLowerCase();
  if (VIDEO_EXTS.has(ext) || fileType.includes('video')) return 'video';
  if (AUDIO_EXTS.has(ext) || fileType.includes('audio')) return 'audio';
  if (IMAGE_EXTS.has(ext) || fileType.includes('image')) return 'image';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (PROJECT_EXTS.has(ext)) return 'project';
  if (DOC_EXTS.has(ext)) return 'doc';
  return 'other';
}

function resolutionBucket(row) {
  const w = row.width || row.video_width || row.videoWidth;
  const h = row.height || row.video_height || row.videoHeight;
  const max = Math.max(w || 0, h || 0);
  if (!max) return 'unknown';
  if (max <= 720) return 'sd';
  if (max <= 1080) return 'hd';
  if (max <= 1440) return '2k';
  if (max <= 2160) return '4k';
  if (max <= 2880) return '5k';
  return '6k';
}

function durationBucket(row) {
  const d = Number(row.duration_sec || row.duration || 0);
  if (!d) return 'unknown';
  if (d < 30) return 'lt30s';
  if (d < 120) return 'lt2m';
  if (d < 600) return 'lt10m';
  if (d < 1800) return 'lt30m';
  if (d < 7200) return 'lt2h';
  return 'gt2h';
}

function sizeBucket(row) {
  const s = Number(row.size_bytes || 0);
  if (!s) return 'unknown';
  if (s < 10 * 1024 * 1024) return 'lt10m';
  if (s < 100 * 1024 * 1024) return 'lt100m';
  if (s < 1024 * 1024 * 1024) return 'lt1g';
  if (s < 10 * 1024 * 1024 * 1024) return 'lt10g';
  return 'gt10g';
}

function dateBucket(row) {
  const m = row.mtime ? row.mtime * 1000 : null;
  if (!m) return 'unknown';
  const ageMs = Date.now() - m;
  const day = 24 * 60 * 60 * 1000;
  if (ageMs <= day) return '24h';
  if (ageMs <= 7 * day) return '7d';
  if (ageMs <= 30 * day) return '30d';
  if (ageMs <= 365 * day) return '1y';
  return 'older';
}

function volumeKey(row) {
  if (row.volume_uuid) return `vol:${row.volume_uuid}`;
  if (row.root_path) return `root:${row.root_path}`;
  return `path:${row.path || 'unknown'}`;
}

function volumeLabel(row) {
  if (row.root_path) {
    const parts = row.root_path.split('/').filter(Boolean);
    return parts[parts.length - 1] || row.root_path;
  }
  if (row.volume_uuid) return row.volume_uuid;
  return 'Unknown';
}

function buildPath(rootPath, relPath, fallback) {
  const cleanRel = (relPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!rootPath) return fallback || null;
  return cleanRel ? `${rootPath}/${cleanRel}` : rootPath;
}

function FilterGroup({ title, options, selectedKeys, onToggle, height = 160 }) {
  if (!options || options.length === 0) return null;
  return (
    <Box sx={{ minWidth: 240, maxWidth: 320 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {title}
      </Typography>
      <Box sx={{ maxHeight: height, overflow: 'auto', pr: 1 }}>
        <FormGroup>
          {options.map((opt) => (
            <FormControlLabel
            key={opt.key}
            control={(
              <Checkbox
                size="small"
                checked={selectedKeys.includes(opt.key)}
                onChange={() => onToggle(opt.key)}
                disabled={opt.count === 0}
              />
            )}
            label={`${opt.label} (${opt.count})`}
          />
        ))}
        </FormGroup>
      </Box>
    </Box>
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

export default function SearchPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 250);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [drives, setDrives] = useState([]);
  const [mounted, setMounted] = useState([]);
  const [volumeSearch, setVolumeSearch] = useState('');
  const [filters, setFilters] = useState({
    mediaTypes: [],
    volumes: [],
    machines: [],
    videoCodecs: [],
    audioCodecs: [],
    formats: [],
    extensions: [],
    resolutions: [],
    durations: [],
    sizes: [],
    dates: []
  });
  const [durationRange, setDurationRange] = useState([0, 0]);
  const [sizeRange, setSizeRange] = useState([0, 0]);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  // Column-view navigation: single panel
  const [panelItem, setPanelItem] = useState(null);
  const [selectedChildId, setSelectedChildId] = useState(null);

  const lastQueryRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    const loadState = async () => {
      if (!hasElectron || !window.electronAPI?.getIndexerState) return;
      const res = await window.electronAPI.getIndexerState();
      if (!cancelled && res?.ok) {
        setDrives(res.state?.drives || []);
      }
    };

    const loadMounts = async () => {
      if (!hasElectron || !window.electronAPI?.getMountedVolumes) return;
      const res = await window.electronAPI.getMountedVolumes();
      if (!cancelled && res?.ok) {
        setMounted(res.mounts || []);
      }
    };

    loadState();
    loadMounts();
    const t = setInterval(loadMounts, 8000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!hasElectron || !window.electronAPI.searchQuery) {
        setError('Search requires Electron + preload searchQuery().');
        return;
      }

      const query = debouncedQ.trim();
      if (query.length < 2 && filters.volumes.length === 0) {
        setResults([]);
        setError(null);
        return;
      }

      if (query.length < 2 && filters.volumes.length > 0) {
        setLoading(true);
        setError(null);
        try {
          const all = [];
          for (const v of filters.volumes) {
            const res = await window.electronAPI.listVolumeFiles?.(v, 1000);
            if (res?.ok) {
              all.push(...(res.files || []));
            }
          }
          const normalized = all.map((r) => ({
            ...r,
            path: r.path || buildPath(r.root_path, r.relative_path, r.path)
          }));
          setResults(normalized);
        } catch (e) {
          setError(e.message || String(e));
          setResults([]);
        } finally {
          setLoading(false);
        }
        return;
      }

      if (lastQueryRef.current === query) return;
      lastQueryRef.current = query;

      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.searchQuery(query, { limit: 200 });
        if (!res.ok) {
          setError(res.error || 'Search failed.');
          setResults([]);
        } else {
          const normalized = (res.results || []).map((r) => ({
            ...r,
            path: r.path || buildPath(r.root_path, r.relative_path, r.path)
          }));
          setResults(normalized);
        }
      } catch (e) {
        setError(e.message || String(e));
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [debouncedQ, filters.volumes]);

  const facets = useMemo(() => {
    const counts = {
      mediaTypes: new Map(),
      volumes: new Map(),
      machines: new Map(),
      videoCodecs: new Map(),
      audioCodecs: new Map(),
      formats: new Map(),
      extensions: new Map(),
      resolutions: new Map(),
      durations: new Map(),
      sizes: new Map(),
      dates: new Map()
    };

    for (const r of results || []) {
      const type = getMediaType(r);
      counts.mediaTypes.set(type, (counts.mediaTypes.get(type) || 0) + 1);

      const machineLabel = r.machineName || r.machineId || 'local';
      counts.machines.set(machineLabel, (counts.machines.get(machineLabel) || 0) + 1);

      const volKey = volumeKey(r);
      const volLabel = volumeLabel(r);
      const volEntry = counts.volumes.get(volKey) || { key: volKey, label: volLabel, count: 0 };
      volEntry.count += 1;
      counts.volumes.set(volKey, volEntry);

      const ext = getExt(r);
      if (ext) counts.extensions.set(ext, (counts.extensions.get(ext) || 0) + 1);

      if (r.video_codec) {
        const v = r.video_codec.toLowerCase();
        counts.videoCodecs.set(v, (counts.videoCodecs.get(v) || 0) + 1);
      }
      if (r.audio_codec) {
        const a = r.audio_codec.toLowerCase();
        counts.audioCodecs.set(a, (counts.audioCodecs.get(a) || 0) + 1);
      }
      if (r.format_name) {
        const f = r.format_name.toLowerCase();
        counts.formats.set(f, (counts.formats.get(f) || 0) + 1);
      }

      const resKey = resolutionBucket(r);
      counts.resolutions.set(resKey, (counts.resolutions.get(resKey) || 0) + 1);
      const durKey = durationBucket(r);
      counts.durations.set(durKey, (counts.durations.get(durKey) || 0) + 1);
      const sizeKey = sizeBucket(r);
      counts.sizes.set(sizeKey, (counts.sizes.get(sizeKey) || 0) + 1);
      const dateKey = dateBucket(r);
      counts.dates.set(dateKey, (counts.dates.get(dateKey) || 0) + 1);
    }

    const toOptions = (map) => Array.from(map.entries())
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count);

    return {
      mediaTypes: [
        { key: 'folder', label: 'Folders', count: counts.mediaTypes.get('folder') || 0 },
        { key: 'file', label: 'Files', count: (results || []).filter(r => !r.is_dir).length },
        { key: 'video', label: 'Video', count: counts.mediaTypes.get('video') || 0 },
        { key: 'audio', label: 'Audio', count: counts.mediaTypes.get('audio') || 0 },
        { key: 'image', label: 'Images', count: counts.mediaTypes.get('image') || 0 },
        { key: 'archive', label: 'Archives', count: counts.mediaTypes.get('archive') || 0 },
        { key: 'project', label: 'Projects', count: counts.mediaTypes.get('project') || 0 },
        { key: 'doc', label: 'Docs', count: counts.mediaTypes.get('doc') || 0 },
        { key: 'other', label: 'Other', count: counts.mediaTypes.get('other') || 0 }
      ],
      machines: toOptions(counts.machines),
      volumes: Array.from(counts.volumes.values()).sort((a, b) => b.count - a.count),
      videoCodecs: toOptions(counts.videoCodecs).map(o => ({ ...o, label: o.label })),
      audioCodecs: toOptions(counts.audioCodecs).map(o => ({ ...o, label: o.label })),
      formats: toOptions(counts.formats).map(o => ({ ...o, label: o.label })),
      extensions: toOptions(counts.extensions).slice(0, 14),
      resolutions: [
        { key: 'sd', label: 'SD', count: counts.resolutions.get('sd') || 0 },
        { key: 'hd', label: 'HD', count: counts.resolutions.get('hd') || 0 },
        { key: '2k', label: '2K', count: counts.resolutions.get('2k') || 0 },
        { key: '4k', label: '4K', count: counts.resolutions.get('4k') || 0 },
        { key: '5k', label: '5K', count: counts.resolutions.get('5k') || 0 },
        { key: '6k', label: '6K+', count: counts.resolutions.get('6k') || 0 },
        { key: 'unknown', label: 'Unknown', count: counts.resolutions.get('unknown') || 0 }
      ],
      durations: [
        { key: 'lt30s', label: '<30s', count: counts.durations.get('lt30s') || 0 },
        { key: 'lt2m', label: '30s–2m', count: counts.durations.get('lt2m') || 0 },
        { key: 'lt10m', label: '2–10m', count: counts.durations.get('lt10m') || 0 },
        { key: 'lt30m', label: '10–30m', count: counts.durations.get('lt30m') || 0 },
        { key: 'lt2h', label: '30m–2h', count: counts.durations.get('lt2h') || 0 },
        { key: 'gt2h', label: '>2h', count: counts.durations.get('gt2h') || 0 },
        { key: 'unknown', label: 'Unknown', count: counts.durations.get('unknown') || 0 }
      ],
      sizes: [
        { key: 'lt10m', label: '<10MB', count: counts.sizes.get('lt10m') || 0 },
        { key: 'lt100m', label: '10–100MB', count: counts.sizes.get('lt100m') || 0 },
        { key: 'lt1g', label: '100MB–1GB', count: counts.sizes.get('lt1g') || 0 },
        { key: 'lt10g', label: '1–10GB', count: counts.sizes.get('lt10g') || 0 },
        { key: 'gt10g', label: '>10GB', count: counts.sizes.get('gt10g') || 0 },
        { key: 'unknown', label: 'Unknown', count: counts.sizes.get('unknown') || 0 }
      ],
      dates: [
        { key: '24h', label: 'Last 24h', count: counts.dates.get('24h') || 0 },
        { key: '7d', label: 'Last 7d', count: counts.dates.get('7d') || 0 },
        { key: '30d', label: 'Last 30d', count: counts.dates.get('30d') || 0 },
        { key: '1y', label: 'Last 1y', count: counts.dates.get('1y') || 0 },
        { key: 'older', label: 'Older', count: counts.dates.get('older') || 0 },
        { key: 'unknown', label: 'Unknown', count: counts.dates.get('unknown') || 0 }
      ]
    };
  }, [results]);

  const stats = useMemo(() => {
    const sizeValues = results.map(r => r.size_bytes).filter(Boolean);
    const durValues = results.map(r => r.duration_sec).filter(Boolean);
    const dateValues = results.map(r => r.mtime).filter(Boolean);
    const sizeMin = sizeValues.length ? Math.min(...sizeValues) : 0;
    const sizeMax = sizeValues.length ? Math.max(...sizeValues) : 0;
    const durMin = durValues.length ? Math.min(...durValues) : 0;
    const durMax = durValues.length ? Math.max(...durValues) : 0;
    const dateMin = dateValues.length ? Math.min(...dateValues) : 0;
    const dateMax = dateValues.length ? Math.max(...dateValues) : 0;
    return { sizeMin, sizeMax, durMin, durMax, dateMin, dateMax };
  }, [results]);

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      volumes: prev.volumes.filter((v) => facets.volumes.find(f => f.key === v)),
      videoCodecs: prev.videoCodecs.filter((v) => facets.videoCodecs.find(f => f.key === v)),
      audioCodecs: prev.audioCodecs.filter((v) => facets.audioCodecs.find(f => f.key === v)),
      formats: prev.formats.filter((v) => facets.formats.find(f => f.key === v)),
      extensions: prev.extensions.filter((v) => facets.extensions.find(f => f.key === v)),
      resolutions: prev.resolutions.filter((v) => facets.resolutions.find(f => f.key === v)),
      durations: prev.durations.filter((v) => facets.durations.find(f => f.key === v)),
      sizes: prev.sizes.filter((v) => facets.sizes.find(f => f.key === v)),
      dates: prev.dates.filter((v) => facets.dates.find(f => f.key === v))
    }));
  }, [facets]);

  useEffect(() => {
    setDurationRange([stats.durMin || 0, stats.durMax || 0]);
    setSizeRange([stats.sizeMin || 0, stats.sizeMax || 0]);
    if (stats.dateMin && stats.dateMax) {
      const start = new Date(stats.dateMin * 1000).toISOString().slice(0, 10);
      const end = new Date(stats.dateMax * 1000).toISOString().slice(0, 10);
      setDateRange({ start, end });
    } else {
      setDateRange({ start: '', end: '' });
    }
  }, [stats.durMin, stats.durMax, stats.sizeMin, stats.sizeMax, stats.dateMin, stats.dateMax]);

  const toggleFilter = useCallback((group, key) => {
    setFilters((prev) => {
      const next = new Set(prev[group]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [group]: Array.from(next) };
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({
      mediaTypes: [],
      volumes: [],
      machines: [],
      videoCodecs: [],
      audioCodecs: [],
      formats: [],
      extensions: [],
      resolutions: [],
      durations: [],
      sizes: [],
      dates: []
    });
  }, []);

  const filteredResults = useMemo(() => {
    if (!results || results.length === 0) return [];
    return results.filter((r) => {
      const type = getMediaType(r);
      const ext = getExt(r);
      const isFile = !r.is_dir;

      const machineLabel = r.machineName || r.machineId || 'local';

      if (filters.mediaTypes.length > 0) {
        const typeMatch = filters.mediaTypes.some((t) => {
          if (t === 'file') return isFile;
          return type === t;
        });
        if (!typeMatch) return false;
      }

      if (filters.machines.length > 0 && !filters.machines.includes(machineLabel)) return false;

      if (filters.volumes.length > 0 && !filters.volumes.includes(volumeKey(r))) return false;

      if (filters.extensions.length > 0 && (!ext || !filters.extensions.includes(ext))) return false;

      if (filters.videoCodecs.length > 0) {
        const v = (r.video_codec || '').toLowerCase();
        if (!v || !filters.videoCodecs.includes(v)) return false;
      }
      if (filters.audioCodecs.length > 0) {
        const a = (r.audio_codec || '').toLowerCase();
        if (!a || !filters.audioCodecs.includes(a)) return false;
      }
      if (filters.formats.length > 0) {
        const f = (r.format_name || '').toLowerCase();
        if (!f || !filters.formats.includes(f)) return false;
      }

      if (filters.resolutions.length > 0) {
        if (r.is_dir) return false;
        if (!filters.resolutions.includes(resolutionBucket(r))) return false;
      }
      if (filters.durations.length > 0) {
        if (r.is_dir) return false;
        if (!filters.durations.includes(durationBucket(r))) return false;
      }
      if (filters.sizes.length > 0) {
        if (r.is_dir) return false;
        if (!filters.sizes.includes(sizeBucket(r))) return false;
      }
      if (filters.dates.length > 0) {
        if (!filters.dates.includes(dateBucket(r))) return false;
      }

      if (durationRange[1] > 0) {
        if (r.is_dir) return false;
        const d = Number(r.duration_sec || 0);
        if (d < durationRange[0] || d > durationRange[1]) return false;
      }
      if (sizeRange[1] > 0) {
        if (r.is_dir) return false;
        const s = Number(r.size_bytes || 0);
        if (s < sizeRange[0] || s > sizeRange[1]) return false;
      }
      if (dateRange.start && dateRange.end) {
        const m = r.mtime ? r.mtime * 1000 : 0;
        const start = new Date(dateRange.start).getTime();
        const end = new Date(dateRange.end).getTime() + (24 * 60 * 60 * 1000);
        if (!m || m < start || m > end) return false;
      }

      return true;
    });
  }, [results, filters, durationRange, sizeRange, dateRange]);

  // DataGrid row click → open panel
  const handleRowClick = useCallback((params) => {
    const row = params.row || {};
    setPanelItem({
      ...row,
      path: row.path || buildPath(row.root_path, row.relative_path, row.path)
    });
    setSelectedChildId(null);
  }, []);

  // Panel item click → open in same panel and mark selected child
  const handlePanelItemClick = useCallback((childItem) => {
    setSelectedChildId(childItem.relative_path || null);
    setPanelItem({
      ...childItem,
      path: childItem.path || buildPath(childItem.root_path, childItem.relative_path, childItem.path)
    });
  }, []);

  const handleExpand = useCallback((asset) => {
    navigate('/detail', { state: { item: asset } });
  }, [navigate]);

  // Close panel → clear selection
  const handleClosePanel = useCallback(() => {
    setPanelItem(null);
    setSelectedChildId(null);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape to close panel
      if (e.key === 'Escape') {
        if (panelItem) {
          setPanelItem(null);
          setSelectedChildId(null);
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panelItem]);

  const rows = useMemo(() => {
    return (filteredResults || []).map((r, idx) => ({
      id: `${r.machineId || 'local'}::${r.volume_uuid || 'none'}::${r.path || idx}`,
      ...r
    }));
  }, [filteredResults]);

  const connectedVolumes = useMemo(() => {
    const mountPoints = new Set((mounted || []).map((m) => m.mount_point));
    return (drives || []).filter((d) => d.mount_point_last && mountPoints.has(d.mount_point_last));
  }, [drives, mounted]);

  const volumeOptions = useMemo(() => {
    const counts = new Map(facets.volumes.map((v) => [v.key, v.count]));
    return (drives || []).map((d) => ({
      key: d.volume_uuid,
      label: d.volume_name || d.mount_point_last || d.volume_uuid,
      count: counts.get(d.volume_uuid) || 0
    }));
  }, [drives, facets.volumes]);

  const openVolumeRoot = useCallback((volume) => {
    if (!volume?.mount_point_last) return;
    setPanelItem({
      volume_uuid: volume.volume_uuid,
      root_path: volume.mount_point_last,
      relative_path: '',
      name: volume.volume_name || volume.mount_point_last,
      path: volume.mount_point_last,
      is_dir: true
    });
    setSelectedChildId(null);
  }, []);

  const columns = useMemo(() => ([
    {
      field: 'name',
      headerName: 'Name',
      flex: 1,
      minWidth: 200,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
          {params.row.is_dir ? (
            <FolderIcon sx={{ color: 'primary.main', fontSize: 20, flexShrink: 0 }} />
          ) : (
            <InsertDriveFileIcon sx={{ color: 'text.secondary', fontSize: 18, flexShrink: 0 }} />
          )}
          <Typography
            variant="body2"
            sx={{
              fontWeight: params.row.is_dir ? 600 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {params.value}
          </Typography>
          <OffshootChip
            status={params.row.offshoot_status}
            message={params.row.offshoot_message}
          />
        </Box>
      )
    },
    { field: 'path', headerName: 'Path', flex: 2, minWidth: 300 },
    { field: 'machineId', headerName: 'Machine', width: 100, valueGetter: (p) => p.row.machineId || 'local' },
    {
      field: 'size_bytes',
      headerName: 'Size',
      width: 100,
      valueGetter: (p) => p.row.is_dir ? '—' : formatBytes(p.row.size_bytes)
    },
    { field: 'mtime', headerName: 'Modified', width: 160, valueGetter: (p) => (p.row.mtime ? formatDateTime(p.row.mtime * 1000) : '—') },
    {
      field: 'file_type',
      headerName: 'Type',
      width: 80,
      valueGetter: (p) => p.row.is_dir ? 'folder' : (p.row.file_type || p.row.ext || '—')
    }
  ]), []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 3, pt: 3, pb: 2, flexShrink: 0 }}>
        <Typography variant="h4">Search</Typography>
        <Typography variant="body2" color="text.secondary">
          Fuzzy search across indexed drives and manual roots. Click folders to browse contents.
        </Typography>
      </Box>

      {/* Connected volumes */}
      <Box sx={{ px: 3, pb: 2, flexShrink: 0 }}>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
          <Typography variant="caption" color="text.secondary">
            Connected volumes
          </Typography>
          {connectedVolumes.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              None detected
            </Typography>
          )}
          {connectedVolumes.map((v) => (
            <Chip
              key={v.volume_uuid}
              label={v.volume_name || v.mount_point_last}
              size="small"
              variant="outlined"
              onClick={() => openVolumeRoot(v)}
            />
          ))}
        </Stack>
      </Box>

      {/* Search input */}
      <Box sx={{ px: 3, pb: 2, flexShrink: 0 }}>
        <TextField
          label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Try: prores, h264 1080, >1gb, .wav, 2025-11..."
          fullWidth
          size="small"
        />
        {loading && <LinearProgress sx={{ mt: 1 }} />}
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </Box>

      {/* Main content: DataGrid + Column-view Panels (Finder style) */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          overflow: 'visible',
          px: 3,
          pb: 3,
          minHeight: 0
        }}
      >
        {!panelItem && (
          <Box
            sx={{
              width: 320,
              flexShrink: 0,
              pr: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              overflow: 'visible',
              minHeight: 0
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'visible' }}>
              <Typography variant="subtitle2" color="text.secondary">
                Showing {filteredResults.length} of {results.length} results
              </Typography>
              <Chip
                label="Clear filters"
                size="small"
                variant="outlined"
                onClick={clearFilters}
                disabled={Object.values(filters).every((arr) => arr.length === 0)}
                sx={{ alignSelf: 'flex-start' }}
              />

              <Divider />

              <Typography variant="caption" color="text.secondary">Duration (sec)</Typography>
              <Slider
                value={durationRange}
                min={stats.durMin || 0}
                max={stats.durMax || 0}
                step={1}
                onChange={(_e, v) => setDurationRange(v)}
                valueLabelDisplay="auto"
                disabled={!stats.durMax}
              />

              <Typography variant="caption" color="text.secondary">Size (bytes)</Typography>
              <Slider
                value={sizeRange}
                min={stats.sizeMin || 0}
                max={stats.sizeMax || 0}
                step={1024}
                onChange={(_e, v) => setSizeRange(v)}
                valueLabelDisplay="auto"
                disabled={!stats.sizeMax}
              />

              <Divider />

              <Typography variant="caption" color="text.secondary">Modified</Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  type="date"
                  size="small"
                  value={dateRange.start}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  type="date"
                  size="small"
                  value={dateRange.end}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Stack>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip size="small" label="Last 7d" onClick={() => {
                  const end = new Date();
                  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                  setDateRange({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
                }} />
                <Chip size="small" label="Last 30d" onClick={() => {
                  const end = new Date();
                  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                  setDateRange({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
                }} />
                <Chip size="small" label="This year" onClick={() => {
                  const end = new Date();
                  const start = new Date(end.getFullYear(), 0, 1);
                  setDateRange({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
                }} />
              </Stack>

              <Divider />
            </Box>

            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', pr: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Volumes
              </Typography>
              <TextField
                size="small"
                placeholder="Filter volumes…"
                value={volumeSearch}
                onChange={(e) => setVolumeSearch(e.target.value)}
                fullWidth
                sx={{ mb: 1 }}
              />
              <Box sx={{ maxHeight: 180, overflow: 'auto', pr: 1 }}>
                <FormGroup>
                  {volumeOptions
                    .filter((v) => v.label.toLowerCase().includes(volumeSearch.toLowerCase()))
                    .map((opt) => (
                      <FormControlLabel
                        key={opt.key}
                        control={(
                          <Checkbox
                            size="small"
                            checked={filters.volumes.includes(opt.key)}
                            onChange={() => toggleFilter('volumes', opt.key)}
                          />
                        )}
                        label={`${opt.label} (${opt.count})`}
                      />
                    ))}
                </FormGroup>
              </Box>
              <Divider sx={{ my: 1.5 }} />

              <FilterGroup
                title="Type"
                options={facets.mediaTypes}
                selectedKeys={filters.mediaTypes}
                onToggle={(key) => toggleFilter('mediaTypes', key)}
              />
              <FilterGroup
                title="Machine"
                options={facets.machines}
                selectedKeys={filters.machines}
                onToggle={(key) => toggleFilter('machines', key)}
              />
              <FilterGroup
                title="Video Codec"
                options={facets.videoCodecs}
                selectedKeys={filters.videoCodecs}
                onToggle={(key) => toggleFilter('videoCodecs', key)}
              />
              <FilterGroup
                title="Audio Codec"
                options={facets.audioCodecs}
                selectedKeys={filters.audioCodecs}
                onToggle={(key) => toggleFilter('audioCodecs', key)}
              />
              <FilterGroup
                title="Format"
                options={facets.formats}
                selectedKeys={filters.formats}
                onToggle={(key) => toggleFilter('formats', key)}
              />
              <FilterGroup
                title="Extensions"
                options={facets.extensions}
                selectedKeys={filters.extensions}
                onToggle={(key) => toggleFilter('extensions', key)}
              />
              <FilterGroup
                title="Resolution"
                options={facets.resolutions}
                selectedKeys={filters.resolutions}
                onToggle={(key) => toggleFilter('resolutions', key)}
              />
              <FilterGroup
                title="Duration bucket"
                options={facets.durations}
                selectedKeys={filters.durations}
                onToggle={(key) => toggleFilter('durations', key)}
              />
              <FilterGroup
                title="Size bucket"
                options={facets.sizes}
                selectedKeys={filters.sizes}
                onToggle={(key) => toggleFilter('sizes', key)}
              />
              <FilterGroup
                title="Modified bucket"
                options={facets.dates}
                selectedKeys={filters.dates}
                onToggle={(key) => toggleFilter('dates', key)}
              />
            </Box>
          </Box>
        )}

        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            bgcolor: 'background.paper',
            borderRadius: 2,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <Typography variant="subtitle2" sx={{ px: 2, pt: 2, pb: 1, color: 'text.secondary' }}>
            Select a folder or file to inspect
          </Typography>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <DataGridPro
              rows={rows}
              columns={columns}
              disableRowSelectionOnClick
              slots={{ toolbar: GridToolbar }}
              slotProps={{
                toolbar: {
                  showQuickFilter: true,
                  quickFilterProps: { debounceMs: 250 }
                }
              }}
              onRowClick={handleRowClick}
              onRowDoubleClick={async (params) => {
                if (!window.electronAPI?.openInFinder) return;
                const p = params.row.path;
                if (!p) return;
                await window.electronAPI.openInFinder(p);
              }}
              getRowClassName={(params) =>
                panelItem?.relative_path === params.row.relative_path ? 'Mui-selected' : ''
              }
              sx={{ height: '100%' }}
            />
          </Box>
        </Box>
      </Box>

      <Slide direction="left" in={!!panelItem} mountOnEnter unmountOnExit>
        <Box
          sx={{
            position: 'fixed',
            top: 76,
            right: 0,
            bottom: 0,
            width: '50vw',
            maxWidth: 980,
            minWidth: 520,
            zIndex: (theme) => theme.zIndex.appBar - 1,
            boxShadow: 6,
            bgcolor: 'background.paper',
            pt: 1,
            display: 'flex',
            alignItems: 'stretch'
          }}
        >
          {panelItem && (
            <DetailPanel
              item={panelItem}
              onItemClick={handlePanelItemClick}
              onClose={handleClosePanel}
              onExpand={handleExpand}
              selectedChildId={selectedChildId}
              width="100%"
              height="100%"
            />
          )}
        </Box>
      </Slide>
    </Box>
  );
}
