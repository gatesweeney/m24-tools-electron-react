import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import Switch from '@mui/material/Switch';
import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { formatBytes, formatDuration, formatDateTime } from '../utils/formatters';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CloseIcon from '@mui/icons-material/Close';

const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

function ResultChip({ status }) {
  if (!status) return '—';
  const map = {
    success: { label: 'Success', color: 'success' },
    cancelled: { label: 'Cancelled', color: 'warning' },
    error: { label: 'Error', color: 'error' }
  };
  const cfg = map[status] || { label: status, color: 'default' };
  return (
    <Alert severity={cfg.color} sx={{ py: 0, px: 1, display: 'inline-flex' }}>
      {cfg.label}
    </Alert>
  );
}

export default function IndexerPage() {
  const navigate = useNavigate();
  const [fdaDialogOpen, setFdaDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [state, setState] = useState({ drives: [], roots: [] });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null); // { type: 'volume'|'root', id, name }
  const [accessMap, setAccessMap] = useState({});
  const [rootsAccessMap, setRootsAccessMap] = useState({});
  const [thumbCacheGb, setThumbCacheGb] = useState('10');
  const [purgeAgeDays, setPurgeAgeDays] = useState('0');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [machineFilter, setMachineFilter] = useState('All');

  const remindLater = async () => {
    const until = new Date(Date.now() + 24*60*60*1000).toISOString();
    await window.electronAPI.setIndexerSetting?.('fda_prompt_snooze_until', until);
    setFdaDialogOpen(false);
  };

  const dontAskAgain = async () => {
    await window.electronAPI.setIndexerSetting?.('fda_prompt_optout', '1');
    setFdaDialogOpen(false);
  };

  const allow = async () => {
    await window.electronAPI.openFullDiskAccess?.();
    setFdaDialogOpen(false);
  };

  const load = async () => {
    if (!hasElectron || !window.electronAPI.getIndexerState) {
      setError('Indexer requires Electron + preload APIs.');
      return;
    }
    try {
      setLoading(true);
      const res = await window.electronAPI.getIndexerState();
      if (!res.ok) setError(res.error || 'Failed to load indexer state');
      else {
        setState(res.state || { drives: [], roots: [] });
        setError(null);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    if (!window.electronAPI?.getIndexerSetting) return;
    const [cacheRes, purgeRes] = await Promise.all([
      window.electronAPI.getIndexerSetting('thumb_cache_max_gb'),
      window.electronAPI.getIndexerSetting('volume_purge_age_days')
    ]);
    setThumbCacheGb(cacheRes?.value ?? '10');
    setPurgeAgeDays(purgeRes?.value ?? '0');
    setSettingsLoaded(true);
  };

  const openConfirm = (target) => {
    setConfirmTarget(target);
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    setConfirmOpen(false);
    setConfirmTarget(null);
  };

  const doDisable = async () => {
    if (!confirmTarget) return;
    try {
      setLoading(true);
      if (confirmTarget.type === 'volume') {
        await window.electronAPI.indexerDisableVolume?.(confirmTarget.id);
      } else {
        await window.electronAPI.indexerDisableManualRoot?.(confirmTarget.id);
      }
      await load();
    } finally {
      setLoading(false);
      closeConfirm();
    }
  };

  const doDisableAndDelete = async () => {
    if (!confirmTarget) return;
    try {
      setLoading(true);
      if (confirmTarget.type === 'volume') {
        await window.electronAPI.indexerDisableAndDeleteVolumeData?.(confirmTarget.id);
      } else {
        await window.electronAPI.indexerDisableAndDeleteManualRootData?.(confirmTarget.id);
      }
      await load();
    } finally {
      setLoading(false);
      closeConfirm();
    }
  };

  useEffect(() => {
    load();
    loadSettings();
    (async () => {
      if (!window.electronAPI?.checkFullDiskAccess) return;

      // settings keys
      const OPT_OUT_KEY = 'fda_prompt_optout';
      const SNOOZE_UNTIL_KEY = 'fda_prompt_snooze_until';

      const optOut = await window.electronAPI.getIndexerSetting?.(OPT_OUT_KEY);
      if (optOut?.value === '1') return;

      const snooze = await window.electronAPI.getIndexerSetting?.(SNOOZE_UNTIL_KEY);
      const snoozeUntil = snooze?.value ? Date.parse(snooze.value) : 0;
      if (snoozeUntil && Date.now() < snoozeUntil) return;

      const res = await window.electronAPI.checkFullDiskAccess();
      if (res?.ok && res.hasFullDiskAccess === false) {
        setFdaDialogOpen(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onIndexerProgress) return;
    let refreshTimer = null;
    const unsubscribe = window.electronAPI.onIndexerProgress((data) => {
      const stage = data?.payload?.stage || data?.stage;
      if (stage === 'SCAN_DONE' || stage === 'A3_stats_end') {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
          await load();
        }, 500);
      }
    });
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !window.electronAPI?.setIndexerSetting) return;
    const t = setTimeout(() => {
      const next = thumbCacheGb && Number(thumbCacheGb) > 0 ? String(thumbCacheGb) : '0';
      window.electronAPI.setIndexerSetting('thumb_cache_max_gb', next);
    }, 400);
    return () => clearTimeout(t);
  }, [thumbCacheGb, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || !window.electronAPI?.setIndexerSetting) return;
    const t = setTimeout(() => {
      const next = purgeAgeDays && Number(purgeAgeDays) > 0 ? String(purgeAgeDays) : '0';
      window.electronAPI.setIndexerSetting('volume_purge_age_days', next);
    }, 400);
    return () => clearTimeout(t);
  }, [purgeAgeDays, settingsLoaded]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!window.electronAPI?.pathExists) return;
      const entries = await Promise.all((state.drives || []).map(async (d) => {
        if (!d.mount_point_last) return [d.volume_uuid, false];
        const res = await window.electronAPI.pathExists(d.mount_point_last);
        return [d.volume_uuid, !!res?.exists];
      }));
      if (!cancelled) {
        const map = {};
        for (const [uuid, ok] of entries) map[uuid] = ok;
        setAccessMap(map);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [state.drives]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!window.electronAPI?.pathExists) return;
      const entries = await Promise.all((state.roots || []).map(async (r) => {
        if (!r.path) return [r.id, false];
        const res = await window.electronAPI.pathExists(r.path);
        return [r.id, !!res?.exists];
      }));
      if (!cancelled) {
        const map = {};
        for (const [id, ok] of entries) map[id] = ok;
        setRootsAccessMap(map);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [state.roots]);

  const machineOptions = useMemo(() => {
    const names = new Set();
    for (const d of state.drives || []) {
      (d.seen_on || []).forEach((n) => n && names.add(n));
    }
    for (const r of state.roots || []) {
      (r.seen_on || []).forEach((n) => n && names.add(n));
    }
    return ['All', ...Array.from(names)];
  }, [state.drives, state.roots]);

  const driveRows = (state.drives || [])
    .filter((d) => machineFilter === 'All' || (d.seen_on || []).includes(machineFilter))
    .map((d, idx) => ({ id: d.volume_uuid || idx, ...d }));

  const intervalOptions = [
    { value: -1, label: 'Manual only' },
    { value: 0, label: 'On mount' },
    { value: 20 * 60 * 1000, label: 'Every 20m' },
    { value: 60 * 60 * 1000, label: 'Every 1h' },
    { value: 6 * 60 * 60 * 1000, label: 'Every 6h' },
    { value: 24 * 60 * 60 * 1000, label: 'Every 24h' }
  ];

  const columns = [
    {
      field: 'actions_scan',
      headerName: 'Scan',
      width: 120,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Tooltip title="Scan this volume now">
            <span>
              <IconButton
                size="small"
                disabled={!window.electronAPI?.scanVolumeNow || !params.row.volume_uuid}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    setLoading(true);
                    const res = await window.electronAPI.scanVolumeNow(params.row.volume_uuid);
                    if (!res?.ok) {
                      setError(res?.error || 'Failed to scan volume.');
                    } else {
                      setError(null);
                    }
                    await load();
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <PlayArrowIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Open">
            <span>
              <IconButton
                size="small"
                disabled={!accessMap[params.row.volume_uuid]}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('/detail', {
                    state: {
                      item: {
                        volume_uuid: params.row.volume_uuid,
                        root_path: params.row.mount_point_last,
                        relative_path: '',
                        name: params.row.volume_name || params.row.mount_point_last,
                        path: params.row.mount_point_last,
                        is_dir: true
                      }
                    }
                  });
                }}
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      )
    },
    { field: 'volume_name', headerName: 'Name', flex: 1, minWidth: 180 },
    {
      field: 'last_scan_at',
      headerName: 'Last Scan',
      width: 180,
      valueGetter: (p) => formatDateTime(p.row.last_scan_at)
    },
    {
      field: 'is_active',
      headerName: 'Active',
      width: 90,
      renderCell: (p) => (
        <Switch
          size="small"
          checked={!!p.row.is_active}
          onChange={async (e) => {
            const next = e.target.checked;
            await window.electronAPI.indexerSetVolumeActive(p.row.volume_uuid, next);
            await load();
          }}
        />
      )
    },
    {
      field: 'auto_purge',
      headerName: 'Auto Purge',
      width: 110,
      renderCell: (p) => (
        <Switch
          size="small"
          checked={p.row.auto_purge !== 0}
          onChange={async (e) => {
            const next = e.target.checked;
            await window.electronAPI.indexerSetVolumeAutoPurge?.(p.row.volume_uuid, next);
            await load();
          }}
        />
      )
    },
    {
      field: 'scan_interval_ms',
      headerName: 'Interval',
      width: 140,
      renderCell: (p) => (
        <FormControl size="small" fullWidth>
          <Select
            value={p.row.scan_interval_ms ?? 20 * 60 * 1000}
            onChange={async (e) => {
              await window.electronAPI.indexerSetVolumeInterval(p.row.volume_uuid, e.target.value);
              await load();
            }}
          >
            {intervalOptions.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      )
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
    { field: 'mount_point_last', headerName: 'Mount', flex: 1.2, minWidth: 220 },
    { field: 'volume_uuid', headerName: 'Volume UUID', flex: 1.2, minWidth: 260 },
    {
      field: 'seen_count',
      headerName: 'Seen',
      width: 80,
      type: 'number',
      valueGetter: (p) => p.row.seen_count ?? 1
    },
    {
      field: 'seen_on',
      headerName: 'Seen On',
      width: 200,
      valueGetter: (p) => {
        const arr = p.row.seen_on;
        if (!Array.isArray(arr) || arr.length === 0) return '—';
        const s = arr.join(', ');
        return s.length > 40 ? s.slice(0, 37) + '…' : s;
      }
    },
    {
      field: 'actions_delete',
      headerName: 'Delete',
      width: 110,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Tooltip title="Disable / Delete options">
          <span>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                openConfirm({
                  type: 'volume',
                  id: params.row.volume_uuid,
                  name: params.row.volume_name || params.row.volume_uuid
                });
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )
    }
  ];

  return (
    <Container maxWidth="xl" sx={{ pt: 4, pb: 6 }}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h4">Indexer</Typography>
            <Typography variant="body2" color="text.secondary">
              Drives + manual roots + background service controls.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <Select value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)}>
                {machineOptions.map((opt) => (
                  <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="outlined" onClick={load} sx={{ mr: 1 }} disabled={loading}>
              Refresh
            </Button>
            <Button
              variant="contained"
              onClick={async () => {
                try {
                  setLoading(true);
                  const res = await window.electronAPI.scanAllNow();
                  if (!res?.ok) {
                    setError(res?.error || 'Failed to start scan.');
                  } else {
                    setError(null);
                  }
                    await load();
                } finally {
                  setLoading(false);
                }
              }}
              sx={{ mr: 1 }}
              disabled={loading || !window.electronAPI?.scanAllNow}
            >
              Scan All Now
            </Button>
          </Stack>
        </Stack>

        {loading && <LinearProgress />}
        {error && <Alert severity="error">{error}</Alert>}

        <Box sx={{ height: 520, width: '100%', bgcolor: 'background.paper', borderRadius: 2 }}>
          <DataGridPro
            rows={driveRows}
            columns={columns}
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

        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
          <Typography variant="h6">Manual Folders</Typography>
          <Button
            variant="outlined"
            onClick={async () => {
              try {
                if (!window.electronAPI?.selectDirectory || !window.electronAPI?.indexerAddManualRoot) {
                  setError('Missing IPC: selectDirectory + indexerAddManualRoot');
                  return;
                }
                const dir = await window.electronAPI.selectDirectory();
                if (!dir) return;
                const res = await window.electronAPI.indexerAddManualRoot(dir);
                if (!res?.ok) {
                  setError(res?.error || 'Failed to add manual folder.');
                  return;
                }
                setError(null);
                await load();
              } catch (e) {
                setError(e.message || String(e));
              }
            }}
          >
            Add Folder
          </Button>
        </Stack>
        <Box sx={{ height: 320, width: '100%', bgcolor: 'background.paper', borderRadius: 2 }}>
          <DataGridPro
            rows={(state.roots || [])
              .filter((r) => machineFilter === 'All' || (r.seen_on || []).includes(machineFilter))
              .map((r, idx) => ({ id: r.id || r.path || idx, ...r }))}
            columns={[
              {
                field: 'actions_scan',
                headerName: 'Scan',
                width: 120,
                renderCell: (params) => (
                  <Stack direction="row" spacing={1}>
                    <Tooltip title="Scan this root now">
                      <IconButton
                        size="small"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            setLoading(true);
                            const res = await window.electronAPI.scanManualRootNow?.(params.row.id);
                            if (!res?.ok) {
                              setError(res?.error || 'Failed to scan folder.');
                            } else {
                              setError(null);
                            }
                            await load();
                          } finally {
                            setLoading(false);
                          }
                        }}
                      >
                        <PlayArrowIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Open">
                      <span>
                        <IconButton
                          size="small"
                          disabled={!rootsAccessMap[params.row.id]}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate('/detail', {
                              state: {
                                item: {
                                  volume_uuid: `manual:${params.row.id}`,
                                  root_path: params.row.path,
                                  relative_path: '',
                                  name: params.row.label || params.row.path,
                                  path: params.row.path,
                                  is_dir: true
                                }
                              }
                            });
                          }}
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                )
              },
              { field: 'label', headerName: 'Label', width: 160, valueGetter: (p) => p.row.label || '—' },
              { field: 'last_scan_at', headerName: 'Last Scan', width: 180, valueGetter: (p) => formatDateTime(p.row.last_scan_at) },
              {
                field: 'is_active',
                headerName: 'Active',
                width: 90,
                renderCell: (p) => (
                  <Switch
                    size="small"
                    checked={!!p.row.is_active}
                    onChange={async (e) => {
                      const next = e.target.checked;
                      await window.electronAPI.indexerSetManualRootActive?.(p.row.id, next);
                      await load();
                    }}
                  />
                )
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
              { field: 'path', headerName: 'Path', flex: 1, minWidth: 320 },
              {
                field: 'scan_interval_ms',
                headerName: 'Interval',
                width: 140,
                renderCell: (p) => (
                  <FormControl size="small" fullWidth>
                    <Select
                      value={p.row.scan_interval_ms ?? 20 * 60 * 1000}
                      onChange={async (e) => {
                        await window.electronAPI.indexerSetManualRootInterval?.(p.row.id, e.target.value);
                        await load();
                      }}
                    >
                      {intervalOptions.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )
              },
              {
                field: 'seen_count',
                headerName: 'Seen',
                width: 80,
                type: 'number',
                valueGetter: (p) => p.row.seen_count ?? 1
              },
              {
                field: 'seen_on',
                headerName: 'Seen On',
                width: 200,
                valueGetter: (p) => {
                  const arr = p.row.seen_on;
                  if (!Array.isArray(arr) || arr.length === 0) return '—';
                  const s = arr.join(', ');
                  return s.length > 40 ? s.slice(0, 37) + '…' : s;
                }
              },
              { field: 'file_count', headerName: 'Files', width: 90, type: 'number' },
              { field: 'dir_count', headerName: 'Dirs', width: 90, type: 'number' },
              { field: 'total_bytes', headerName: 'Bytes', width: 140, valueGetter: (p) => formatBytes(p.row.total_bytes) },
              {
                field: 'actions_delete',
                headerName: 'Delete',
                width: 110,
                renderCell: (params) => (
                  <Tooltip title="Disable / Delete options">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        openConfirm({
                          type: 'root',
                          id: params.row.id,
                          name: params.row.label || params.row.path
                        });
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )
              }
            ]}
            disableRowSelectionOnClick
            slots={{ toolbar: GridToolbar }}
          />
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Cache & Retention</Typography>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap' }}>
            <TextField
              label="Thumbnail cache max (GB)"
              type="number"
              size="small"
              value={thumbCacheGb}
              onChange={(e) => setThumbCacheGb(e.target.value)}
              inputProps={{ min: 0, step: 1 }}
              sx={{ width: 220 }}
            />
            <TextField
              label="Volume purge age (days)"
              type="number"
              size="small"
              value={purgeAgeDays}
              onChange={(e) => setPurgeAgeDays(e.target.value)}
              inputProps={{ min: 0, step: 1 }}
              helperText="0 disables auto purge"
              sx={{ width: 220 }}
            />
          </Stack>
        </Box>

        <Dialog open={fdaDialogOpen} onClose={() => setFdaDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Full Disk Access</DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2" color="text.secondary" paragraph>
              Full Disk Access is recommended so M24 Tools can index all folders and external drives reliably.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              You can enable it in System Settings → Privacy & Security → Full Disk Access. Click the + button at the bottom and add M24 Tools. Restart the app after enabling.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" onClick={dontAskAgain}>
              Don't ask again
            </Button>
            <Button variant="outlined" onClick={remindLater}>
              Remind me later
            </Button>
            <Button variant="contained" onClick={allow}>
              Open Settings
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={confirmOpen} onClose={closeConfirm} maxWidth="sm" fullWidth>
          <DialogTitle>Remove from scanning</DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2" color="text.secondary">
              {confirmTarget
                ? `What do you want to do with: ${confirmTarget.name}?`
                : 'Select an item.'}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeConfirm}>Close</Button>
            <Button
              variant="outlined"
              color="warning"
              onClick={doDisable}
              disabled={!confirmTarget}
            >
              Disable
            </Button>
            <Button
              variant="contained"
              color="error"
              onClick={doDisableAndDelete}
              disabled={!confirmTarget}
            >
              Disable + Delete Data
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </Container>
  );
}
