import React, { useEffect, useState } from 'react';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import IndexerSettingsModal from '../components/IndexerSettingsModal';
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [state, setState] = useState({ drives: [], roots: [] });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null); // { type: 'volume'|'root', id, name }

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
  }, []);

  const driveRows = (state.drives || []).map((d, idx) => ({ id: d.volume_uuid || idx, ...d }));

  const columns = [
    { field: 'volume_name', headerName: 'Name', flex: 1, minWidth: 180 },
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
      field: 'is_active',
      headerName: 'Active',
      width: 90,
      valueGetter: (p) => (p.row.is_active ? 'Yes' : 'No')
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
                    await window.electronAPI.scanVolumeNow(params.row.volume_uuid);
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
        </Stack>
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
          <Box>
            <Button variant="outlined" onClick={load} sx={{ mr: 1 }} disabled={loading}>
              Refresh
            </Button>
            <Button
              variant="contained"
              onClick={async () => {
                try {
                  setLoading(true);
                  await window.electronAPI.scanAllNow();
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
            <Button variant="contained" onClick={() => setSettingsOpen(true)}>
              Settings
            </Button>
          </Box>
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

        <Box sx={{ height: 320, width: '100%', bgcolor: 'background.paper', borderRadius: 2 }}>
        <DataGridPro
            rows={(state.roots || []).map((r, idx) => ({ id: r.id || r.path || idx, ...r }))}
            columns={[
            { field: 'label', headerName: 'Label', width: 160, valueGetter: (p) => p.row.label || '—' },
            { field: 'path', headerName: 'Path', flex: 1, minWidth: 320 },
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
            { field: 'is_active', headerName: 'Active', width: 90, valueGetter: (p) => (p.row.is_active ? 'Yes' : 'No') },
            { field: 'file_count', headerName: 'Files', width: 90, type: 'number' },
            { field: 'dir_count', headerName: 'Dirs', width: 90, type: 'number' },
            { field: 'total_bytes', headerName: 'Bytes', width: 140, valueGetter: (p) => formatBytes(p.row.total_bytes) },
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
            { field: 'scan_interval_ms', headerName: 'Interval', width: 140 },
            { field: 'last_scan_at', headerName: 'Last Scan', width: 180, valueGetter: (p) => formatDateTime(p.row.last_scan_at) },
            {
              field: 'actions',
              headerName: 'Actions',
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
                          await window.electronAPI.scanManualRootNow?.(params.row.id);
                          await load();
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      <PlayArrowIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>

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
                </Stack>
              )
            }
            ]}
            disableRowSelectionOnClick
            slots={{ toolbar: GridToolbar }}
        />
        </Box>

        <IndexerSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onStateChanged={(st) => setState(st)}
        />

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