import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Stack,
  Button,
  TextField,
  Paper,
  Divider,
  Chip,
  Alert,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Switch
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';

const DEFAULT_CROC_RELAY = 'relay1.motiontwofour.com:9009';
const DEFAULT_CROC_PASS = 'jfogtorkwnxjfkrmemwikflglemsjdikfkemwja';

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString();
}

function normalizeShareLink(share) {
  if (!share) return '';
  if (share.shareUrl) return share.shareUrl;
  if (share.secretId) return `m24://share/${share.secretId}`;
  return '';
}

export default function TransfersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sendPaths, setSendPaths] = useState([]);
  const [shareLabel, setShareLabel] = useState('');
  const [receiveLink, setReceiveLink] = useState('');
  const [downloadDir, setDownloadDir] = useState('');
  const [crocRelay, setCrocRelay] = useState(DEFAULT_CROC_RELAY);
  const [crocPassphrase, setCrocPassphrase] = useState(DEFAULT_CROC_PASS);
  const [startMinimized, setStartMinimized] = useState(false);
  const [shares, setShares] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [relayStatus, setRelayStatus] = useState(null);
  const [crocStatus, setCrocStatus] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareModalPaths, setShareModalPaths] = useState([]);
  const [shareModalLabel, setShareModalLabel] = useState('');
  const [shareModalMaxDownloads, setShareModalMaxDownloads] = useState(0);
  const [shareModalAllowBrowser, setShareModalAllowBrowser] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadDeviceId = async () => {
      if (!window.electronAPI?.getIndexerSetting) return;
      const res = await window.electronAPI.getIndexerSetting('machine_id');
      if (mounted && res?.ok && res.value) setDeviceId(res.value);
    };
    loadDeviceId();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (location?.state?.openShareModal) {
      setShareModalOpen(true);
      setShareModalPaths(location.state.sharePaths || []);
      setShareModalLabel(location.state.shareLabel || '');
      setShareModalMaxDownloads(0);
      setShareModalAllowBrowser(false);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  useEffect(() => {
    let mounted = true;
    const loadSettings = async () => {
      if (!window.electronAPI?.getIndexerSetting) return;
      const dirRes = await window.electronAPI.getIndexerSetting('transfers_download_dir');
      if (mounted && dirRes?.ok && dirRes.value) setDownloadDir(dirRes.value);
      const relayRes = await window.electronAPI.getIndexerSetting('transfers_croc_relay');
      if (mounted && relayRes?.ok && relayRes.value != null && relayRes.value !== '') {
        setCrocRelay(relayRes.value);
      }
      const passRes = await window.electronAPI.getIndexerSetting('transfers_croc_pass');
      if (mounted && passRes?.ok && passRes.value != null && passRes.value !== '') {
        setCrocPassphrase(passRes.value);
      }
      const startRes = await window.electronAPI.getIndexerSetting('start_minimized');
      if (mounted && startRes?.ok && startRes.value) {
        const normalized = String(startRes.value).toLowerCase();
        setStartMinimized(['1', 'true', 'yes'].includes(normalized));
      }
    };
    loadSettings();
    return () => { mounted = false; };
  }, []);

  const refreshShares = async () => {
    if (!window.electronAPI?.listShares) return;
    setRefreshing(true);
    const res = await window.electronAPI.listShares({});
    if (res?.ok) {
      setShares(res.shares || []);
      setError('');
    } else {
      const msg = res?.error === 'http_404'
        ? 'Relay not configured (set M24_RELAY_URL) or endpoint missing.'
        : (res?.error || 'Failed to load shares.');
      setError(msg);
    }
    setRefreshing(false);
  };

  useEffect(() => {
    refreshShares();
    let unsub = null;
    if (window.electronAPI?.onShareEvent) {
      unsub = window.electronAPI.onShareEvent((evt) => {
        if (evt?.share) {
          setShares((prev) => {
            const map = new Map(prev.map((s) => [s.secretId, s]));
            map.set(evt.share.secretId, evt.share);
            return Array.from(map.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          });
        }
      });
    }
    return () => { if (unsub) unsub(); };
  }, []);

  useEffect(() => {
    let mounted = true;
    let timer = null;
    const loadStatus = async () => {
      if (!window.electronAPI?.getTransferStatus) return;
      const res = await window.electronAPI.getTransferStatus();
      if (!mounted || !res?.ok) return;
      setRelayStatus(res.relay || null);
      setCrocStatus(res.croc || null);
    };
    loadStatus();
    timer = setInterval(loadStatus, 15000);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  const renderStatusDot = (ok) => (
    <Box
      sx={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        bgcolor: ok == null ? 'grey.600' : (ok ? 'success.main' : 'error.main')
      }}
    />
  );

  const addFiles = async () => {
    setError('');
    if (!window.electronAPI?.selectFiles) return;
    const files = await window.electronAPI.selectFiles();
    if (files && files.length) {
      setSendPaths((prev) => [...prev, ...files]);
    }
  };

  const addFolder = async () => {
    setError('');
    if (!window.electronAPI?.selectDirectory) return;
    const folder = await window.electronAPI.selectDirectory();
    if (folder) {
      setSendPaths((prev) => [...prev, folder]);
    }
  };

  const createShareWithConfig = async ({ paths, label, maxDownloads, allowBrowser }) => {
    setError('');
    setInfo('');
    if (!paths.length) {
      setError('Choose at least one file or folder.');
      return;
    }
    const res = await window.electronAPI?.createShare({
      paths,
      label: label || undefined,
      maxDownloads,
      allowBrowser
    });
    if (!res?.ok || !res.share) {
      setError(res?.error || 'Failed to create share.');
      return;
    }
    const link = normalizeShareLink(res.share);
    setInfo(link ? `Share link ready: ${link}` : 'Share created.');
    setSendPaths([]);
    setShareLabel('');
    refreshShares();
  };

  const createShare = async () => {
    await createShareWithConfig({
      paths: sendPaths,
      label: shareLabel,
      maxDownloads: 0,
      allowBrowser: false
    });
  };

  const handleReceive = async () => {
    setError('');
    setInfo('');
    if (!receiveLink.trim()) {
      setError('Paste a share link or secret.');
      return;
    }
    const res = await window.electronAPI?.readyShare({ link: receiveLink.trim() });
    if (!res?.ok) {
      setError(res?.error || 'Failed to mark receiver ready.');
      return;
    }
    setInfo('Receiver is ready. Waiting for sender...');
    setReceiveLink('');
  };

  const updateDownloadDir = async () => {
    if (!window.electronAPI?.setIndexerSetting) return;
    await window.electronAPI.setIndexerSetting('transfers_download_dir', downloadDir || '');
    await window.electronAPI.setIndexerSetting('transfers_croc_relay', crocRelay || '');
    await window.electronAPI.setIndexerSetting('transfers_croc_pass', crocPassphrase || '');
    await window.electronAPI.setIndexerSetting('start_minimized', startMinimized ? '1' : '0');
    setInfo('Download folder saved.');
  };

  const pickDownloadDir = async () => {
    if (!window.electronAPI?.selectDirectory) return;
    const folder = await window.electronAPI.selectDirectory();
    if (folder) {
      setDownloadDir(folder);
      await window.electronAPI.setIndexerSetting('transfers_download_dir', folder);
    }
  };

  const copyLink = async (share) => {
    const link = normalizeShareLink(share);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setInfo('Link copied to clipboard.');
    } catch {
      setInfo(link);
    }
  };

  const submitShareModal = async () => {
    await createShareWithConfig({
      paths: shareModalPaths,
      label: shareModalLabel,
      maxDownloads: shareModalMaxDownloads,
      allowBrowser: shareModalAllowBrowser
    });
    setShareModalOpen(false);
  };

  const cancelShare = async (share) => {
    const res = await window.electronAPI?.cancelShare({ secretId: share.secretId });
    if (!res?.ok) {
      setError(res?.error || 'Failed to cancel share.');
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
            Transfers
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create share links and handle incoming transfers using croc.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center">
          <Stack direction="row" spacing={1} alignItems="center">
            {renderStatusDot(relayStatus?.ok)}
            <Typography variant="caption" color="text.secondary">Relay</Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            {renderStatusDot(crocStatus?.ok)}
            <Typography variant="caption" color="text.secondary">Croc relay</Typography>
          </Stack>
          <Tooltip title="Refresh">
            <span>
              <IconButton onClick={refreshShares} disabled={refreshing}>
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {info ? <Alert severity="success">{info}</Alert> : null}

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Settings
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
          <TextField
            label="Download folder"
            value={downloadDir}
            onChange={(e) => setDownloadDir(e.target.value)}
            size="small"
            sx={{ flex: 1 }}
          />
          <Button variant="outlined" onClick={pickDownloadDir}>Choose</Button>
          <Button variant="contained" onClick={updateDownloadDir}>Save</Button>
        </Stack>
        <Box sx={{ mt: 2 }}>
          <TextField
            label="Croc relay (optional)"
            value={crocRelay}
            onChange={(e) => setCrocRelay(e.target.value)}
            size="small"
            fullWidth
          />
        </Box>
        <Box sx={{ mt: 2 }}>
          <TextField
            label="Croc relay passphrase"
            value={crocPassphrase}
            onChange={(e) => setCrocPassphrase(e.target.value)}
            size="small"
            fullWidth
            type="password"
          />
        </Box>
        <Box sx={{ mt: 2 }}>
          <FormControlLabel
            control={(
              <Switch
                checked={startMinimized}
                onChange={(e) => setStartMinimized(e.target.checked)}
              />
            )}
            label="Start minimized in tray"
          />
        </Box>
      </Paper>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Paper sx={{ flex: 1, p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Create Share
          </Typography>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" onClick={addFiles}>Add Files</Button>
              <Button variant="outlined" onClick={addFolder}>Add Folder</Button>
              <Button variant="text" onClick={() => setSendPaths([])}>Clear</Button>
            </Stack>
            {sendPaths.length ? (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {sendPaths.map((p) => (
                  <Chip key={p} label={p} size="small" />
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No files selected.
              </Typography>
            )}
            <TextField
              label="Label (optional)"
              value={shareLabel}
              onChange={(e) => setShareLabel(e.target.value)}
              size="small"
            />
            <Button variant="contained" onClick={createShare}>
              Create Link
            </Button>
          </Stack>
        </Paper>

        <Paper sx={{ flex: 1, p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Receive Share
          </Typography>
          <Stack spacing={1.5}>
            <TextField
              label="Share link or secret"
              value={receiveLink}
              onChange={(e) => setReceiveLink(e.target.value)}
              size="small"
            />
            <Button variant="contained" onClick={handleReceive}>
              Ready to Receive
            </Button>
          </Stack>
        </Paper>
      </Stack>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Shares
        </Typography>
        {shares.length ? (
          <Stack spacing={1.5}>
            {shares.map((share) => (
              <Box key={share.secretId}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle2" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    {share.ownerDeviceId === deviceId ? 'SENDER' : 'SHARE'}
                  </Typography>
                  {share.ownerName || share.ownerDeviceId ? (
                    <Chip
                      size="small"
                      label={`from: ${share.ownerName || share.ownerDeviceId}`}
                    />
                  ) : null}
                  <Chip size="small" label={share.status || 'open'} />
                  {share.label ? <Chip size="small" label={share.label} /> : null}
                  {share.secretId ? <Chip size="small" label={`id: ${share.secretId}`} /> : null}
                  {share.maxDownloads != null ? (
                    <Chip
                      size="small"
                      label={`downloads: ${share.maxDownloads === 0 ? '∞' : share.maxDownloads}`}
                    />
                  ) : null}
                  {share.allowBrowser ? <Chip size="small" label="browser ok" /> : null}
                  <Typography variant="caption" color="text.secondary">
                    {formatTime(share.createdAt)}
                  </Typography>
                  <IconButton size="small" onClick={() => copyLink(share)}>
                    <ContentCopyIcon fontSize="inherit" />
                  </IconButton>
                  {(share.status === 'open' || share.status === 'receiver_ready') && share.ownerDeviceId === deviceId ? (
                    <Button size="small" onClick={() => cancelShare(share)}>Cancel</Button>
                  ) : null}
                </Stack>
                {share.shareUrl ? (
                  <Typography variant="body2" color="text.secondary">
                    {share.shareUrl}
                  </Typography>
                ) : null}
                <Divider sx={{ mt: 1.5 }} />
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No shares yet.
          </Typography>
        )}
      </Paper>

      <Dialog open={shareModalOpen} onClose={() => setShareModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Share</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField
              label="Label"
              value={shareModalLabel}
              onChange={(e) => setShareModalLabel(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Max downloads (0 = infinite)"
              type="number"
              value={shareModalMaxDownloads}
              onChange={(e) => setShareModalMaxDownloads(Number(e.target.value))}
              fullWidth
              size="small"
              inputProps={{ min: 0 }}
            />
            <FormControlLabel
              control={(
                <Switch
                  checked={shareModalAllowBrowser}
                  onChange={(e) => setShareModalAllowBrowser(e.target.checked)}
                />
              )}
              label="Allow browser download (wire later)"
            />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Items to share
              </Typography>
              {shareModalPaths.length ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {shareModalPaths.map((p) => (
                    <Chip key={p} label={p} size="small" />
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">No paths selected.</Typography>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submitShareModal} disabled={!shareModalPaths.length}>
            Create Share
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
