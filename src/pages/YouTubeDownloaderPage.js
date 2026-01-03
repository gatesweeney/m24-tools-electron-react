import React, { useEffect, useMemo, useState } from 'react';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import ButtonGroup from '@mui/material/ButtonGroup';
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';

const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

function formatBytes(bytes) {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

function getHeight(format) {
  if (format.height) return format.height;
  if (typeof format.resolution === 'string') {
    const m = format.resolution.match(/x(\d+)/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function resolutionTier(format) {
  const h = getHeight(format);
  if (!h) return '';
  if (h >= 4320) return '8K';
  if (h >= 2880) return '6K';
  if (h >= 2160) return '4K';
  if (h >= 1440) return '1440p';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  return `${h}p`;
}

/**
 * Normalize common YouTube URLs so we don't accidentally trigger playlist/radio expansion.
 * Keeps only watch?v=<id> (drops list/start_radio/etc.)
 */
function normalizeYouTubeUrl(raw) {
  const input = (raw || '').trim();
  if (!input) return '';

  try {
    const u = new URL(input);

    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace('/', '').trim();
      return id ? `https://www.youtube.com/watch?v=${id}` : input;
    }

    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/watch?v=${v}`;
    }

    return input;
  } catch {
    return input;
  }
}

export default function YouTubeDownloaderPage() {
  const [url, setUrl] = useState('');
  const [tab, setTab] = useState(0); // 0 video, 1 audio

  const [info, setInfo] = useState(null);
  const [formats, setFormats] = useState([]);

  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  // Default destination
  const [destDir, setDestDir] = useState('~/Downloads');

  useEffect(() => {
    if (!hasElectron || !window.electronAPI.onYtProgress) return;
    const unsub = window.electronAPI.onYtProgress((p) => setProgress(p));
    return () => unsub && unsub();
  }, []);

  const videoRows = useMemo(() => {
    return formats
      .filter((f) => f.vcodec && f.vcodec !== 'none')
      .map((f, idx) => ({
        id: `${f.format_id}-${idx}`,
        tier: resolutionTier(f),
        ...f
      }));
  }, [formats]);

  const audioRows = useMemo(() => {
    return formats
      .filter((f) => (f.vcodec === 'none' || !f.vcodec) && f.acodec && f.acodec !== 'none')
      .map((f, idx) => ({
        id: `${f.format_id}-${idx}`,
        tier: 'Audio',
        ...f
      }));
  }, [formats]);

  const rows = tab === 0 ? videoRows : audioRows;

  const pickDest = async () => {
    if (!hasElectron || !window.electronAPI.selectDirectory) return;
    const dir = await window.electronAPI.selectDirectory();
    if (dir) setDestDir(dir);
  };

  const fetchFormats = async () => {
    setError(null);
    setInfo(null);
    setFormats([]);
    setProgress(null);

    if (!url.trim()) {
      setError('Paste a YouTube URL.');
      return;
    }
    if (!hasElectron || !window.electronAPI.getYtFormats) {
      setError('This tool only works in the Electron app.');
      return;
    }

    const cleanUrl = normalizeYouTubeUrl(url);

    setLoading(true);
    try {
      const res = await window.electronAPI.getYtFormats(cleanUrl);
      if (!res.ok) {
        setError(res.error || 'Failed to fetch formats.');
      } else {
        setInfo(res.info || null);
        setFormats(res.formats || []);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  /**
   * kind: 'video' | 'audio'
   * outFormat:
   *  - video: 'mp4' | 'mov' | 'original'
   *  - audio: 'mp3' | 'wav' | 'original'
   */
  const handleDownload = async ({ formatId, kind, outFormat }) => {
    setError(null);
    setProgress(null);

    if (!destDir) {
      setError('Choose a destination folder first.');
      return;
    }

    if (!hasElectron || !window.electronAPI.downloadYtFormat) {
      setError('This tool only works in the Electron app.');
      return;
    }

    const cleanUrl = normalizeYouTubeUrl(url);

    setDownloading(true);
    try {
      const res = await window.electronAPI.downloadYtFormat({
        url: cleanUrl,
        formatId,
        destDir,
        outputTemplate: '%(title)s.%(ext)s',
        kind,
        outFormat
      });

      if (!res.ok) {
        setError(res.error || 'Download failed.');
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setDownloading(false);
    }
  };

  const columns = useMemo(() => {
    const base = [
      { field: 'format_id', headerName: 'Format', width: 90 },
      { field: 'tier', headerName: 'Tier', width: 90 },
      { field: 'ext', headerName: 'Ext', width: 80 },
      { field: 'resolution', headerName: 'Resolution', width: 140 },
      { field: 'fps', headerName: 'FPS', width: 80 },
      { field: 'vcodec', headerName: 'VCodec', flex: 1, minWidth: 140 },
      { field: 'acodec', headerName: 'ACodec', flex: 1, minWidth: 140 },
      { field: 'abr', headerName: 'ABR', width: 90 },
      {
        field: 'filesize',
        headerName: 'Size',
        width: 120,
        valueGetter: (p) => formatBytes(p.row.filesize)
      }
    ];

    const actionsCol = {
      field: 'actions',
      headerName: 'Save As',
      width: tab === 0 ? 260 : 260,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        const f = params.row;
        const formatId = f.format_id;

        if (!destDir) {
          return (
            <Typography variant="caption" color="text.secondary">
              Choose folder
            </Typography>
          );
        }

        if (tab === 0) {
          // Video: MP4 / MOV / Original
          return (
            <ButtonGroup size="small" variant="contained" disabled={downloading}>
              <Button onClick={() => handleDownload({ formatId, kind: 'video', outFormat: 'mp4' })}>
                MP4
              </Button>
              <Button onClick={() => handleDownload({ formatId, kind: 'video', outFormat: 'mov' })}>
                MOV
              </Button>
              <Button onClick={() => handleDownload({ formatId, kind: 'video', outFormat: 'original' })}>
                Orig
              </Button>
            </ButtonGroup>
          );
        }

        // Audio: MP3 / WAV / Original
        return (
          <ButtonGroup size="small" variant="contained" disabled={downloading}>
            <Button onClick={() => handleDownload({ formatId, kind: 'audio', outFormat: 'mp3' })}>
              MP3
            </Button>
            <Button onClick={() => handleDownload({ formatId, kind: 'audio', outFormat: 'wav' })}>
              WAV
            </Button>
            <Button onClick={() => handleDownload({ formatId, kind: 'audio', outFormat: 'original' })}>
              Orig
            </Button>
          </ButtonGroup>
        );
      }
    };

    return [...base, actionsCol];
  }, [tab, destDir, downloading]);

  return (
    <Container maxWidth="xl" sx={{ pt: 4, pb: 6 }}>
      <Stack spacing={2}>
        <Typography variant="h4">YouTube Downloader</Typography>
        <Typography variant="body2" color="text.secondary">
          Download content you own or have permission to download. Wraps yt-dlp.
        </Typography>

        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            label="YouTube link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            fullWidth
            size="small"
            placeholder="https://www.youtube.com/watch?v=..."
          />
          <Button
            variant="contained"
            onClick={fetchFormats}
            disabled={loading || downloading}
          >
            Fetch
          </Button>
        </Stack>

        <Stack direction="row" spacing={2} alignItems="center">
          <Button variant="outlined" onClick={pickDest}>
            {destDir ? `Save to: ${destDir}` : 'Choose folder'}
          </Button>
          {(loading || downloading) && <LinearProgress sx={{ flex: 1 }} />}
        </Stack>

        {info && (
          <Alert severity="info">
            <strong>{info.title}</strong>
            {info.uploader ? ` — ${info.uploader}` : ''}
          </Alert>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {progress && (
          <Alert severity="success">
            {progress.percent != null ? `${progress.percent}%` : ''}
            {progress.speed ? ` • ${progress.speed}` : ''}
            {progress.eta ? ` • ETA ${progress.eta}` : ''}
            <br />
            {progress.filename || ''}
          </Alert>
        )}

        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab label={`Video (${videoRows.length})`} />
          <Tab label={`Audio (${audioRows.length})`} />
        </Tabs>

        <Box sx={{ height: 560, width: '100%', bgcolor: 'background.paper', borderRadius: 2 }}>
          <DataGridPro
            rows={rows}
            columns={columns}
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
      </Stack>
    </Container>
  );
}