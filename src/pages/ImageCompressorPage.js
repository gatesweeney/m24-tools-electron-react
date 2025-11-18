import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import imageCompression from 'browser-image-compression';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Container } from '@mui/material';

function ImageCompressorPage() {
  const [files, setFiles] = useState([]);
  const [maxSizeMB, setMaxSizeMB] = useState('4');      // like options.maxSizeMB default in rapt-tools
  const [maxResolution, setMaxResolution] = useState('5000'); // like options.maxWidthOrHeight
  const [keepResolution, setKeepResolution] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  const handleFileChange = (event) => {
    const list = Array.from(event.target.files || []);
    setFiles(list);
    setResults([]);
    setError(null);
    setProgress(0);
  };

  const parseNumberOrUndefined = (value) => {
    const cleaned = (value || '').replace(/[^0-9.]/g, '');
    if (!cleaned) return undefined;
    const n = Number(cleaned);
    return Number.isNaN(n) ? undefined : n;
  };

  const handleCompress = async () => {
    if (!files.length || compressing) return;

    const maxSize = parseNumberOrUndefined(maxSizeMB);
    const maxRes = parseNumberOrUndefined(maxResolution);

    const options = {
      maxSizeMB: maxSize || 4,
      maxWidthOrHeight: maxRes || undefined,
      useWebWorker: true,
      alwaysKeepResolution: keepResolution
    };

    setCompressing(true);
    setProgress(0);
    setResults([]);
    setError(null);

    const compressed = [];
    let processed = 0;

    try {
      for (const file of files) {
        // browser-image-compression supports most image types
        const output = await imageCompression(file, options);
        compressed.push({ original: file, blob: output });

        processed++;
        setProgress((processed / files.length) * 100);
      }

      setResults(compressed);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setCompressing(false);
    }
  };

  const makeOutputName = (originalName) => {
    const base = originalName.replace(/\.[^/.]+$/, '');
    const ext = originalName.split('.').pop() || 'jpg';
    return `${base}-compressed.${ext}`;
  };

  const handleDownloadZip = async () => {
    if (!results.length) return;

    const zip = new JSZip();
    for (const item of results) {
      const name = makeOutputName(item.original.name);
      zip.file(name, item.blob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'images-compressed.zip');
  };

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
          maxWidth: 900,
          p: 3,
          bgcolor: 'background.paper'
        }}
        elevation={3}
      >
        <Stack spacing={2}>
          <Typography variant="h5" component="h1">
            Image Compressor
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Compress images to a target size and optional max resolution. Based on the same logic as
            your original rapt-tools compressor, using browser-image-compression + JSZip.
          </Typography>

          {/* File input */}
          <Stack direction="row" spacing={2} alignItems="center">
            <Button
              variant="outlined"
              component="label"
              size="small"
            >
              Select Images
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handleFileChange}
              />
            </Button>
            <Typography variant="body2" color="text.secondary">
              {files.length
                ? `${files.length} file${files.length > 1 ? 's' : ''} selected`
                : 'No files selected'}
            </Typography>
          </Stack>

          {/* Options */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Max size (MB)"
              size="small"
              value={maxSizeMB}
              onChange={(e) => setMaxSizeMB(e.target.value)}
              sx={{ maxWidth: 160 }}
              helperText="Leave empty for ~4 MB default"
            />
            <TextField
              label="Max resolution (px)"
              size="small"
              value={maxResolution}
              onChange={(e) => setMaxResolution(e.target.value)}
              sx={{ maxWidth: 200 }}
              helperText="Max width/height; leave empty to keep original"
            />
          </Stack>

          <FormControlLabel
            control={
              <Checkbox
                checked={keepResolution}
                onChange={(e) => setKeepResolution(e.target.checked)}
              />
            }
            label="Always keep original resolution"
          />

          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={handleCompress}
              disabled={!files.length || compressing}
            >
              {compressing ? 'Compressing...' : 'Compress'}
            </Button>
          </Box>

          {compressing && (
            <Box sx={{ mt: 1 }}>
              <LinearProgress variant="determinate" value={progress} />
              <Typography variant="caption" color="text.secondary">
                {Math.round(progress)}%
              </Typography>
            </Box>
          )}

          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Results */}
          {results.length > 0 && (
            <Stack spacing={1} sx={{ mt: 2 }}>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <Typography variant="subtitle1">
                  Compressed files
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleDownloadZip}
                >
                  Download all as ZIP
                </Button>
              </Box>

              <Stack spacing={0.5}>
                {results.map((item, idx) => {
                  const name = makeOutputName(item.original.name);
                  return (
                    <Box
                      key={idx}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <Typography
                        variant="body2"
                        sx={{ mr: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {name}
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => saveAs(item.blob, name)}
                      >
                        Download
                      </Button>
                    </Box>
                  );
                })}
              </Stack>
            </Stack>
          )}
        </Stack>
      </Container>
    </Box>
  );
}

export default ImageCompressorPage;