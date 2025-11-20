// src/pages/IndexerPage.js
import React, { useEffect, useState } from 'react';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';

const hasElectron = typeof window !== 'undefined' && window.electronAPI;

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
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
  const [error, setError] = useState(null);
  const [openDriveIds, setOpenDriveIds] = useState({});

  const loadState = async () => {
    if (!hasElectron) {
      setError('Indexer UI only works in Electron.');
      return;
    }
    try {
      setLoading(true);
      const res = await window.electronAPI.getIndexerState();
      if (!res.ok) {
        setError(res.error || 'Failed to load indexer state');
      } else {
        setState(res.state || { drives: [], roots: [] });
        setError(null);
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

  const toggleDriveOpen = (id) => {
    setOpenDriveIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleScanNow = async (rootPath) => {
    if (!hasElectron) return;
    try {
      setScanBusy(true);
      const res = await window.electronAPI.scanIndexerRoot(rootPath);
      if (!res.ok) {
        setError(res.error || 'Scan failed');
      } else {
        await loadState();
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setScanBusy(false);
    }
  };

  const { drives, roots } = state;

  // Join roots by drive_uuid
  const rootsByDrive = roots.reduce((acc, root) => {
    const key = root.drive_uuid || '__no_drive__';
    if (!acc[key]) acc[key] = [];
    acc[key].push(root);
    return acc;
  }, {});

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
              variant="contained"
              onClick={() => handleScanNow(null)}
              disabled={scanBusy}
            >
              Scan All Now
            </Button>
          </Box>
        </Stack>

        {loading && <LinearProgress />}

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {drives.length === 0 ? (
          <Alert severity="info">
            No drives found yet. Plug in an external drive or run the indexer to populate data.
          </Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell />
                <TableCell>Drive Name</TableCell>
                <TableCell>UUID</TableCell>
                <TableCell>Mount Point</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Last Scan</TableCell>
                <TableCell>Location</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {drives.map((drive) => {
                const isOpen = !!openDriveIds[drive.id];
                const driveRoots = rootsByDrive[drive.volume_uuid] || [];
                return (
                  <React.Fragment key={drive.id}>
                    <TableRow hover>
                      <TableCell padding="checkbox">
                        <IconButton
                          size="small"
                          onClick={() => toggleDriveOpen(drive.id)}
                        >
                          {isOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                        </IconButton>
                      </TableCell>
                      <TableCell>{drive.primary_name || '(unnamed)'}</TableCell>
                      <TableCell>{drive.volume_uuid || '—'}</TableCell>
                      <TableCell>{drive.mount_point || '—'}</TableCell>
                      <TableCell>{formatBytes(drive.size_bytes)}</TableCell>
                      <TableCell>{formatDate(drive.last_scan_at)}</TableCell>
                      <TableCell>{drive.location_note || '—'}</TableCell>
                    </TableRow>

                    <TableRow>
                      <TableCell colSpan={7} sx={{ py: 0 }}>
                        <Collapse in={isOpen} timeout="auto" unmountOnExit>
                          <Box sx={{ p: 2, bgcolor: 'background.default' }}>
                            <Typography variant="subtitle1" sx={{ mb: 1 }}>
                              Watched Roots
                            </Typography>
                            {driveRoots.length === 0 ? (
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                No active roots associated with this drive.
                              </Typography>
                            ) : (
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Root Path</TableCell>
                                    <TableCell>Label</TableCell>
                                    <TableCell>Active</TableCell>
                                    <TableCell>Mode</TableCell>
                                    <TableCell>Scan Interval</TableCell>
                                    <TableCell>Last Scan</TableCell>
                                    <TableCell>Actions</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {driveRoots.map((root) => (
                                    <TableRow key={root.id}>
                                      <TableCell>{root.root_path}</TableCell>
                                      <TableCell>{root.label || '—'}</TableCell>
                                      <TableCell>{root.is_active ? 'Yes' : 'No'}</TableCell>
                                      <TableCell>{root.deep_scan_mode || 'none'}</TableCell>
                                      <TableCell>{formatInterval(root.scan_interval_ms)}</TableCell>
                                      <TableCell>{formatDate(root.last_scan_at)}</TableCell>
                                      <TableCell>
                                        <Button
                                          size="small"
                                          variant="outlined"
                                          disabled={scanBusy}
                                          onClick={() => handleScanNow(root.root_path)}
                                        >
                                          Scan Now
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Stack>
    </Container>
  );
}

export default IndexerPage;