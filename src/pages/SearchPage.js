

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import Divider from '@mui/material/Divider';
import Button from '@mui/material/Button';
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';
import { formatBytes, formatDateTime } from '../utils/formatters';

const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function SearchPage() {
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 250);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);

  const [selected, setSelected] = useState(null);

  const lastQueryRef = useRef('');

  useEffect(() => {
    const run = async () => {
      if (!hasElectron || !window.electronAPI.searchQuery) {
        setError('Search requires Electron + preload searchQuery().');
        return;
      }

      const query = debouncedQ.trim();
      if (query.length < 2) {
        setResults([]);
        setError(null);
        return;
      }

      // avoid refiring same query
      if (lastQueryRef.current === query) return;
      lastQueryRef.current = query;

      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.searchQuery(query, { limit: 200 });
        if (!res.ok) {
          setError(res.error || 'Search failed.');
          setResults([]);
        } else {
          setResults(res.results || []);
        }
      } catch (e) {
        setError(e.message || String(e));
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [debouncedQ]);

  const rows = useMemo(() => {
    return (results || []).map((r, idx) => ({
      id: `${r.machineId || 'local'}::${r.volume_uuid || 'none'}::${r.path || idx}`,
      ...r
    }));
  }, [results]);

  const columns = useMemo(() => ([
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 180 },
    { field: 'path', headerName: 'Path', flex: 2, minWidth: 360 },
    { field: 'machineId', headerName: 'Machine', width: 140, valueGetter: (p) => p.row.machineId || 'local' },
    { field: 'volume_uuid', headerName: 'Volume UUID', width: 220, valueGetter: (p) => p.row.volume_uuid || '—' },
    { field: 'size_bytes', headerName: 'Size', width: 120, valueGetter: (p) => formatBytes(p.row.size_bytes) },
    { field: 'mtime', headerName: 'Modified', width: 180, valueGetter: (p) => (p.row.mtime ? formatDateTime(p.row.mtime * 1000) : '—') },
    { field: 'type', headerName: 'Type', width: 90 }
  ]), []);

  return (
    <Container maxWidth="xl" sx={{ pt: 4, pb: 6 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h4">Search</Typography>
          <Typography variant="body2" color="text.secondary">
            Fuzzy search across indexed drives and manual roots.
          </Typography>
        </Box>

        <TextField
          label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Try: A001, BD_SHUTTLE, .wav, invoice, 2025-11..."
          fullWidth
          size="small"
        />

        {loading && <LinearProgress />}
        {error && <Alert severity="error">{error}</Alert>}

        <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2 }}>
          <Box sx={{ height: 640, width: '100%', bgcolor: 'background.paper', borderRadius: 2 }}>
            <DataGridPro
              rows={rows}
              columns={columns}
              disableRowSelectionOnClick
              slots={{ toolbar: GridToolbar }}
              slotProps={{
                toolbar: {
                  showQuickFilter: true,
                  quickFilterProps: { debounceMs: 250 }
                }
              }}
              onRowClick={(params) => setSelected(params.row)}
              onRowDoubleClick={async (params) => {
                if (!window.electronAPI?.openInFinder) return;
                const p = params.row.path;
                if (!p) return;
                await window.electronAPI.openInFinder(p);
              }}
            />
          </Box>

          <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, p: 2, height: 640, overflow: 'auto' }}>
            <Stack spacing={1}>
              <Typography variant="h6">Inspector</Typography>
              <Divider />

              {!selected ? (
                <Typography variant="body2" color="text.secondary">
                  Select a row to inspect file/dir/volume details.
                </Typography>
              ) : (
                <>
                  <Typography variant="subtitle2">{selected.name || '(no name)'}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selected.path}
                  </Typography>

                  <Divider sx={{ my: 1 }} />

                  <Typography variant="body2">
                    <strong>Machine:</strong> {selected.machineId || 'local'}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Volume UUID:</strong> {selected.volume_uuid || '—'}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Size:</strong> {formatBytes(selected.size_bytes)}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Modified:</strong> {selected.mtime ? formatDateTime(selected.mtime * 1000) : '—'}
                  </Typography>

                  <Box sx={{ pt: 1 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={!window.electronAPI?.openInFinder || !selected.path}
                      onClick={async () => {
                        if (!window.electronAPI?.openInFinder) return;
                        await window.electronAPI.openInFinder(selected.path);
                      }}
                    >
                      Reveal in Finder
                    </Button>
                  </Box>

                  <Alert severity="info" sx={{ mt: 2 }}>
                    Next: file details panel with ffprobe + Foolcat linkage.
                  </Alert>
                </>
              )}
            </Stack>
          </Box>
        </Box>
      </Stack>
    </Container>
  );
}