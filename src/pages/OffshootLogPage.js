import React, { useState } from 'react';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';

function OffshootLogPage() {
  const [rootFolder, setRootFolder] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openRows, setOpenRows] = useState({});
  const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const chooseRootFolder = async () => {
    if (hasElectron && window.electronAPI.selectDirectory) {
      const dir = await window.electronAPI.selectDirectory();
      if (dir) setRootFolder(dir);
    } else {
      const dir = window.prompt(
        'Enter folder path to scan (browser placeholder):',
        rootFolder
      );
      if (dir) setRootFolder(dir);
    }
  };

  const scanLogs = async () => {
    if (!rootFolder) {
      alert('Please choose a folder first.');
      return;
    }

    setLoading(true);

    let result;
    if (hasElectron && window.electronAPI.scanOffshootLogs) {
      result = await window.electronAPI.scanOffshootLogs(rootFolder);
    } else {
      result = { ok: true, results: [] };
    }

    if (!result.ok) {
      console.error(result.error);
      setLogs([]);
    } else {
      const rows = result.results.map((r, index) => ({
        id: r.id || index,
        ...r
      }));
      setLogs(rows);
    }

    setLoading(false);
  };

  const toggleOpen = (id) => {
    setOpenRows((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const formatDuration = (sec) => {
    if (sec == null) return '—';
    const total = Math.round(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = bytes;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
      v /= 1024;
      u++;
    }
    return `${v.toFixed(1)} ${units[u]}`;
  };

  return (
    <Container maxWidth="xl" sx={{ pt: 4, pb: 6 }}>
      <Stack spacing={3}>
        <Stack spacing={1}>
          <Typography variant="h4">OffShoot Log Checker</Typography>
          <Typography variant="body1" color="text.secondary">
            Scan a folder recursively for OffShoot “Transfer Logs” folders and view offload jobs in a structured way.
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

          {!hasElectron && (
            <Typography variant="caption" color="text.secondary">
              Browser mode: directory picker is a prompt. Electron will use native dialogs and real parsing.
            </Typography>
          )}
        </Stack>

        {loading && <LinearProgress />}

        {logs.length === 0 && !loading ? (
          <Alert severity="info">
            No OffShoot logs loaded yet. Choose a folder and click “Scan Logs” to discover “Transfer Logs” subfolders.
          </Alert>
        ) : (
          <TableContainer sx={{ bgcolor: 'background.paper', borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                    <TableCell />
                    <TableCell>Thumb</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Source / Card</TableCell>
                    <TableCell>Destination Volume</TableCell>
                    <TableCell align="right">Files</TableCell>
                    <TableCell>Total Size</TableCell>
                    <TableCell>Verification</TableCell>
                    <TableCell>Hash</TableCell>
                    <TableCell>Status</TableCell>
                </TableRow>
                </TableHead>
              <TableBody>
                {logs.map((row) => {
                  const isOpen = !!openRows[row.id];
                  return (
                    <React.Fragment key={row.id}>
                      <TableRow hover>
                        {/* expand/collapse cell */}
                        <TableCell padding="checkbox">
                            <IconButton
                            size="small"
                            onClick={() => toggleOpen(row.id)}
                            >
                            {isOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                            </IconButton>
                        </TableCell>

                        {/* NEW: thumbnail cell */}
                        <TableCell>
                            {row.foolcat && Array.isArray(row.foolcat.clips) && row.foolcat.clips.length > 0 ? (() => {
                            // Pick first clip that has a thumbnail
                            const repClip =
                                row.foolcat.clips.find((c) => c.thumbnailPath) ||
                                row.foolcat.clips[0];

                            if (!repClip || !repClip.thumbnailPath) {
                                return (
                                <Typography variant="caption" color="text.secondary">
                                    No thumbnail
                                </Typography>
                                );
                            }

                            const thumbSrc = `file://${encodeURI(repClip.thumbnailPath)}`;

                            return (
                                <Box
                                component="img"
                                src={thumbSrc}
                                alt={repClip.clipName}
                                sx={{
                                    width: 90,
                                    height: 'auto',
                                    borderRadius: 1,
                                    display: 'block',
                                    objectFit: 'cover'
                                }}
                                />
                            );
                            })() : (
                            <Typography variant="caption" color="text.secondary">
                                No report
                            </Typography>
                            )}
                        </TableCell>

                        {/* existing cells */}
                        <TableCell>{row.date || row.started || '—'}</TableCell>
                        <TableCell>{row.source || row.sourceName || '—'}</TableCell>
                        <TableCell>{row.destination || '—'}</TableCell>
                        <TableCell align="right">
                            {row.files != null ? row.files : '—'}
                        </TableCell>
                        <TableCell>{row.size || '—'}</TableCell>
                        <TableCell>{row.verification || '—'}</TableCell>
                        <TableCell>{row.hash || '—'}</TableCell>
                        <TableCell>{row.status || 'Success'}</TableCell>
                        </TableRow>

                      <TableRow>
                        <TableCell colSpan={9} sx={{ py: 0 }}>
                          <Collapse in={isOpen} timeout="auto" unmountOnExit>
                            <Box sx={{ p: 2, bgcolor: 'background.default' }}>
                              <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
                                {(row.source || row.sourceName || 'Source')}{' '}
                                → {row.destination || 'Destination'}
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

                              {/* Foolcat clip table */}
                              {row.foolcat && Array.isArray(row.foolcat.clips) && row.foolcat.clips.length > 0 && (
                                <Box sx={{ mt: 3 }}>
                                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                    Clips ({row.foolcat.summary?.clipCount ?? row.foolcat.clips.length})
                                  </Typography>
                                  <TableContainer
                                    sx={{
                                      maxHeight: 320,
                                      bgcolor: 'background.paper',
                                      borderRadius: 1
                                    }}
                                  >
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell>Thumb</TableCell>
                                          <TableCell>Clip Name</TableCell>
                                          <TableCell>Duration</TableCell>
                                          <TableCell>FPS</TableCell>
                                          <TableCell>Resolution</TableCell>
                                          <TableCell>Camera</TableCell>
                                          <TableCell>ISO/WB/Shutter</TableCell>
                                          <TableCell>TC Start</TableCell>
                                          <TableCell>Size</TableCell>
                                          <TableCell>Codec</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {row.foolcat.clips.map((clip) => {
                                          const thumbSrc = clip.thumbnailPath
                                            ? `file://${encodeURI(clip.thumbnailPath)}`
                                            : null;

                                          return (
                                            <TableRow key={clip.id}>
                                              <TableCell>
                                                {thumbSrc ? (
                                                  <Box
                                                    component="img"
                                                    src={thumbSrc}
                                                    alt={clip.clipName}
                                                    sx={{
                                                      width: 80,
                                                      height: 'auto',
                                                      borderRadius: 1,
                                                      display: 'block'
                                                    }}
                                                  />
                                                ) : (
                                                  <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                  >
                                                    No thumbnail
                                                  </Typography>
                                                )}
                                              </TableCell>
                                              <TableCell>{clip.clipName}</TableCell>
                                              <TableCell>
                                                {formatDuration(clip.durationSec)}
                                              </TableCell>
                                              <TableCell>
                                                {clip.fps ? clip.fps.toFixed(3) : '—'}
                                              </TableCell>
                                              <TableCell>
                                                {clip.width && clip.height
                                                  ? `${clip.width}×${clip.height} (${clip.aspectRatio || '—'})`
                                                  : '—'}
                                              </TableCell>
                                              <TableCell>{clip.cameraName || '—'}</TableCell>
                                              <TableCell>
                                                {clip.iso ? `ISO ${clip.iso}` : 'ISO —'}
                                                <br />
                                                {clip.whiteBalance
                                                  ? `${clip.whiteBalance}K`
                                                  : 'WB —'}
                                                <br />
                                                {clip.shutterAngle
                                                  ? `${clip.shutterAngle}°`
                                                  : 'Shutter —'}
                                              </TableCell>
                                              <TableCell>
                                                {clip.timecodeStart || '—'}
                                              </TableCell>
                                              <TableCell>
                                                {formatSize(clip.sizeBytes)}
                                              </TableCell>
                                              <TableCell>{clip.codec || '—'}</TableCell>
                                            </TableRow>
                                          );
                                        })}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                </Box>
                              )}

                              {/* Transferred file list preview */}
                              <Box sx={{ mt: 3 }}>
                                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                  Transferred Files (raw OffShoot log)
                                </Typography>
                                <Box
                                  component="pre"
                                  sx={{
                                    fontSize: 12,
                                    maxHeight: 200,
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
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>
    </Container>
  );
}

export default OffshootLogPage;