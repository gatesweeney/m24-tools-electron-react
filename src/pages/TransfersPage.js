import React, { useEffect, useMemo, useState } from 'react';
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
  LinearProgress,
  MenuItem,
  Checkbox,
  List,
  ListItem,
  ListItemButton,
  ListItemText
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import { DataGridPro } from '@mui/x-data-grid-pro';
import { formatBytes } from '../utils/formatters';

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
  const [browseEnabled, setBrowseEnabled] = useState(true);
  const [browseMode, setBrowseMode] = useState('indexed');
  const [browseFolders, setBrowseFolders] = useState([]);
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
  const [shareModalOwnerDeviceId, setShareModalOwnerDeviceId] = useState('');
  const [shareModalOwnerName, setShareModalOwnerName] = useState('');
  const [shareModalDisplayName, setShareModalDisplayName] = useState('');
  const [shareModalFileCount, setShareModalFileCount] = useState(null);
  const [shareModalTotalBytes, setShareModalTotalBytes] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remoteState, setRemoteState] = useState({ drives: [], roots: [], devices: [] });
  const [deviceListError, setDeviceListError] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedDeviceName, setSelectedDeviceName] = useState('');
  const [deviceRoots, setDeviceRoots] = useState([]);
  const [selectedRoot, setSelectedRoot] = useState(null);
  const [remoteDirRel, setRemoteDirRel] = useState('');
  const [remoteEntries, setRemoteEntries] = useState([]);
  const [remoteDirCache, setRemoteDirCache] = useState({});
  const [remoteHistory, setRemoteHistory] = useState([]);
  const [remoteHistoryIndex, setRemoteHistoryIndex] = useState(-1);
  const [browseModalOpen, setBrowseModalOpen] = useState(false);
  const [remoteSelection, setRemoteSelection] = useState([]);
  const [metaEntry, setMetaEntry] = useState(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState('');

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
      setShareModalOwnerDeviceId('');
      setShareModalOwnerName('');
      setShareModalDisplayName('');
      setShareModalFileCount(null);
      setShareModalTotalBytes(null);
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
      const browseEnabledRes = await window.electronAPI.getIndexerSetting('transfers_browse_enabled');
      if (mounted && browseEnabledRes?.ok) {
        const normalized = String(browseEnabledRes.value ?? '1').toLowerCase();
        setBrowseEnabled(!['0', 'false', 'no'].includes(normalized));
      }
      const browseModeRes = await window.electronAPI.getIndexerSetting('transfers_browse_mode');
      if (mounted && browseModeRes?.ok && browseModeRes.value) {
        setBrowseMode(String(browseModeRes.value));
      }
      const browseFoldersRes = await window.electronAPI.getIndexerSetting('transfers_browse_folders');
      if (mounted && browseFoldersRes?.ok && browseFoldersRes.value != null) {
        try {
          const parsed = JSON.parse(browseFoldersRes.value);
          setBrowseFolders(Array.isArray(parsed) ? parsed : []);
        } catch {
          setBrowseFolders([]);
        }
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

  const refreshDeviceState = async () => {
    if (!window.electronAPI?.getIndexerState) return;
    const res = await window.electronAPI.getIndexerState();
    if (res?.ok) {
      const nextState = res.state || { drives: [], roots: [], devices: [] };
      setRemoteState(nextState);
      setDeviceListError('');
    } else {
      setDeviceListError(res?.error || 'Failed to load device list.');
    }
  };

  const enqueueShareSnackbar = (share, statusOverride) => {
    const status = statusOverride || share?.status || 'info';
    const label = share?.label || share?.displayName || share?.secretId || 'share';
    const message = formatStatusLabel(status) || 'status';
    setSnackbarQueue((prev) => [...prev, { status, message, label, transfer: null }]);
  };

  useEffect(() => {
    refreshShares();
    refreshDeviceState();
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
    if (!remoteState?.devices) return;
    if (!selectedDeviceId && remoteState.devices.length) {
      setSelectedDeviceId(remoteState.devices[0].device_id || '');
      setSelectedDeviceName(remoteState.devices[0].name || '');
    }
  }, [remoteState, selectedDeviceId]);

  useEffect(() => {
    if (!selectedDeviceId) {
      setDeviceRoots([]);
      setSelectedRoot(null);
      setRemoteEntries([]);
      setRemoteDirRel('');
      return;
    }
    const selectedDevice = (remoteState.devices || []).find((d) => d?.device_id === selectedDeviceId) || {};
    const policy = getDeviceBrowsePolicy(selectedDevice);
    const drives = (remoteState.drives || []).filter((d) =>
      d?.device_id === selectedDeviceId
      && d?.is_active !== 0
      && d?.is_available !== 0
    );
    const roots = (remoteState.roots || []).filter((r) =>
      r?.device_id === selectedDeviceId
      && r?.is_active !== 0
      && r?.is_available !== 0
    );
    const driveRoots = drives.map((d) => ({
      key: `vol:${d.volume_uuid}`,
      type: 'volume',
      label: d.label || d.volume_label || d.volume_name || d.volume_uuid || 'Volume',
      volumeUuid: d.volume_uuid,
      rootPath: d.root_path || d.rootPath || d.mount_point_last || d.mount_point || d.path || '',
      deviceId: d.device_id,
      os_internal: d.os_internal
    })).filter((d) => d.volumeUuid && d.rootPath);
    const manualRoots = roots.map((r) => {
      const rootId = r.__rootId || r.id || r.root_id;
      return {
        key: `root:${rootId || r.path}`,
        type: 'root',
        label: r.label || r.path || 'Root',
        volumeUuid: r.volume_uuid || (rootId ? `manual:${rootId}` : null),
        rootPath: r.path || '',
        deviceId: r.device_id
      };
    }).filter((r) => r.volumeUuid && r.rootPath);
    let visibleRoots = [...driveRoots, ...manualRoots];
    if (policy.mode === 'external') {
      visibleRoots = driveRoots.filter((d) => d.os_internal === false || d.os_internal === 0);
    } else if (policy.mode === 'custom') {
      const allow = new Set((policy.folders || []).map((p) => String(p)));
      visibleRoots = manualRoots.filter((r) => allow.has(r.rootPath));
    }
    setDeviceRoots(visibleRoots);
    setSelectedRoot(null);
    setRemoteEntries([]);
    setRemoteDirRel('');
  }, [remoteState, selectedDeviceId]);

  useEffect(() => {
    if (!window.electronAPI?.onCrocEvent) return undefined;
    const unsub = window.electronAPI.onCrocEvent((evt) => {
      if (evt?.type !== 'transfer' || !evt.transfer) return;
      const transfer = evt.transfer;
      const label = transfer.fileName
        || (transfer.paths?.length ? transfer.paths[0].split('/').pop() : (transfer.code || 'transfer'));
      const status = transfer.status || 'running';
      const tense = status === 'completed'
        ? 'Completed'
        : status === 'failed'
          ? 'Failed'
          : status === 'cancelled'
            ? 'Cancelled'
            : status === 'sending'
              ? 'Sending'
              : status === 'receiving'
                ? 'Receiving'
                : 'Working';
      const detail = transfer.progressDetail || '';
      const message = detail
        ? `${tense}: ${label} — ${detail}`
        : `${tense}: ${label}`;
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
    setShareModalOwnerDeviceId('');
    setShareModalOwnerName('');
    setShareModalDisplayName('');
    setShareModalFileCount(null);
    setShareModalTotalBytes(null);
  };

  const createShareWithConfig = async ({
    paths,
    label,
    maxDownloads,
    allowBrowser,
    ownerDeviceId,
    ownerName,
    displayName,
    fileCount,
    totalBytes
  }) => {
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
      allowBrowser,
      ownerDeviceId: ownerDeviceId || undefined,
      ownerName: ownerName || undefined,
      displayName: displayName || undefined,
      fileCount: typeof fileCount === 'number' ? fileCount : undefined,
      totalBytes: typeof totalBytes === 'number' ? totalBytes : undefined
    });
    if (!res?.ok || !res.share) {
      setError(res?.error || 'Failed to create share.');
      return res;
    }
    const link = normalizeShareLink(res.share);
    setInfo(link ? `Share link ready: ${link}` : 'Share created.');
    refreshShares();
    return res;
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

  const receiveShare = async (share) => {
    setError('');
    setInfo('');
    const link = normalizeShareLink(share) || share?.secretId;
    if (!link) {
      setError('Invalid share link.');
      return;
    }
    console.log('[transfer-ui] receive share', { secretId: share?.secretId, link });
    const res = await window.electronAPI?.readyShare({ secretId: share?.secretId, link });
    console.log('[transfer-ui] receive share response', res);
    if (!res?.ok) {
      setError(res?.error || 'Failed to mark receiver ready.');
      return;
    }
    setInfo('Receiver is ready. Waiting for sender...');
  };

  const updateDownloadDir = async () => {
    if (!window.electronAPI?.setIndexerSetting) return;
    await window.electronAPI.setIndexerSetting('transfers_download_dir', downloadDir || '');
    await window.electronAPI.setIndexerSetting('transfers_croc_relay', crocRelay || '');
    await window.electronAPI.setIndexerSetting('transfers_croc_pass', crocPassphrase || '');
    await window.electronAPI.setIndexerSetting('start_minimized', startMinimized ? '1' : '0');
    await window.electronAPI.setIndexerSetting('transfers_browse_enabled', browseEnabled ? '1' : '0');
    await window.electronAPI.setIndexerSetting('transfers_browse_mode', browseMode || 'indexed');
    await window.electronAPI.setIndexerSetting('transfers_browse_folders', JSON.stringify(browseFolders || []));
    await window.electronAPI.updateBrowsePolicy?.({
      browseEnabled,
      browseMode,
      browseFolders
    });
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
      allowBrowser: shareModalAllowBrowser,
      ownerDeviceId: shareModalOwnerDeviceId || undefined,
      ownerName: shareModalOwnerName || undefined,
      displayName: shareModalDisplayName || undefined,
      fileCount: shareModalFileCount,
      totalBytes: shareModalTotalBytes
    });
    setShareModalOpen(false);
  };

  const selectDevice = (device) => {
    const id = device?.device_id || '';
    if (!id) return;
    setSelectedDeviceId(id);
    setSelectedDeviceName(String(device?.name || id).split('.')[0]);
    setBrowseModalOpen(true);
  };

  const getDeviceBrowsePolicy = (device) => {
    const isLocal = deviceId && device?.device_id === deviceId;
    if (isLocal) {
      return {
        enabled: browseEnabled,
        mode: browseMode || 'indexed',
        folders: browseFolders || []
      };
    }
    let enabled = device?.browseEnabled;
    if (enabled == null && device?.browse_enabled != null) enabled = device.browse_enabled;
    if (enabled == null && device?.browse_enabled === 0) enabled = false;
    if (enabled == null) enabled = true;
    const mode = device?.browseMode || device?.browse_mode || 'indexed';
    let folders = device?.browseFolders || device?.browse_folders || [];
    if (typeof folders === 'string') {
      try { folders = JSON.parse(folders); } catch { folders = []; }
    }
    return {
      enabled: !!enabled,
      mode,
      folders: Array.isArray(folders) ? folders : []
    };
  };

  const loadDirectoryContents = async (root, dirRel = '') => {
    if (!window.electronAPI?.getDirectoryContents || !root) return;
    setRemoteLoading(true);
    setRemoteError('');
    setRemoteSelection([]);
    try {
      const res = await window.electronAPI.getDirectoryContents(root.volumeUuid, root.rootPath, dirRel || '', root.deviceId || selectedDeviceId);
      if (!res?.ok) {
        setRemoteError(res?.error || 'Failed to load directory.');
        setRemoteEntries([]);
      } else {
        const files = (res.files || []).filter((f) => f?.status !== 'deleted' && f?.status !== 'missing');
        setRemoteEntries(files);
        setRemoteDirCache((prev) => ({ ...prev, [dirRel || '']: files }));
      }
    } catch (e) {
      setRemoteError(e?.message || String(e));
      setRemoteEntries([]);
    } finally {
      setRemoteLoading(false);
    }
  };

  const openRoot = async (root) => {
    setSelectedRoot(root);
    setRemoteDirRel('');
    setRemoteHistory(['']);
    setRemoteHistoryIndex(0);
    setRemoteSelection([]);
    setMetaEntry(null);
    await loadDirectoryContents(root, '');
  };

  const openEntry = async (entry) => {
    if (!selectedRoot || !entry?.is_dir) return;
    const nextRel = entry.relative_path || entry.path?.replace(`${selectedRoot.rootPath}/`, '');
    setRemoteDirRel(nextRel || '');
    setRemoteHistory((prev) => {
      const next = prev.slice(0, remoteHistoryIndex + 1);
      next.push(nextRel || '');
      return next;
    });
    setRemoteHistoryIndex((prev) => prev + 1);
    setRemoteSelection([]);
    setMetaEntry(null);
    await loadDirectoryContents(selectedRoot, nextRel || '');
  };

  const goUp = async () => {
    if (!selectedRoot) return;
    if (!remoteDirRel) {
      setRemoteEntries([]);
      return;
    }
    const parts = remoteDirRel.split('/').filter(Boolean);
    parts.pop();
    const nextRel = parts.join('/');
    setRemoteDirRel(nextRel);
    setRemoteHistory((prev) => {
      const next = prev.slice(0, remoteHistoryIndex + 1);
      next.push(nextRel);
      return next;
    });
    setRemoteHistoryIndex((prev) => prev + 1);
    setRemoteSelection([]);
    await loadDirectoryContents(selectedRoot, nextRel);
  };

  const goBack = async () => {
    if (!selectedRoot || remoteHistoryIndex <= 0) return;
    const nextIndex = remoteHistoryIndex - 1;
    const nextRel = remoteHistory[nextIndex] || '';
    setRemoteHistoryIndex(nextIndex);
    setRemoteDirRel(nextRel);
    setRemoteSelection([]);
    await loadDirectoryContents(selectedRoot, nextRel);
  };

  const goForward = async () => {
    if (!selectedRoot || remoteHistoryIndex >= remoteHistory.length - 1) return;
    const nextIndex = remoteHistoryIndex + 1;
    const nextRel = remoteHistory[nextIndex] || '';
    setRemoteHistoryIndex(nextIndex);
    setRemoteDirRel(nextRel);
    setRemoteSelection([]);
    await loadDirectoryContents(selectedRoot, nextRel);
  };

  const entryFullPath = (entry) => {
    if (!entry) return '';
    if (entry.path) return entry.path;
    if (selectedRoot?.rootPath && entry.relative_path) {
      return `${selectedRoot.rootPath}/${entry.relative_path}`.replace(/\/+/g, '/');
    }
    return '';
  };

  const shareRemoteEntry = (entry) => {
    const fullPath = entryFullPath(entry);
    if (!fullPath) return;
    const label = entry.name || fullPath.split('/').pop() || fullPath;
    setShareModalPaths([fullPath]);
    setShareModalLabel(label);
    setShareModalMaxDownloads(0);
    setShareModalAllowBrowser(true);
    setShareModalOwnerDeviceId(selectedDeviceId);
    setShareModalOwnerName(selectedDeviceName || selectedDeviceId);
    setShareModalDisplayName(label);
    setShareModalFileCount(entry.is_dir ? 0 : 1);
    setShareModalTotalBytes(typeof entry.size_bytes === 'number' ? entry.size_bytes : null);
    setShareModalOpen(true);
  };

  const toggleRemoteSelection = (entry) => {
    const fullPath = entryFullPath(entry);
    if (!fullPath) return;
    setRemoteSelection((prev) => {
      if (prev.some((p) => p === fullPath)) {
        return prev.filter((p) => p !== fullPath);
      }
      return [...prev, fullPath];
    });
  };

  const clearRemoteSelection = () => setRemoteSelection([]);

  const shareSelectedRemote = async () => {
    if (!remoteSelection.length || !selectedDeviceId) return;
    const label = remoteSelection.length === 1
      ? (remoteSelection[0].split('/').pop() || remoteSelection[0])
      : `${remoteSelection.length} items`;
    setSnackbarQueue((prev) => [...prev, { status: 'info', message: `Creating share for ${label}`, label, transfer: null }]);
    const res = await createShareWithConfig({
      paths: remoteSelection,
      label,
      maxDownloads: 0,
      allowBrowser: true,
      ownerDeviceId: selectedDeviceId,
      ownerName: selectedDeviceName || selectedDeviceId
    });
    if (res?.ok && res.share) {
      const link = normalizeShareLink(res.share);
      if (link) {
        try { await navigator.clipboard.writeText(link); } catch {}
        setInfo('Share link copied to clipboard.');
        setSnackbarQueue((prev) => [...prev, { status: 'completed', message: `Share link copied for ${label}`, label, transfer: null }]);
      }
    }
  };

  const downloadSelectedRemote = async () => {
    if (!remoteSelection.length || !selectedDeviceId) return;
    const label = remoteSelection.length === 1
      ? (remoteSelection[0].split('/').pop() || remoteSelection[0])
      : `${remoteSelection.length} items`;
    setSnackbarQueue((prev) => [...prev, { status: 'starting', message: `Starting download for ${label}`, label, transfer: { status: 'starting' } }]);
    const res = await createShareWithConfig({
      paths: remoteSelection,
      label,
      maxDownloads: 0,
      allowBrowser: true,
      ownerDeviceId: selectedDeviceId,
      ownerName: selectedDeviceName || selectedDeviceId
    });
    if (res?.ok && res.share) {
      await window.electronAPI?.readyShare({ secretId: res.share.secretId });
      setInfo('Download started.');
      setBrowseModalOpen(false);
    }
  };

  const shareEntryDirect = async (entry) => {
    const fullPath = entryFullPath(entry);
    if (!fullPath || !selectedDeviceId) return;
    const label = entry.name || fullPath.split('/').pop() || fullPath;
    const res = await createShareWithConfig({
      paths: [fullPath],
      label,
      maxDownloads: 0,
      allowBrowser: true,
      ownerDeviceId: selectedDeviceId,
      ownerName: selectedDeviceName || selectedDeviceId
    });
    if (res?.ok && res.share) {
      const link = normalizeShareLink(res.share);
      if (link) {
        try { await navigator.clipboard.writeText(link); } catch {}
        setInfo('Share link copied to clipboard.');
      }
    }
  };

  const downloadEntryDirect = async (entry) => {
    const fullPath = entryFullPath(entry);
    if (!fullPath || !selectedDeviceId) return;
    const label = entry.name || fullPath.split('/').pop() || fullPath;
    setSnackbarQueue((prev) => [...prev, { status: 'starting', message: `Starting download for ${label}`, label, transfer: { status: 'starting' } }]);
    const res = await createShareWithConfig({
      paths: [fullPath],
      label,
      maxDownloads: 0,
      allowBrowser: true,
      ownerDeviceId: selectedDeviceId,
      ownerName: selectedDeviceName || selectedDeviceId
    });
    if (res?.ok && res.share) {
      await window.electronAPI?.readyShare({ secretId: res.share.secretId });
      setInfo('Download started.');
      setBrowseModalOpen(false);
    }
  };

  const breadcrumb = remoteDirRel
    ? remoteDirRel.split('/').filter(Boolean)
    : [];

  const jumpToDirRel = async (dirRel) => {
    if (!selectedRoot) return;
    setRemoteDirRel(dirRel || '');
    setRemoteHistory((prev) => {
      const next = prev.slice(0, remoteHistoryIndex + 1);
      next.push(dirRel || '');
      return next;
    });
    setRemoteHistoryIndex((prev) => prev + 1);
    setRemoteSelection([]);
    await loadDirectoryContents(selectedRoot, dirRel || '');
  };

  const getColumnEntries = (dirRel) => {
    return remoteDirCache[dirRel || ''] || [];
  };

  const columnPaths = (() => {
    if (!selectedRoot) return [];
    const parts = breadcrumb;
    const levels = [''];
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      levels.push(acc);
    }
    // show last 3 columns
    return levels.slice(-3);
  })();

  const localManualRoots = useMemo(() => {
    if (!deviceId) return [];
    return (remoteState.roots || [])
      .filter((r) => r?.device_id === deviceId && r?.is_active !== 0)
      .map((r) => ({
        id: r.__rootId || r.id || r.root_id || r.path,
        path: r.path,
        label: r.label || r.path
      }))
      .filter((r) => r.path);
  }, [remoteState, deviceId]);

  const addBrowseFolder = async () => {
    if (!window.electronAPI?.selectDirectory) return;
    const folder = await window.electronAPI.selectDirectory();
    if (!folder) return;
    await window.electronAPI.indexerAddManualRoot?.(folder);
    setBrowseFolders((prev) => Array.from(new Set([...(prev || []), folder])));
    refreshDeviceState();
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
            {share.ownerDeviceId && deviceId && share.ownerDeviceId !== deviceId ? (
              <Tooltip title="Download">
                <span>
                  <IconButton size="small" onClick={() => receiveShare(share)}>
                    <DownloadOutlinedIcon fontSize="inherit" />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
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
              setShareModalOwnerDeviceId('');
              setShareModalOwnerName('');
              setShareModalDisplayName('');
              setShareModalFileCount(null);
              setShareModalTotalBytes(null);
            }}
          >
            Create Share
          </Button>
          <Tooltip title="Refresh">
            <span>
              <IconButton onClick={() => { refreshShares(); refreshDeviceState(); }} disabled={refreshing}>
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

      <Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Computers</Typography>
          <Typography variant="caption" color="text.secondary">
            Select a device to browse its indexed files.
          </Typography>
        </Stack>
        {deviceListError ? <Alert severity="error" sx={{ mb: 1 }}>{deviceListError}</Alert> : null}
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {(remoteState.devices || []).length ? (
            remoteState.devices
              .filter((device) => {
                const id = device.device_id || device.id || device.deviceId;
                if (deviceId && id === deviceId) return true;
                const policy = getDeviceBrowsePolicy(device);
                return policy.enabled;
              })
              .map((device) => {
                const id = device.device_id || device.id || device.deviceId;
                const label = String(device.name || id || 'device').split('.')[0];
                const selected = id && id === selectedDeviceId;
                return (
                  <Chip
                    key={id || label}
                    label={label}
                    color={selected ? 'primary' : 'default'}
                    variant={selected ? 'filled' : 'outlined'}
                    onClick={() => selectDevice({ device_id: id, name: label })}
                  />
                );
              })
          ) : (
            <Typography variant="body2" color="text.secondary">
              No devices registered yet.
            </Typography>
          )}
        </Stack>
        {selectedDeviceId ? null : null}
      </Box>

      <Dialog
        open={browseModalOpen}
        onClose={() => setBrowseModalOpen(false)}
        maxWidth="xl"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#14161a' } }}
      >
        <DialogTitle sx={{ bgcolor: '#14161a' }}>{selectedDeviceName || selectedDeviceId} Files</DialogTitle>
        <DialogContent dividers sx={{ bgcolor: '#14161a' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '260px 1fr' }, gap: 2, height: 680 }}>
            <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, p: 1.5, overflow: 'auto' }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Sources
              </Typography>
              {deviceRoots.length ? (
                <Stack spacing={0.5}>
                  {deviceRoots.map((root) => (
                    <Button
                      key={root.key}
                      size="small"
                      variant={selectedRoot?.key === root.key ? 'contained' : 'text'}
                      onClick={() => openRoot(root)}
                      sx={{ justifyContent: 'flex-start' }}
                    >
                      {root.label}
                    </Button>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No indexed roots for this device.
                </Typography>
              )}
            </Box>
            <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, p: 1.5, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2">Browse</Typography>
                {remoteSelection.length ? (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button size="small" variant="outlined" onClick={shareSelectedRemote}>
                      Share Link
                    </Button>
                    <Button size="small" variant="contained" onClick={downloadSelectedRemote}>
                      Download
                    </Button>
                    <Button size="small" variant="text" onClick={clearRemoteSelection}>
                      Clear
                    </Button>
                  </Stack>
                ) : null}
                <Stack direction="row" spacing={0.5}>
                  <IconButton size="small" onClick={goBack} disabled={remoteHistoryIndex <= 0}>
                    ‹
                  </IconButton>
                  <IconButton size="small" onClick={goForward} disabled={remoteHistoryIndex >= remoteHistory.length - 1}>
                    ›
                  </IconButton>
                </Stack>
                {selectedRoot ? (
                  <>
                    <Button size="small" onClick={goUp} disabled={!remoteDirRel}>
                      Up
                    </Button>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      <Button size="small" variant="text" onClick={() => jumpToDirRel('')}>
                        {selectedRoot.rootPath}
                      </Button>
                      {breadcrumb.map((part, idx) => {
                        const rel = breadcrumb.slice(0, idx + 1).join('/');
                        return (
                          <Button key={rel} size="small" variant="text" onClick={() => jumpToDirRel(rel)}>
                            / {part}
                          </Button>
                        );
                      })}
                    </Typography>
                  </>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    Pick a source to view files.
                  </Typography>
                )}
              </Stack>
              {remoteError ? <Alert severity="error" sx={{ mb: 1 }}>{remoteError}</Alert> : null}
              {selectedRoot ? (
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, flex: 1, minHeight: 0 }}>
                  {columnPaths.map((dirRel) => {
                    const entries = getColumnEntries(dirRel);
                    return (
                      <Box key={dirRel || 'root'} sx={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <Box sx={{ px: 1.5, py: 1, bgcolor: 'rgba(255,255,255,0.04)' }}>
                          <Typography variant="caption" color="text.secondary">
                            {dirRel ? dirRel.split('/').slice(-1)[0] : (selectedRoot.label || selectedRoot.rootPath)}
                          </Typography>
                        </Box>
                        <Box sx={{ overflow: 'auto', flex: 1 }}>
                          <List dense disablePadding>
                            {entries.map((entry) => {
                              const isActive = entry.is_dir && (entry.relative_path || '') === remoteDirRel;
                              const checked = remoteSelection.includes(entry.path);
                              return (
                                <ListItem key={entry.path || entry.relative_path} disablePadding>
                                  <ListItemButton
                                    selected={isActive}
                                    onClick={() => entry.is_dir ? openEntry(entry) : setMetaEntry(entry)}
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleRemoteSelection(entry);
                                      }}
                                    />
                                    <ListItemText
                                      primary={entry.name || entry.relative_path || entry.path}
                                      secondary={entry.is_dir ? 'Folder' : formatBytes(entry.size_bytes || 0)}
                                    />
                                  </ListItemButton>
                                </ListItem>
                              );
                            })}
                            {!entries.length && !remoteLoading ? (
                              <ListItem>
                                <ListItemText primary="Empty" primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }} />
                              </ListItem>
                            ) : null}
                          </List>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              ) : null}
              {metaEntry ? (
                <Box sx={{ mt: 1.5, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, p: 1.5 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Metadata</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {metaEntry.name || metaEntry.relative_path || metaEntry.path || '—'}
                    </Typography>
                    <Typography variant="body2">{metaEntry.path || '—'}</Typography>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Type</Typography>
                        <Typography variant="body2">{metaEntry.is_dir ? 'Folder' : 'File'}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Size</Typography>
                        <Typography variant="body2">{metaEntry.is_dir ? '—' : formatBytes(metaEntry.size_bytes || 0)}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Modified</Typography>
                        <Typography variant="body2">{metaEntry.mtime ? new Date(metaEntry.mtime * 1000).toLocaleString() : '—'}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Kind</Typography>
                        <Typography variant="body2">{metaEntry.file_type || metaEntry.ext || '—'}</Typography>
                      </Box>
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="outlined" onClick={() => shareEntryDirect(metaEntry)}>
                        Share Link
                      </Button>
                      <Button size="small" variant="contained" onClick={() => downloadEntryDirect(metaEntry)}>
                        Download
                      </Button>
                    </Stack>
                  </Stack>
                </Box>
              ) : null}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBrowseModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

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
      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#14161a' } }}
      >
        <DialogTitle sx={{ bgcolor: '#14161a' }}>Transfer Settings</DialogTitle>
        <DialogContent dividers sx={{ bgcolor: '#14161a' }}>
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
            <FormControlLabel
              control={(
                <Switch
                  checked={browseEnabled}
                  onChange={(e) => setBrowseEnabled(e.target.checked)}
                />
              )}
              label="Allow other computers to browse this computer"
            />
            <TextField
              select
              label="Browse access"
              value={browseMode}
              onChange={(e) => setBrowseMode(e.target.value)}
              size="small"
              fullWidth
            >
              <MenuItem value="external">External volumes only</MenuItem>
              <MenuItem value="indexed">Indexed files</MenuItem>
              <MenuItem value="all">All files</MenuItem>
              <MenuItem value="custom">Choose my own folders</MenuItem>
            </TextField>
            {browseMode === 'custom' ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Allowed folders
                </Typography>
                <Button variant="outlined" size="small" onClick={addBrowseFolder} sx={{ mb: 1 }}>
                  Add Folder
                </Button>
                {localManualRoots.length ? (
                  <Stack spacing={0.5}>
                    {localManualRoots.map((root) => {
                      const checked = browseFolders.includes(root.path);
                      return (
                        <FormControlLabel
                          key={root.id}
                          control={(
                            <Checkbox
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setBrowseFolders((prev) => Array.from(new Set([...prev, root.path])));
                                } else {
                                  setBrowseFolders((prev) => prev.filter((p) => p !== root.path));
                                }
                              }}
                            />
                          )}
                          label={root.label}
                        />
                      );
                    })}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Add manual roots in the Indexer page to choose folders.
                  </Typography>
                )}
              </Box>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Close</Button>
          <Button variant="contained" onClick={updateDownloadDir}>Save</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#14161a' } }}
      >
        <DialogTitle sx={{ bgcolor: '#14161a' }}>Create Share</DialogTitle>
        <DialogContent dividers sx={{ bgcolor: '#14161a' }}>
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
