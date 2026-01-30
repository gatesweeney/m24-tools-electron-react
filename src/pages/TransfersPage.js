import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Stack,
  Button,
  TextField,
  Chip,
  Alert,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Switch,
  Snackbar,
  CircularProgress,
  LinearProgress
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import { DataGridPro } from '@mui/x-data-grid-pro';

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
  const [receiveLink, setReceiveLink] = useState('');
  const [downloadDir, setDownloadDir] = useState('');
  const [crocRelay, setCrocRelay] = useState(DEFAULT_CROC_RELAY);
  const [crocPassphrase, setCrocPassphrase] = useState(DEFAULT_CROC_PASS);
  const [startMinimized, setStartMinimized] = useState(false);
  const [shares, setShares] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [relayStatus, setRelayStatus] = useState(null);
  const [crocStatus, setCrocStatus] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, status: 'info', message: '', transfer: null });
  const [snackbarQueue, setSnackbarQueue] = useState([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareModalPaths, setShareModalPaths] = useState([]);
  const [shareModalLabel, setShareModalLabel] = useState('');
  const [shareModalMaxDownloads, setShareModalMaxDownloads] = useState(0);
  const [shareModalAllowBrowser, setShareModalAllowBrowser] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const formatStatusLabel = (value) => String(value || '').replace(/_/g, ' ').trim();

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

  const enqueueShareSnackbar = (share, statusOverride) => {
    const status = statusOverride || share?.status || 'info';
    const label = share?.label || share?.displayName || share?.secretId || 'share';
    const message = formatStatusLabel(status) || 'status';
    setSnackbarQueue((prev) => [...prev, { status, message, label, transfer: null }]);
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
          if (evt.type === 'share_receiver_ready' || evt.type === 'share_croc_ready' || evt.type === 'share_status') {
            enqueueShareSnackbar(evt.share);
          }
        }
      });
    }
    return () => { if (unsub) unsub(); };
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onCrocEvent) return undefined;
    const unsub = window.electronAPI.onCrocEvent((evt) => {
      if (evt?.type !== 'transfer' || !evt.transfer) return;
      const transfer = evt.transfer;
      const label = transfer.fileName
        || (transfer.paths?.length ? transfer.paths[0].split('/').pop() : (transfer.code || 'transfer'));
      const status = transfer.status || 'running';
      const message = formatStatusLabel(status) || 'transfer';
      setSnackbarQueue((prev) => [...prev, { status, message, label, transfer }]);
    });
    return () => { if (unsub) unsub(); };
  }, []);

  useEffect(() => {
    if (snackbar.open || snackbarQueue.length === 0) return;
    const next = snackbarQueue[0];
    setSnackbar({ open: true, ...next });
    setSnackbarQueue((prev) => prev.slice(1));
  }, [snackbar.open, snackbarQueue]);

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

  const statusChipColor = (status) => {
    const value = String(status || '').toLowerCase();
    if (['completed', 'complete', 'done', 'success'].includes(value)) return 'success';
    if (['failed', 'error', 'cancelled', 'canceled'].includes(value)) return 'error';
    if (['receiver_ready', 'sending', 'croc_ready'].includes(value)) return 'info';
    if (['open', 'pending', 'queued'].includes(value)) return 'warning';
    return 'default';
  };

  const snackbarColor = (status) => {
    const value = String(status || '').toLowerCase();
    if (['completed', 'complete', 'done', 'success'].includes(value)) return '#0e4b2a';
    if (['failed', 'error', 'cancelled', 'canceled'].includes(value)) return '#4b1010';
    if (['running', 'starting', 'sending', 'receiving'].includes(value)) return '#202225';
    return '#2b2f36';
  };

  const addShareModalFiles = async () => {
    setError('');
    if (!window.electronAPI?.selectFiles) return;
    const files = await window.electronAPI.selectFiles();
    if (files && files.length) {
      setShareModalPaths((prev) => [...prev, ...files]);
      if (!shareModalLabel) {
        setShareModalLabel(files.length === 1 ? files[0].split('/').pop() : `${files.length} items`);
      }
    }
  };

  const addShareModalFolder = async () => {
    setError('');
    const selectDirs = window.electronAPI?.selectDirectories || window.electronAPI?.selectDirectory;
    if (!selectDirs) return;
    const folders = await selectDirs();
    const picked = Array.isArray(folders) ? folders : (folders ? [folders] : []);
    if (picked.length) {
      setShareModalPaths((prev) => [...prev, ...picked]);
      if (!shareModalLabel) {
        setShareModalLabel(picked.length === 1 ? (picked[0].split('/').pop() || picked[0]) : `${picked.length} folders`);
      }
    }
  };

  const clearShareModal = () => {
    setShareModalPaths([]);
    setShareModalLabel('');
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
    refreshShares();
  };

  const handleReceive = async () => {
    setError('');
    setInfo('');
    if (!receiveLink.trim()) {
      setError('Paste a share link or secret.');
      return;
    }
    console.log('[transfer-ui] submit receive', { value: receiveLink.trim() });
    const res = await window.electronAPI?.readyShare({ link: receiveLink.trim() });
    console.log('[transfer-ui] receive response', res);
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

  const trashShare = async (share) => {
    const res = await window.electronAPI?.trashShare({ secretId: share.secretId });
    if (!res?.ok) {
      setError(res?.error || 'Failed to trash share.');
    } else {
      setInfo('Share trashed.');
    }
  };

  const shareRows = shares
    .filter((share) => String(share.status || '').toLowerCase() !== 'deleted')
    .map((share) => ({
      id: share.secretId,
      ...share
    }));

  const shareColumns = [
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      renderCell: (params) => (
        <Chip
          size="small"
          label={params.value || 'open'}
          color={statusChipColor(params.value)}
        />
      )
    },
    {
      field: 'owner',
      headerName: 'From',
      minWidth: 140,
      flex: 0.6,
      valueGetter: (params) => (params.row.ownerName || params.row.ownerDeviceId || ''),
      renderCell: (params) => (
        <Chip
          size="small"
          label={`from: ${String(params.value || '').split('.')[0]}`}
        />
      )
    },
    {
      field: 'label',
      headerName: 'Label',
      minWidth: 160,
      flex: 1,
      valueGetter: (params) => params.row.label || params.row.displayName || ''
    },
    {
      field: 'createdAt',
      headerName: 'Created',
      minWidth: 180,
      valueGetter: (params) => params.row.createdAt,
      valueFormatter: (params) => formatTime(params.value)
    },
    {
      field: 'maxDownloads',
      headerName: 'Downloads',
      width: 120,
      valueFormatter: (params) => (params.value === 0 ? '∞' : params.value)
    },
    {
      field: 'actions',
      headerName: '',
      width: 140,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        const share = params.row;
        const canCancel = (share.status === 'open' || share.status === 'receiver_ready') && share.ownerDeviceId === deviceId;
        return (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Copy link">
              <span>
                <IconButton size="small" onClick={() => copyLink(share)}>
                  <ContentCopyIcon fontSize="inherit" />
                </IconButton>
              </span>
            </Tooltip>
            {canCancel ? (
              <Tooltip title="Cancel share">
                <span>
                  <IconButton size="small" onClick={() => cancelShare(share)}>
                    <CancelOutlinedIcon fontSize="inherit" />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
            <Tooltip title="Trash share">
              <span>
                <IconButton size="small" color="error" onClick={() => trashShare(share)}>
                  <DeleteOutlineIcon fontSize="inherit" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        );
      }
    }
  ];

  return (
    <Box sx={{ pt: 4, pb: 6, px: { xs: 2, md: 3 }, display: 'flex', flexDirection: 'column', gap: 3 }}>
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
          <Button
            variant="contained"
            onClick={() => {
              setShareModalOpen(true);
              setShareModalPaths([]);
              setShareModalLabel('');
              setShareModalMaxDownloads(0);
              setShareModalAllowBrowser(false);
            }}
          >
            Create Share
          </Button>
          <Tooltip title="Refresh">
            <span>
              <IconButton onClick={refreshShares} disabled={refreshing}>
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Settings">
            <span>
              <IconButton onClick={() => setSettingsOpen(true)}>
                <SettingsOutlinedIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {info ? <Alert severity="success">{info}</Alert> : null}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ flex: 1 }}>
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
        </Box>
      </Stack>

      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Shares
        </Typography>
        {shareRows.length ? (
          <Box sx={{ height: 420 }}>
            <DataGridPro
              rows={shareRows}
              columns={shareColumns}
              disableRowSelectionOnClick
              hideFooterSelectedRowCount
              initialState={{
                sorting: { sortModel: [{ field: 'createdAt', sort: 'desc' }] }
              }}
            />
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No shares yet.
          </Typography>
        )}
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box
          sx={{
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.25,
            px: 2,
            py: 1.25,
            borderRadius: 1.5,
            minWidth: 360,
            bgcolor: snackbarColor(snackbar.status),
            color: '#e9edf2',
            boxShadow: 3,
            overflow: 'hidden'
          }}
        >
          {typeof snackbar.transfer?.progressPercent === 'number' ? (
            <Box sx={{ position: 'relative', width: 34, height: 34, mt: 0.1 }}>
              <CircularProgress
                variant="determinate"
                value={Math.max(0, Math.min(100, snackbar.transfer.progressPercent))}
                size={34}
                thickness={4.5}
                sx={{ color: '#9ad1ff' }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Typography variant="caption" sx={{ color: '#e9edf2', fontWeight: 700 }}>
                  {Math.round(snackbar.transfer.progressPercent)}%
                </Typography>
              </Box>
            </Box>
          ) : ['running', 'starting', 'sending', 'receiving'].includes(String(snackbar.status || '').toLowerCase()) ? (
            <CircularProgress size={16} thickness={5} sx={{ color: '#9ad1ff', mt: 0.3 }} />
          ) : null}
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              {snackbar.message}
            </Typography>
            {(snackbar.transfer?.fileName || snackbar.label) ? (
              <Typography variant="caption" sx={{ color: 'rgba(233,237,242,0.75)' }}>
                {snackbar.transfer?.fileName || snackbar.label}
              </Typography>
            ) : null}
            {snackbar.transfer?.progressDetail ? (
              <Typography variant="caption" sx={{ color: 'rgba(233,237,242,0.75)' }}>
                {snackbar.transfer.progressDetail}
              </Typography>
            ) : null}
          </Box>
          {typeof snackbar.transfer?.progressPercent === 'number' ? (
            <LinearProgress
              variant="determinate"
              value={Math.max(0, Math.min(100, snackbar.transfer.progressPercent))}
              sx={{
                position: 'absolute',
                left: 0,
                bottom: 0,
                width: '100%',
                height: 4,
                backgroundColor: 'rgba(255,255,255,0.08)',
                '& .MuiLinearProgress-bar': {
                  backgroundColor: '#2ecc71'
                }
              }}
            />
          ) : null}
        </Box>
      </Snackbar>
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Transfer Settings</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
              <TextField
                label="Download folder"
                value={downloadDir}
                onChange={(e) => setDownloadDir(e.target.value)}
                size="small"
                sx={{ flex: 1 }}
              />
              <Button variant="outlined" onClick={pickDownloadDir}>Choose</Button>
            </Stack>
            <TextField
              label="Croc relay (optional)"
              value={crocRelay}
              onChange={(e) => setCrocRelay(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="Croc relay passphrase"
              value={crocPassphrase}
              onChange={(e) => setCrocPassphrase(e.target.value)}
              size="small"
              fullWidth
              type="password"
            />
            <FormControlLabel
              control={(
                <Switch
                  checked={startMinimized}
                  onChange={(e) => setStartMinimized(e.target.checked)}
                />
              )}
              label="Start minimized in tray"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Close</Button>
          <Button variant="contained" onClick={updateDownloadDir}>Save</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={shareModalOpen} onClose={() => setShareModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Share</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" onClick={addShareModalFiles}>Add Files</Button>
              <Button variant="outlined" onClick={addShareModalFolder}>Add Folder</Button>
              <Button variant="text" onClick={clearShareModal}>Clear</Button>
            </Stack>
            <TextField
              label="Label"
              value={shareModalLabel}
              onChange={(e) => setShareModalLabel(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Max downloads (0 = unlimited)"
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
              label="Allow browser download"
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
