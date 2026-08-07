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
  Search as SearchIcon,
  ViewModule as ViewModuleIcon,
  ViewList as ViewListIcon,
} from '@mui/icons-material';
import { Avatar, InputAdornment } from '@mui/material';

import DuplicatePerformersSection from '../components/hash/DuplicatePerformersSection';
import CheckHashModal from '../components/CheckHashModal';
import HashResultsModal from '../components/HashResultsModal';
import HashCreationQueue from '../components/HashCreationQueue';
import MediaOptimizationPanel from '../components/MediaOptimizationPanel';
import { usePerformerData } from '../hooks/usePerformerData';
import {
  PageShell, PageHeader, Panel, StatRow, EmptyState,
  Toolbar as LayoutToolbar, ICON, iconBtnSx
} from '../components/layout';

const HASH_VIEW_KEY = 'hashMgmtView_v1';

const LOC_LABEL = { before: 'Before Filter', after: 'After Filter' };
const LOC_TONE = { before: 'var(--warn)', after: 'var(--ok)' };

/* Same three primitives as PerformerManagement — pill, count, flag-dot — so a
   performer reads identically on both pages. */
const hashPillSx = (tone) => ({
  flexShrink: 0,
  fontSize: '0.62rem',
  fontWeight: 700,
  letterSpacing: '.02em',
  color: tone,
  border: '1px solid',
  borderColor: tone,
  borderRadius: 'var(--radius-sm, 4px)',
  px: 0.75,
  py: '1px',
  lineHeight: 1.5,
  whiteSpace: 'nowrap'
});

const hashMetaSx = {
  fontSize: '0.72rem',
  color: 'var(--dim)',
  fontVariantNumeric: 'tabular-nums',
  '& b': { color: 'var(--text)', fontWeight: 600 }
};

const hashDotSx = (tone) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '0.68rem',
  color: 'var(--muted)',
  '&::before': {
    content: '""',
    width: 6, height: 6, borderRadius: '50%',
    background: tone, flexShrink: 0
  }
});

const hashChipSx = (active) => ({
  height: 24,
  fontSize: '0.7rem',
  fontWeight: active ? 650 : 550,
  cursor: 'pointer',
  bgcolor: active ? 'var(--accent)' : 'var(--bg)',
  color: active ? 'var(--on-accent)' : 'var(--dim)',
  border: '1px solid',
  borderColor: active ? 'var(--accent)' : 'var(--line)',
  '&:hover': { bgcolor: active ? 'var(--accent-hover)' : 'var(--raised)' }
});

/* `thumbnail` here is a file path, same as on the performers table — see the
   note in PerformerManagementPageNew. There is no GET /api/performers/:id/thumbnail. */
