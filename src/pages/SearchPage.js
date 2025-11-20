import React, { useState } from 'react';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';

const hasElectron = typeof window !== 'undefined' && !!window.electronAPI;

function formatBytes(bytes) {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e?.preventDefault?.();
    if (!hasElectron) {
      setError('Search is only available in the Electron app.');
      return;
    }
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    try {
      setError(null);
      setLoading(true);
      const res = await window.electronAPI.searchIndexerFiles(q, 300);
      if (!res.ok) {
        setError(res.error || 'Search failed.');
        setResults([]);
      } else {
        setResults(res.results || []);
      }
    } catch (err) {
      setError(err.message || String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ pt: 4, pb: 6 }}>
      <Stack spacing={3}>
        <Typography variant="h4">Search</Typography>
        <Typography variant="body2" color="text.secondary">
          Search across all indexed files by name or path. This uses the indexer database and works even when drives are offline.
        </Typography>

        <Box component="form" onSubmit={handleSearch}>
          <Stack direction="row" spacing={2} alignItems="center">
            <TextField
              label="Search terms"
              variant="outlined"
              size="small"
              fullWidth
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              variant="contained"
              type="submit"
              disabled={loading || !query.trim()}
            >
              Search
            </Button>
          </Stack>
        </Box>

        {loading && <LinearProgress />}

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {results.length === 0 && !loading && query.trim() && !error && (
          <Alert severity="info">No results found.</Alert>
        )}

        {results.length > 0 && (
          <Box sx={{ maxHeight: 500, overflow: 'auto', bgcolor: 'background.paper', borderRadius: 2 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>File Name</TableCell>
                  <TableCell>Drive</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Size</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Root Path</TableCell>
                  <TableCell>Relative Path</TableCell>
                  <TableCell>Last Seen</TableCell>
                  <TableCell>First Seen</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.drive_name || row.drive_uuid || '—'}</TableCell>
                    <TableCell>{row.file_type || '—'}</TableCell>
                    <TableCell>{formatBytes(row.size_bytes)}</TableCell>
                    <TableCell>{row.last_status || '—'}</TableCell>
                    <TableCell>{row.root_path}</TableCell>
                    <TableCell>{row.relative_path}</TableCell>
                    <TableCell>{formatDate(row.last_seen_at)}</TableCell>
                    <TableCell>{formatDate(row.first_seen_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Stack>
    </Container>
  );
}

export default SearchPage;