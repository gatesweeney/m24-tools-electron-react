import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Collapse from '@mui/material/Collapse';
import Alert from '@mui/material/Alert';
import CloseIcon from '@mui/icons-material/Close';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { formatBytes, formatDateTime, formatDurationSec, formatBitrate } from '../utils/formatters';

const VIDEO_EXTS = ['mp4', 'mov', 'mxf', 'mkv', 'avi', 'webm', 'mts', 'm2ts'];
const AUDIO_EXTS = ['wav', 'mp3', 'aac', 'flac', 'm4a', 'ogg', 'wma', 'aiff'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp', 'heic'];

function DetailRow({ label, value }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 90, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'right', wordBreak: 'break-word', ml: 1 }}>
        {value || '—'}
      </Typography>
    </Box>
  );
}

function SectionTitle({ children }) {
  return (
    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: 'primary.main' }}>
      {children}
    </Typography>
  );
}

/**
 * DetailPanel - shows either directory contents or file details
 * Finder column-view style navigation
 */
export default function DetailPanel({
  item,
  onItemClick,
  onClose,
  selectedChildId,
  width = 350
}) {
  const [loading, setLoading] = useState(false);
  const [contents, setContents] = useState([]);
  const [stats, setStats] = useState(null);
  const [extendedData, setExtendedData] = useState(null);
  const [thumbnails, setThumbnails] = useState({});

  // Transcription state
  const [transcription, setTranscription] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState(null);
  const [transcribeError, setTranscribeError] = useState(null);
  const [transcriptionExpanded, setTranscriptionExpanded] = useState(true);
  const [whisperAvailable, setWhisperAvailable] = useState(null);

  const isDirectory = item?.is_dir;
  const ext = item?.ext?.toLowerCase();
  const canTranscribe = ext && (VIDEO_EXTS.includes(ext) || AUDIO_EXTS.includes(ext));

  // Check if whisper is available
  useEffect(() => {
    if (window.electronAPI?.transcribeCheckAvailable) {
      window.electronAPI.transcribeCheckAvailable().then(res => {
        setWhisperAvailable(res?.available || false);
      });
    }
  }, []);

  // Listen for transcription progress
  useEffect(() => {
    if (!window.electronAPI?.onTranscribeProgress) return;

    const unsubscribe = window.electronAPI.onTranscribeProgress((data) => {
      if (data.filePath === item?.path) {
        setTranscribeProgress(data);
      }
    });

    return () => unsubscribe();
  }, [item?.path]);

  // Check for cached transcription when item changes
  useEffect(() => {
    if (!item?.path || isDirectory || !canTranscribe) {
      setTranscription(null);
      setTranscribeError(null);
      return;
    }

    if (window.electronAPI?.transcribeGetCached) {
      window.electronAPI.transcribeGetCached(item.path).then(res => {
        if (res?.ok) {
          setTranscription({
            text: res.text,
            language: res.language,
            transcribedAt: res.transcribedAt
          });
        } else {
          setTranscription(null);
        }
      });
    }
  }, [item?.path, isDirectory, canTranscribe]);

  // Fetch directory contents or file details when item changes
  useEffect(() => {
    if (!item) {
      setContents([]);
      setStats(null);
      setExtendedData(null);
      setThumbnails({});
      setTranscription(null);
      setTranscribeError(null);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setThumbnails({});

      try {
        if (isDirectory) {
          // Fetch directory contents
          let files = [];
          if (window.electronAPI?.getDirectoryContents) {
            const res = await window.electronAPI.getDirectoryContents(
              item.volume_uuid,
              item.root_path,
              item.relative_path
            );
            if (res?.ok) {
              files = res.files || [];
              setContents(files);
            }
          }

          // Fetch directory stats
          if (window.electronAPI?.getDirectoryStats) {
            const statsRes = await window.electronAPI.getDirectoryStats(
              item.volume_uuid,
              item.root_path,
              item.relative_path
            );
            if (statsRes?.ok) {
              setStats(statsRes.stats);
            }
          }

          // Fetch thumbnails for media files in directory (async, after main load)
          if (files.length > 0 && window.electronAPI?.generateBatchThumbnails) {
            const mediaFiles = files.filter(f => !f.is_dir && f.path);
            if (mediaFiles.length > 0) {
              // Don't await - let thumbnails load in background
              window.electronAPI.generateBatchThumbnails(mediaFiles).then(thumbRes => {
                if (thumbRes?.ok) {
                  setThumbnails(thumbRes.thumbnails || {});
                }
              });
            }
          }
        } else {
          // Fetch file details (volume, ffprobe, thumbnails)
          let volume = null;
          let ffprobeData = null;
          let clipThumbs = null;

          if (item.volume_uuid && window.electronAPI?.getVolumeInfo) {
            const volumeRes = await window.electronAPI.getVolumeInfo(item.volume_uuid);
            if (volumeRes?.ok) volume = volumeRes.volume;
          }

          if (item.path && window.electronAPI?.getMediaInfo) {
            const mediaRes = await window.electronAPI.getMediaInfo(item.path);
            if (mediaRes?.ok) ffprobeData = mediaRes.mediaInfo;
          }

          const ext = item.ext?.toLowerCase();
          if (ext && VIDEO_EXTS.includes(ext) && item.path && window.electronAPI?.generateClipThumbnails) {
            const thumbRes = await window.electronAPI.generateClipThumbnails(item.path);
            if (thumbRes?.ok) clipThumbs = thumbRes.thumbs;
          }

          setExtendedData({ volume, ffprobeData, clipThumbs });
        }
      } catch (e) {
        console.error('DetailPanel fetch error:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [item, isDirectory]);

  const handleItemClick = useCallback((childItem) => {
    if (onItemClick) {
      onItemClick(childItem);
    }
  }, [onItemClick]);

  const handleRevealInFinder = useCallback(async () => {
    if (window.electronAPI?.openInFinder && item?.path) {
      await window.electronAPI.openInFinder(item.path);
    }
  }, [item]);

  const handleTranscribe = useCallback(async () => {
    if (!window.electronAPI?.transcribeRequest || !item?.path) return;

    setTranscribing(true);
    setTranscribeError(null);
    setTranscribeProgress(null);

    try {
      const res = await window.electronAPI.transcribeRequest(item.path);
      if (res?.ok) {
        setTranscription({
          text: res.text,
          language: res.language,
          cached: res.cached
        });
      } else {
        setTranscribeError(res?.error || 'Transcription failed');
      }
    } catch (e) {
      setTranscribeError(e.message || String(e));
    } finally {
      setTranscribing(false);
      setTranscribeProgress(null);
    }
  }, [item?.path]);

  if (!item) return null;

  const volume = extendedData?.volume;
  const ffprobeData = extendedData?.ffprobeData;
  const clipThumbs = extendedData?.clipThumbs;

  return (
    <Paper
      elevation={2}
      sx={{
        width,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 2,
        borderLeft: 1,
        borderColor: 'divider'
      }}
    >
      {/* Panel Header */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, mr: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
            {isDirectory ? (
              <FolderIcon sx={{ color: 'primary.main', fontSize: 24, flexShrink: 0 }} />
            ) : (
              <InsertDriveFileIcon sx={{ color: 'text.secondary', fontSize: 22, flexShrink: 0 }} />
            )}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
                {item.name || '(no name)'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all', display: 'block' }}>
                {item.path}
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Stats for directories */}
        {isDirectory && stats && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {stats.file_count} files, {stats.dir_count} folders • {formatBytes(stats.total_bytes)}
          </Typography>
        )}

        <Button
          variant="outlined"
          size="small"
          startIcon={<FolderOpenIcon />}
          disabled={!window.electronAPI?.openInFinder || !item.path}
          onClick={handleRevealInFinder}
          sx={{ mt: 1.5 }}
        >
          Reveal in Finder
        </Button>
      </Box>

      {/* Panel Content */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {/* Directory Contents */}
        {isDirectory && !loading && (
          <List dense disablePadding>
            {contents.length === 0 ? (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Empty folder
                </Typography>
              </Box>
            ) : (
              contents.map((child, idx) => {
                const thumbPath = thumbnails[child.path];
                const hasThumb = thumbPath && !child.is_dir;

                return (
                  <ListItemButton
                    key={`${child.relative_path}-${idx}`}
                    onClick={() => handleItemClick(child)}
                    selected={selectedChildId === child.relative_path}
                    sx={{
                      borderBottom: 1,
                      borderColor: 'divider',
                      '&:last-child': { borderBottom: 0 },
                      py: hasThumb ? 0.5 : 1
                    }}
                  >
                    {/* Thumbnail or icon */}
                    {hasThumb ? (
                      <Box
                        component="img"
                        src={`file://${thumbPath}?t=1`}
                        alt=""
                        sx={{
                          width: 40,
                          height: 40,
                          objectFit: 'cover',
                          borderRadius: 0.5,
                          mr: 1.5,
                          flexShrink: 0,
                          bgcolor: 'action.hover'
                        }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        {child.is_dir ? (
                          <FolderIcon sx={{ color: 'primary.main', fontSize: 20 }} />
                        ) : (
                          <InsertDriveFileIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                        )}
                      </ListItemIcon>
                    )}
                    <ListItemText
                      primary={child.name}
                      secondary={child.is_dir ? null : formatBytes(child.size_bytes)}
                      primaryTypographyProps={{
                        variant: 'body2',
                        fontWeight: child.is_dir ? 600 : 400,
                        noWrap: true
                      }}
                      secondaryTypographyProps={{
                        variant: 'caption'
                      }}
                    />
                    <ChevronRightIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                  </ListItemButton>
                );
              })
            )}
          </List>
        )}

        {/* File Details */}
        {!isDirectory && !loading && (
          <Stack spacing={2.5} sx={{ p: 2 }}>
            {/* Clip Thumbnails */}
            {clipThumbs && clipThumbs.length > 0 && (
              <Box>
                <SectionTitle>Preview</SectionTitle>
                <Stack direction="row" spacing={1}>
                  {clipThumbs.map((thumbPath, i) => (
                    <Box
                      key={i}
                      component="img"
                      src={`file://${thumbPath}?t=${Date.now()}`}
                      alt={`Frame ${i + 1}`}
                      sx={{
                        flex: 1,
                        height: 80,
                        objectFit: 'cover',
                        borderRadius: 1,
                        bgcolor: 'action.hover'
                      }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ))}
                </Stack>
              </Box>
            )}

            {/* FFprobe Data */}
            {ffprobeData && !ffprobeData.error && (
              <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.5 }}>
                <SectionTitle>Media Info</SectionTitle>
                <Stack spacing={0.5}>
                  {ffprobeData.duration && (
                    <DetailRow label="Duration" value={formatDurationSec(ffprobeData.duration)} />
                  )}
                  {ffprobeData.width && ffprobeData.height && (
                    <DetailRow label="Resolution" value={`${ffprobeData.width} × ${ffprobeData.height}`} />
                  )}
                  {ffprobeData.codec && <DetailRow label="Video" value={ffprobeData.codec} />}
                  {ffprobeData.audioCodec && <DetailRow label="Audio" value={ffprobeData.audioCodec} />}
                  {ffprobeData.audioSampleRate && (
                    <DetailRow label="Sample Rate" value={`${(parseInt(ffprobeData.audioSampleRate, 10) / 1000).toFixed(1)} kHz`} />
                  )}
                  {ffprobeData.bitrate && <DetailRow label="Bitrate" value={formatBitrate(ffprobeData.bitrate)} />}
                </Stack>
              </Box>
            )}

            <Divider />

            {/* File Info */}
            <Box>
              <SectionTitle>File</SectionTitle>
              <Stack spacing={0.5}>
                <DetailRow label="Size" value={formatBytes(item.size_bytes)} />
                <DetailRow label="Extension" value={item.ext || '(none)'} />
                <DetailRow label="Modified" value={item.mtime ? formatDateTime(item.mtime * 1000) : '—'} />
              </Stack>
            </Box>

            <Divider />

            {/* Volume */}
            <Box>
              <SectionTitle>Volume</SectionTitle>
              <Stack spacing={0.5}>
                <DetailRow label="Name" value={volume?.volume_name} />
                <DetailRow label="UUID" value={item.volume_uuid} />
                <DetailRow label="Mount" value={volume?.mount_point_last} />
              </Stack>
            </Box>

            {/* Transcription - only for audio/video files */}
            {canTranscribe && (
              <>
                <Divider />
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <SectionTitle>Transcription</SectionTitle>
                    {transcription && (
                      <IconButton
                        size="small"
                        onClick={() => setTranscriptionExpanded(!transcriptionExpanded)}
                      >
                        {transcriptionExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    )}
                  </Box>

                  {/* Transcribe button - show if not transcribed yet */}
                  {!transcription && !transcribing && (
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<RecordVoiceOverIcon />}
                      onClick={handleTranscribe}
                      disabled={whisperAvailable === false}
                      fullWidth
                    >
                      {whisperAvailable === false ? 'Whisper not installed' : 'Transcribe Audio'}
                    </Button>
                  )}

                  {/* Progress indicator */}
                  {transcribing && (
                    <Box sx={{ textAlign: 'center', py: 1 }}>
                      <CircularProgress size={24} sx={{ mb: 1 }} />
                      <Typography variant="caption" display="block" color="text.secondary">
                        {transcribeProgress?.message || 'Transcribing...'}
                      </Typography>
                      {transcribeProgress?.progress > 0 && (
                        <LinearProgress
                          variant="determinate"
                          value={transcribeProgress.progress}
                          sx={{ mt: 1 }}
                        />
                      )}
                    </Box>
                  )}

                  {/* Error message */}
                  {transcribeError && (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      {transcribeError}
                    </Alert>
                  )}

                  {/* Transcription result */}
                  {transcription && (
                    <Collapse in={transcriptionExpanded}>
                      <Box
                        sx={{
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          p: 1.5,
                          maxHeight: 200,
                          overflow: 'auto'
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontSize: '0.8rem',
                            lineHeight: 1.5
                          }}
                        >
                          {transcription.text || '(No speech detected)'}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        Language: {transcription.language || 'auto'}
                        {transcription.cached && ' (cached)'}
                      </Typography>
                      {/* Re-transcribe button */}
                      <Button
                        variant="text"
                        size="small"
                        onClick={handleTranscribe}
                        disabled={transcribing || whisperAvailable === false}
                        sx={{ mt: 1 }}
                      >
                        Re-transcribe
                      </Button>
                    </Collapse>
                  )}

                  {/* Hint for installing whisper */}
                  {whisperAvailable === false && !transcription && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      Install whisper.cpp: brew install whisper-cpp
                    </Typography>
                  )}
                </Box>
              </>
            )}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
