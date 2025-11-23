// src/components/IndexerSettingsModal.js
import React, { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';

const hasElectron =
  typeof window !== 'undefined' && window.electronAPI;

function formatInterval(ms) {
  if (ms == null) return 'default';
  if (ms < 0) return 'manual only';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr`;
  const d = Math.floor(h / 24);
  return `${d} day${d !== 1 ? 's' : ''}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function formatBytes(bytes) {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

function RootFilesGrid({ rootId }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!hasElectron) return;
      try {
        setLoading(true);
        const res = await window.electronAPI.getIndexerFilesForRoot(rootId, 500);
        if (!res.ok) {
          if (mounted) setErr(res.error || 'Failed to load files for root.');
        } else {
          if (mounted) {
            const rows = (res.files || []).map((f) => ({ ...f, id: f.id }));
            setFiles(rows);
            setErr(null);
          }
        }
      } catch (e) {
        if (mounted) setErr(e.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [rootId]);

  const fileColumns = [
    { field: 'name', headerName: 'Name', flex: 1.5, minWidth: 200 },
    { field: 'ext', headerName: 'Ext', width: 80 },
    { field: 'file_type', headerName: 'Type', width: 120 },
    {
      field: 'size_bytes',
      headerName: 'Size',
      width: 120,
      valueGetter: (params) => formatBytes(params.value)
    },
    {
      field: 'last_status',
      headerName: 'Status',
      width: 100
    },
    {
      field: 'relative_path',
      headerName: 'Relative Path',
      flex: 2,
      minWidth: 250
    },
    {
      field: 'last_seen_at',
      headerName: 'Last Seen',
      width: 180,
      valueGetter: (params) => formatDate(params.value)
    }
  ];

  return (
    <Box sx={{ mt: 1 }}>
      {loading && <LinearProgress sx={{ mb: 1 }} />}
      {err && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {err}
        </Alert>
      )}
      <Box sx={{ height: 280, width: '100%' }}>
        <DataGridPro
          rows={files}
          columns={fileColumns}
          density="compact"
          disableRowSelectionOnClick
          slots={{ toolbar: GridToolbar }}
          slotProps={{
            toolbar: {
              showQuickFilter: true,
              quickFilterProps: { debounceMs: 300 }
            }
          }}
        />
      </Box>
    </Box>
  );
}

function IndexerSettingsModal({ open, onClose, onStateChanged }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [drives, setDrives] = useState([]);
  const [roots, setRoots] = useState([]);
  const [selectedRootIds, setSelectedRootIds] = useState([]);

  const loadState = async () => {
    if (!hasElectron) return;
    try {
      setLoading(true);
      const res = await window.electronAPI.getIndexerState();
      if (!res.ok) {
        setError(res.error || 'Failed to load indexer state.');
      } else {
        const state = res.state || { drives: [], roots: [] };
        setDrives(state.drives);
        setRoots(state.roots);
        setError(null);
        onStateChanged && onStateChanged(state);
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadState();
    }
  }, [open]);

  const handleAddRoot = async () => {
    if (!hasElectron || !window.electronAPI.selectDirectory) return;
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return;

    try {
      setLoading(true);
      const res = await window.electronAPI.addIndexerRoot(dir);
      if (!res.ok) {
        setError(res.error || 'Failed to add root.');
      } else {
        const state = res.state || { drives: [], roots: [] };
        setDrives(state.drives);
        setRoots(state.roots);
        setError(null);
        onStateChanged && onStateChanged(state);
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDisableSelectedRoots = async () => {
    if (!hasElectron || selectedRootIds.length === 0) return;

    try {
      setLoading(true);
      let state = { drives, roots };

      for (const id of selectedRootIds) {
        const res = await window.electronAPI.setIndexerRootActive(id, false);
        if (!res.ok) {
          setError(res.error || 'Failed to disable root.');
          break;
        } else {
          state = res.state || state;
        }
      }

      if (state) {
        setDrives(state.drives);
        setRoots(state.roots);
        setError(null);
        onStateChanged && onStateChanged(state);
      }
      setSelectedRootIds([]);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const rootsWithDriveName = roots.map((root) => {
    const drive = drives.find((d) => d.volume_uuid === root.drive_uuid);
    return {
      ...root,
      id: root.id,
      drive_name: drive?.primary_name || ''
    };
  });

  const rootColumns = [
    { field: 'root_path', headerName: 'Root Path', flex: 2, minWidth: 250 },
    { field: 'label', headerName: 'Label', flex: 1, minWidth: 160 },
    { field: 'drive_name', headerName: 'Drive', flex: 1, minWidth: 140 },
    {
      field: 'is_active',
      headerName: 'Active',
      width: 100,
      valueGetter: (params) => (params.value ? 'Yes' : 'No')
    },
    {
      field: 'deep_scan_mode',
      headerName: 'Mode',
      width: 110
    },
    {
      field: 'scan_interval_ms',
      headerName: 'Interval',
      width: 130,
      valueGetter: (params) => formatInterval(params.value)
    },
    {
      field: 'last_scan_at',
      headerName: 'Last Scan',
      width: 180,
      valueGetter: (params) => formatDate(params.value)
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 200,
      renderCell: (params) => {
        const row = params.row;
        return (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              onClick={async () => {
                if (!hasElectron) return;
                try {
                  await window.electronAPI.scanIndexerRoot(row.root_path);
                } catch (err) {
                  console.error('Scan root error:', err);
                }
              }}
            >
              Scan
            </Button>
            <Button
              size="small"
              variant="outlined"
              color={row.is_active ? 'warning' : 'success'}
              onClick={async () => {
                if (!hasElectron) return;
                try {
                  const res = await window.electronAPI.setIndexerRootActive(
                    row.id,
                    !row.is_active
                  );
                  if (!res.ok) {
                    setError(res.error || 'Failed to toggle root.');
                  } else {
                    const state = res.state || { drives: [], roots: [] };
                    setDrives(state.drives);
                    setRoots(state.roots);
                    setError(null);
                    onStateChanged && onStateChanged(state);
                  }
                } catch (e) {
                  setError(e.message || String(e));
                }
              }}
            >
              {row.is_active ? 'Disable' : 'Enable'}
            </Button>
          </Stack>
        );
      }
    }
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
    >
      <DialogTitle>Indexer Settings</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="subtitle1">Watched Roots</Typography>
            <Box>
              <Button
                variant="outlined"
                size="small"
                onClick={handleAddRoot}
                sx={{ mr: 1 }}
                disabled={loading}
              >
                Add Watch Folder
              </Button>
              <Button
                variant="outlined"
                size="small"
                color="warning"
                onClick={handleDisableSelectedRoots}
                disabled={loading || selectedRootIds.length === 0}
              >
                Disable Selected
              </Button>
            </Box>
          </Stack>

          {loading && <LinearProgress />}

          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {rootsWithDriveName.length === 0 ? (
            <Alert severity="info">
              No watched roots. External drives are added automatically, or you
              can add custom roots with "Add Watch Folder".
            </Alert>
          ) : (
            <Box sx={{ height: 420, width: '100%' }}>
              <DataGridPro
                rows={rootsWithDriveName}
                columns={rootColumns}
                checkboxSelection
                disableRowSelectionOnClick
                slots={{ toolbar: GridToolbar }}
                slotProps={{
                  toolbar: {
                    showQuickFilter: true,
                    quickFilterProps: { debounceMs: 300 }
                  }
                }}
                onRowSelectionModelChange={(sel) =>
                  setSelectedRootIds(sel)
                }
                rowSelectionModel={selectedRootIds}
                getDetailPanelContent={(params) => (
                  <Box sx={{ p: 2, bgcolor: 'background.default' }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Files in {params.row.root_path}
                    </Typography>
                    <RootFilesGrid rootId={params.row.id} />
                  </Box>
                )}
                getDetailPanelHeight={() => 320}
              />
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default IndexerSettingsModal;