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

const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
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
        const rows = (result.results || []).map((r, idx) => ({
          id: r.id || idx,
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

  // Helpers to pull thumbs
  const getLogThumbSrc = (row) => {
    if (!row.foolcat || !Array.isArray(row.foolcat.clips)) return null;
    const clipWithThumb =
      row.foolcat.clips.find((c) => c.thumbnailPath) || row.foolcat.clips[0];
    if (!clipWithThumb || !clipWithThumb.thumbnailPath) return null;
    return `file://${encodeURI(clipWithThumb.thumbnailPath)}`;
  };

  const columns = [
    {
      field: 'thumb',
      headerName: 'Thumb',
      width: 120,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        const thumbSrc = getLogThumbSrc(params.row);
        if (!thumbSrc) {
          return (
            <Typography variant="caption" color="text.secondary">
              No thumbnail
            </Typography>
          );
        }
        return (
          <Box
            component="img"
            src={thumbSrc}
            alt={params.row.sourceName || params.row.source || ''}
            sx={{
              width: 110,
              height: 60,
              objectFit: 'cover',
              borderRadius: 1,
              display: 'block'
            }}
          />
        );
      }
    },
    {
      field: 'date',
      headerName: 'Date',
      width: 200,
      valueGetter: (params) => params.row.started || params.row.date || '',
      valueFormatter: (params) => formatDate(params.value)
    },
    {
      field: 'source',
      headerName: 'Source / Card',
      flex: 1,
      minWidth: 200,
      valueGetter: (params) =>
        params.row.source || params.row.sourceName || '—'
    },
    {
      field: 'destination',
      headerName: 'Destination Volume',
      flex: 1,
      minWidth: 160
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
      headerName: 'Hash',
      width: 120
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120
    }
  ];

  const renderDetailPanel = (params) => {
    const row = params.row;
    const clips = row.foolcat?.clips || [];

    const clipRows = clips.map((c, i) => ({
      id: `${row.id}-clip-${i}`,
      ...c
    }));

    const clipColumns = [
      {
        field: 'thumb',
        headerName: 'Thumb',
        width: 110,
        sortable: false,
        filterable: false,
        renderCell: (p) => {
          const src = p.row.thumbnailPath
            ? `file://${encodeURI(p.row.thumbnailPath)}`
            : null;
          if (!src) {
            return (
              <Typography variant="caption" color="text.secondary">
                No thumbnail
              </Typography>
            );
          }
          return (
            <Box
              component="img"
              src={src}
              alt={p.row.clipName || ''}
              sx={{
                width: 100,
                height: 56,
                objectFit: 'cover',
                borderRadius: 1,
                display: 'block'
              }}
            />
          );
        }
      },
      {
        field: 'clipName',
        headerName: 'Clip Name',
        flex: 1.5,
        minWidth: 200
      },
      {
        field: 'fileName',
        headerName: 'File Path',
        flex: 2,
        minWidth: 260,
        renderCell: (p) => {
          const filePath = p.row.fileName || '';
          if (!filePath) return '—';
          return (
            <Button
              size="small"
              variant="text"
              sx={{ textTransform: 'none' }}
              onClick={async (e) => {
                e.stopPropagation();
                if (!hasElectron || !window.electronAPI.openInFinder) return;
                try {
                  await window.electronAPI.openInFinder(filePath);
                } catch (err) {
                  console.error('openInFinder error:', err);
                }
              }}
            >
              {filePath}
            </Button>
          );
        }
      },
      {
        field: 'durationSec',
        headerName: 'Duration',
        width: 110,
        valueGetter: (p) =>
          p.row.durationSec != null
            ? `${p.row.durationSec.toFixed(2)}s`
            : '—'
      },
      {
        field: 'fps',
        headerName: 'FPS',
        width: 90,
        valueGetter: (p) =>
          p.row.fps != null ? p.row.fps.toFixed(3) : '—'
      },
      {
        field: 'sizeBytes',
        headerName: 'Size',
        width: 110,
        valueGetter: (p) => formatBytes(p.row.sizeBytes)
      },
      {
        field: 'codec',
        headerName: 'Codec',
        width: 120
      }
    ];

    return (
      <Box sx={{ p: 2, bgcolor: 'background.default' }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {row.source || row.sourceName || 'Source'} →{' '}
          {row.destination || 'Destination'}
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
              maxHeight: 180,
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

        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Clips (Foolcat)
          </Typography>
          {clipRows.length === 0 ? (
            <Alert severity="info">
              No Foolcat clip info found for this log.
            </Alert>
          ) : (
            <Box sx={{ height: 280, width: '100%' }}>
              <DataGridPro
                rows={clipRows}
                columns={clipColumns}
                density="compact"
                disableRowSelectionOnClick
              />
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Container maxWidth="xl" sx={{ pt: 4, pb: 6 }}>
      <Stack spacing={3}>
        <Stack spacing={1}>
          <Typography variant="h4">OffShoot Log Checker</Typography>
          <Typography variant="body2" color="text.secondary">
            Scan a folder recursively for OffShoot "Transfer Logs" folders and
            view offload jobs in a structured way.
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
            No OffShoot logs loaded yet. Choose a folder and click "Scan Logs"
            to discover OffShoot "Transfer Logs" subfolders.
          </Alert>
        ) : (
          <Box
            sx={{
              height: 600,
              width: '100%',
              bgcolor: 'background.paper',
              borderRadius: 2
            }}
          >
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
              getDetailPanelContent={renderDetailPanel}
              getDetailPanelHeight={() => 420}
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