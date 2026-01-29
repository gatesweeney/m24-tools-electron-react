import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Tooltip from '@mui/material/Tooltip';
import LinearProgress from '@mui/material/LinearProgress';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

const VIDEO_EXTS = new Set([
  'mp4', 'mov', 'mxf', 'mkv', 'avi', 'webm', 'mts', 'm2ts', 'mpg', 'mpeg', 'flv',
  'f4v', '3gp', '3g2', 'wmv', 'hevc', 'ts', 'vob', 'rmvb', 'divx', 'm4v', 'ogv',
  'braw', 'r3d', 'crm', 'cin', 'dpx', 'm2v', 'm2p', 'avc', 'h264', 'h265', 'prores'
]);
const AUDIO_EXTS = new Set([
  'wav', 'mp3', 'aac', 'flac', 'm4a', 'ogg', 'wma', 'aiff', 'alac', 'opus', 'aif',
  'caf', 'ac3', 'dts', 'mka', 'mp2', 'au', 'mid', 'midi'
]);

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatTimecode(seconds, fps) {
  if (!Number.isFinite(seconds)) return '00:00:00:00';
  const s = Math.max(0, seconds);
  const frames = fps ? Math.floor((s * fps) % fps) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

function getExt(item) {
  return (item?.ext || item?.name?.split('.').pop() || '').toLowerCase();
}

function buildPath(rootPath, relPath) {
  const cleanRel = (relPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!rootPath) return null;
  return cleanRel ? `${rootPath}/${cleanRel}` : rootPath;
}

function normalizeThumbs(thumbs, duration) {
  if (!Array.isArray(thumbs)) return [];
  const count = thumbs.length;
  return thumbs.map((t, i) => {
    if (typeof t === 'string') {
      const time = duration > 0 ? (duration * (i + 1)) / (count + 1) : null;
      return { path: t, time, index: i };
    }
    return { ...t, index: i };
  });
}

export default function MediaPlayer({ item, clipThumbs = [], ffprobeData = null }) {
  const ext = getExt(item);
  const fileType = (item?.file_type || '').toLowerCase();
  const isVideo = VIDEO_EXTS.has(ext) || fileType.includes('video');
  const isAudio = AUDIO_EXTS.has(ext) || fileType.includes('audio');
  const canWaveform = isAudio || isVideo;
  const isR3D = ext === 'r3d';
  const itemPath = item?.path || buildPath(item?.root_path, item?.relative_path);

  const mediaRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const waveformWrapRef = useRef(null);
  const playerWrapRef = useRef(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [peaks, setPeaks] = useState([]);
  const [waveformStatus, setWaveformStatus] = useState('idle');
  const [waveformImage, setWaveformImage] = useState(null);
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [hoverTime, setHoverTime] = useState(null);
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const [thumbCount, setThumbCount] = useState(10);
  const [thumbs, setThumbs] = useState([]);
  const [hoverThumb, setHoverThumb] = useState(null);
  const [inPoint, setInPoint] = useState(null);
  const [outPoint, setOutPoint] = useState(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [waveformWidth, setWaveformWidth] = useState(980);
  const [waveformGainDb, setWaveformGainDb] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [isTheater, setIsTheater] = useState(false);
  const [proxySrc, setProxySrc] = useState(null);
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyError, setProxyError] = useState(null);

  const effectiveDuration = duration || ffprobeData?.duration || 0;
  const thumbItems = useMemo(() => normalizeThumbs(thumbs, effectiveDuration), [thumbs, effectiveDuration]);

  useEffect(() => {
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setThumbs([]);
    setWaveformImage(null);
    setProxySrc(null);
    setProxyLoading(false);
    setProxyError(null);
  }, [itemPath]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return undefined;

    const handleLoaded = () => {
      const d = media.duration || 0;
      setDuration(d);
    };
    const handleTime = () => {
      const t = media.currentTime || 0;
      setCurrentTime(t);
      if (loopEnabled && inPoint != null && outPoint != null && outPoint > inPoint) {
        if (t >= outPoint) {
          media.currentTime = inPoint;
        }
      }
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    media.addEventListener('loadedmetadata', handleLoaded);
    media.addEventListener('timeupdate', handleTime);
    media.addEventListener('play', handlePlay);
    media.addEventListener('pause', handlePause);

    return () => {
      media.removeEventListener('loadedmetadata', handleLoaded);
      media.removeEventListener('timeupdate', handleTime);
      media.removeEventListener('play', handlePlay);
      media.removeEventListener('pause', handlePause);
    };
  }, [inPoint, outPoint, loopEnabled]);

  useEffect(() => {
    if (!isVideo || !itemPath || !window.electronAPI?.generateClipThumbnails) {
      setThumbs([]);
      setThumbsLoading(false);
      return;
    }
    let cancelled = false;
    setThumbsLoading(true);
    window.electronAPI.generateClipThumbnails(itemPath, { count: thumbCount }).then((res) => {
      if (!cancelled && res?.ok) {
        const mapped = (res.thumbs || []).map((p, i) => ({
          path: p,
          time: Array.isArray(res.times) ? res.times[i] : null
        }));
        setThumbs(mapped);
      }
      if (!cancelled) setThumbsLoading(false);
    });
    return () => { cancelled = true; };
  }, [isVideo, itemPath, thumbCount]);

  useEffect(() => {
    if (clipThumbs && clipThumbs.length > 0 && thumbs.length === 0) {
      setThumbs(clipThumbs);
    }
  }, [clipThumbs, thumbs.length]);

  useEffect(() => {
    if (!canWaveform || !itemPath) {
      setPeaks([]);
      setWaveformImage(null);
      setWaveformStatus('idle');
      return undefined;
    }

    let cancelled = false;
    const run = async () => {
      try {
        setWaveformStatus('loading');
        const imgRes = await window.electronAPI?.generateWaveformImage?.(itemPath, {
          width: Math.round(waveformWidth),
          height: 120,
          colors: '#93a9bf|#3f5c74|#93a9bf',
          gainDb: waveformGainDb,
          bg: '#1e2227'
        });
        if (imgRes?.ok && imgRes.path && !cancelled) {
          setWaveformImage(imgRes.path);
          setWaveformStatus('ready');
          return;
        }

        const cached = await window.electronAPI?.getWaveformCache?.(itemPath);
        if (cached?.ok && cached.peaks && cached.duration) {
          if (!cancelled) {
            setDuration(cached.duration);
            setPeaks(cached.peaks);
            setWaveformStatus(cached.peaks.length > 0 ? 'ready' : 'empty');
          }
          return;
        }
        setWaveformStatus('error');
      } catch (e) {
        setPeaks([]);
        setWaveformImage(null);
        setWaveformStatus('error');
      }
    };
    run();
    return () => { cancelled = true; };
  }, [canWaveform, itemPath, waveformWidth, waveformGainDb]);

  useEffect(() => {
    const update = () => {
      if (!waveformWrapRef.current) return;
      const rect = waveformWrapRef.current.getBoundingClientRect();
      if (rect.width > 0) setWaveformWidth(rect.width);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = Math.max(0, Math.min(volume, 1));
    media.muted = muted;
    media.playbackRate = rate;
  }, [volume, muted, rate]);

  const ensureAudioGraph = useCallback(() => {
    if (!mediaRef.current) return;
    if (!audioCtxRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
    }
    const ctx = audioCtxRef.current;
    if (!sourceRef.current) {
      sourceRef.current = ctx.createMediaElementSource(mediaRef.current);
      sourceRef.current.connect(ctx.destination);
    }
    return ctx;
  }, []);

  const handleToggle = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    ensureAudioGraph();
    if (media.paused) media.play();
    else media.pause();
  }, [ensureAudioGraph]);

  const handleFullscreen = useCallback(() => {
    setIsTheater((v) => !v);
  }, []);

  const handleSeek = useCallback((time) => {
    const media = mediaRef.current;
    if (!media || !Number.isFinite(time)) return;
    media.currentTime = Math.max(0, Math.min(time, effectiveDuration || 0));
  }, [effectiveDuration]);

  const handleSeekPercent = useCallback((pct) => {
    if (!effectiveDuration || !Number.isFinite(pct)) return;
    handleSeek(pct * effectiveDuration);
  }, [effectiveDuration, handleSeek]);

  const imageWidth = Math.round(waveformWidth);

  const rulerTicks = useMemo(() => {
    if (!effectiveDuration || !imageWidth) return [];
    const targetTicks = Math.max(6, Math.min(18, Math.floor(imageWidth / 80)));
    const rawStep = effectiveDuration / targetTicks;
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
    const step = steps.find((s) => s >= rawStep) || steps[steps.length - 1];
    const ticks = [];
    for (let t = 0; t <= effectiveDuration + 0.01; t += step) {
      ticks.push(t);
    }
    return ticks;
  }, [effectiveDuration, imageWidth]);

  const handleBarClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const totalWidth = rect.width || imageWidth;
    const pct = totalWidth > 0 ? (e.clientX - rect.left) / totalWidth : 0;
    handleSeekPercent(pct);
  }, [handleSeekPercent, imageWidth]);

  const handleBarMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const totalWidth = rect.width || imageWidth;
    const pct = totalWidth > 0 ? (e.clientX - rect.left) / totalWidth : 0;
    if (!Number.isFinite(pct) || !effectiveDuration) {
      setHoverTime(null);
      return;
    }
    setHoverTime(Math.max(0, Math.min(pct * effectiveDuration, effectiveDuration)));
  }, [effectiveDuration, imageWidth]);

  const handleBarLeave = useCallback(() => {
    setHoverTime(null);
  }, []);

  const handleOpenWith = useCallback((appName) => {
    if (!window.electronAPI?.openWithApp || !itemPath) return;
    window.electronAPI.openWithApp(appName, itemPath);
  }, [itemPath]);

  const handleFfplay = useCallback(() => {
    if (!window.electronAPI?.playWithFfplay || !itemPath) return;
    window.electronAPI.playWithFfplay(itemPath);
  }, [itemPath]);

  const handleProxy = useCallback(async () => {
    if (!window.electronAPI?.ensureProxyMp4 || !itemPath) return;
    try {
      setProxyLoading(true);
      setProxyError(null);
      const res = await window.electronAPI.ensureProxyMp4(itemPath);
      if (res?.ok && res.path) {
        setProxySrc(`file://${res.path}`);
      } else {
        setProxyError(res?.error || 'Proxy failed');
      }
    } catch (e) {
      setProxyError(e.message || String(e));
    } finally {
      setProxyLoading(false);
    }
  }, [itemPath]);

  const handleSliderChange = (_e, value) => {
    if (typeof value !== 'number') return;
    handleSeek(value);
  };

  const fps = (() => {
    const streams = ffprobeData?.streams || [];
    const v = streams.find((s) => s.codec_type === 'video');
    const rate = v?.r_frame_rate || v?.avg_frame_rate;
    if (!rate || typeof rate !== 'string') return null;
    const [num, den] = rate.split('/').map((n) => parseFloat(n));
    if (!den || !Number.isFinite(num) || !Number.isFinite(den)) return null;
    return num / den;
  })();

  const frameStep = fps ? 1 / fps : 1 / 24;

  useEffect(() => {
    const onKey = (e) => {
      if (!isFocused && document.activeElement !== document.body) return;
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      const key = e.key.toLowerCase();
      if (key === ' ' || key === 'k') {
        e.preventDefault();
        handleToggle();
      } else if (key === 'j') {
        e.preventDefault();
        handleSeek(currentTime - 5);
      } else if (key === 'l') {
        e.preventDefault();
        handleSeek(currentTime + 5);
      } else if (key === 'arrowleft') {
        e.preventDefault();
        handleSeek(currentTime - (e.shiftKey ? 10 : 1));
      } else if (key === 'arrowright') {
        e.preventDefault();
        handleSeek(currentTime + (e.shiftKey ? 10 : 1));
      } else if (key === 'arrowup') {
        e.preventDefault();
        setVolume((v) => Math.min(1, v + 0.05));
        setMuted(false);
      } else if (key === 'arrowdown') {
        e.preventDefault();
        setVolume((v) => Math.max(0, v - 0.05));
      } else if (key === 'm') {
        e.preventDefault();
        setMuted((v) => !v);
      } else if (key === 'f') {
        e.preventDefault();
        handleFullscreen();
      } else if (key === 'i') {
        e.preventDefault();
        setInPoint(currentTime);
      } else if (key === 'o') {
        e.preventDefault();
        setOutPoint(currentTime);
      } else if (key === 'p') {
        e.preventDefault();
        setLoopEnabled((v) => !v);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentTime, handleFullscreen, handleSeek, handleToggle, isFocused]);

  if (!itemPath || (!isVideo && !isAudio)) return null;

  return (
    <Box
      ref={playerWrapRef}
      tabIndex={0}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      sx={{
        bgcolor: isTheater ? '#0b0d10' : 'background.paper',
        borderRadius: 1,
        p: 1.5,
        outline: 'none',
        position: isTheater ? 'fixed' : 'relative',
        inset: isTheater ? 12 : 'auto',
        zIndex: isTheater ? 2000 : 'auto',
        boxShadow: isTheater ? '0 0 0 2px rgba(0,0,0,0.6)' : 'none',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <Stack spacing={1.5}>
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            ...(ffprobeData?.width && ffprobeData?.height
              ? { aspectRatio: `${ffprobeData.width}/${ffprobeData.height}` }
              : {})
          }}
        >
          {isVideo ? (
            <Box
              component="video"
              ref={mediaRef}
              src={proxySrc || `file://${itemPath}`}
              sx={{ width: '100%', height: '100%', objectFit: 'contain', bgcolor: 'black' }}
            />
          ) : (
            <Box component="audio" ref={mediaRef} src={`file://${itemPath}`} />
          )}
        </Box>
        {isVideo && (
          <Typography variant="caption" color="text.secondary">
            TC {formatTimecode(currentTime, fps)}
          </Typography>
        )}

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <IconButton size="small" onClick={handleToggle}>
            {isPlaying ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
          </IconButton>
          <Tooltip title="Theater (F)">
            <IconButton size="small" onClick={handleFullscreen}>
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={muted ? 'Unmute' : 'Mute'}>
            <IconButton size="small" onClick={() => setMuted((m) => !m)}>
              {muted || volume === 0 ? <VolumeOffIcon fontSize="small" /> : <VolumeUpIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Slider
            size="small"
            value={muted ? 0 : Math.round(volume * 100)}
            min={0}
            max={100}
            onChange={(_e, value) => {
              if (typeof value !== 'number') return;
              setVolume(value / 100);
              if (value > 0) setMuted(false);
            }}
            sx={{ width: 120 }}
          />
          <Select
            size="small"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            sx={{ minWidth: 84 }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
              <MenuItem key={r} value={r}>{r}x</MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="text.secondary">
            {formatTime(currentTime)} / {formatTime(effectiveDuration)}
          </Typography>
        </Stack>

        {ffprobeData && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {ffprobeData.width && ffprobeData.height && (
              <Chip size="small" label={`${ffprobeData.width}×${ffprobeData.height}`} />
            )}
            {ffprobeData.codec && <Chip size="small" label={`Video ${ffprobeData.codec}`} />}
            {ffprobeData.audioCodec && <Chip size="small" label={`Audio ${ffprobeData.audioCodec}`} />}
            {fps && <Chip size="small" label={`FPS ${fps.toFixed(2)}`} />}
            {ffprobeData.audioChannels && <Chip size="small" label={`${ffprobeData.audioChannels}ch`} />}
          </Stack>
        )}

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" onClick={() => handleOpenWith('QuickTime Player')}>
            Open in QuickTime
          </Button>
          {isR3D && (
            <Button size="small" variant="outlined" onClick={() => handleOpenWith('RED Player')}>
              Open in RED Player
            </Button>
          )}
          {isVideo && (
            <Button size="small" variant="outlined" onClick={handleFfplay}>
              Play in ffplay
            </Button>
          )}
          {isVideo && (
            <Button size="small" variant="outlined" onClick={handleProxy} disabled={proxyLoading}>
              {proxyLoading ? 'Proxying…' : 'Play Proxy'}
            </Button>
          )}
        </Stack>
        {proxyLoading && <LinearProgress />}
        {proxyError && (
          <Typography variant="caption" color="error">
            {proxyError}
          </Typography>
        )}

        <Slider
          size="small"
          value={effectiveDuration ? currentTime : 0}
          min={0}
          max={effectiveDuration}
          step={0.1}
          onChange={handleSliderChange}
        />

        {isVideo && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">Thumbs</Typography>
            <Slider
              size="small"
              value={thumbCount}
              min={4}
              max={20}
              step={2}
              onChange={(_e, value) => {
                if (typeof value === 'number') setThumbCount(value);
              }}
              sx={{ width: 160 }}
            />
            {thumbsLoading && <LinearProgress sx={{ width: 120 }} />}
          </Stack>
        )}

        {isVideo && thumbItems.length > 0 && (
          <Tooltip title={hoverTime != null ? formatTime(hoverTime) : ''} followCursor>
            <Box
            onClick={handleBarClick}
            onMouseMove={handleBarMove}
            onMouseLeave={handleBarLeave}
            sx={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: `repeat(${thumbItems.length}, 1fr)`,
              gap: 0.5,
              cursor: 'pointer'
            }}
          >
            {thumbItems.map((t) => (
              <Tooltip key={`${t.path}-${t.index}`} title={Number.isFinite(t.time) ? formatTime(t.time) : ''}>
                <Box
                  component="img"
                  src={`file://${t.path}?t=${t.index}`}
                  alt={`thumb-${t.index}`}
                  sx={{ width: '100%', height: 64, objectFit: 'cover', bgcolor: 'action.hover' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (Number.isFinite(t.time)) handleSeek(t.time);
                  }}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoverThumb({
                      path: t.path,
                      x: rect.left + rect.width / 2
                    });
                  }}
                  onMouseLeave={() => setHoverThumb(null)}
                />
              </Tooltip>
            ))}
            {effectiveDuration > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${(currentTime / effectiveDuration) * 100}%`,
                  width: 2,
                  bgcolor: 'primary.main',
                  pointerEvents: 'none'
                }}
              />
            )}
            {inPoint != null && effectiveDuration > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${(inPoint / effectiveDuration) * 100}%`,
                  width: 2,
                  bgcolor: 'success.main',
                  pointerEvents: 'none'
                }}
              />
            )}
            {outPoint != null && effectiveDuration > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${(outPoint / effectiveDuration) * 100}%`,
                  width: 2,
                  bgcolor: 'warning.main',
                  pointerEvents: 'none'
                }}
              />
            )}
          </Box>
          </Tooltip>
        )}

        {hoverThumb && (
          <Box
            sx={{
              position: 'fixed',
              top: 80,
              left: hoverThumb.x - 80,
              width: 160,
              height: 90,
              borderRadius: 1,
              overflow: 'hidden',
              bgcolor: 'black',
              zIndex: 1400,
              pointerEvents: 'none'
            }}
          >
            <Box component="img" src={`file://${hoverThumb.path}`} alt="preview" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </Box>
        )}

        <Divider />

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" onClick={() => setInPoint(currentTime)}>Set In</Button>
          <Button size="small" variant="outlined" onClick={() => setOutPoint(currentTime)}>Set Out</Button>
          <Button
            size="small"
            variant={loopEnabled ? 'contained' : 'outlined'}
            onClick={() => setLoopEnabled((v) => !v)}
          >
            Loop
          </Button>
          <Button size="small" variant="outlined" onClick={() => handleSeek(currentTime - frameStep)}>−1f</Button>
          <Button size="small" variant="outlined" onClick={() => handleSeek(currentTime + frameStep)}>+1f</Button>
          <Button size="small" variant="outlined" onClick={() => handleSeek(currentTime - frameStep * 5)}>−5f</Button>
          <Button size="small" variant="outlined" onClick={() => handleSeek(currentTime + frameStep * 5)}>+5f</Button>
          <Chip size="small" label={`TC ${formatTimecode(currentTime, fps)}`} />
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary">Waveform Gain</Typography>
          <Slider
            size="small"
            value={waveformGainDb}
            min={-6}
            max={18}
            step={1}
            onChange={(_e, value) => {
              if (typeof value === 'number') setWaveformGainDb(value);
            }}
            sx={{ width: 160 }}
          />
        </Stack>

        {canWaveform && waveformImage && (
          <Tooltip title={hoverTime != null ? formatTime(hoverTime) : ''} followCursor>
            <Box
              ref={waveformWrapRef}
              onClick={handleBarClick}
              onMouseMove={handleBarMove}
              onMouseLeave={handleBarLeave}
              sx={{
                position: 'relative',
                height: 120,
                cursor: 'pointer',
                bgcolor: '#1e2227',
                borderRadius: 1,
                overflow: 'hidden'
              }}
            >
              <Box sx={{ position: 'absolute', top: 4, left: 6, fontSize: 11, color: '#c0c6cf' }}>
                {formatTimecode(currentTime, fps)}
              </Box>
              <Box sx={{ width: '100%', position: 'relative', height: '100%' }}>
                <Box sx={{ position: 'absolute', top: 0, left: 0, height: 18, width: '100%', pointerEvents: 'none' }}>
                  <Box sx={{ position: 'relative', height: '100%' }}>
                    {rulerTicks.map((t) => {
                      const left = (t / effectiveDuration) * 100;
                      return (
                        <Box key={`tick-${t}`} sx={{ position: 'absolute', left: `${left}%`, top: 0, height: '100%' }}>
                          <Box sx={{ width: 1, height: 8, bgcolor: '#5e6a75' }} />
                          <Typography variant="caption" sx={{ fontSize: 10, color: '#9aa3ad' }}>
                            {formatTime(t)}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
                <Box
                  component="img"
                  src={`file://${waveformImage}?t=${Date.now()}`}
                  alt="waveform"
                  sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </Box>
              {effectiveDuration > 0 && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${(currentTime / effectiveDuration) * 100}%`,
                    width: 2,
                    bgcolor: 'primary.main',
                    pointerEvents: 'none'
                  }}
                />
              )}
              {inPoint != null && effectiveDuration > 0 && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${(inPoint / effectiveDuration) * 100}%`,
                    width: 2,
                    bgcolor: 'success.main',
                    pointerEvents: 'none'
                  }}
                />
              )}
              {outPoint != null && effectiveDuration > 0 && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${(outPoint / effectiveDuration) * 100}%`,
                    width: 2,
                    bgcolor: 'warning.main',
                    pointerEvents: 'none'
                  }}
                />
              )}
            </Box>
          </Tooltip>
        )}
        {canWaveform && !waveformImage && (
          <Box sx={{ height: 120, display: 'flex', alignItems: 'center', px: 1, bgcolor: '#1e2227', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {waveformStatus === 'loading' ? 'Generating waveform…' : 'Waveform unavailable'}
            </Typography>
            {waveformStatus === 'loading' && (
              <Box sx={{ flex: 1, ml: 2 }}>
                <LinearProgress />
              </Box>
            )}
          </Box>
        )}

        <Divider />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Space/K: Play/Pause
          </Typography>
          <Typography variant="caption" color="text.secondary">
            J/L: -/+5s
          </Typography>
          <Typography variant="caption" color="text.secondary">
            ←/→: -/+1s (Shift: 10s)
          </Typography>
          <Typography variant="caption" color="text.secondary">
            I/O: Set In/Out
          </Typography>
          <Typography variant="caption" color="text.secondary">
            P: Loop
          </Typography>
          <Typography variant="caption" color="text.secondary">
            M: Mute
          </Typography>
          <Typography variant="caption" color="text.secondary">
            ↑/↓: Volume
          </Typography>
          <Typography variant="caption" color="text.secondary">
            F: Fullscreen
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}
