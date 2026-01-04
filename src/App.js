import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Box from '@mui/material/Box';
import NavBar from './components/NavBar';
import JobProgressBar from './components/JobProgressBar';
import HomePage from './pages/HomePage';
import ProxyToolPage from './pages/ProxyToolPage';
import HeicConverterPage from './pages/HeicConverterPage';
import ImageCompressorPage from './pages/ImageCompressorPage';
import OffshootLogPage from './pages/OffshootLogPage';
import IndexerPage from './pages/IndexerPage';
import SearchPage from './pages/SearchPage';
import YouTubeDownloaderPage from './pages/YouTubeDownloaderPage';
import YouTubeSimplePage from './pages/YouTubeSimplePage';

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
      <Route path="/offshoot-logs" element={<OffshootLogPage />} />
      <Route path="/indexer" element={<IndexerPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/youtube" element={<YouTubeDownloaderPage />} />
      <Route path="/youtube-simple" element={<YouTubeSimplePage />} />
    </Routes>
      </Box>
      <JobProgressBar />
    </Box>
  );
}

export default App;
