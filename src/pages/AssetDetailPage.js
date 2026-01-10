import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DetailPanel from '../components/DetailPanel';
import MediaPlayer from '../components/MediaPlayer';
import { formatBytes } from '../utils/formatters';

const VIDEO_EXTS = new Set([
  'mp4', 'mov', 'mxf', 'mkv', 'avi', 'webm', 'mts', 'm2ts', 'mpg', 'mpeg', 'flv',
  'f4v', '3gp', '3g2', 'wmv', 'hevc', 'ts', 'vob', 'rmvb', 'divx', 'm4v', 'ogv',
  'braw', 'r3d', 'crm', 'cin', 'dpx', 'm2v', 'm2p', 'avc', 'h264', 'h265', 'prores'
]);
const AUDIO_EXTS = new Set([
  'wav', 'mp3', 'aac', 'flac', 'm4a', 'ogg', 'wma', 'aiff', 'alac', 'opus', 'aif',
  'caf', 'ac3', 'dts', 'mka', 'mp2', 'au', 'mid', 'midi'
]);
const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp', 'heic', 'heif', 'svg', 'raw',
  'cr2', 'nef', 'arw', 'orf', 'raf', 'dng', 'sr2', 'pef', 'rw2', '3fr'
]);

function getExt(item) {
  return (item?.ext || item?.name?.split('.').pop() || '').toLowerCase();
}

function buildPath(rootPath, relPath) {
  const cleanRel = (relPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!rootPath) return null;
  return cleanRel ? `${rootPath}/${cleanRel}` : rootPath;
}

export default function AssetDetailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [item, setItem] = useState(location.state?.item || null);
  const [contents, setContents] = useState([]);
  const [mediaInfo, setMediaInfo] = useState(null);

  const isDirectory = !!item?.is_dir;
  const ext = getExt(item);
  const fileType = (item?.file_type || '').toLowerCase();
  const canPreviewImage = IMAGE_EXTS.has(ext) || fileType.includes('image');
  const canPreviewVideo = VIDEO_EXTS.has(ext) || fileType.includes('video');
  const canPreviewAudio = AUDIO_EXTS.has(ext) || fileType.includes('audio');
  const isR3D = ext === 'r3d';
  const itemPath = item?.path || buildPath(item?.root_path, item?.relative_path);
  const resolvedItem = itemPath ? { ...item, path: itemPath } : item;

  useEffect(() => {
    if (!item?.is_dir) {
      setContents([]);
      return;
    }
    const run = async () => {
      if (!window.electronAPI?.getDirectoryContents) return;
      const res = await window.electronAPI.getDirectoryContents(
        item.volume_uuid,
        item.root_path,
        item.relative_path
      );
      if (res?.ok) {
        const files = (res.files || []).map((f) => ({
          ...f,
          path: f.path || buildPath(f.root_path || item?.root_path, f.relative_path)
        }));
        setContents(files);
      }
    };
    run();
  }, [item?.is_dir, item?.volume_uuid, item?.root_path, item?.relative_path]);

  useEffect(() => {
    let cancelled = false;
    if (!itemPath || isDirectory || !window.electronAPI?.getMediaInfo) {
      setMediaInfo(null);
      return () => {};
    }
    window.electronAPI.getMediaInfo(itemPath).then((res) => {
      if (!cancelled && res?.ok) setMediaInfo(res.mediaInfo || null);
    });
    return () => { cancelled = true; };
  }, [itemPath, isDirectory]);

  const handleOpen = useCallback(() => {
    if (!itemPath || !window.electronAPI?.openPath) return;
    window.electronAPI.openPath(itemPath);
  }, [itemPath]);

  const handleOpenFinder = useCallback(() => {
    if (!itemPath || !window.electronAPI?.openInFinder) return;
    window.electronAPI.openInFinder(itemPath);
  }, [itemPath]);

  const preview = useMemo(() => {
    if (!item || !itemPath || isDirectory) return null;
    if (canPreviewImage) {
      return (
        <Box
          component="img"
          src={`file://${itemPath}`}
          alt={item.name}
          sx={{ width: '100%', maxHeight: '32vh', objectFit: 'contain', bgcolor: 'black' }}
        />
      );
    }
    return null;
  }, [item, itemPath, isDirectory, canPreviewImage]);

  if (!item) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>No item selected.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <Box sx={{ flex: 1, minWidth: 0, p: 3, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Stack spacing={2} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center">
              <IconButton onClick={() => navigate(-1)} size="small">
                <ArrowBackIcon fontSize="small" />
              </IconButton>
              <Typography variant="h5">{item.name || item.path}</Typography>
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" onClick={handleOpenFinder}>Reveal in Finder</Button>
              <Button variant="contained" onClick={handleOpen} startIcon={<OpenInNewIcon />}>
                Open
              </Button>
            </Stack>
          </Stack>

          {preview && (
            <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, p: 2, overflow: 'hidden', flexShrink: 0 }}>
              {preview}
              {isR3D && (
                <Button sx={{ mt: 2 }} variant="outlined" onClick={handleOpen}>
                  Open in RED Player
                </Button>
              )}
            </Box>
          )}

          {(canPreviewVideo || canPreviewAudio) && (
            <Box sx={{ overflow: 'hidden', flexShrink: 0 }}>
              <MediaPlayer item={resolvedItem} ffprobeData={mediaInfo} />
            </Box>
          )}

          {isDirectory && (
            <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, p: 2, overflow: 'hidden', flexShrink: 0 }}>
              <Typography variant="subtitle2" color="text.secondary">Contents</Typography>
              <Divider sx={{ my: 1 }} />
              <List dense disablePadding sx={{ maxHeight: 260, overflow: 'hidden' }}>
                {contents.map((child, idx) => (
                  <ListItemButton
                    key={`${child.relative_path}-${idx}`}
                    onClick={() => setItem({
                      ...child,
                      path: child.path || buildPath(child.root_path || item?.root_path, child.relative_path)
                    })}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      {child.is_dir ? (
                        <FolderIcon sx={{ color: 'primary.main', fontSize: 20 }} />
                      ) : (
                        <InsertDriveFileIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={child.name}
                      secondary={child.is_dir ? null : formatBytes(child.size_bytes)}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          )}
        </Stack>
      </Box>

      <Box sx={{ width: 420, flexShrink: 0, borderLeft: 1, borderColor: 'divider' }}>
        <DetailPanel
          item={item}
          onItemClick={(child) => setItem(child)}
          onClose={() => navigate(-1)}
          width="100%"
          height="100%"
        />
      </Box>
    </Box>
  );
}
