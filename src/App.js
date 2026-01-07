import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Box from '@mui/material/Box';
import NavBar from './components/NavBar';
import JobProgressBar from './components/JobProgressBar';
import HomePage from './pages/HomePage';
import ProxyToolPage from './pages/ProxyToolPage';
import HeicConverterPage from './pages/HeicConverterPage';
import ImageCompressorPage from './pages/ImageCompressorPage';
import YouTubeDownloaderPage from './pages/YouTubeDownloaderPage';
import YouTubeSimplePage from './pages/YouTubeSimplePage';
import IndexerPage from './pages/IndexerPage';
import IndexerProgressStrip from './components/IndexerProgressStrip';
import { useEffect, useState } from 'react';


function App() {

  const [indexerProgress, setIndexerProgress] = useState(null);
  const [indexerStatus, setIndexerStatus] = useState(null);

useEffect(() => {
  if (!window.electronAPI?.onIndexerProgress) return;
  const unsub = window.electronAPI.onIndexerProgress((msg) => {
    // msg: {cmd, label, payload, at}
    setIndexerProgress(msg);
    // clear on SCAN_DONE (optional)
    if (msg?.payload?.stage === 'SCAN_DONE') {
      setTimeout(() => setIndexerProgress(null), 1500);
    }
  });
  return () => unsub && unsub();
}, []);

useEffect(() => {
  if (!window.electronAPI?.getIndexerStatus) return;

  let timer = null;

  const tick = async () => {
    const res = await window.electronAPI.getIndexerStatus();
    if (res?.ok) setIndexerStatus(res.status || null);
  };

  if (indexerProgress) {
    tick();
    timer = setInterval(tick, 1000);
  } else {
    setIndexerStatus(null);
  }

  return () => timer && clearInterval(timer);
}, [indexerProgress]);

const cancelAll = async () => {
  await window.electronAPI.cancelIndexerAll?.();
};


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
      <Route path="/youtube" element={<YouTubeDownloaderPage />} />
      <Route path="/youtube-simple" element={<YouTubeSimplePage />} />
      <Route path="/indexer" element={<IndexerPage />} />
    </Routes>
        <>
      {/* existing layout */}
      <IndexerProgressStrip
        progress={indexerProgress}
        status={indexerStatus}
        onCancelAll={cancelAll}
      />
      </>
    
      </Box>
      <JobProgressBar />
    </Box>
  );
}

export default App;
