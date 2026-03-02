import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Grid,
  TextField,
  MenuItem,
  Button,
  Chip,
  IconButton,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  LinearProgress,
} from '@mui/material';
import {
  Storage as StorageIcon,
  CompareArrows as CompareArrowsIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Refresh as RefreshIcon,
  FindInPage as FindInPageIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';

import DuplicatePerformersSection from '../components/hash/DuplicatePerformersSection';
import CheckHashModal from '../components/CheckHashModal';
import HashResultsModal from '../components/HashResultsModal';
import HashCreationQueue from '../components/HashCreationQueue';
import MediaOptimizationPanel from '../components/MediaOptimizationPanel';
import { usePerformerData } from '../hooks/usePerformerData';

// Gradient button style
const gradientButtonStyle = {
  background: 'linear-gradient(45deg, #FE6B8B 30%, #FF8E53 90%)',
  color: '#fff',
  fontWeight: 'bold',
  textTransform: 'none',
  boxShadow: '0 3px 5px 2px rgba(255, 105, 135, .3)',
  '&:hover': {
    background: 'linear-gradient(45deg, #FE6B8B 20%, #FF8E53 80%)',
    boxShadow: '0 3px 10px 2px rgba(255, 105, 135, .4)',
  },
  '&:disabled': {
    background: '#444',
    color: '#777',
    boxShadow: 'none'
  }
};

function HashManagementPage({
  basePath,
  hashQueue,
  setHashQueue,
  currentJobRef,
  pollingIntervalRef,
  setShowGlobalQueue
}) {
  const [searchParams] = useSearchParams();
  const [currentPerformerSearch, setCurrentPerformerSearch] = useState(searchParams.get('performer') || '');
  const [orderBy, setOrderBy] = useState('canonical_name');
  const [order, setOrder] = useState('asc');
  const [locationFilter, setLocationFilter] = useState('all');
  const [hashStatusFilter, setHashStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('performer') || '');

  const { performers, loading, error: performerError, refresh: refreshPerformers } = usePerformerData();
  const [error, setError] = useState(null);
  const [processingActions, setProcessingActions] = useState(new Set());

  // Modal state
  const [checkHashModalOpen, setCheckHashModalOpen] = useState(false);
  const [hashResultsModalOpen, setHashResultsModalOpen] = useState(false);
  const [selectedPerformerId, setSelectedPerformerId] = useState(null);
  const [currentRunId, setCurrentRunId] = useState(null);

  useEffect(() => {
    if (performerError) setError(performerError);
  }, [performerError]);

  useEffect(() => {
    const performer = searchParams.get('performer') || '';
    setCurrentPerformerSearch(performer);
    setSearchQuery(performer);
  }, [searchParams]);

  const loadPerformers = refreshPerformers;

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      if (currentJobRef.current) cancelJob(currentJobRef.current);
    };
  }, []);

  const cancelJob = async (queueJobId) => {
    const job = hashQueue.find(j => j.id === queueJobId);
    if (!job) return;
    if (job.status === 'processing') {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      currentJobRef.current = null;
    }
    setHashQueue(prev => prev.filter(j => j.id !== queueJobId));
    await loadPerformers();
  };

  const isPerformerInQueue = (performerId) => {
    return hashQueue.some(job => job.performerId === performerId && (job.status === 'queued' || job.status === 'processing'));
  };

  const handleCreateHashDB = (performerId, mode = 'append') => {
    if (!basePath) {
      setError('Base path is not configured. Please set it in settings first.');
      return;
    }
    const performer = performers.find(p => p.id === performerId);
    if (!performer) return;
    const existingJob = hashQueue.find(j => j.performerId === performerId && (j.status === 'queued' || j.status === 'processing'));
    if (existingJob) {
      setError(`${performer.name} is already in the hash creation queue`);
      return;
    }
    const newJob = {
      id: `job-${Date.now()}-${Math.random()}`,
      performerId,
      performerName: performer.canonical_name || performer.name,
      location: performer.location,
      mode,
      status: 'queued',
      processed: 0,
      total: 0,
      progress: 0,
    };
    setHashQueue(prev => [...prev, newJob]);
  };

  const handleDeleteHashDB = async (performerId) => {
    if (!window.confirm('Delete this performer\'s hash database? This cannot be undone.')) return;
    try {
      const resp = await fetch(`/api/hashes/performer/${performerId}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error(`Failed to delete: ${resp.statusText}`);
      await loadPerformers();
    } catch (err) {
      setError('Failed to delete hash DB: ' + err.message);
    }
  };

  const handleCompare = async (sourcePerformerId, targetPerformerId = null) => {
    const actionKey = `compare-${sourcePerformerId}-${targetPerformerId || 'select'}`;
    if (targetPerformerId) {
      if (processingActions.has(actionKey)) return;
      setProcessingActions(prev => new Set(prev).add(actionKey));
      const newTab = window.open('about:blank', '_blank');
      if (newTab) {
        newTab.document.write(`<html><head><title>Loading...</title><style>body{background:#1E1E1E;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}</style></head><body><div style="text-align:center"><div style="width:40px;height:40px;border:4px solid #444;border-top-color:#FF8E53;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px;"></div>Processing...</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style></body></html>`);
      }
      try {
        const response = await fetch('/api/hashes/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_performer_id: sourcePerformerId, target_performer_id: targetPerformerId }),
        });
        const data = await response.json();
        if (data.success && data.runId) {
          if (newTab) newTab.location.href = `/hash-results/${data.runId}`;
        } else {
          throw new Error(data.error || 'Failed to check for duplicates');
        }
      } catch (err) {
        setError('Failed to compare performers: ' + err.message);
        if (newTab) newTab.close();
      } finally {
        setProcessingActions(prev => { const next = new Set(prev); next.delete(actionKey); return next; });
      }
    } else {
      setSelectedPerformerId(sourcePerformerId);
      setCheckHashModalOpen(true);
    }
  };

  const handleCheckInternal = async (performerId) => {
    const actionKey = `internal-${performerId}`;
    if (processingActions.has(actionKey)) return;
    setProcessingActions(prev => new Set(prev).add(actionKey));
    const newTab = window.open('about:blank', '_blank');
    if (newTab) {
      newTab.document.write(`<html><head><title>Loading...</title><style>body{background:#1E1E1E;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}</style></head><body><div style="text-align:center"><div style="width:40px;height:40px;border:4px solid #444;border-top-color:#FF8E53;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px;"></div>Checking...</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style></body></html>`);
    }
    try {
      const response = await fetch('/api/hashes/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_performer_id: performerId, target_performer_id: performerId }),
      });
      const data = await response.json();
      if (data.success && data.runId) {
        if (newTab) newTab.location.href = `/hash-results/${data.runId}`;
      } else {
        throw new Error(data.error || 'Failed to check for internal duplicates');
      }
    } catch (err) {
      setError('Failed to check internal duplicates: ' + err.message);
      if (newTab) newTab.close();
    } finally {
      setProcessingActions(prev => { const next = new Set(prev); next.delete(actionKey); return next; });
    }
  };

  const handleRunCreated = (runId) => {
    setCurrentRunId(runId);
    setHashResultsModalOpen(true);
    setCheckHashModalOpen(false);
  };

  const handleResultsClosed = () => {
    setHashResultsModalOpen(false);
    loadPerformers();
  };

  const handleSort = (property) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Filter and sort performers
  const filteredPerformers = useMemo(() => {
    let filtered = performers;
    if (locationFilter !== 'all') filtered = filtered.filter(p => p.location === locationFilter);
    if (hashStatusFilter === 'with-hash') filtered = filtered.filter(p => p.has_hash_db);
    else if (hashStatusFilter === 'no-hash') filtered = filtered.filter(p => !p.has_hash_db);
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p => p.canonical_name.toLowerCase().includes(query) || (p.folder_path && p.folder_path.toLowerCase().includes(query)));
    }
    filtered.sort((a, b) => {
      let aVal = a[orderBy];
      let bVal = b[orderBy];
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      if (typeof aVal === 'string') { aVal = aVal.toLowerCase(); bVal = bVal.toLowerCase(); }
      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });
    return filtered;
  }, [performers, locationFilter, hashStatusFilter, searchQuery, orderBy, order]);

  // Stats
  const stats = useMemo(() => ({
    total: performers.length,
    withHash: performers.filter(p => p.has_hash_db).length,
    noHash: performers.filter(p => !p.has_hash_db).length,
    before: performers.filter(p => p.location === 'before').length,
    after: performers.filter(p => p.location === 'after').length,
  }), [performers]);

  return (
    <Box sx={{ p: 3, height: '100vh', overflow: 'auto', display: 'flex', flexDirection: 'column', maxWidth: 1600, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', background: 'linear-gradient(45deg, #FE6B8B 30%, #FF8E53 90%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Hash-Based Duplicate Detection
        </Typography>
        <Typography variant="body2" sx={{ color: '#666' }}>
          Manage performer hash databases and find duplicate content.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress sx={{ color: '#FF8E53' }} />
        </Box>
      ) : (
        <>
          {/* Media Optimization Panel */}
          <MediaOptimizationPanel performerId={selectedPerformerId} />

          <Grid container spacing={3} sx={{ flex: 1 }}>
            {/* Left Panel: Stats & Filters */}
            <Grid item xs={12} md={3}>
              <Paper elevation={0} sx={{ p: 3, bgcolor: '#1E1E1E', borderRadius: 2, border: '1px solid #333', position: 'sticky', top: 16 }}>
                {/* Stats */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: '#888', mb: 1.5 }}>Statistics</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                    <Box sx={{ p: 1.5, bgcolor: '#252525', borderRadius: 1, textAlign: 'center' }}>
                      <Typography variant="h5" sx={{ color: '#fff', fontWeight: 'bold' }}>{stats.total}</Typography>
                      <Typography variant="caption" sx={{ color: '#666' }}>Total</Typography>
                    </Box>
                    <Box sx={{ p: 1.5, bgcolor: '#252525', borderRadius: 1, textAlign: 'center' }}>
                      <Typography variant="h5" sx={{ color: '#4caf50', fontWeight: 'bold' }}>{stats.withHash}</Typography>
                      <Typography variant="caption" sx={{ color: '#666' }}>With Hash</Typography>
                    </Box>
                    <Box sx={{ p: 1.5, bgcolor: '#252525', borderRadius: 1, textAlign: 'center' }}>
                      <Typography variant="h5" sx={{ color: '#ed6c02', fontWeight: 'bold' }}>{stats.before}</Typography>
                      <Typography variant="caption" sx={{ color: '#666' }}>Before</Typography>
                    </Box>
                    <Box sx={{ p: 1.5, bgcolor: '#252525', borderRadius: 1, textAlign: 'center' }}>
                      <Typography variant="h5" sx={{ color: '#4caf50', fontWeight: 'bold' }}>{stats.after}</Typography>
                      <Typography variant="caption" sx={{ color: '#666' }}>After</Typography>
                    </Box>
                  </Box>
                </Box>

                {/* Filters */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: '#888', mb: 1 }}>Search</Typography>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Search performers..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        color: '#fff',
                        '& fieldset': { borderColor: '#444' },
                        '&:hover fieldset': { borderColor: '#FF8E53' },
                        '&.Mui-focused fieldset': { borderColor: '#FF8E53' }
                      },
                      '& .MuiInputBase-input::placeholder': { color: '#666' }
                    }}
                  />
                </Box>

                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: '#888', mb: 1 }}>Location</Typography>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    sx={{
                      '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: '#444' }, '&:hover fieldset': { borderColor: '#FF8E53' } },
                      '& .MuiSelect-icon': { color: '#888' }
                    }}
                  >
                    <MenuItem value="all">All Locations</MenuItem>
                    <MenuItem value="before">Before Filter</MenuItem>
                    <MenuItem value="after">After Filter</MenuItem>
                  </TextField>
                </Box>

                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: '#888', mb: 1 }}>Hash Status</Typography>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    value={hashStatusFilter}
                    onChange={(e) => setHashStatusFilter(e.target.value)}
                    sx={{
                      '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: '#444' }, '&:hover fieldset': { borderColor: '#FF8E53' } },
                      '& .MuiSelect-icon': { color: '#888' }
                    }}
                  >
                    <MenuItem value="all">All Status</MenuItem>
                    <MenuItem value="with-hash">With Hash DB</MenuItem>
                    <MenuItem value="no-hash">No Hash DB</MenuItem>
                  </TextField>
                </Box>

                {/* Refresh button */}
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={loadPerformers}
                  sx={{ borderColor: '#444', color: '#aaa', '&:hover': { borderColor: '#FF8E53', color: '#FF8E53' } }}
                >
                  Refresh List
                </Button>
              </Paper>
            </Grid>

            {/* Right Panel: Performer Table */}
            <Grid item xs={12} md={9}>
              {/* Duplicate Performers Section */}
              <DuplicatePerformersSection
                performers={performers}
                onCreateHashDB={handleCreateHashDB}
                onCompare={handleCompare}
                processingActions={processingActions}
                hashQueue={hashQueue}
              />

              {/* Performer Table */}
              <Paper elevation={0} sx={{ bgcolor: '#1E1E1E', borderRadius: 2, border: '1px solid #333', overflow: 'hidden' }}>
                <Box sx={{ p: 2, borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle1" fontWeight="bold" sx={{ color: '#fff' }}>
                    All Performers ({filteredPerformers.length})
                  </Typography>
                </Box>

                <TableContainer sx={{ maxHeight: 'calc(100vh - 400px)' }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ bgcolor: '#252525', color: '#aaa', borderBottom: '1px solid #333' }}>
                          <TableSortLabel active={orderBy === 'canonical_name'} direction={orderBy === 'canonical_name' ? order : 'asc'} onClick={() => handleSort('canonical_name')} sx={{ '&.Mui-active': { color: '#FF8E53' }, '& .MuiTableSortLabel-icon': { color: '#FF8E53 !important' } }}>
                            Performer
                          </TableSortLabel>
                        </TableCell>
                        <TableCell sx={{ bgcolor: '#252525', color: '#aaa', borderBottom: '1px solid #333' }}>Location</TableCell>
                        <TableCell align="center" sx={{ bgcolor: '#252525', color: '#aaa', borderBottom: '1px solid #333' }}>Hash DB</TableCell>
                        <TableCell align="right" sx={{ bgcolor: '#252525', color: '#aaa', borderBottom: '1px solid #333' }}>Files</TableCell>
                        <TableCell sx={{ bgcolor: '#252525', color: '#aaa', borderBottom: '1px solid #333' }}>Last Updated</TableCell>
                        <TableCell align="right" sx={{ bgcolor: '#252525', color: '#aaa', borderBottom: '1px solid #333' }}>Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredPerformers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} align="center" sx={{ py: 4, color: '#666', borderBottom: 'none' }}>
                            No performers found matching the current filters
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredPerformers.map((performer) => (
                          <TableRow key={performer.id} hover sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' } }}>
                            <TableCell sx={{ borderBottom: '1px solid #333' }}>
                              <Typography variant="body2" sx={{ color: '#fff', fontWeight: 500 }}>{performer.canonical_name}</Typography>
                              <Typography variant="caption" sx={{ color: '#666' }}>{performer.folder_path}</Typography>
                            </TableCell>
                            <TableCell sx={{ borderBottom: '1px solid #333' }}>
                              <Chip
                                label={performer.location === 'before' ? 'Before' : performer.location === 'after' ? 'After' : 'Unknown'}
                                size="small"
                                sx={{
                                  bgcolor: performer.location === 'before' ? 'rgba(237, 108, 2, 0.15)' : performer.location === 'after' ? 'rgba(76, 175, 80, 0.15)' : 'rgba(255,255,255,0.08)',
                                  color: performer.location === 'before' ? '#ed6c02' : performer.location === 'after' ? '#4caf50' : '#888',
                                  fontWeight: 'bold',
                                  fontSize: '0.65rem'
                                }}
                              />
                            </TableCell>
                            <TableCell align="center" sx={{ borderBottom: '1px solid #333' }}>
                              {performer.has_hash_db ? (
                                <CheckCircleIcon sx={{ color: '#4caf50', fontSize: 20 }} />
                              ) : (
                                <CancelIcon sx={{ color: '#555', fontSize: 20 }} />
                              )}
                            </TableCell>
                            <TableCell align="right" sx={{ borderBottom: '1px solid #333', color: '#fff' }}>
                              {performer.file_count || 0}
                            </TableCell>
                            <TableCell sx={{ borderBottom: '1px solid #333', color: '#888' }}>
                              {formatDate(performer.last_updated)}
                            </TableCell>
                            <TableCell align="right" sx={{ borderBottom: '1px solid #333' }}>
                              <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                                <Tooltip title={isPerformerInQueue(performer.id) ? 'In Queue' : performer.has_hash_db ? 'Recreate' : 'Create Hash DB'}>
                                  <span>
                                    <Button
                                      size="small"
                                      variant="contained"
                                      startIcon={isPerformerInQueue(performer.id) ? <CircularProgress size={14} color="inherit" /> : <StorageIcon />}
                                      onClick={() => handleCreateHashDB(performer.id, performer.has_hash_db ? 'replace' : 'append')}
                                      disabled={isPerformerInQueue(performer.id)}
                                      sx={!performer.has_hash_db ? { ...gradientButtonStyle, minWidth: 80, py: 0.5, fontSize: '0.7rem' } : { minWidth: 80, py: 0.5, fontSize: '0.7rem', bgcolor: '#444', '&:hover': { bgcolor: '#555' } }}
                                    >
                                      {isPerformerInQueue(performer.id) ? 'Queued' : performer.has_hash_db ? 'Recreate' : 'Create'}
                                    </Button>
                                  </span>
                                </Tooltip>
                                <Tooltip title="Find Internal Duplicates">
                                  <span>
                                    <IconButton size="small" onClick={() => handleCheckInternal(performer.id)} disabled={!performer.has_hash_db} sx={{ color: performer.has_hash_db ? '#29b6f6' : '#444' }}>
                                      <FindInPageIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Tooltip title="Compare with Another">
                                  <span>
                                    <IconButton size="small" onClick={() => handleCompare(performer.id)} disabled={!performer.has_hash_db} sx={{ color: performer.has_hash_db ? '#ce93d8' : '#444' }}>
                                      <CompareArrowsIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                {performer.has_hash_db && (
                                  <Tooltip title="Delete Hash DB">
                                    <IconButton size="small" onClick={() => handleDeleteHashDB(performer.id)} sx={{ color: '#f44336' }}>
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                )}
                              </Box>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </Grid>
          </Grid>
        </>
      )}

      {/* Background Task Queue */}
      {hashQueue.length > 0 && (
        <HashCreationQueue
          title="Background Tasks"
          queue={[...hashQueue]}
          onClose={() => setHashQueue(prev => prev.filter(j => j.status === 'processing' || j.status === 'queued'))}
          onCancel={(jobId) => {
            setHashQueue(prev => prev.filter(j => j.id !== jobId));
            if (currentJobRef.current === jobId) {
              currentJobRef.current = null;
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
            }
          }}
        />
      )}

      {/* Modals */}
      <CheckHashModal
        open={checkHashModalOpen}
        onClose={() => setCheckHashModalOpen(false)}
        basePath={basePath}
        performerId={selectedPerformerId}
        onRunCreated={handleRunCreated}
      />
      <HashResultsModal
        open={hashResultsModalOpen}
        onClose={handleResultsClosed}
        runId={currentRunId}
      />
    </Box>
  );
}

export default HashManagementPage;