const hashThumbUrl = (performer) =>
  (performer?.thumbnail ? `/api/files/preview?path=${encodeURIComponent(performer.thumbnail)}` : undefined);

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
  // Cards by default; the table keeps the sortable file-count and last-updated
  // columns, which the rows deliberately don't reproduce.
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(HASH_VIEW_KEY) || 'cards');
  useEffect(() => { localStorage.setItem(HASH_VIEW_KEY, viewMode); }, [viewMode]);

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
        newTab.document.write(`<html><head><title>Loading...</title><style>body{background: var(--surface);color: var(--text);display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}</style></head><body><div style="text-align:center"><div style="width:40px;height:40px;border:4px solid #444;border-top-color: var(--accent);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px;"></div>Processing...</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style></body></html>`);
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
      newTab.document.write(`<html><head><title>Loading...</title><style>body{background: var(--surface);color: var(--text);display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}</style></head><body><div style="text-align:center"><div style="width:40px;height:40px;border:4px solid #444;border-top-color: var(--accent);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px;"></div>Checking...</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style></body></html>`);
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

  /**
   * The action set, shared by both views.
   *
   * Extracted so the card and the table cannot drift apart — the actions are
   * the point of this page, and having two copies is how one of them ends up
   * missing a button after a change.
   */
  const renderHashActions = (performer) => (
    <>
      <Tooltip title={isPerformerInQueue(performer.id) ? 'In queue' : performer.has_hash_db ? 'Recreate hash DB' : 'Create hash DB'}>
        <span>
          <Button
            size="small"
            variant={performer.has_hash_db ? 'outlined' : 'contained'}
            startIcon={isPerformerInQueue(performer.id) ? <CircularProgress size={14} color="inherit" /> : <StorageIcon />}
            onClick={() => handleCreateHashDB(performer.id, performer.has_hash_db ? 'replace' : 'append')}
            disabled={isPerformerInQueue(performer.id)}
            sx={{ minWidth: 80, py: 0.5, fontSize: '0.7rem' }}
          >
            {isPerformerInQueue(performer.id) ? 'Queued' : performer.has_hash_db ? 'Recreate' : 'Create'}
          </Button>
        </span>
      </Tooltip>
      <Tooltip title={performer.has_hash_db ? 'Find internal duplicates' : 'Needs a hash DB first'}>
        <span>
          <IconButton size="small" onClick={() => handleCheckInternal(performer.id)}
            disabled={!performer.has_hash_db} sx={iconBtnSx('var(--info)')}>
            <FindInPageIcon />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={performer.has_hash_db ? 'Compare with another performer' : 'Needs a hash DB first'}>
        <span>
          <IconButton size="small" onClick={() => handleCompare(performer.id)}
            disabled={!performer.has_hash_db} sx={iconBtnSx('var(--accent)')}>
            <CompareArrowsIcon />
          </IconButton>
        </span>
      </Tooltip>
      {performer.has_hash_db && (
        <Tooltip title="Delete hash DB">
          <IconButton size="small" onClick={() => handleDeleteHashDB(performer.id)} sx={iconBtnSx('var(--dim)', 'var(--bad)')}>
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      )}
    </>
  );

  /**
   * A performer as a media row, matching Performer Management.
   *
   * Hash state is the axis you work along here, so it reads as a labelled dot
   * rather than a bare check/cross icon whose meaning you had to hover for. The
   * payload already carries `thumbnail`, `target_stats` and the CLIP-DB fields;
   * the table surfaced none of them.
   */
  const renderHashCard = (performer) => {
    const ts = performer.target_stats || {};
    const queued = isPerformerInQueue(performer.id);

    return (
      <Panel
        key={performer.id}
        padded={false}
        sx={{
          // .App is a flex column; cards in a nested flex column collapse
          // without this. See the note in FunpipePage.
          flexShrink: 0,
          borderColor: queued ? 'var(--accent)' : 'var(--line)',
          '&:hover': { borderColor: queued ? 'var(--accent)' : 'var(--line-strong)' }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1 }}>
          <Avatar
            variant="rounded"
            src={hashThumbUrl(performer)}
            sx={{
              width: 56, height: 56, flexShrink: 0,
              bgcolor: 'var(--raised)', color: 'var(--muted)',
              fontSize: '1.1rem', fontWeight: 600,
              borderRadius: 'var(--radius-sm, 4px)'
            }}
          >
            {performer.canonical_name?.[0] || '?'}
          </Avatar>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <Typography
                title={performer.canonical_name}
                sx={{
                  fontSize: '0.9rem', fontWeight: 620, color: 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}
              >
                {performer.canonical_name}
              </Typography>
              <Box component="span" sx={hashPillSx(LOC_TONE[performer.location] || 'var(--dim)')}>
                {LOC_LABEL[performer.location] || 'Unknown'}
              </Box>
              {queued && <Box component="span" sx={hashPillSx('var(--accent)')}>Queued</Box>}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 0.5, flexWrap: 'wrap' }}>
              <Tooltip title={performer.has_hash_db
                ? `${performer.file_count || 0} files hashed · updated ${formatDate(performer.last_updated)}`
                : 'No hash database yet'}>
                <Box component="span" sx={hashDotSx(performer.has_hash_db ? 'var(--ok)' : 'var(--faint)')}>
                  {performer.has_hash_db ? `${performer.file_count || 0} hashed` : 'no hash db'}
                </Box>
              </Tooltip>
              <Tooltip title={performer.has_clip_db
                ? `${performer.files_with_clip || 0} files with CLIP embeddings`
                : 'No CLIP database'}>
                <Box component="span" sx={hashDotSx(performer.has_clip_db ? 'var(--ok)' : 'var(--faint)')}>
                  clip
                </Box>
              </Tooltip>
              {ts.pics_count > 0 && (
                <Typography sx={hashMetaSx}><b>{ts.pics_count}</b> pics</Typography>
              )}
              {ts.vids_count > 0 && (
                <Typography sx={hashMetaSx}><b>{ts.vids_count}</b> vids</Typography>
              )}
              {ts.total_size_gb > 0 && (
                <Typography sx={hashMetaSx}>{ts.total_size_gb.toFixed(1)} GB</Typography>
              )}
              {performer.has_hash_db && (
                <Typography sx={{ ...hashMetaSx, color: 'var(--muted)' }}>
                  {formatDate(performer.last_updated)}
                </Typography>
              )}
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, pr: 0.5 }}>
            {renderHashActions(performer)}
          </Box>
        </Box>
      </Panel>
    );
  };

  return (
    /* Was a hand-rolled shell — its own p:3, its own maxWidth 1600, its own
       h5 heading block. Same numbers PageShell/PageHeader already define, kept
       in a second place where they could drift. */
    <PageShell>
      <PageHeader
        title="Hash-Based Duplicate Detection"
        subtitle="Manage performer hash databases and find duplicate content."
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress sx={{ color: 'primary.main' }} />
        </Box>
      ) : (
        <>
          {/* Media Optimization Panel */}
          <MediaOptimizationPanel performerId={selectedPerformerId} />

          {/* Stats lead and act as filters, same as Performer Management, so
              the two pages behave the same way. They were read-only boxes in a
              sidebar next to selects that repeated the same categories. */}
          <StatRow
            min={140}
            items={[
              { label: 'Total', value: stats.total, tone: 'default' },
              { label: 'With hash', value: stats.withHash, tone: 'ok' },
              { label: 'No hash', value: stats.noHash, tone: 'bad' },
              { label: 'Before', value: stats.before, tone: 'warn' },
              { label: 'After', value: stats.after, tone: 'ok' }
            ]}
          />

          <LayoutToolbar>
            {[
              { label: 'All', loc: 'all', hash: 'all', count: stats.total },
              { label: 'With hash', loc: 'all', hash: 'with-hash', count: stats.withHash },
              { label: 'No hash', loc: 'all', hash: 'no-hash', count: stats.noHash },
              { label: 'Before', loc: 'before', hash: 'all', count: stats.before },
              { label: 'After', loc: 'after', hash: 'all', count: stats.after }
            ].map(f => {
              const active = locationFilter === f.loc && hashStatusFilter === f.hash;
              return (
                <Chip
                  key={f.label}
                  size="small"
                  label={`${f.label} ${f.count}`}
                  onClick={() => { setLocationFilter(f.loc); setHashStatusFilter(f.hash); }}
                  sx={hashChipSx(active)}
                />
              );
            })}

            <TextField
              size="small"
              placeholder="Search performers…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              sx={{ flex: 1, minWidth: 180, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.75 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: ICON.inline, color: 'var(--muted)' }} />
                  </InputAdornment>
                )
              }}
            />

            <Tooltip title="Refresh list">
              <IconButton size="small" onClick={loadPerformers} sx={iconBtnSx()}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>

            {/* Same toggle as Performer Management. The table sorts by file
                count and last-updated, which the cards deliberately don't. */}
            <Box role="group" aria-label="View" sx={{
              display: 'flex', gap: '2px', p: '2px', bgcolor: 'var(--bg)',
              border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)'
            }}>
              {[['cards', 'Cards', <ViewModuleIcon key="c" />], ['table', 'Table', <ViewListIcon key="t" />]].map(([key, label, icon]) => (
                <Tooltip title={`${label} view`} key={key}>
                  <IconButton
                    size="small"
                    onClick={() => setViewMode(key)}
                    aria-label={`${label} view`}
                    sx={{
                      borderRadius: 'var(--radius-sm, 4px)', p: 0.5,
                      color: viewMode === key ? 'var(--on-accent)' : 'var(--dim)',
                      bgcolor: viewMode === key ? 'var(--accent)' : 'transparent',
                      '& svg': { fontSize: ICON.action },
                      '&:hover': { bgcolor: viewMode === key ? 'var(--accent-hover)' : 'var(--raised)' }
                    }}
                  >
                    {icon}
                  </IconButton>
                </Tooltip>
              ))}
            </Box>
          </LayoutToolbar>

          {/* Duplicate Performers Section */}
          <DuplicatePerformersSection
            performers={performers}
            onCreateHashDB={handleCreateHashDB}
            onCompare={handleCompare}
            processingActions={processingActions}
            hashQueue={hashQueue}
            viewMode={viewMode}
          />

          {viewMode === 'cards' ? (
            filteredPerformers.length === 0 ? (
              <EmptyState
                icon={<SearchIcon />}
                title="No performers match these filters"
                description="Try a different filter, or clear the search."
              />
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {filteredPerformers.map(performer => renderHashCard(performer))}
              </Box>
            )
          ) : (
            <Paper elevation={0} sx={{ bgcolor: 'var(--surface)', borderRadius: 2, border: '1px solid var(--line)', overflow: 'hidden' }}>
              <Box sx={{ p: 2, borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ color: 'var(--text)' }}>
                  All Performers ({filteredPerformers.length})
                </Typography>
              </Box>

              <TableContainer sx={{ maxHeight: 'calc(100vh - 400px)' }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ bgcolor: 'var(--surface)', color: 'var(--dim)', borderBottom: '1px solid var(--line)' }}>
                        <TableSortLabel active={orderBy === 'canonical_name'} direction={orderBy === 'canonical_name' ? order : 'asc'} onClick={() => handleSort('canonical_name')} sx={{ '&.Mui-active': { color: 'var(--accent)' }, '& .MuiTableSortLabel-icon': { color: 'var(--accent) !important' } }}>
                          Performer
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ bgcolor: 'var(--surface)', color: 'var(--dim)', borderBottom: '1px solid var(--line)' }}>Location</TableCell>
                      <TableCell align="center" sx={{ bgcolor: 'var(--surface)', color: 'var(--dim)', borderBottom: '1px solid var(--line)' }}>Hash DB</TableCell>
                      <TableCell align="right" sx={{ bgcolor: 'var(--surface)', color: 'var(--dim)', borderBottom: '1px solid var(--line)' }}>Files</TableCell>
                      <TableCell sx={{ bgcolor: 'var(--surface)', color: 'var(--dim)', borderBottom: '1px solid var(--line)' }}>Last Updated</TableCell>
                      <TableCell align="right" sx={{ bgcolor: 'var(--surface)', color: 'var(--dim)', borderBottom: '1px solid var(--line)' }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredPerformers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'var(--muted)', borderBottom: 'none' }}>
                          No performers found matching the current filters
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredPerformers.map((performer) => (
                        <TableRow key={performer.id} hover sx={{ '&:hover': { bgcolor: 'var(--raised)' } }}>
                          <TableCell sx={{ borderBottom: '1px solid var(--line)' }}>
                            <Typography variant="body2" sx={{ color: 'var(--text)', fontWeight: 500 }}>{performer.canonical_name}</Typography>
                            <Typography variant="caption" sx={{ color: 'var(--muted)' }}>{performer.folder_path}</Typography>
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid var(--line)' }}>
                            <Box component="span" sx={hashPillSx(LOC_TONE[performer.location] || 'var(--dim)')}>
                              {LOC_LABEL[performer.location] || 'Unknown'}
                            </Box>
                          </TableCell>
                          <TableCell align="center" sx={{ borderBottom: '1px solid var(--line)' }}>
                            {performer.has_hash_db ? (
                              <CheckCircleIcon sx={{ color: 'var(--ok)', fontSize: 20 }} />
                            ) : (
                              <CancelIcon sx={{ color: 'var(--muted)', fontSize: 20 }} />
                            )}
                          </TableCell>
                          <TableCell align="right" sx={{ borderBottom: '1px solid var(--line)', color: 'var(--text)' }}>
                            {performer.file_count || 0}
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid var(--line)', color: 'var(--dim)' }}>
                            {formatDate(performer.last_updated)}
                          </TableCell>
                          <TableCell align="right" sx={{ borderBottom: '1px solid var(--line)' }}>
                            <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                              {renderHashActions(performer)}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
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
    </PageShell>
  );
}

export default HashManagementPage;
