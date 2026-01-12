import React, { useEffect, useMemo, useState, useCallback } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';

export default function UpdateDialog({ open, onClose }) {
  const [status, setStatus] = useState({ status: 'idle', progress: null, error: null, info: null });
  const [checking, setChecking] = useState(false);
  const [messages, setMessages] = useState([]);

  const addMessage = useCallback((text) => {
    const ts = new Date().toLocaleTimeString();
    setMessages((prev) => [...prev.slice(-30), `${ts} — ${text}`]); // keep last ~30 entries
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    let unsub = null;
    if (window.electronAPI?.onUpdateEvent) {
      unsub = window.electronAPI.onUpdateEvent((evt) => {
        setStatus(evt || { status: 'idle' });
        if (evt?.status === 'checking') setChecking(true);
        if (evt?.status && evt.status !== 'checking') setChecking(false);
        if (evt?.status) {
          const label = evt.status === 'downloading' && evt.progress?.percent
            ? `${evt.status} ${Math.round(evt.progress.percent)}%`
            : evt.status;
          addMessage(`Status: ${label}`);
        }
        if (evt?.error) addMessage(`Error: ${evt.error}`);
      });
    }
    if (window.electronAPI?.getUpdateStatus) {
      window.electronAPI.getUpdateStatus().then((res) => {
        if (res?.ok && res.status) setStatus(res.status);
      });
    }
    return () => {
      if (unsub) unsub();
    };
  }, [open, addMessage]);

  const handleCheck = useCallback(async () => {
    if (!window.electronAPI?.checkForUpdates) return;
    setChecking(true);
    addMessage('Request: check for updates');
    try {
      await window.electronAPI.checkForUpdates();
    } finally {
      setChecking(false);
    }
  }, [addMessage]);

  const handleInstall = useCallback(async () => {
    if (!window.electronAPI?.quitAndInstallUpdate) return;
    addMessage('Request: install and restart');
    try {
      await window.electronAPI.quitAndInstallUpdate();
    } catch {}
  }, [addMessage]);

  const percent = status?.progress?.percent ?? null;
  const infoText = useMemo(() => {
    const st = status?.status;
    if (st === 'downloading') {
      return percent ? `Downloading update (${Math.round(percent)}%)` : 'Downloading update…';
    }
    if (st === 'available') return 'Update available — starting download';
    if (st === 'downloaded') return 'Update ready — will restart to install';
    if (st === 'checking') return 'Checking for updates…';
    if (st === 'error') return 'Update error';
    return 'Idle';
  }, [status?.status, percent]);

  const canInstall = status?.status === 'downloaded';
  const canCheck = !checking && status?.status !== 'downloading';

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Updates</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip label={status?.status || 'idle'} color={status?.status === 'error' ? 'error' : 'primary'} size="small" />
            <Typography variant="body2" color="text.secondary">
              {infoText}
            </Typography>
          </Stack>

          {status?.status === 'downloading' ? (
            <Stack spacing={1}>
              <LinearProgress variant={percent ? 'determinate' : 'indeterminate'} value={percent || 0} />
              {percent ? (
                <Typography variant="caption" color="text.secondary">
                  {Math.round(percent)}% ({Math.round((status?.progress?.transferred || 0) / 1_048_576)} MB /
                  {Math.round((status?.progress?.total || 0) / 1_048_576)} MB)
                </Typography>
              ) : null}
            </Stack>
          ) : null}

          {status?.info?.version ? (
            <Typography variant="body2">Version: {status.info.version}</Typography>
          ) : null}

          {status?.error ? (
            <Alert severity="error" variant="outlined">
              {status.error}
            </Alert>
          ) : null}

          <Divider light />
          <Stack spacing={1}>
            <Typography variant="subtitle2">Messages</Typography>
            <Paper variant="outlined" sx={{ maxHeight: 160, overflow: 'auto', p: 1, bgcolor: 'background.default' }}>
              {messages.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No events yet.</Typography>
              ) : (
                <Stack spacing={0.5}>
                  {messages.slice().reverse().map((msg, idx) => (
                    <Typography key={idx} variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{msg}</Typography>
                  ))}
                </Stack>
              )}
            </Paper>
          </Stack>
          <Divider light />
          <Typography variant="body2" color="text.secondary">
            Use the tray menu “Updates…” to reopen this window anytime.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button onClick={handleCheck} disabled={!canCheck || !window.electronAPI?.checkForUpdates} variant="outlined">
          Check for updates
        </Button>
        <Button onClick={handleInstall} disabled={!canInstall} variant="contained" color="primary">
          Install and restart
        </Button>
      </DialogActions>
    </Dialog>
  );
}
