import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import { Button } from '@mui/material';

export default function IndexerProgressStrip({ progress, status, onCancelAll }) {
  if (!progress) return null;

  const { label, payload } = progress;
  const stage = payload?.stage || '';
  const name = payload?.name || payload?.rootPath || '';
  const meta = payload?.volume_uuid || payload?.rootId || '';

  const text = `${label} • ${stage}${name ? ` • ${name}` : ''}${meta ? ` • ${meta}` : ''}`;

  // If you later include percent, we’ll render determinate.
  return (
    <Box sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 2000 }}>
      <Box sx={{ px: 2, py: 1, bgcolor: 'background.paper', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary" noWrap>
            {text}
          </Typography>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="caption" color="text.secondary" noWrap>
                {text}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color="text.secondary">
                {status ? `Running ${status.runningTotal} • Queued ${status.queuedTotal}` : ''}
                </Typography>
                <Button size="small" variant="outlined" onClick={onCancelAll}>
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