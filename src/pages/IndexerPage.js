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

const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${sizes[i]}`;
}

export default function IndexerPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [state, setState] = useState({ drives: [], roots: [] });

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

  useEffect(() => {
    load();
  }, []);

  const driveRows = (state.drives || []).map((d, idx) => ({ id: d.volume_uuid || idx, ...d }));

  const columns = [
    { field: 'volume_name', headerName: 'Name', flex: 1, minWidth: 180 },
    { field: 'mount_point_last', headerName: 'Mount', flex: 1.2, minWidth: 220 },
    { field: 'volume_uuid', headerName: 'Volume UUID', flex: 1.2, minWidth: 260 },
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
      valueGetter: (p) => formatDate(p.row.last_scan_at)
    }
    ,
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Tooltip title="Scan this volume now">
          <span>
            <IconButton
              size="small"
              disabled={!window.electronAPI?.scanIndexerRoot || !params.row.mount_point_last}
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  setLoading(true);
                  await window.electronAPI.scanIndexerRoot(params.row.mount_point_last);
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
              disabled={loading || !window.electronAPI?.scanIndexerRoot}
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
            { field: 'is_active', headerName: 'Active', width: 90, valueGetter: (p) => (p.row.is_active ? 'Yes' : 'No') },
            { field: 'file_count', headerName: 'Files', width: 90, type: 'number' },
            { field: 'dir_count', headerName: 'Dirs', width: 90, type: 'number' },
            { field: 'total_bytes', headerName: 'Bytes', width: 140, valueGetter: (p) => formatBytes(p.row.total_bytes) },
            { field: 'scan_interval_ms', headerName: 'Interval', width: 140 },
            { field: 'last_scan_at', headerName: 'Last Scan', width: 180, valueGetter: (p) => formatDate(p.row.last_scan_at) }
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
      </Stack>
    </Container>
  );
}