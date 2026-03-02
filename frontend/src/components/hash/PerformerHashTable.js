import React, { useState, useMemo, useEffect } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Button,
  Chip,
  IconButton,
  Tooltip,
  TextField,
  MenuItem,
  Typography,
  alpha,
  CircularProgress,
  Paper,
} from '@mui/material';
import {
  Storage as StorageIcon,
  CompareArrows as CompareArrowsIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Refresh as RefreshIcon,
  FindInPage as FindInPageIcon,
} from '@mui/icons-material';
import DeleteIcon from '@mui/icons-material/Delete';

function PerformerHashTable({ performers, onCreateHashDB, onCompare, onRefresh, onCheckInternal, onDeleteHashDB, processingActions = new Set(), hashQueue = [], initialSearch = '' }) {
  const [orderBy, setOrderBy] = useState('canonical_name');
  const [order, setOrder] = useState('asc');
  const [locationFilter, setLocationFilter] = useState('all');
  const [hashStatusFilter, setHashStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState(initialSearch);

  // Update search query when initialSearch changes (from URL param)
  useEffect(() => {
    if (initialSearch && initialSearch !== searchQuery) {
      setSearchQuery(initialSearch);
    }
  }, [initialSearch]);

  // Check if performer is in hash creation queue
  const isPerformerInQueue = (performerId) => {
    return hashQueue.some(job =>
      job.performerId === performerId &&
      (job.status === 'queued' || job.status === 'processing')
    );
  };



  // Handle sorting
  const handleSort = (property) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  // Filter and sort performers
  const filteredPerformers = useMemo(() => {
    let filtered = performers;

    // Apply location filter
    if (locationFilter !== 'all') {
      filtered = filtered.filter(p => p.location === locationFilter);
    }

    // Apply hash status filter
    if (hashStatusFilter === 'with-hash') {
      filtered = filtered.filter(p => p.has_hash_db);
    } else if (hashStatusFilter === 'no-hash') {
      filtered = filtered.filter(p => !p.has_hash_db);
    }

    // Apply search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.canonical_name.toLowerCase().includes(query) ||
        (p.folder_path && p.folder_path.toLowerCase().includes(query))
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let aVal = a[orderBy];
      let bVal = b[orderBy];

      // Handle null values
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      // Handle string comparison
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [performers, locationFilter, hashStatusFilter, searchQuery, orderBy, order]);

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

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

  return (
    <Paper sx={{ p: 3, bgcolor: '#252525', borderRadius: 3, border: '1px solid #333' }}>
      {/* Filters and Controls */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          label="Search"
          variant="outlined"
          size="small"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          sx={{ minWidth: 250 }}
        />

        <TextField
          label="Location"
          variant="outlined"
          size="small"
          select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="all">All Locations</MenuItem>
          <MenuItem value="before">Before Filter</MenuItem>
          <MenuItem value="after">After Filter</MenuItem>
        </TextField>

        <TextField
          label="Hash Status"
          variant="outlined"
          size="small"
          select
          value={hashStatusFilter}
          onChange={(e) => setHashStatusFilter(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="all">All Status</MenuItem>
          <MenuItem value="with-hash">With Hash DB</MenuItem>
          <MenuItem value="no-hash">No Hash DB</MenuItem>
        </TextField>

        <Box sx={{ flexGrow: 1 }} />

        <Tooltip title="Refresh">
          <IconButton onClick={onRefresh} color="primary">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Results Count */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Showing {filteredPerformers.length} of {performers.length} performers
      </Typography>

      {/* Table */}
      <TableContainer sx={{ border: '1px solid #333', borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'rgba(255,255,255,0.05)' }}>
              <TableCell sx={{ color: '#aaa', borderBottom: '1px solid #333' }}>
                <TableSortLabel
                  active={orderBy === 'canonical_name'}
                  direction={orderBy === 'canonical_name' ? order : 'asc'}
                  onClick={() => handleSort('canonical_name')}
                  sx={{
                    '&.Mui-active': { color: '#fff' },
                    '&.Mui-active .MuiTableSortLabel-icon': { color: '#fff' }
                  }}
                >
                  Performer Name
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ color: '#aaa', borderBottom: '1px solid #333' }}>
                <TableSortLabel
                  active={orderBy === 'location'}
                  direction={orderBy === 'location' ? order : 'asc'}
                  onClick={() => handleSort('location')}
                  sx={{
                    '&.Mui-active': { color: '#fff' },
                    '&.Mui-active .MuiTableSortLabel-icon': { color: '#fff' }
                  }}
                >
                  Location
                </TableSortLabel>
              </TableCell>
              <TableCell align="center" sx={{ color: '#aaa', borderBottom: '1px solid #333' }}>
                <TableSortLabel
                  active={orderBy === 'has_hash_db'}
                  direction={orderBy === 'has_hash_db' ? order : 'asc'}
                  onClick={() => handleSort('has_hash_db')}
                  sx={{
                    '&.Mui-active': { color: '#fff' },
                    '&.Mui-active .MuiTableSortLabel-icon': { color: '#fff' }
                  }}
                >
                  Hash DB
                </TableSortLabel>
              </TableCell>

              <TableCell align="right" sx={{ color: '#aaa', borderBottom: '1px solid #333' }}>
                <TableSortLabel
                  active={orderBy === 'file_count'}
                  direction={orderBy === 'file_count' ? order : 'asc'}
                  onClick={() => handleSort('file_count')}
                  sx={{
                    '&.Mui-active': { color: '#fff' },
                    '&.Mui-active .MuiTableSortLabel-icon': { color: '#fff' }
                  }}
                >
                  Files
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ color: '#aaa', borderBottom: '1px solid #333' }}>
                <TableSortLabel
                  active={orderBy === 'last_updated'}
                  direction={orderBy === 'last_updated' ? order : 'asc'}
                  onClick={() => handleSort('last_updated')}
                  sx={{
                    '&.Mui-active': { color: '#fff' },
                    '&.Mui-active .MuiTableSortLabel-icon': { color: '#fff' }
                  }}
                >
                  Last Updated
                </TableSortLabel>
              </TableCell>
              <TableCell align="right" sx={{ color: '#aaa', borderBottom: '1px solid #333' }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredPerformers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4, borderBottom: 'none' }}>
                  <Typography variant="body2" color="text.secondary">
                    No performers found matching the current filters
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredPerformers.map((performer) => (
                <TableRow
                  key={performer.id}
                  hover
                  sx={{
                    '&:last-child td, &:last-child th': { border: 0 },
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.03) !important' }
                  }}
                >
                  <TableCell sx={{ borderBottom: '1px solid #333', color: '#fff' }}>
                    <Typography variant="body2" fontWeight="medium" sx={{ color: '#fff', fontSize: '0.95rem' }}>
                      {performer.canonical_name}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: '#bbb' }}>
                      {performer.folder_path}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ borderBottom: '1px solid #333' }}>
                    <Chip
                      label={performer.location === 'before' ? 'Before Filter' : performer.location === 'after' ? 'After Filter' : 'Unknown'}
                      color={performer.location === 'before' ? 'warning' : performer.location === 'after' ? 'success' : 'default'}
                      size="small"
                      variant={performer.location === 'before' || performer.location === 'after' ? 'filled' : 'outlined'}
                      sx={{ fontWeight: 'bold' }}
                    />
                  </TableCell>
                  <TableCell align="center" sx={{ borderBottom: '1px solid #333' }}>
                    {performer.has_hash_db ? (
                      <Tooltip title="Hash database exists">
                        <CheckCircleIcon color="success" fontSize="small" />
                      </Tooltip>
                    ) : (
                      <Tooltip title="No hash database">
                        <CancelIcon color="disabled" fontSize="small" />
                      </Tooltip>
                    )}
                  </TableCell>

                  <TableCell align="right" sx={{ borderBottom: '1px solid #333', color: '#fff' }}>
                    <Typography variant="body2" fontWeight="bold">
                      {performer.file_count || 0}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ borderBottom: '1px solid #333' }}>
                    <Typography variant="body2" sx={{ color: '#bbb' }}>
                      {formatDate(performer.last_updated)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ borderBottom: '1px solid #333' }}>
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                      <Tooltip title={
                        isPerformerInQueue(performer.id)
                          ? 'Already in queue'
                          : performer.has_hash_db
                            ? 'Recreate Hash DB'
                            : 'Create Hash DB'
                      }>
                        <span>
                          <Button
                            variant={performer.has_hash_db ? "contained" : "contained"}
                            // Using contained for both but gradient usually implies primary action
                            size="small"
                            startIcon={isPerformerInQueue(performer.id) ? <CircularProgress size={16} color="inherit" /> : <StorageIcon />}
                            onClick={(e) => { e.stopPropagation(); onCreateHashDB(performer.id); }}
                            disabled={isPerformerInQueue(performer.id)}
                            sx={!performer.has_hash_db ? { ...gradientButtonStyle, minWidth: 100 } : { minWidth: 100 }}
                            color={performer.has_hash_db ? 'primary' : 'inherit'}
                          >
                            {isPerformerInQueue(performer.id)
                              ? 'Queued'
                              : performer.has_hash_db
                                ? 'Recreate'
                                : 'Create'
                            }
                          </Button>
                        </span>
                      </Tooltip>

                      <Tooltip title={performer.has_hash_db ? 'Find duplicates within this performer' : 'Create hash database first'}>
                        <span>
                          <Button
                            variant="outlined"
                            size="small"
                            color="info"
                            startIcon={processingActions.has(`internal-${performer.id}`) ? <CircularProgress size={16} /> : <FindInPageIcon />}
                            onClick={(e) => { e.stopPropagation(); onCheckInternal(performer.id); }}
                            disabled={!performer.has_hash_db || processingActions.has(`internal-${performer.id}`)}
                            sx={{
                              color: '#29b6f6',
                              borderColor: 'rgba(41, 182, 246, 0.5)',
                              '&:hover': { borderColor: '#29b6f6', bgcolor: 'rgba(41, 182, 246, 0.08)' }
                            }}
                          >
                            {processingActions.has(`internal-${performer.id}`) ? 'Checking...' : 'Internal'}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title={performer.has_hash_db ? 'Compare with another performer' : 'Create hash database first'}>
                        <span>
                          <Button
                            variant="outlined"
                            size="small"
                            color="secondary"
                            startIcon={<CompareArrowsIcon />}
                            onClick={(e) => { e.stopPropagation(); onCompare(performer.id); }}
                            disabled={!performer.has_hash_db}
                            sx={{
                              color: '#ce93d8',
                              borderColor: 'rgba(206, 147, 216, 0.5)',
                              '&:hover': { borderColor: '#ce93d8', bgcolor: 'rgba(206, 147, 216, 0.08)' }
                            }}
                          >
                            Compare
                          </Button>
                        </span>
                      </Tooltip>
                      {performer.has_hash_db && (
                        <Tooltip title="Delete Hash DB">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              if (onDeleteHashDB) onDeleteHashDB(performer.id);
                            }}
                          >
                            <DeleteIcon />
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
  );
}

export default PerformerHashTable;
