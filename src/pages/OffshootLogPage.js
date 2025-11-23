// src/pages/OffshootLogPage.js
import React, { useState } from 'react';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';

const hasElectron =
  typeof window !== 'undefined' && !!window.electronAPI;

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function OffshootLogPage() {
  const [rootFolder, setRootFolder] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [snack, setSnack] = useState({
    open: false,
    message: '',
    severity: 'info'
  });

  const chooseRootFolder = async () => {
    if (!hasElectron || !window.electronAPI.selectDirectory) {
      const dir = window.prompt(
        'Enter folder path to scan (browser placeholder):',
        rootFolder
      );
      if (dir) setRootFolder(dir);
      return;
    }

    const dir = await window.electronAPI.selectDirectory();
    if (dir) setRootFolder(dir);
  };

  const scanLogs = async () => {
    if (!rootFolder) {
      setSnack({
        open: true,
        message: 'Please choose a folder first.',
        severity: 'warning'
      });
      return;
    }

    if (!hasElectron || !window.electronAPI.scanOffshootLogs) {
      setSnack({
        open: true,
        message: 'OffShoot scanning only works in Electron.',
        severity: 'error'
      });
      return;
    }

    try {
      setLoading(true);
      const result = await window.electronAPI.scanOffshootLogs(rootFolder);
      if (!result.ok) {
        setLogs([]);
        setSnack({
          open: true,
          message: 'Scan failed: ' + (result.error || 'Unknown error'),
          severity: 'error'
        });
      } else {
        const rows = (result.results || []).map((r, index) => ({
          id: r.id || index,
          ...r
        }));
        setLogs(rows);
        setSnack({
          open: true,
          message: `Found ${rows.length} OffShoot log(s).`,
          severity: 'success'
        });
      }
    } catch (err) {
      console.error(err);
      setSnack({
        open: true,
        message: 'Scan failed: ' + (err.message || String(err)),
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      field: 'date',
      headerName: 'Date',
      width: 200,
      valueGetter: (params) => params.row.started || params.row.date || '—',
      valueFormatter: (params) => formatDate(params.value)
    },
    {
      field: 'source',
      headerName: 'Source / Card',
      flex: 1,
      minWidth: 200,
      valueGetter: (params) => params.row.source || params.row.sourceName || '—'
    },
    {
      field: 'destination',
      headerName: 'Destination Volume',
      flex: 1,
      minWidth: 180
    },
    {
      field: 'files',
      headerName: 'Files',
      width: 100,
      type: 'number'
    },
    {
      field: 'size',
      headerName: 'Total Size',
      width: 150
    },
    {
      field: 'verification',
      headerName: 'Verification',
      width: 160
    },
    {
      field: 'hash',
      headerName: 'Hash Type',
      width: 140
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120
    }
  ];

  const getDetailPanelContent = (params) => {
    const row = params.row;
    return (
      <Box sx={{ p: 2, bgcolor: 'background.default' }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {row.source || row.sourceName || 'Source'} → {row.destination || 'Destination'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Started: {row.started || '—'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Finished: {row.finished || '—'}{' '}
          {row.duration ? `(${row.duration})` : ''}
        </Typography>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Log Summary
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Files: {row.files ?? '—'} · Size: {row.size || '—'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Verification: {row.verification || '—'} · Hash: {row.hash || '—'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Log file: {row.filePath || '—'}
          </Typography>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Transferred Files (raw OffShoot log)
          </Typography>
          <Box
            component="pre"
            sx={{
              fontSize: 12,
              maxHeight: 240,
              overflow: 'auto',
              bgcolor: 'background.paper',
              p: 1,
              borderRadius: 1
            }}
          >
            {Array.isArray(row.transferredFiles) &&
            row.transferredFiles.length > 0
              ? row.transferredFiles.join('\n')
              : '(no transferred files block parsed)'}
          </Box>
        </Box>
      </Box>
    );
  };

  const getDetailPanelHeight = () => 320;

  return (
    <Container maxWidth="xl" sx={{ pt: 4, pb: 6 }}>
      <Stack spacing={3}>
        <Stack spacing={1}>
          <Typography variant="h4">OffShoot Log Checker</Typography>
          <Typography variant="body2" color="text.secondary">
            Scan a folder recursively for OffShoot "Transfer Logs" folders and view offload jobs in
            a structured way.
          </Typography>
        </Stack>

        {/* Controls */}
        <Stack direction="row" spacing={2} alignItems="center">
          <Button variant="outlined" onClick={chooseRootFolder}>
            {rootFolder || 'Choose Folder'}
          </Button>
          <Button
            variant="contained"
            onClick={scanLogs}
            disabled={!rootFolder || loading}
          >
            {loading ? 'Scanning…' : 'Scan Logs'}
          </Button>
        </Stack>

        {loading && <LinearProgress />}

        {logs.length === 0 && !loading ? (
          <Alert severity="info">
            No OffShoot logs loaded yet. Choose a folder and click "Scan Logs" to discover OffShoot "Transfer Logs" subfolders.
          </Alert>
        ) : (
          <Box sx={{ height: 600, width: '100%', bgcolor: 'background.paper', borderRadius: 2 }}>
            <DataGridPro
              rows={logs}
              columns={columns}
              disableRowSelectionOnClick
              slots={{ toolbar: GridToolbar }}
              slotProps={{
                toolbar: {
                  showQuickFilter: true,
                  quickFilterProps: { debounceMs: 300 }
                }
              }}
              getDetailPanelContent={getDetailPanelContent}
              getDetailPanelHeight={getDetailPanelHeight}
            />
          </Box>
        )}

        <Snackbar
          open={snack.open}
          autoHideDuration={4000}
          onClose={() => setSnack({ ...snack, open: false })}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <MuiAlert
            onClose={() => setSnack({ ...snack, open: false })}
            severity={snack.severity}
            sx={{ width: '100%' }}
          >
            {snack.message}
          </MuiAlert>
        </Snackbar>
      </Stack>
    </Container>
  );
}

export default OffshootLogPage;