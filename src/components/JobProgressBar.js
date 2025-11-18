import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import { useJob } from '../context/JobContext';

function JobProgressBar() {
    const { jobState, cancelJob } = useJob();
  const { status, progress, processedFiles, totalFiles, currentFile } = jobState;

  if (status === 'idle') {
    return null;
  }

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        borderRadius: 0,
        px: 2,
        py: 1,
        bgcolor: 'background.paper'
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {status === 'running'
              ? 'Proxy job in progress...'
              : status === 'success'
              ? 'Job completed.'
              : 'Job failed.'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {totalFiles > 0
                ? `${processedFiles}/${totalFiles} files (${Math.round(progress)}%)`
                : `${Math.round(progress)}%`}
            </Typography>
            {status === 'running' && (
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                onClick={cancelJob}
              >
                Cancel
              </Button>
            )}
          </Box>
        </Box>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{ height: 6, borderRadius: 3 }}
        />
        {currentFile && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {currentFile}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

export default JobProgressBar;
