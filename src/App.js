import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Box from '@mui/material/Box';
import NavBar from './components/NavBar';
import JobProgressBar from './components/JobProgressBar';
import HomePage from './pages/HomePage';
import ProxyToolPage from './pages/ProxyToolPage';
import HeicConverterPage from './pages/HeicConverterPage';
import ImageCompressorPage from './pages/ImageCompressorPage';

function App() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.paper',
        color: 'text.primary',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <NavBar />
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          px: 2,
          pt: 2,
          pb: 6   // leaves room above the bottom progress bar
        }}
      >
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/proxy" element={<ProxyToolPage />} />
      <Route path="/heic-converter" element={<HeicConverterPage />} />
      <Route path="/image-compressor" element={<ImageCompressorPage />} />
    </Routes>
      </Box>
      <JobProgressBar />
    </Box>
  );
}

export default App;
