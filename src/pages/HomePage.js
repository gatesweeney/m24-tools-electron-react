import React from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';

function HomePage() {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        p: 4
      }}
    >
      <Paper
        sx={{
          width: '100%',
          maxWidth: 900,
          p: 4,
          bgcolor: 'background.paper'
        }}
        elevation={3}
      >
        <Stack spacing={3}>
          <Typography variant="h4" component="h1">
            M24 Tools
          </Typography>

          <Typography variant="body1" color="text.secondary">
            A collection of fast, local utilities for media workflows.
          </Typography>

          <Stack spacing={2}>
            <Button
              variant="contained"
              size="large"
              color="primary"
              onClick={() => navigate('/proxy')}
              sx={{ justifyContent: 'flex-start' }}
            >
              Proxy Tool
            </Button>

            <Button
              variant="contained"
              size="large"
              color="primary"
              onClick={() => navigate('/heic-converter')}
              sx={{ justifyContent: 'flex-start' }}
            >
              HEIC Converter
            </Button>

            <Button
              variant="contained"
              size="large"
              color="primary"
              onClick={() => navigate('/image-compressor')}
              sx={{ justifyContent: 'flex-start' }}
            >
              Image Compressor
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}

export default HomePage;
