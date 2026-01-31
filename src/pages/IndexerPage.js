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
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined';
import EjectOutlinedIcon from '@mui/icons-material/EjectOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import Menu from '@mui/material/Menu';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import Chip from '@mui/material/Chip';
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

function ActionMenu({ items, disabled }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <IconButton
        size="small"
        disabled={disabled}
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {items.map((item) => (
          <MenuItem
            key={item.key}
            onClick={() => {
              setAnchorEl(null);
              item.onClick();
            }}
            disabled={item.disabled}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
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
  const [machineFilter, setMachineFilter] = useState([]);
  const [apiTokenDialogOpen, setApiTokenDialogOpen] = useState(false);
  const [apiTokenValue, setApiTokenValue] = useState('');
  const [apiTokenChecked, setApiTokenChecked] = useState(false);
  const [apiStatus, setApiStatus] = useState({ label: 'API Unknown', color: 'default' });
  const [localMachineId, setLocalMachineId] = useState(null);

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
      setApiStatus({ label: 'API Checking', color: 'warning' });
      const res = await window.electronAPI.getIndexerState();
      if (!res.ok) {
        setError(res.error || 'Failed to load indexer state');
        setApiStatus({ label: 'API Error', color: 'error' });
      } else {
        const nextState = res.state || { drives: [], roots: [] };
        const roots = Array.isArray(nextState.roots) ? nextState.roots : [];
        const updatedRoots = await Promise.all(roots.map(async (r) => {
          const rawId = r?.root_id ?? r?.id ?? null;
          const isNumeric = typeof rawId === 'number' || (typeof rawId === 'string' && /^\d+$/.test(rawId));
          if (isNumeric) return { ...r, __rootId: String(rawId) };
          if (r?.device_id && localMachineId && r.device_id !== localMachineId) {
            return { ...r, __rootId: rawId };
          }
          if (window.electronAPI?.normalizeManualRootId && r?.path) {
            const normalized = await window.electronAPI.normalizeManualRootId(r.path);
            return { ...r, __rootId: normalized?.id || rawId };
          }
          return { ...r, __rootId: rawId };
        }));
        nextState.roots = updatedRoots;
        setState(nextState);
        setError(null);
        setApiStatus({ label: 'API Connected', color: 'success' });
      }
    } catch (e) {
      setError(e.message || String(e));
      setApiStatus({ label: 'API Error', color: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    if (!window.electronAPI?.getIndexerSetting) return;
    const [cacheRes, purgeRes, machineRes] = await Promise.all([
      window.electronAPI.getIndexerSetting('thumb_cache_max_gb'),
      window.electronAPI.getIndexerSetting('volume_purge_age_days'),
      window.electronAPI.getIndexerSetting('machine_id')
    ]);
    setThumbCacheGb(cacheRes?.value ?? '10');
    setPurgeAgeDays(purgeRes?.value ?? '0');
    setLocalMachineId(machineRes?.value ?? null);
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
        const res = await window.electronAPI.indexerDisableVolume?.(confirmTarget.id, confirmTarget.deviceId);
        if (res && res.ok === false) {
          setError(res.error || 'Failed to disable volume.');
          return;
        }
      } else {
        const res = await window.electronAPI.indexerDisableManualRoot?.(confirmTarget.id, confirmTarget.deviceId);
        if (res && res.ok === false) {
          setError(res.error || 'Failed to disable manual root.');
          return;
        }
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
        const res = await window.electronAPI.indexerDisableAndDeleteVolumeData?.(confirmTarget.id, confirmTarget.deviceId);
        if (res && res.ok === false) {
          setError(res.error || 'Failed to disable volume data.');
          return;
        }
      } else {
        const res = await window.electronAPI.indexerDisableAndDeleteManualRootData?.(confirmTarget.id, confirmTarget.deviceId);
        if (res && res.ok === false) {
          setError(res.error || 'Failed to disable manual root data.');
          return;
        }
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
    if (!settingsLoaded || apiTokenChecked) return;
    const run = async () => {
      if (!window.electronAPI?.getIndexerSetting) return;
      const res = await window.electronAPI.getIndexerSetting('remote_api_token');
      const token = (res?.value || '').trim();
      if (!token) {
        setApiTokenDialogOpen(true);
      } else {
        setApiTokenValue(token);
      }
      setApiTokenChecked(true);
    };
    run();
  }, [settingsLoaded, apiTokenChecked]);

  const saveApiToken = async () => {
    const next = apiTokenValue.trim();
    if (!next || !window.electronAPI?.setIndexerSetting) return;
    await window.electronAPI.setIndexerSetting('remote_api_token', next);
    setApiTokenDialogOpen(false);
  };

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
        const key = r.__rootId || r.root_id || r.id;
        if (!r.path) return [key, false];
        if (localMachineId && r.device_id && r.device_id === localMachineId) {
          return [key, true];
        }
        const res = await window.electronAPI.pathExists(r.path);
        return [key, !!res?.exists];
      }));
      if (!cancelled) {
        const map = {};
        for (const [id, ok] of entries) map[id] = ok;
        setRootsAccessMap(map);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [state.roots, localMachineId]);

  const machineOptions = useMemo(() => {
    const options = [];
    const fromDevices = Array.isArray(state.devices) ? state.devices : [];
    if (fromDevices.length > 0) {
      for (const d of fromDevices) {
        if (!d?.deviceId) continue;
        options.push({ id: d.deviceId, label: d.name || d.deviceId });
      }
      return options;
    }

    const ids = new Map();
    for (const d of state.drives || []) {
      if (d.device_id) ids.set(d.device_id, d.device_id);
    }
    for (const r of state.roots || []) {
      if (r.device_id) ids.set(r.device_id, r.device_id);
    }
    return Array.from(ids.keys()).map((id) => ({ id, label: id }));
  }, [state.devices, state.drives, state.roots]);

  const machineLabelById = useMemo(() => {
    const map = new Map();
    machineOptions.forEach((opt) => map.set(opt.id, opt.label));
    return map;
  }, [machineOptions]);

  const openShareModal = (paths, label) => {
    navigate('/transfers', {
      state: {
        openShareModal: true,
        sharePaths: paths,
        shareLabel: label
      }
    });
  };

  const driveRows = (state.drives || [])
    .filter((d) => machineFilter.length === 0 || machineFilter.includes(d.device_id))
    .map((d, idx) => {
      const baseId = d.volume_uuid || d.id || idx;
      return { ...d, id: `${d.device_id || 'unknown'}::${baseId}` };
    });

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
      field: 'actions',
      headerName: '',
      width: 64,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <ActionMenu
            items={[
              {
                key: 'scan',
                label: 'Scan now',
                icon: <PlayArrowIcon fontSize="small" />,
                disabled: !window.electronAPI?.scanVolumeNow || !params.row.volume_uuid || !accessMap[params.row.volume_uuid],
                onClick: async () => {
                  try {
                    setLoading(true);
                    const res = await window.electronAPI.scanVolumeNow(params.row.volume_uuid);
                    if (!res?.ok) setError(res?.error || 'Failed to scan volume.');
                    else setError(null);
                    await load();
                  } finally {
                    setLoading(false);
                  }
                }
              },
              {
                key: 'thumbs',
                label: 'Generate thumbnails',
                icon: <PhotoLibraryOutlinedIcon fontSize="small" />,
                disabled: !window.electronAPI?.scanVolumeWithThumbs || !params.row.volume_uuid || !accessMap[params.row.volume_uuid],
                onClick: async () => {
                  try {
                    setLoading(true);
                    const res = await window.electronAPI.scanVolumeWithThumbs(params.row.volume_uuid);
                    if (!res?.ok) setError(res?.error || 'Failed to start thumbnail scan.');
                    else setError(null);
                    await load();
                  } finally {
                    setLoading(false);
                  }
                }
              },
              {
                key: 'eject',
                label: 'Eject volume',
                icon: <EjectOutlinedIcon fontSize="small" />,
                disabled: !window.electronAPI?.ejectVolume || !accessMap[params.row.volume_uuid],
                onClick: async () => {
                  try {
                    setLoading(true);
                    const res = await window.electronAPI.ejectVolume(params.row.volume_uuid);
                    if (!res?.ok) setError(res?.error || 'Failed to eject volume.');
                    else setError(null);
                    await load();
                  } finally {
                    setLoading(false);
                  }
                }
              },
              {
                key: 'details',
                label: 'Open details',
                icon: <InfoOutlinedIcon fontSize="small" />,
                disabled: false,
                onClick: () => {
                  navigate('/detail', {
                  state: {
                    item: {
                      volume_uuid: params.row.volume_uuid,
                      root_path: params.row.mount_point_last,
                      relative_path: '',
                      name: params.row.volume_name || params.row.mount_point_last,
                      path: params.row.mount_point_last,
                      device_id: params.row.device_id,
                      is_dir: true
                    }
                  }
                });
                }
              },
              {
                key: 'share',
                label: 'Share…',
                icon: <ShareOutlinedIcon fontSize="small" />,
                disabled: !params.row.mount_point_last,
                onClick: () => {
                  const path = params.row.mount_point_last;
                  const label = params.row.volume_name || path;
                  openShareModal([path], label);
                }
              },
              {
                key: 'delete',
                label: 'Disable / Delete…',
                icon: <DeleteOutlineIcon fontSize="small" />,
                disabled: false,
                onClick: () => {
                  openConfirm({
                    type: 'volume',
                    id: params.row.volume_uuid,
                    name: params.row.volume_name || params.row.volume_uuid,
                    deviceId: params.row.device_id
                  });
                }
              }
            ]}
          />
          {accessMap[params.row.volume_uuid] ? (
            <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
          ) : null}
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
            await window.electronAPI.indexerSetVolumeActive(p.row.volume_uuid, next, p.row.device_id);
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
          checked={!!p.row.auto_purge}
          onChange={async (e) => {
            const next = e.target.checked;
            await window.electronAPI.indexerSetVolumeAutoPurge?.(p.row.volume_uuid, next, p.row.device_id);
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
              await window.electronAPI.indexerSetVolumeInterval(p.row.volume_uuid, e.target.value, p.row.device_id);
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
    { field: 'mount_point_last', headerName: 'Mount', flex: 1.2, minWidth: 220 },
    { field: 'volume_uuid', headerName: 'Volume UUID', flex: 1.2, minWidth: 260 },
 
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
            <Chip size="small" label={apiStatus.label} color={apiStatus.color} />
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <Select
                multiple
                displayEmpty
                value={machineFilter}
                onChange={(e) => setMachineFilter(e.target.value)}
                renderValue={(selected) => {
                  if (!selected || selected.length === 0) return 'All Machines';
                  return selected.map((id) => machineLabelById.get(id) || id).join(', ');
                }}
              >
                {machineOptions.map((opt) => (
                  <MenuItem key={opt.id} value={opt.id}>
                    <Checkbox size="small" checked={machineFilter.includes(opt.id)} />
                    <ListItemText primary={opt.label} />
                  </MenuItem>
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

        {loading && (
          <Box
            sx={{
              position: 'fixed',
              top: (theme) => `calc(${theme.mixins.toolbar.minHeight || 48}px + ${theme.spacing(2)})`,
              left: 0,
              right: 0,
              zIndex: (theme) => theme.zIndex.snackbar + 1
            }}
          >
            <LinearProgress />
          </Box>
        )}
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
              .filter((r) => machineFilter.length === 0 || machineFilter.includes(r.device_id))
              .map((r, idx) => ({ ...r, id: r.__rootId || r.id || r.path || idx }))}
            columns={[
              {
                field: 'actions',
                headerName: '',
                width: 64,
                renderCell: (params) => (
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <ActionMenu
                      items={[
                        {
                          key: 'scan',
                          label: 'Scan now',
                          icon: <PlayArrowIcon fontSize="small" />,
                          disabled: !window.electronAPI?.scanManualRootNow || !(params.row.__rootId || params.row.root_id || params.row.id) || !rootsAccessMap[params.row.__rootId || params.row.root_id || params.row.id],
                          onClick: async () => {
                            try {
                              setLoading(true);
                              const rootId = params.row.__rootId || params.row.root_id || params.row.id;
                              if (!rootId) return;
                              const res = await window.electronAPI.scanManualRootNow?.(rootId);
                              if (!res?.ok) setError(res?.error || 'Failed to scan folder.');
                              else setError(null);
                              await load();
                            } finally {
                              setLoading(false);
                            }
                          }
                        },
                        {
                          key: 'thumbs',
                          label: 'Generate thumbnails',
                          icon: <PhotoLibraryOutlinedIcon fontSize="small" />,
                          disabled: !window.electronAPI?.scanManualRootWithThumbs || !(params.row.__rootId || params.row.root_id || params.row.id) || !rootsAccessMap[params.row.__rootId || params.row.root_id || params.row.id],
                          onClick: async () => {
                            try {
                              setLoading(true);
                              const rootId = params.row.__rootId || params.row.root_id || params.row.id;
                              if (!rootId) return;
                              const res = await window.electronAPI.scanManualRootWithThumbs(rootId);
                              if (!res?.ok) setError(res?.error || 'Failed to start thumbnail scan.');
                              else setError(null);
                              await load();
                            } finally {
                              setLoading(false);
                            }
                          }
                        },
                        {
                          key: 'details',
                          label: 'Open details',
                          icon: <InfoOutlinedIcon fontSize="small" />,
                          disabled: false,
                          onClick: () => {
                            navigate('/detail', {
                              state: {
                              item: {
                                volume_uuid: `manual:${params.row.__rootId || params.row.root_id || params.row.id}`,
                                root_path: params.row.path,
                                relative_path: '',
                                name: params.row.label || params.row.path,
                                path: params.row.path,
                                device_id: params.row.device_id,
                                is_dir: true
                              }
                            }
                          });
                          }
                        },
                        {
                          key: 'share',
                          label: 'Share…',
                          icon: <ShareOutlinedIcon fontSize="small" />,
                          disabled: !params.row.path,
                          onClick: () => {
                            const path = params.row.path;
                            const label = params.row.label || path;
                            openShareModal([path], label);
                          }
                        },
                        {
                          key: 'delete',
                          label: 'Disable / Delete…',
                          icon: <DeleteOutlineIcon fontSize="small" />,
                          disabled: false,
                          onClick: () => {
                            openConfirm({
                              type: 'root',
                              id: params.row.__rootId || params.row.root_id || params.row.id,
                              name: params.row.label || params.row.path,
                              deviceId: params.row.device_id
                            });
                          }
                        }
                      ]}
                    />
                    {rootsAccessMap[params.row.__rootId] ? (
                      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
                    ) : null}
                  </Stack>
                )
              },
              { field: 'label', headerName: 'Name', flex: 1, minWidth: 180, valueGetter: (p) => p.row.label || p.row.path || '—' },
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
                      const rootId = p.row.__rootId || p.row.root_id || p.row.id;
                      if (!rootId) return;
                      await window.electronAPI.indexerSetManualRootActive?.(rootId, next, p.row.device_id);
                      await load();
                    }}
                  />
                )
              },
              {
                field: 'auto_purge',
                headerName: 'Auto Purge',
                width: 110,
                renderCell: (p) => {
                  if (p.row.auto_purge == null) {
                    return <Typography variant="body2" color="text.secondary">—</Typography>;
                  }
                  return (
                    <Switch
                      size="small"
                      checked={!!p.row.auto_purge}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        const rootId = p.row.__rootId || p.row.root_id || p.row.id;
                        if (!rootId) return;
                        await window.electronAPI.indexerSetManualRootAutoPurge?.(rootId, next, p.row.device_id);
                        await load();
                      }}
                    />
                  );
                }
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
                        const rootId = p.row.__rootId || p.row.root_id || p.row.id;
                        if (!rootId) return;
                        await window.electronAPI.indexerSetManualRootInterval?.(rootId, e.target.value, p.row.device_id);
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
              { field: 'path', headerName: 'Path', flex: 1.2, minWidth: 220 },
              { field: 'id', headerName: 'Root ID', flex: 1.2, minWidth: 200 },
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
        <Dialog open={apiTokenDialogOpen} onClose={() => setApiTokenDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Enter Remote API Token</DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Add the token for the relay server so this indexer can read and write the shared database.
            </Typography>
            <TextField
              autoFocus
              fullWidth
              label="API Token"
              type="password"
              value={apiTokenValue}
              onChange={(event) => setApiTokenValue(event.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setApiTokenDialogOpen(false)}>Later</Button>
            <Button variant="contained" onClick={saveApiToken} disabled={!apiTokenValue.trim()}>
              Save Token
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </Container>
  );
}
