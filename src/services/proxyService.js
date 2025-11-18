// Proxy job service that talks to Electron when available,
// and falls back to a simulated implementation when running
// in a plain browser (no real file access).

const hasElectron =
  typeof window !== 'undefined' &&
  window.electronAPI &&
  typeof window.electronAPI.startProxyJob === 'function';

export async function runProxyJob(config, onProgress) {
  if (!hasElectron) {
    // Fallback: simulated behavior to let you develop UI in the browser.
    console.log('Simulated runProxyJob called with config:', config);

    const totalFiles = 120;
    let processed = 0;

    onProgress({
      totalFiles,
      processedFiles: processed,
      progress: 0,
      currentFile: null
    });

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        processed += 3;
        if (processed > totalFiles) processed = totalFiles;

        const currentFile = `File_${processed}.mov`;

        onProgress({
          totalFiles,
          processedFiles: processed,
          progress: (processed / totalFiles) * 100,
          currentFile
        });

        if (processed >= totalFiles) {
          clearInterval(interval);
          resolve({
            summary: {
              totalFound: totalFiles,
              copied: config.operation === 'copy' ? totalFiles : 0,
              moved: config.operation === 'move' ? totalFiles : 0,
              deleted: config.operation === 'delete' ? totalFiles : 0,
              errorCount: 0
            }
          });
        }
      }, 100);
    });
  }

  // Electron-backed implementation
  return new Promise((resolve, reject) => {
    // Subscribe to progress events
    const unsubscribe = window.electronAPI.onProxyProgress((progressData) => {
      onProgress(progressData);
    });

    window.electronAPI
      .startProxyJob(config)
      .then((response) => {
        unsubscribe();
        if (response && response.ok) {
          resolve({ summary: response.summary });
        } else {
          reject(new Error(response?.error || 'Proxy job failed.'));
        }
      })
      .catch((err) => {
        unsubscribe();
        reject(err);
      });
  });
}
