import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Box from '@mui/material/Box';
import NavBar from './components/NavBar';
import JobProgressBar from './components/JobProgressBar';
import HomePage from './pages/HomePage';
import ProxyToolPage from './pages/ProxyToolPage';
import YouTubeDownloaderPage from './pages/YouTubeDownloaderPage';
import YouTubeSimplePage from './pages/YouTubeSimplePage';
import IndexerPage from './pages/IndexerPage';
import SearchPage from './pages/SearchPage';
import AssetDetailPage from './pages/AssetDetailPage';
import TransfersPage from './pages/TransfersPage';
import IndexerProgressStrip from './components/IndexerProgressStrip';
import UpdateDialog from './components/UpdateDialog';


function App() {

  const [indexerProgress, setIndexerProgress] = useState(null);
  const [indexerStatus, setIndexerStatus] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

useEffect(() => {
  if (!window.electronAPI?.onIndexerProgress) return;

  const unsub = window.electronAPI.onIndexerProgress((msg) => {
    setIndexerProgress(msg);

    const stage = msg?.payload?.stage;
    if (stage === 'SCAN_DONE' || stage === 'CANCELLED') {
      setTimeout(() => setIndexerProgress(null), 300);
    }
    // If stage is 'A3_stats_end' and no status polling currently, leave as-is (no extra logic needed)
  });

  return () => unsub && unsub();
}, []);

useEffect(() => {
  if (!window.electronAPI?.getIndexerStatus) return;
  if (isCancelling) return;

  let timer = null;

  const tick = async () => {
    const res = await window.electronAPI.getIndexerStatus();
    if (res?.ok) {
      setIndexerStatus(res.status || null);
      if (res.status && res.status.runningTotal === 0 && res.status.queuedTotal === 0) {
        setIndexerProgress(null);
        setIndexerStatus(res.status);
        // do not set interval again, so polling stops
      }
    }
  };

  if (indexerProgress) {
    tick();
    timer = setInterval(tick, 1000);
  } else {
    setIndexerStatus(null);
  }

  return () => timer && clearInterval(timer);
}, [indexerProgress, isCancelling]);

const cancelAll = async () => {
  if (!window.electronAPI?.cancelIndexerAll) return;
  setIsCancelling(true);
  setIndexerProgress(null);
  setIndexerStatus(null);
  try {
    await window.electronAPI.cancelIndexerAll();
  } finally {
    setIsCancelling(false);
  }
};

const cancelCurrent = async () => {
  if (!window.electronAPI?.cancelIndexerCurrent) return;
  setIsCancelling(true);
  try {
    await window.electronAPI.cancelIndexerCurrent();
  } finally {
    setIsCancelling(false);
  }
};

useEffect(() => {
  if (!window.electronAPI?.onShowUpdateDialog) return undefined;
  const unsub = window.electronAPI.onShowUpdateDialog(() => setUpdateDialogOpen(true));
  return unsub;
}, []);


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
      <Route path="/youtube" element={<YouTubeDownloaderPage />} />
      <Route path="/youtube-simple" element={<YouTubeSimplePage />} />
      <Route path="/indexer" element={<IndexerPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/detail" element={<AssetDetailPage />} />
      <Route path="/transfers" element={<TransfersPage />} />
    </Routes>
      <IndexerProgressStrip
        progress={indexerProgress}
        status={indexerStatus}
        onCancelAll={cancelAll}
        onCancelCurrent={cancelCurrent}
      />
    
    </Box>
      <JobProgressBar />
      <UpdateDialog open={updateDialogOpen} onClose={() => setUpdateDialogOpen(false)} />
    </Box>
  );
}

export default App;
