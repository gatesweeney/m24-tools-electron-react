// src/pages/IndexerPage.js
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

const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

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

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

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

function IndexerPage() {
  const [state, setState] = useState({ drives: [], roots: [] });
  const [loading, setLoading] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanProgress, setScanProgress] = useState(null);
  const [error, setError] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadState = async () => {
    if (!hasElectron) {
      setError('Indexer UI only works in the Electron app.');
      return;
    }
    try {
      setError(null);
      setLoading(true);
      const res = await window.electronAPI.getIndexerState();
      if (!res.ok) {
        setError(res.error || 'Failed to load indexer state.');
      } else {
        setState(res.state || { drives: [], roots: [] });
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    if (!hasElectron || !window.electronAPI.onIndexerScanProgress) return;

    const unsubscribe = window.electronAPI.onIndexerScanProgress((payload) => {
      setScanProgress(payload);
    });

    return () => unsubscribe && unsubscribe();
  }, []);

  const handleScanAll = async () => {
    if (!hasElectron) return;
    try {
      setScanBusy(true);
      setError(null);
      await window.electronAPI.scanIndexerRoot(null);
      await loadState();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setScanBusy(false);
    }
  };

  const renderScanStatus = () => {
    if (!scanProgress) return null;

    const { stage, totalRoots, index, rootPath, error: errMsg } = scanProgress;

    let message = '';
    let value = undefined;

    if (stage === 'startCycle') {
      message = 'Starting scan…';
    } else if (stage === 'rootsLoaded') {
      if (totalRoots === 0) message = 'No roots to scan.';
      else message = `Preparing to scan ${totalRoots} root(s)…`;
    } else if (stage === 'rootStart') {
      if (totalRoots && index) {
        const pct = Math.round(((index - 1) / totalRoots) * 100);
        value = pct;
        message = `Scanning ${index} of ${totalRoots}: ${rootPath}`;
      } else {
        message = `Scanning: ${rootPath}`;
      }
    } else if (stage === 'rootEnd') {
      if (totalRoots && index) {
        const pct = Math.round((index / totalRoots) * 100);
        value = pct;
        message = `Finished ${index} of ${totalRoots}: ${rootPath}`;
      } else {
        message = `Finished: ${rootPath}`;
      }
    } else if (stage === 'rootError') {
      message = `Error scanning ${rootPath}: ${errMsg}`;
    } else if (stage === 'endCycle') {
      message = 'Scan complete.';
      value = 100;
    }

    return (
      <Box sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          {message}
        </Typography>
        <LinearProgress
          variant={value == null ? 'indeterminate' : 'determinate'}
          value={value}
        />
      </Box>
    );
  };

  const { drives, roots } = state;

  // Prepare drive rows for DataGrid
  const driveRows = drives.map((d) => ({
    ...d,
    id: d.id
  }));

  // Helper to get all roots for a given drive
  const getRootsForDrive = (driveUuid) =>
    roots.filter((r) => r.drive_uuid === driveUuid);

  const driveColumns = [
    { field: 'primary_name', headerName: 'Drive Name', flex: 1.3, minWidth: 180 },
    { field: 'volume_uuid', headerName: 'UUID', flex: 1.2, minWidth: 220 },
    { field: 'mount_point', headerName: 'Mount Point', flex: 1.3, minWidth: 200 },
    {
      field: 'size_bytes',
      headerName: 'Size',
      width: 120,
      valueGetter: (params) => formatBytes(params.value)
    },
    {
      field: 'last_scan_at',
      headerName: 'Last Scan',
      width: 180,
      valueGetter: (params) => formatDate(params.value)
    },
    {
      field: 'location_note',
      headerName: 'Location',
      flex: 1,
      minWidth: 140
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 220,
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
                  // For now, this triggers a full scan; later we can limit to this drive
                  await window.electronAPI.scanIndexerRoot(null);
                } catch (err) {
                  console.error('Scan drive error:', err);
                }
              }}
            >
              Scan
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setSettingsOpen(true)}
            >
              Settings
            </Button>
          </Stack>
        );
      }
    }
  ];

  const renderDriveDetailPanel = (params) => {
    const drive = params.row;
    const driveRoots = getRootsForDrive(drive.volume_uuid);

    const rootRows = driveRoots.map((r) => ({
      ...r,
      id: r.id
    }));

    const rootColumns = [
      { field: 'root_path', headerName: 'Root Path', flex: 2, minWidth: 260 },
      { field: 'label', headerName: 'Label', flex: 1, minWidth: 160 },
      {
        field: 'is_active',
        headerName: 'Active',
        width: 100,
        valueGetter: (p) => (p.value ? 'Yes' : 'No')
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
        valueGetter: (p) => formatInterval(p.value)
      },
      {
        field: 'last_scan_at',
        headerName: 'Last Scan',
        width: 180,
        valueGetter: (p) => formatDate(p.value)
      }
    ];

    return (
      <Box sx={{ p: 2, bgcolor: 'background.default' }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Watched Roots for {drive.primary_name || drive.mount_point}
        </Typography>
        {rootRows.length === 0 ? (
          <Alert severity="info">
            No roots associated with this drive. You can add custom roots in Settings.
          </Alert>
        ) : (
          <Box sx={{ height: 260, width: '100%' }}>
            <DataGridPro
              rows={rootRows}
              columns={rootColumns}
              density="compact"
              disableRowSelectionOnClick
              components={{ Toolbar: GridToolbar }}
              componentsProps={{
                toolbar: {
                  showQuickFilter: true,
                  quickFilterProps: { debounceMs: 300 }
                }
              }}
            />
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Container maxWidth="xl" sx={{ pt: 4, pb: 6 }}>
      <Stack spacing={3}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h4">Indexer</Typography>
            <Typography variant="body2" color="text.secondary">
              View indexed drives and roots, trigger scans, and inspect basic metadata.
            </Typography>
          </Box>
          <Box>
            <Button
              variant="outlined"
              onClick={loadState}
              disabled={loading || scanBusy}
              sx={{ mr: 1 }}
            >
              Refresh
            </Button>
            <Button
              variant="outlined"
              onClick={() => setSettingsOpen(true)}
              sx={{ mr: 1 }}
            >
              Settings
            </Button>
            <Button
              variant="contained"
              onClick={handleScanAll}
              disabled={scanBusy}
            >
              Scan All Now
            </Button>
          </Box>
        </Stack>

        {renderScanStatus()}

        {loading && <LinearProgress />}

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {driveRows.length === 0 ? (
          <Alert severity="info">
            No drives recorded yet. Connect an external drive or run a scan.
          </Alert>
        ) : (
          <Box sx={{ height: 500, width: '100%', bgcolor: 'background.paper', borderRadius: 2 }}>
            <DataGridPro
              rows={driveRows}
              columns={driveColumns}
              disableRowSelectionOnClick
              components={{ Toolbar: GridToolbar }}
              componentsProps={{
                toolbar: {
                  showQuickFilter: true,
                  quickFilterProps: { debounceMs: 300 }
                }
              }}
              getDetailPanelContent={renderDriveDetailPanel}
              getDetailPanelHeight={() => 320}
            />
          </Box>
        )}
      </Stack>

      <IndexerSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onStateChanged={(newState) => setState(newState)}
      />
    </Container>
  );
}

export default IndexerPage;