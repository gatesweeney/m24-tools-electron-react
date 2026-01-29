import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';

function prettyStage(stage) {
  if (!stage) return 'Working…';
  if (stage.startsWith('A1')) return 'Scanning folders';
  if (stage.startsWith('A2')) return 'Indexing files';
  if (stage.startsWith('A3')) return 'Reading file info';
  if (stage === 'SCAN_START') return 'Starting scan';
  if (stage === 'SCAN_DONE') return 'Scan complete';
  if (stage === 'CANCELLED') return 'Scan cancelled';
  return stage;
}

export default function IndexerProgressStrip({
  progress,
  status,
  onCancelAll,
  onCancelCurrent
}) {
  if (!progress) return null;

  const { label, payload } = progress;
  const stage = payload?.stage || '';
  const name = payload?.name || payload?.rootPath || '';

  const running = status?.runningTotal || 0;
  const queued = status?.queuedTotal || 0;

  const canCancelCurrent = running > 0;
  const canCancelAll = queued > 0 || running > 1;

  return (
    <Box sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 2500 }}>
      <Box
        sx={{
          px: 2,
          py: 1,
          bgcolor: 'background.paper',
          borderTop: '1px solid rgba(255,255,255,0.08)'
        }}
      >
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary" noWrap>
            {label} • {prettyStage(stage)}
            {name ? ` • ${name}` : ''}
          </Typography>

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="caption" color="text.secondary">
              Running {running} • Queued {queued}
            </Typography>

            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                color="warning"
                disabled={!canCancelCurrent}
                onClick={onCancelCurrent}
              >
                Cancel Current
              </Button>

              <Button
                size="small"
                variant="outlined"
                disabled={!canCancelAll}
                onClick={onCancelAll}
              >
                Cancel All
              </Button>
            </Stack>
          </Stack>

          <LinearProgress />
        </Stack>
      </Box>
    </Box>
  );
}