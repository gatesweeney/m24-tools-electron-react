import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Divider from '@mui/material/Divider';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DeleteIcon from '@mui/icons-material/Delete';
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';
import { formatBytes, formatDuration, formatDateTime, formatInterval } from '../utils/formatters';

const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

function ResultChip({ status }) {
  if (!status) return '—';
  const map = {
    success: { label: 'Success', severity: 'success' },
    cancelled: { label: 'Cancelled', severity: 'warning' },
    error: { label: 'Error', severity: 'error' }
  };
  const cfg = map[status] || { label: status, severity: 'info' };
  return (
    <Alert severity={cfg.severity} sx={{ py: 0, px: 1, display: 'inline-flex' }}>
      {cfg.label}
    </Alert>
  );
}

const DEFAULT_INTERVAL = 20 * 60 * 1000;

const INTERVAL_OPTIONS = [
  { label: 'On mount only', value: 0 },
  { label: 'Every 20 min', value: 20 * 60 * 1000 },
  { label: 'Every 30 min', value: 30 * 60 * 1000 },
  { label: 'Every 1 hour', value: 60 * 60 * 1000 },
  { label: 'Every 6 hours', value: 6 * 60 * 60 * 1000 },
  { label: 'Daily', value: 24 * 60 * 60 * 1000 },
  { label: 'Manual only', value: -1 }
];

function intervalLabel(ms) {
  const hit = INTERVAL_OPTIONS.find((o) => o.value === ms);
  return hit ? hit.label : formatInterval(ms);
}

/**
 * Busy indicator that doesn't flicker:
 * - increments for each async operation
 * - shows bar only if busy lasts > SHOW_DELAY
 * - once visible, stays visible at least MIN_VISIBLE
 */
function useBusyIndicator() {
  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;

  const [busyVisible, setBusyVisible] = useState(false);
  const showTimer = useRef(null);
  const hideTimer = useRef(null);

  const SHOW_DELAY = 120;     // ms
  const MIN_VISIBLE = 250;    // ms

  useEffect(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);

    if (busy) {
      // only show if it lasts a bit
      showTimer.current = setTimeout(() => {
        setBusyVisible(true);
      }, SHOW_DELAY);
    } else {
      // keep visible briefly to avoid flicker
      hideTimer.current = setTimeout(() => {
        setBusyVisible(false);
      }, MIN_VISIBLE);
    }

    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [busy]);

  const begin = useCallback(() => setBusyCount((c) => c + 1), []);
  const end = useCallback(() => setBusyCount((c) => Math.max(0, c - 1)), []);

  return { busy, busyVisible, begin, end };
}

