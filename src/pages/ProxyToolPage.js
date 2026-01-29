import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import { useJob } from '../context/JobContext';
import { runProxyJob } from '../services/proxyService';
import { Container } from '@mui/material';

const hasElectron =
  typeof window !== 'undefined' &&
  window.electronAPI &&
  typeof window.electronAPI.selectDirectory === 'function';

function ProxyToolPage() {
  const [mediaDir, setMediaDir] = useState('');
  const [proxiesLocationType, setProxiesLocationType] = useState('subfolder');
  const [proxiesSubfolderName, setProxiesSubfolderName] = useState('Proxy');
  const [operation, setOperation] = useState('copy');
  const [destinationDir, setDestinationDir] = useState('');
  const [preserveStructure, setPreserveStructure] = useState('preserve');
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });

  const { startJob, updateProgress, finishJob, failJob, jobState } = useJob();

  const chooseDirectory = async (currentValue) => {
    if (hasElectron) {
      const dir = await window.electronAPI.selectDirectory();
      return dir || currentValue;
    }
    // Browser mode placeholder
    const dir = window.prompt('Enter directory path (browser mode placeholder):', currentValue);
    return dir || currentValue;
  };

  const handleChooseMediaDir = async () => {
    const dir = await chooseDirectory(mediaDir);
    setMediaDir(dir);
  };

  const handleChooseDestinationDir = async () => {
    if (operation === 'delete') return;
    const dir = await chooseDirectory(destinationDir);
    setDestinationDir(dir);
  };

  const handleStart = async () => {
    if (!mediaDir) {
      setSnack({ open: true, message: 'Please choose a media directory.', severity: 'warning' });
      return;
    }
    if (operation !== 'delete' && !destinationDir) {
      setSnack({ open: true, message: 'Please choose a destination directory.', severity: 'warning' });
      return;
    }

    const config = {
      mediaDir,
      proxiesLocationType,
      proxiesSubfolderName,
      operation,
      destinationDir: operation === 'delete' ? null : destinationDir,
      preserveStructure
    };

    try {
            startJob();
      const result = await runProxyJob(config, (progressData) => {
        updateProgress(progressData);
      });

      const summary = result.summary || {};
      finishJob(summary);

      const {
        totalFound = 0,
        copied = 0,
        moved = 0,
        deleted = 0,
        skippedExisting = 0
      } = summary;

      setSnack({
        open: true,
        message: `Job completed. Found ${totalFound} proxies — copied: ${copied}, moved: ${moved}, deleted: ${deleted}, skipped existing: ${skippedExisting}.`,
        severity: 'success'
      });
    } catch (err) {
      console.error(err);
      failJob(err.message || String(err));
      setSnack({
        open: true,
        message: 'Job failed: ' + (err.message || String(err)),
        severity: 'error'
      });
    }
  };

  const running = jobState.status === 'running';

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        p: 3
      }}
    >
      <Container
        sx={{
          width: '100%',
          maxWidth: 1100,
          p: 3,
          bgcolor: 'background.paper'
        }}
        elevation={3}
      >
        <Stack spacing={2}>
          <Typography variant="h5" component="h1">
            Proxy Tool
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure where your media and proxies live, then choose what you want to do with them.
            When running under Electron, this will perform real file operations. In a normal browser
            it runs in a simulated mode so you can still build and test the UI.
          </Typography>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: 1.5,
              rowGap: 1,
              fontSize: 16
            }}
          >
            <Typography variant="body1">My media is located in</Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={handleChooseMediaDir}
            >
              {mediaDir || 'choose directory'}
            </Button>
            <Typography variant="body1">, the proxies are located</Typography>
            <Select
              size="small"
              value={proxiesLocationType}
              onChange={(e) => setProxiesLocationType(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="subfolder">inside subfolder called</MenuItem>
              <MenuItem value="nextTo">next to the original media</MenuItem>
            </Select>
            {proxiesLocationType === 'subfolder' && (
              <TextField
                size="small"
                sx={{ width: 180 }}
                value={proxiesSubfolderName}
                onChange={(e) => setProxiesSubfolderName(e.target.value)}
                placeholder="Proxy"
              />
            )}
            <Typography variant="body1">, and I want to</Typography>
            <Select
              size="small"
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="copy">copy</MenuItem>
              <MenuItem value="move">move</MenuItem>
              <MenuItem value="delete" disabled>delete</MenuItem>
            </Select>
            {operation !== 'delete' && (
              <>
                <Typography variant="body1">them to</Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleChooseDestinationDir}
                >
                  {destinationDir || 'choose directory'}
                </Button>
              </>
            )}
            <Typography variant="body1">and</Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={preserveStructure}
              onChange={(_e, val) => {
                if (val) setPreserveStructure(val);
              }}
            >
              <ToggleButton value="preserve">preserve folder structure</ToggleButton>
              <ToggleButton value="flatten">put all in same folder</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="body1">.</Typography>
          </Box>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              mt: 1
            }}
          >
            <Button
              variant="contained"
              size="large"
              onClick={handleStart}
              disabled={running}
            >
              {running ? 'Working...' : 'Start'}
            </Button>
          </Box>
        </Stack>
        <Snackbar
          open={snack.open}
          autoHideDuration={4000}
          onClose={() => setSnack({ ...snack, open: false })}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            onClose={() => setSnack({ ...snack, open: false })}
            severity={snack.severity}
            sx={{ width: '100%' }}
          >
            {snack.message}
          </Alert>
        </Snackbar>
      </Container>
    </Box>
  );
}

export default ProxyToolPage;
