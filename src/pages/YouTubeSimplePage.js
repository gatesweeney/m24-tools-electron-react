import React, { useEffect, useMemo, useState } from 'react';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';

const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

export default function YouTubeSimplePage() {
  const [folder, setFolder] = useState('~/Downloads');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [logLines, setLogLines] = useState([]);

  useEffect(() => {
    if (!hasElectron || !window.electronAPI.onYtLog) return;
    const unsub = window.electronAPI.onYtLog((line) => {
      setLogLines((prev) => {
        const next = [...prev, line];
        return next.length > 300 ? next.slice(next.length - 300) : next;
      });
    });
    return () => unsub && unsub();
  }, []);

  const pickFolder = async () => {
    if (!hasElectron || !window.electronAPI.chooseYtFolder) return;
    const res = await window.electronAPI.chooseYtFolder();
    if (res.ok && res.folder) setFolder(res.folder);
  };

  const run = async (mode) => {
    setError(null);
    setLogLines([]);
    if (!url.trim()) {
      setError('Paste a YouTube URL first.');
      return;
    }
    if (!hasElectron || !window.electronAPI.runYt) {
      setError('This tool only works in the Electron app.');
      return;
    }

    setBusy(true);
    try {
      const res = await window.electronAPI.runYt({
        url: url.trim(),
        mode,         // 'video' or 'audio'
        folder
      });
      if (!res.ok) setError(res.error || 'Download failed.');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ pt: 4, pb: 6 }}>
      <Stack spacing={2}>
        <Typography variant="h4">YouTube Download</Typography>
        <Typography variant="body2" color="text.secondary">
          Use only for content you own or have permission to download.
        </Typography>

        <Stack direction="row" spacing={2} alignItems="center">
          <Button variant="outlined" onClick={pickFolder} disabled={busy}>
            {folder ? `Folder: ${folder}` : 'Choose folder'}
          </Button>
        </Stack>

        <TextField
          label="YouTube URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          fullWidth
          size="small"
        />

        <Stack direction="row" spacing={2}>
          <Button
            variant="contained"
            onClick={() => run('video')}
            disabled={busy}
          >
            Video
          </Button>
          <Button
            variant="contained"
            onClick={() => run('audio')}
            disabled={busy}
          >
            Audio
          </Button>
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}

        <Box
          sx={{
            bgcolor: 'background.paper',
            borderRadius: 2,
            p: 2,
            height: 260,
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: 12
          }}
        >
          {logLines.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              Logs will appear here…
            </Typography>
          ) : (
            logLines.map((l, idx) => <div key={idx}>{l}</div>)
          )}
        </Box>
      </Stack>
    </Container>
  );
}