export default function IndexerSettingsModal({ open, onClose, onStateChanged }) {
  const [tab, setTab] = useState(0); // 0=Service, 1=Drives, 2=Manual Roots
  const [error, setError] = useState(null);

  const [state, setState] = useState({ drives: [], roots: [] });
  const [serviceStatus, setServiceStatus] = useState(null);

  const { busyVisible, begin, end } = useBusyIndicator();

  // --- Helpers ---
  const safeCall = useCallback(async (fn, { setErr = true } = {}) => {
    if (!hasElectron || !fn) {
      if (setErr) setError('Missing Electron preload API for this action.');
      return null;
    }
    begin();
    try {
      const res = await fn();
      return res;
    } catch (e) {
      if (setErr) setError(e.message || String(e));
      return null;
    } finally {
      end();
    }
  }, [begin, end]);

  const loadIndexerState = useCallback(async () => {
    setError(null);
    const res = await safeCall(() => window.electronAPI.getIndexerState?.(), { setErr: true });
    if (!res) return;

    if (!res.ok) {
      setError(res.error || 'Failed to load indexer state.');
      return;
    }
    const st = res.state || { drives: [], roots: [] };
    setState(st);
    onStateChanged && onStateChanged(st);
  }, [safeCall, onStateChanged]);

  const loadServiceStatus = useCallback(async () => {
    const res = await safeCall(() => window.electronAPI.indexerServiceStatus?.(), { setErr: false });
    if (!res) return;
    setServiceStatus(res);
  }, [safeCall]);

  // Load once per open (not repeatedly)
  useEffect(() => {
    if (!open) return;
    loadIndexerState();
    loadServiceStatus();
  }, [open, loadIndexerState, loadServiceStatus]);

  // --- Service actions ---
  const doServiceAction = useCallback(async (fn) => {
    setError(null);
    const res = await safeCall(fn, { setErr: true });
    if (res && res.ok === false) setError(res.error || 'Service action failed.');
    await loadServiceStatus();
  }, [safeCall, loadServiceStatus]);

  // --- Drives actions ---
  const setVolumeActive = useCallback(async (volumeUuid, isActive) => {
    setError(null);
    const res = await safeCall(() =>
      window.electronAPI.indexerSetVolumeActive?.(volumeUuid, isActive)
    );
    if (!res) return;
    if (!res.ok) return setError(res.error || 'Failed to update drive.');
    const st = res.state || state;
    setState(st);
    onStateChanged && onStateChanged(st);
  }, [safeCall, state, onStateChanged]);

  const setVolumeInterval = useCallback(async (volumeUuid, intervalMs) => {
    setError(null);
    const res = await safeCall(() =>
      window.electronAPI.indexerSetVolumeInterval?.(volumeUuid, intervalMs)
    );
    if (!res) return;
    if (!res.ok) return setError(res.error || 'Failed to update interval.');
    const st = res.state || state;
    setState(st);
    onStateChanged && onStateChanged(st);
  }, [safeCall, state, onStateChanged]);

  // --- Manual roots actions ---
  const addManualRoot = useCallback(async () => {
    setError(null);
    if (!window.electronAPI.selectDirectory || !window.electronAPI.indexerAddManualRoot) {
      return setError('Missing IPC: selectDirectory + indexerAddManualRoot(path)');
    }
    begin();
    try {
      const dir = await window.electronAPI.selectDirectory();
      if (!dir) return;
      const res = await window.electronAPI.indexerAddManualRoot(dir);
      if (!res.ok) return setError(res.error || 'Failed to add manual root.');
      const st = res.state || state;
      setState(st);
      onStateChanged && onStateChanged(st);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      end();
    }
  }, [begin, end, state, onStateChanged]);

  const setManualRootActive = useCallback(async (rootId, isActive) => {
    setError(null);
    const res = await safeCall(() =>
      window.electronAPI.indexerSetManualRootActive?.(rootId, isActive)
    );
    if (!res) return;
    if (!res.ok) return setError(res.error || 'Failed to update manual root.');
    const st = res.state || state;
    setState(st);
    onStateChanged && onStateChanged(st);
  }, [safeCall, state, onStateChanged]);

  const setManualRootInterval = useCallback(async (rootId, intervalMs) => {
    setError(null);
    const res = await safeCall(() =>
      window.electronAPI.indexerSetManualRootInterval?.(rootId, intervalMs)
    );
    if (!res) return;
    if (!res.ok) return setError(res.error || 'Failed to update manual root interval.');
    const st = res.state || state;
    setState(st);
    onStateChanged && onStateChanged(st);
  }, [safeCall, state, onStateChanged]);

  const removeManualRoot = useCallback(async (rootId) => {
    setError(null);
    const res = await safeCall(() =>
      window.electronAPI.indexerRemoveManualRoot?.(rootId)
    );
    if (!res) return;
    if (!res.ok) return setError(res.error || 'Failed to remove manual root.');
    const st = res.state || state;
    setState(st);
    onStateChanged && onStateChanged(st);
  }, [safeCall, state, onStateChanged]);

  // --- Derived rows ---
  const driveRows = useMemo(() => {
    return (state.drives || []).map((d, idx) => ({
      id: d.volume_uuid || d.id || idx,
      ...d
    }));
  }, [state.drives]);

  const rootRows = useMemo(() => {
    return (state.roots || []).map((r, idx) => ({
      id: r.id || r.path || idx,
      ...r
    }));
  }, [state.roots]);

  // --- Columns ---
  const driveColumns = useMemo(() => ([
    {
      field: 'is_active',
      headerName: 'Active',
      width: 90,
      sortable: false,
      renderCell: (params) => (
        <Switch
          checked={!!params.row.is_active}
          size="small"
          onChange={(e) => setVolumeActive(params.row.volume_uuid, e.target.checked)}
        />
      )
    },
    { field: 'volume_name', headerName: 'Name', flex: 1, minWidth: 180 },
    {
      field: 'mount_point_last',
      headerName: 'Mount',
      flex: 1.1,
      minWidth: 220
    },
    {
      field: 'size_bytes',
      headerName: 'Size',
      width: 120,
      valueGetter: (p) => formatBytes(p.row.size_bytes)
    },
    {
      field: 'last_scan_at',
      headerName: 'Last Scan',
      width: 180,
      valueGetter: (p) => formatDateTime(p.row.last_scan_at)
    },
    {
      field: 'last_run_status',
      headerName: 'Last Result',
      width: 130,
      renderCell: (p) => <ResultChip status={p.row.last_run_status} />
    },
    {
      field: 'last_run_duration_ms',
      headerName: 'Duration',
      width: 110,
      valueGetter: (p) => formatDuration(p.row.last_run_duration_ms)
    },
    {
      field: 'scan_interval_ms',
      headerName: 'Interval',
      width: 160,
      renderCell: (params) => (
        <Button
          size="small"
          variant="outlined"
          onClick={async (e) => {
            e.stopPropagation();
            const current = params.row.scan_interval_ms ?? DEFAULT_INTERVAL;
            const idx = Math.max(0, INTERVAL_OPTIONS.findIndex((o) => o.value === current));
            const next = INTERVAL_OPTIONS[(idx + 1) % INTERVAL_OPTIONS.length].value;
            await setVolumeInterval(params.row.volume_uuid, next);
          }}
        >
          {intervalLabel(params.row.scan_interval_ms ?? DEFAULT_INTERVAL)}
        </Button>
      )
    },
    {
      field: 'volume_uuid',
      headerName: 'Volume UUID',
      width: 240
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 140,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh">
            <span>
              <IconButton size="small" onClick={loadIndexerState}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Reveal in Finder">
            <span>
              <IconButton
                size="small"
                disabled={!window.electronAPI.openInFinder || !params.row.mount_point_last}
                onClick={async (e) => {
                  e.stopPropagation();
                  await window.electronAPI.openInFinder?.(params.row.mount_point_last);
                }}
              >
                <FolderOpenIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      )
    }
  ]), [setVolumeActive, setVolumeInterval, loadIndexerState]);

  const rootColumns = useMemo(() => ([
    {
      field: 'is_active',
      headerName: 'Active',
      width: 90,
      sortable: false,
      renderCell: (params) => (
        <Switch
          checked={!!params.row.is_active}
          size="small"
          onChange={(e) => setManualRootActive(params.row.id, e.target.checked)}
        />
      )
    },
    { field: 'label', headerName: 'Label', width: 160, valueGetter: (p) => p.row.label || '—' },
    { field: 'path', headerName: 'Path', flex: 1.8, minWidth: 320 },
    {
      field: 'scan_interval_ms',
      headerName: 'Interval',
      width: 160,
      renderCell: (params) => (
        <Button
          size="small"
          variant="outlined"
          onClick={async (e) => {
            e.stopPropagation();
            const current = params.row.scan_interval_ms ?? DEFAULT_INTERVAL;
            const idx = Math.max(0, INTERVAL_OPTIONS.findIndex((o) => o.value === current));
            const next = INTERVAL_OPTIONS[(idx + 1) % INTERVAL_OPTIONS.length].value;
            await setManualRootInterval(params.row.id, next);
          }}
        >
          {intervalLabel(params.row.scan_interval_ms ?? DEFAULT_INTERVAL)}
        </Button>
      )
    },
    {
      field: 'last_scan_at',
      headerName: 'Last Scan',
      width: 180,
      valueGetter: (p) => formatDateTime(p.row.last_scan_at)
    },
    {
      field: 'last_run_status',
      headerName: 'Last Result',
      width: 130,
      renderCell: (p) => <ResultChip status={p.row.last_run_status} />
    },
    {
      field: 'last_run_duration_ms',
      headerName: 'Duration',
      width: 110,
      valueGetter: (p) => formatDuration(p.row.last_run_duration_ms)
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 140,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Tooltip title="Remove">
            <span>
              <IconButton
                size="small"
                onClick={async (e) => {
                  e.stopPropagation();
                  await removeManualRoot(params.row.id);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      )
    }
  ]), [setManualRootActive, setManualRootInterval, removeManualRoot]);

  // --- Panes ---
  const ServicePane = () => (
    <Stack spacing={2} sx={{ pt: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1">Background Service</Typography>
        <Tooltip title="Refresh">
          <span>
            <IconButton size="small" onClick={loadServiceStatus}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {!serviceStatus ? (
        <Alert severity="info">Service status not loaded yet.</Alert>
      ) : serviceStatus.ok === false ? (
        <Alert severity="error">{serviceStatus.error || 'Failed to read service status.'}</Alert>
      ) : serviceStatus.loaded ? (
        <Alert severity="success">Service is installed and loaded (running in background).</Alert>
      ) : (
        <Alert severity="warning">Service not installed (indexing runs only while app is open).</Alert>
      )}

      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          disabled={!window.electronAPI.indexerServiceInstall}
          onClick={() => doServiceAction(window.electronAPI.indexerServiceInstall)}
        >
          Install
        </Button>
        <Button
          variant="outlined"
          disabled={!window.electronAPI.indexerServiceRestart || !serviceStatus?.loaded}
          onClick={() => doServiceAction(window.electronAPI.indexerServiceRestart)}
        >
          Restart
        </Button>
        <Button
          variant="outlined"
          color="warning"
          disabled={!window.electronAPI.indexerServiceUninstall}
          onClick={() => doServiceAction(window.electronAPI.indexerServiceUninstall)}
        >
          Uninstall
        </Button>
      </Stack>

      <Alert severity="info">
        Full Disk Access is required for complete indexing. (We’ll wire a one-click button to open
        the System Settings pane next.)
      </Alert>

      <Typography variant="body2" color="text.secondary">
        Logs:
        <br />
        ~/Library/Logs/m24-indexer.log
        <br />
        ~/Library/Logs/m24-indexer.err.log
      </Typography>
    </Stack>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{ sx: { height: '85vh' } }}
    >
      <DialogTitle>Indexer Settings</DialogTitle>

      <DialogContent dividers sx={{ overflow: 'hidden' }}>
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label="Service" />
            <Tab label="Drives" />
            <Tab label="Manual Roots" />
          </Tabs>
          <Divider sx={{ mb: 1 }} />

          {/* Reserved space for progress bar (no layout shift) */}
          <Box sx={{ height: 4, mb: 1 }}>
            {busyVisible ? <LinearProgress /> : null}
          </Box>

          {error && (
            <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>
              {error}
            </Alert>
          )}

          {/* Tab content fills remaining space */}
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {tab === 0 && <ServicePane />}

            {tab === 1 && (
              <Stack spacing={1} sx={{ height: '100%' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="subtitle1">Drives</Typography>
                  <IconButton size="small" onClick={loadIndexerState}>
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Stack>

                <Box sx={{ height: '100%', minHeight: 0 }}>
                  <Box sx={{ height: '100%', width: '100%' }}>
                    <DataGridPro
                      rows={driveRows}
                      columns={driveColumns}
                      disableRowSelectionOnClick
                      slots={{ toolbar: GridToolbar }}
                      slotProps={{
                        toolbar: { showQuickFilter: true, quickFilterProps: { debounceMs: 300 } }
                      }}
                      initialState={{
                        sorting: { sortModel: [{ field: 'last_scan_at', sort: 'desc' }] }
                      }}
                    />
                  </Box>
                </Box>
              </Stack>
            )}

            {tab === 2 && (
              <Stack spacing={1} sx={{ height: '100%' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="subtitle1">Manual Roots</Typography>
                  <Button size="small" variant="outlined" onClick={addManualRoot}>
                    Add Folder
                  </Button>
                </Stack>

                <Box sx={{ height: '100%', minHeight: 0 }}>
                  <Box sx={{ height: '100%', width: '100%' }}>
                    <DataGridPro
                      rows={rootRows}
                      columns={rootColumns}
                      disableRowSelectionOnClick
                      slots={{ toolbar: GridToolbar }}
                      slotProps={{
                        toolbar: { showQuickFilter: true, quickFilterProps: { debounceMs: 300 } }
                      }}
                      initialState={{
                        sorting: { sortModel: [{ field: 'last_scan_at', sort: 'desc' }] }
                      }}
                    />
                  </Box>
                </Box>
              </Stack>
            )}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}