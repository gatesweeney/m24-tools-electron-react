import React, { createContext, useContext, useState, useCallback } from 'react';

const JobContext = createContext(null);

export function JobProvider({ children }) {
  const [jobState, setJobState] = useState({
    status: 'idle', // idle | running | success | error
    progress: 0,
    totalFiles: 0,
    processedFiles: 0,
    currentFile: null,
    lastResult: null,
    error: null
  });

  const startJob = useCallback(() => {
    setJobState(prev => ({
      ...prev,
      status: 'running',
      progress: 0,
      totalFiles: 0,
      processedFiles: 0,
      currentFile: null,
      lastResult: null,
      error: null
    }));
  }, []);

  const updateProgress = useCallback((partial) => {
    setJobState(prev => ({
      ...prev,
      ...partial
    }));
  }, []);

    const finishJob = useCallback((result) => {
    setJobState(prev => ({
      ...prev,
      status: 'success',
      progress: 100,
      lastResult: result,
      currentFile: null
    }));
  }, []);

  const failJob = useCallback((errorMessage) => {
    setJobState(prev => ({
      ...prev,
      status: 'error',
      error: errorMessage,
      currentFile: null
    }));
  }, []);

  const cancelJob = useCallback(() => {
    setJobState(prev => ({
      ...prev,
      status: 'idle',
      progress: 0,
      totalFiles: 0,
      processedFiles: 0,
      currentFile: null
    }));
  }, []);

  const value = {
    jobState,
    startJob,
    updateProgress,
    finishJob,
    failJob,
    cancelJob
  };

  return (
    <JobContext.Provider value={value}>
      {children}
    </JobContext.Provider>
  );
}

export function useJob() {
  const ctx = useContext(JobContext);
  if (!ctx) {
    throw new Error('useJob must be used within a JobProvider');
  }
  return ctx;
}
