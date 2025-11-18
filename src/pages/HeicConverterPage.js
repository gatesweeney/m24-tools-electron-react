import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import heic2any from 'heic2any';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Container } from '@mui/material';

function HeicConverterPage() {
  const [files, setFiles] = useState([]);
  const [outputFormat, setOutputFormat] = useState('image/jpeg'); // jpg by default
  const [converting, setConverting] = useState(false);
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

  const handleConvert = async () => {
    if (!files.length || converting) return;

    setConverting(true);
    setProgress(0);
    setResults([]);
    setError(null);

    const converted = [];
    let processed = 0;

    try {
      for (const file of files) {
        // Only attempt real convert if it’s HEIC
        if (!file.name.toLowerCase().endsWith('.heic')) {
          converted.push({ file, blob: null, skipped: true });
          processed++;
          setProgress((processed / files.length) * 100);
          continue;
        }

        const arrayBuffer = await file.arrayBuffer();
        const blob = await heic2any({
          blob: new Blob([arrayBuffer]),
          toType: outputFormat
        });

        converted.push({ file, blob, skipped: false });
        processed++;
        setProgress((processed / files.length) * 100);
      }

      setResults(converted);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setConverting(false);
    }
  };

  const makeDownloadInfo = (blob, originalName) => {
    if (!blob) return null;
    const ext =
      outputFormat === 'image/jpeg'
        ? 'jpg'
        : outputFormat === 'image/png'
        ? 'png'
        : 'webp';
    const base = originalName.replace(/\.[^/.]+$/, '');
    const filename = `${base}.${ext}`;
    const url = URL.createObjectURL(blob);
    return { url, filename };
  };

  const handleDownloadZip = async () => {
    if (!results.length) return;

    const zip = new JSZip();
    for (const item of results) {
      if (!item.blob || item.skipped) continue;
      const info = makeDownloadInfo(item.blob, item.file.name);
      if (!info) continue;
      zip.file(info.filename, item.blob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'heic-converted.zip');
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
            HEIC Converter
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Convert .heic images to JPEG, PNG, or WebP. Everything runs locally in the app (browser
            or Electron renderer) using client-side conversion.
          </Typography>

          {/* File input + format selection */}
          <Stack direction="row" spacing={2} alignItems="center">
            <Button
              variant="outlined"
              component="label"
              size="small"
            >
              Select HEIC Files
              <input
                type="file"
                accept=".heic,image/heic"
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

          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="body2">Output format:</Typography>
            <Select
              size="small"
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="image/jpeg">JPEG (.jpg)</MenuItem>
              <MenuItem value="image/png">PNG (.png)</MenuItem>
              <MenuItem value="image/webp">WebP (.webp)</MenuItem>
            </Select>
          </Stack>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={handleConvert}
              disabled={!files.length || converting}
            >
              {converting ? 'Converting...' : 'Convert'}
            </Button>
          </Box>

          {converting && (
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
                  Converted files
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
                  if (item.skipped || !item.blob) {
                    return (
                      <Typography
                        key={idx}
                        variant="caption"
                        color="text.secondary"
                      >
                        Skipped (not HEIC): {item.file.name}
                      </Typography>
                    );
                  }

                  const info = makeDownloadInfo(item.blob, item.file.name);
                  return (
                    <Box
                      key={idx}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <Typography variant="body2" sx={{ mr: 2 }}>
                        {info.filename}
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => saveAs(item.blob, info.filename)}
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

export default HeicConverterPage;