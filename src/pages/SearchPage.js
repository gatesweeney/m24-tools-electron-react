import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';
import { formatBytes, formatDateTime } from '../utils/formatters';
import DetailPanel from '../components/DetailPanel';

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

  // Column-view navigation: up to 2 panels
  const [panel1Item, setPanel1Item] = useState(null);
  const [panel2Item, setPanel2Item] = useState(null);

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

  // DataGrid row click → open in Panel 1, clear Panel 2
  const handleRowClick = useCallback((params) => {
    setPanel1Item(params.row);
    setPanel2Item(null);
  }, []);

  // Panel 1 item click → open in Panel 2
  const handlePanel1ItemClick = useCallback((childItem) => {
    setPanel2Item(childItem);
  }, []);

  // Panel 2 item click → shift left (item becomes panel1, clear panel2)
  const handlePanel2ItemClick = useCallback((childItem) => {
    setPanel1Item(panel2Item);
    setPanel2Item(childItem);
  }, [panel2Item]);

  // Close panel 1 → close both panels
  const handleClosePanel1 = useCallback(() => {
    setPanel1Item(null);
    setPanel2Item(null);
  }, []);

  // Close panel 2 → just close panel 2
  const handleClosePanel2 = useCallback(() => {
    setPanel2Item(null);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape to close panels (rightmost first)
      if (e.key === 'Escape') {
        if (panel2Item) {
          setPanel2Item(null);
          e.preventDefault();
        } else if (panel1Item) {
          setPanel1Item(null);
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panel1Item, panel2Item]);

  const rows = useMemo(() => {
    return (results || []).map((r, idx) => ({
      id: `${r.machineId || 'local'}::${r.volume_uuid || 'none'}::${r.path || idx}`,
      ...r
    }));
  }, [results]);

  const columns = useMemo(() => ([
    {
      field: 'name',
      headerName: 'Name',
      flex: 1,
      minWidth: 200,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
          {params.row.is_dir ? (
            <FolderIcon sx={{ color: 'primary.main', fontSize: 20, flexShrink: 0 }} />
          ) : (
            <InsertDriveFileIcon sx={{ color: 'text.secondary', fontSize: 18, flexShrink: 0 }} />
          )}
          <Typography
            variant="body2"
            sx={{
              fontWeight: params.row.is_dir ? 600 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {params.value}
          </Typography>
        </Box>
      )
    },
    { field: 'path', headerName: 'Path', flex: 2, minWidth: 300 },
    { field: 'machineId', headerName: 'Machine', width: 100, valueGetter: (p) => p.row.machineId || 'local' },
    {
      field: 'size_bytes',
      headerName: 'Size',
      width: 100,
      valueGetter: (p) => p.row.is_dir ? '—' : formatBytes(p.row.size_bytes)
    },
    { field: 'mtime', headerName: 'Modified', width: 160, valueGetter: (p) => (p.row.mtime ? formatDateTime(p.row.mtime * 1000) : '—') },
    {
      field: 'file_type',
      headerName: 'Type',
      width: 80,
      valueGetter: (p) => p.row.is_dir ? 'folder' : (p.row.file_type || p.row.ext || '—')
    }
  ]), []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 3, pt: 3, pb: 2, flexShrink: 0 }}>
        <Typography variant="h4">Search</Typography>
        <Typography variant="body2" color="text.secondary">
          Fuzzy search across indexed drives and manual roots. Click folders to browse contents.
        </Typography>
      </Box>

      {/* Search input */}
      <Box sx={{ px: 3, pb: 2, flexShrink: 0 }}>
        <TextField
          label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Try: prores, h264 1080, >1gb, .wav, 2025-11..."
          fullWidth
          size="small"
        />
        {loading && <LinearProgress sx={{ mt: 1 }} />}
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </Box>

      {/* Main content: DataGrid + Column-view Panels (Finder style) */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', px: 3, pb: 3, gap: 0 }}>
        {/* DataGrid - scrolls internally */}
        <Box
          sx={{
            flex: 1,
            minWidth: 300,
            bgcolor: 'background.paper',
            borderRadius: 2,
            overflow: 'hidden',
            transition: 'flex 0.2s ease'
          }}
        >
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
            onRowClick={handleRowClick}
            onRowDoubleClick={async (params) => {
              if (!window.electronAPI?.openInFinder) return;
              const p = params.row.path;
              if (!p) return;
              await window.electronAPI.openInFinder(p);
            }}
            getRowClassName={(params) =>
              panel1Item?.relative_path === params.row.relative_path ? 'Mui-selected' : ''
            }
          />
        </Box>

        {/* Panel 1 - First selection */}
        {panel1Item && (
          <DetailPanel
            item={panel1Item}
            onItemClick={handlePanel1ItemClick}
            onClose={handleClosePanel1}
            selectedChildId={panel2Item?.relative_path}
            width={350}
          />
        )}

        {/* Panel 2 - Drill-down selection */}
        {panel2Item && (
          <DetailPanel
            item={panel2Item}
            onItemClick={handlePanel2ItemClick}
            onClose={handleClosePanel2}
            width={350}
          />
        )}
      </Box>
    </Box>
  );
}
