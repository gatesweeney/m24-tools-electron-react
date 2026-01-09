

// src/utils/formatters.js

export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${sizes[i]}`;
}

export function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return d.toLocaleString();
  } catch {
    return '—';
  }
}

export function formatInterval(ms) {
  if (ms == null) return 'default';
  if (ms < 0) return 'manual only';
  if (ms === 0) return 'on mount only';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr`;
  const d = Math.floor(h / 24);
  return `${d} day${d !== 1 ? 's' : ''}`;
}

export function formatDurationSec(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const s = parseFloat(seconds);
  if (s < 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatBitrate(bps) {
  if (bps == null || Number.isNaN(bps)) return '—';
  const kbps = parseInt(bps, 10) / 1000;
  if (kbps < 1000) return `${kbps.toFixed(0)} kbps`;
  return `${(kbps / 1000).toFixed(1)} Mbps`;
}