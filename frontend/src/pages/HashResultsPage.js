import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Paper,
  Grid,
  Chip,
  Button,
  Slider,
  FormControlLabel,
  Checkbox,
  ToggleButtonGroup,
  ToggleButton,
  Fab,
  Collapse,
  IconButton,
  CardMedia,
  Tooltip,
  Switch,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import WarningIcon from '@mui/icons-material/Warning';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';
import ImageIcon from '@mui/icons-material/Image';
import MovieIcon from '@mui/icons-material/Movie';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HashResultsGrid from '../components/HashResultsGrid';

// Global cache for deleted files - persists across re-renders
const deletedFileCache = new Set();

function HashResultsPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hammingThreshold, setHammingThreshold] = useState(10);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [commitAction, setCommitAction] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null);
  const [sortBy, setSortBy] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [displayPage, setDisplayPage] = useState(1);
  const [deletedSectionOpen, setDeletedSectionOpen] = useState(false);
  const [detectedDeletedPaths, setDetectedDeletedPaths] = useState(new Set());
  const [hashVerified, setHashVerified] = useState(false);
  const [rerunLoading, setRerunLoading] = useState(false);
  const [performerId, setPerformerId] = useState(null);
  const groupsPerPage = 20;
  const itemsPerPage = 300;

  useEffect(() => {
    if (runId) {
      loadResults();
    }
  }, [runId, hammingThreshold]);

  const loadResults = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/hashes/run/${runId}?maxHammingDistance=${hammingThreshold}&limit=${itemsPerPage}`
      );
      const data = await response.json();

      if (data.success) {
        setRun(data.run);
        setItems(data.items);
        const preSelected = new Set(
          data.items.filter(item => item.selected === 1).map(item => item.id)
        );
        setSelectedItems(preSelected);

        // Extract performer ID from run for internal checks
        if (data.run && data.run.source_performer_id) {
          setPerformerId(data.run.source_performer_id);
          // Fetch verified status
          try {
            const statusRes = await fetch(`/api/hashes/performer/${data.run.source_performer_id}/status`);
            const statusData = await statusRes.json();
            if (statusData.success) {
              setHashVerified(!!statusData.hash_verified);
            }
          } catch (e) {
            console.error('Error fetching hash status:', e);
          }
        }
      } else {
        throw new Error(data.error || 'Failed to load results');
      }
    } catch (err) {
      console.error('Error loading results:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle verify toggle
  const handleVerifyToggle = async (event) => {
    const newValue = event.target.checked;
    if (!performerId) return;

    try {
      const res = await fetch(`/api/hashes/performer/${performerId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified: newValue })
      });
      const data = await res.json();
      if (data.success) {
        setHashVerified(newValue);
      }
    } catch (err) {
      console.error('Error toggling verified:', err);
      setError('Failed to update verified status');
    }
  };

  // Handle rerun internal dup check
  const handleRerunCheck = async () => {
    if (!performerId) return;

    setRerunLoading(true);
    try {
      const res = await fetch(`/api/hashes/performer/${performerId}/internal-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success && data.runId) {
        // Navigate to the new run results
        navigate(`/hash-results/${data.runId}`);
      } else {
        setError(data.error || 'Failed to rerun check');
      }
    } catch (err) {
      console.error('Error rerunning check:', err);
      setError('Failed to rerun duplicate check');
    } finally {
      setRerunLoading(false);
    }
  };

  // Callback for when a file is detected as deleted (image failed to load)
  const handleFileDeleted = useCallback((filePath) => {
    deletedFileCache.add(filePath);
    setDetectedDeletedPaths(prev => {
      const newSet = new Set(prev);
      newSet.add(filePath);
      return newSet;
    });
  }, []);

  const handleToggleItem = (itemId) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleSelectAll = (checked, itemsToSelect) => {
    if (checked) {
      const newSelected = new Set(selectedItems);
      itemsToSelect.forEach(item => newSelected.add(item.id));
      setSelectedItems(newSelected);
    } else {
      const newSelected = new Set(selectedItems);
      itemsToSelect.forEach(item => newSelected.delete(item.id));
      setSelectedItems(newSelected);
    }
    setSelectAll(checked);
  };

  const handleCommit = async (action) => {
    if (selectedItems.size === 0) {
      setError('No items selected');
      return;
    }

    setCommitting(true);
    setError(null);

    // Wait for UI to unmount media components to release file locks
    await new Promise(r => setTimeout(r, 1000));

    try {
      const response = await fetch(`/api/hashes/run/${runId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          selectedItems: Array.from(selectedItems),
        }),
      });

      const data = await response.json();

      if (data.success) {
        setCommitResult(data.results);
        setCommitAction(null);

        // Optimistically remove processed items from local state
        setItems(prevItems => prevItems.filter(item => !selectedItems.has(item.id)));
        setSelectedItems(new Set()); // Clear selection

        await loadResults();
      } else {
        throw new Error(data.error || 'Failed to commit action');
      }
    } catch (err) {
      console.error('Error committing action:', err);
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  };

  const getSimilarityPercent = (hammingDistance) => {
    if (hammingDistance === 0) return 100;
    return Math.round((1 - hammingDistance / 64) * 100);
  };

  const handleSwitch = async (group) => {
    const firstItem = group[0];
    let chosen = group.length === 1 ? group[0] : group.find(i => !selectedItems.has(i.id));

    if (!chosen) {
      setError('To switch a group, unselect at least one remove-side item first.');
      return;
    }

    try {
      const resp = await fetch(`/api/hashes/run/${runId}/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: firstItem.candidate_id, chosenFileId: chosen.file_id_ref }),
      });

      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Switch failed');

      setItems(prevItems => {
        const oldCandidateId = firstItem.candidate_id;
        const groupStartIndex = prevItems.findIndex(item => item.candidate_id === oldCandidateId);
        const withoutOldGroup = prevItems.filter(item => item.candidate_id !== oldCandidateId);
        if (groupStartIndex >= 0) {
          withoutOldGroup.splice(groupStartIndex, 0, ...data.updatedItems);
          return withoutOldGroup;
        } else {
          return [...withoutOldGroup, ...data.updatedItems];
        }
      });

      setSelectedItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(chosen.id);
        if (data.newItemId) newSet.add(data.newItemId);
        return newSet;
      });
    } catch (err) {
      console.error('Error switching items:', err);
      setError(err.message);
    }
  };

  const isVideoPath = (p) => /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(p);

  // Check if file is deleted (from DB flag or detected via image error)
  const isFileDeleted = useCallback((path, dbFlag) => {
    return dbFlag === 1 || deletedFileCache.has(path) || detectedDeletedPaths.has(path);
  }, [detectedDeletedPaths]);

  // Filter items
  let filteredItems = items.filter(
    item => item.exact_match || item.hamming_distance <= hammingThreshold
  );

  if (sortBy === 'exact') {
    filteredItems = filteredItems.filter(item => item.exact_match);
  } else if (sortBy === 'similar') {
    filteredItems = filteredItems.filter(item => !item.exact_match);
  }

  // Group by candidate_id
  const groupedItems = new Map();
  for (const item of filteredItems) {
    const targetId = item.candidate_id;
    if (!groupedItems.has(targetId)) {
      groupedItems.set(targetId, []);
    }
    groupedItems.get(targetId).push(item);
  }

  const allGroups = Array.from(groupedItems.values());

  // Separate active from deleted groups
  const activeGroups = [];
  const deletedMatchItems = [];

  for (const group of allGroups) {
    const firstItem = group[0];
    const targetDeleted = isFileDeleted(firstItem.target_path, firstItem.target_deleted);
    const anySourceDeleted = group.some(item => isFileDeleted(item.source_path, item.source_deleted));

    if (targetDeleted || anySourceDeleted) {
      // For deleted matches, collect the existing files
      if (!targetDeleted) {
        deletedMatchItems.push({
          ...firstItem,
          existingPath: firstItem.target_path,
          isTarget: true
        });
      }
      for (const item of group) {
        if (!isFileDeleted(item.source_path, item.source_deleted)) {
          deletedMatchItems.push({
            ...item,
            existingPath: item.source_path,
            isTarget: false
          });
        }
      }
    } else {
      activeGroups.push(group);
    }
  }

  // Apply filters to active groups
  let mediaFilteredGroups = activeGroups;
  if (mediaFilter === 'pics') {
    mediaFilteredGroups = activeGroups.filter(group => {
      const targetIsVideo = isVideoPath(group[0].target_path);
      const anySourcePic = group.some(i => !isVideoPath(i.source_path));
      return !targetIsVideo || anySourcePic;
    });
  } else if (mediaFilter === 'videos') {
    mediaFilteredGroups = activeGroups.filter(group => {
      const targetIsVideo = isVideoPath(group[0].target_path);
      const anySourceVideo = group.some(i => isVideoPath(i.source_path));
      return targetIsVideo || anySourceVideo;
    });
  }

  let filteredActiveGroups = mediaFilteredGroups;
  if (groupFilter === 'pairs') {
    filteredActiveGroups = mediaFilteredGroups.filter(group => group.length === 1);
  } else if (groupFilter === 'groups') {
    filteredActiveGroups = mediaFilteredGroups.filter(group => group.length > 1);
  }

  const totalPages = Math.ceil(filteredActiveGroups.length / groupsPerPage);
  const startIndex = (displayPage - 1) * groupsPerPage;
  const endIndex = startIndex + groupsPerPage;
  const paginatedGroups = filteredActiveGroups.slice(startIndex, endIndex);

  const handlePageChange = (event, value) => {
    setDisplayPage(value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToBottom = () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  };

  const handleSelectAllDeleted = (checked) => {
    const newSelected = new Set(selectedItems);
    deletedMatchItems.forEach(item => {
      if (checked) {
        newSelected.add(item.id);
      } else {
        newSelected.delete(item.id);
      }
    });
    setSelectedItems(newSelected);
  };

  const deletedSelectedCount = deletedMatchItems.filter(item => selectedItems.has(item.id)).length;

  // Loading state for deleted file detection in thumbnail grid
  const [thumbLoadErrors, setThumbLoadErrors] = useState({});

  const handleThumbError = (path) => {
    setThumbLoadErrors(prev => ({ ...prev, [path]: true }));
    handleFileDeleted(path);
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={60} sx={{ color: '#FF8E53' }} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, minHeight: '100vh', display: 'flex', flexDirection: 'column', maxWidth: 2000, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/hash-management')}
          sx={{ color: '#aaa', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.05)' } }}
        >
          Back
        </Button>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', background: 'linear-gradient(45deg, #FE6B8B 30%, #FF8E53 90%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Hash Comparison Results
          </Typography>
          <Typography variant="body2" sx={{ color: '#666' }}>
            Run ID: {runId}
          </Typography>
        </Box>

        {/* Verify Toggle and Rerun Button */}
        {performerId && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Tooltip title="Mark as verified - confirmed no remaining duplicates">
              <FormControlLabel
                control={
                  <Switch
                    checked={hashVerified}
                    onChange={handleVerifyToggle}
                    color="success"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <CheckCircleIcon sx={{ color: hashVerified ? '#4caf50' : '#666', fontSize: 18 }} />
                    <span>Verified</span>
                  </Box>
                }
                sx={{ color: hashVerified ? '#4caf50' : '#999' }}
              />
            </Tooltip>
            <Tooltip title="Re-run internal duplicate check">
              <Button
                variant="outlined"
                startIcon={rerunLoading ? <CircularProgress size={16} /> : <RefreshIcon />}
                onClick={handleRerunCheck}
                disabled={rerunLoading}
                sx={{
                  borderColor: '#FF8E53',
                  color: '#FF8E53',
                  '&:hover': { borderColor: '#FE6B8B', bgcolor: 'rgba(255,142,83,0.1)' }
                }}
              >
                Rerun Check
              </Button>
            </Tooltip>
          </Box>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {commitResult && (
        <Alert
          severity={commitResult.failed.length > 0 ? 'warning' : 'success'}
          sx={{ mb: 2 }}
          onClose={() => setCommitResult(null)}
        >
          Action completed: {commitResult.success.length} succeeded
          {commitResult.failed.length > 0 && `, ${commitResult.failed.length} failed`}
        </Alert>
      )}

      {/* Deleted Matches Section */}
      {deletedMatchItems.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            mb: 3,
            bgcolor: 'rgba(244, 67, 54, 0.05)',
            border: '1px solid rgba(244, 67, 54, 0.3)',
            borderRadius: 2,
            overflow: 'hidden'
          }}
        >
          <Box
            onClick={() => setDeletedSectionOpen(!deletedSectionOpen)}
            sx={{
              p: 2,
              minHeight: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              '&:hover': { bgcolor: 'rgba(244, 67, 54, 0.08)' }
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <BrokenImageIcon sx={{ color: '#f44336', flexShrink: 0 }} />
              <Typography variant="subtitle1" fontWeight="bold" sx={{ color: '#f44336', whiteSpace: 'nowrap' }}>
                Matches with Deleted Files ({deletedMatchItems.length})
              </Typography>
              <Chip
                label={`${deletedSelectedCount} selected`}
                size="small"
                sx={{ bgcolor: 'rgba(244, 67, 54, 0.2)', color: '#f44336' }}
              />
            </Box>
            <IconButton size="small" sx={{ color: '#f44336', flexShrink: 0 }}>
              {deletedSectionOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
            </IconButton>
          </Box>

          <Collapse in={deletedSectionOpen}>
            <Box sx={{ p: 2, pt: 0, borderTop: '1px solid rgba(244, 67, 54, 0.2)' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="body2" sx={{ color: '#888' }}>
                  Files that matched with now-deleted files. Select to delete, unselect to keep.
                </Typography>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={deletedSelectedCount === deletedMatchItems.length && deletedMatchItems.length > 0}
                      indeterminate={deletedSelectedCount > 0 && deletedSelectedCount < deletedMatchItems.length}
                      onChange={(e) => handleSelectAllDeleted(e.target.checked)}
                      sx={{ color: '#f44336', '&.Mui-checked': { color: '#f44336' } }}
                    />
                  }
                  label={<Typography variant="body2" sx={{ color: '#aaa' }}>Select All</Typography>}
                />
              </Box>

              <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 1.5
              }}>
                {deletedMatchItems.map((item, idx) => {
                  const isVideo = isVideoPath(item.existingPath);
                  const isSelected = selectedItems.has(item.id);
                  const filename = item.existingPath.split(/[\\/]/).pop();
                  const hasError = thumbLoadErrors[item.existingPath];

                  return (
                    <Paper
                      key={`del-${item.id}-${idx}`}
                      elevation={0}
                      onClick={() => handleToggleItem(item.id)}
                      sx={{
                        p: 1,
                        bgcolor: isSelected ? 'rgba(244, 67, 54, 0.15)' : '#1a1a1a',
                        border: isSelected ? '2px solid #f44336' : '1px solid #333',
                        borderRadius: 1.5,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        '&:hover': { borderColor: isSelected ? '#ff6659' : '#555' }
                      }}
                    >
                      <Box sx={{ position: 'relative' }}>
                        <Box sx={{
                          width: '100%',
                          height: 100,
                          borderRadius: 1,
                          overflow: 'hidden',
                          bgcolor: '#000',
                          mb: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          {hasError ? (
                            <Box sx={{ textAlign: 'center' }}>
                              <BrokenImageIcon sx={{ color: '#f44336', fontSize: 24 }} />
                              <Typography variant="caption" sx={{ color: '#f44336', display: 'block', fontSize: '0.5rem' }}>
                                Also Deleted
                              </Typography>
                            </Box>
                          ) : isVideo ? (
                            <video
                              muted
                              preload="metadata"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              src={`/api/files/raw?path=${encodeURIComponent(item.existingPath)}&_t=${Date.now()}`}
                              onError={() => handleThumbError(item.existingPath)}
                            />
                          ) : (
                            <CardMedia
                              component="img"
                              image={`/api/files/preview?path=${encodeURIComponent(item.existingPath)}&_t=${Date.now()}`}
                              alt={filename}
                              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={() => handleThumbError(item.existingPath)}
                            />
                          )}
                        </Box>

                        <Checkbox
                          checked={isSelected}
                          size="small"
                          sx={{
                            position: 'absolute',
                            top: 4,
                            left: 4,
                            bgcolor: 'rgba(0,0,0,0.6)',
                            borderRadius: 1,
                            p: 0.25,
                            color: '#888',
                            '&.Mui-checked': { color: '#f44336' }
                          }}
                        />

                        <Chip
                          label={item.exact_match ? 'EXACT' : `${getSimilarityPercent(item.hamming_distance)}%`}
                          size="small"
                          sx={{
                            position: 'absolute',
                            bottom: 8,
                            right: 4,
                            height: 18,
                            fontSize: '0.55rem',
                            fontWeight: 'bold',
                            bgcolor: item.exact_match ? '#f44336' : '#ed6c02',
                            color: '#fff'
                          }}
                        />
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        {isVideo ? <MovieIcon sx={{ fontSize: 12, color: '#ce93d8' }} /> : <ImageIcon sx={{ fontSize: 12, color: '#90caf9' }} />}
                        <Typography variant="caption" sx={{ color: '#666', fontSize: '0.55rem' }}>
                          {isVideo ? 'Video' : 'Image'}
                        </Typography>
                      </Box>
                      <Tooltip title={item.existingPath}>
                        <Typography
                          variant="caption"
                          sx={{
                            color: '#aaa',
                            fontSize: '0.65rem',
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {filename}
                        </Typography>
                      </Tooltip>
                    </Paper>
                  );
                })}
              </Box>
            </Box>
          </Collapse>
        </Paper>
      )}

      <Grid container spacing={3} sx={{ flex: 1 }}>
        {/* Left Panel: Filters */}
        <Grid item xs={12} md={3}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              bgcolor: '#1E1E1E',
              borderRadius: 2,
              border: '1px solid #333',
              position: 'sticky',
              top: 16,
              width: '100%',
              boxSizing: 'border-box',
              overflow: 'hidden'
            }}
          >
            {/* Stats */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ color: '#888', mb: 1.5 }}>Statistics</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <Box sx={{ p: 1.5, bgcolor: '#252525', borderRadius: 1, textAlign: 'center' }}>
                  <Typography variant="h5" sx={{ color: '#fff', fontWeight: 'bold' }}>{filteredActiveGroups.length}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Active</Typography>
                </Box>
                <Box sx={{ p: 1.5, bgcolor: '#252525', borderRadius: 1, textAlign: 'center' }}>
                  <Typography variant="h5" sx={{ color: '#FF8E53', fontWeight: 'bold' }}>{selectedItems.size}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Selected</Typography>
                </Box>
                <Box sx={{ p: 1.5, bgcolor: '#252525', borderRadius: 1, textAlign: 'center' }}>
                  <Typography variant="h5" sx={{ color: '#f44336', fontWeight: 'bold' }}>{filteredItems.filter(i => i.exact_match).length}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Exact</Typography>
                </Box>
                <Box sx={{ p: 1.5, bgcolor: '#252525', borderRadius: 1, textAlign: 'center' }}>
                  <Typography variant="h5" sx={{ color: '#ed6c02', fontWeight: 'bold' }}>{deletedMatchItems.length}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Deleted</Typography>
                </Box>
              </Box>
            </Box>

            {/* Similarity Slider */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ color: '#888', mb: 1 }}>Similarity Threshold</Typography>
              <Slider
                value={hammingThreshold}
                onChange={(e, val) => setHammingThreshold(val)}
                min={0}
                max={60}
                step={1}
                valueLabelDisplay="auto"
                valueLabelFormat={(val) => `${getSimilarityPercent(val)}%`}
                sx={{
                  color: '#FF8E53',
                  '& .MuiSlider-thumb': { bgcolor: '#fff', border: '2px solid #FF8E53' },
                  '& .MuiSlider-track': { bgcolor: '#FF8E53' },
                  '& .MuiSlider-rail': { bgcolor: '#444' },
                }}
              />
            </Box>

            {/* Match Type Filter */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ color: '#888', mb: 1 }}>Match Type</Typography>
              <ToggleButtonGroup
                value={sortBy}
                exclusive
                onChange={(e, v) => v && setSortBy(v)}
                size="small"
                fullWidth
                sx={{ '& .MuiToggleButton-root': { color: '#888', borderColor: '#444', '&.Mui-selected': { bgcolor: 'rgba(255, 142, 83, 0.15)', color: '#FF8E53' } } }}
              >
                <ToggleButton value="all">All</ToggleButton>
                <ToggleButton value="exact">Exact</ToggleButton>
                <ToggleButton value="similar">Similar</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {/* Group Filter */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ color: '#888', mb: 1 }}>Group Type</Typography>
              <ToggleButtonGroup
                value={groupFilter}
                exclusive
                onChange={(e, v) => { if (v) { setGroupFilter(v); setDisplayPage(1); } }}
                size="small"
                fullWidth
                sx={{ '& .MuiToggleButton-root': { color: '#888', borderColor: '#444', '&.Mui-selected': { bgcolor: 'rgba(255, 142, 83, 0.15)', color: '#FF8E53' } } }}
              >
                <ToggleButton value="all">All</ToggleButton>
                <ToggleButton value="pairs">Pairs</ToggleButton>
                <ToggleButton value="groups">Groups</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {/* Media Filter */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ color: '#888', mb: 1 }}>Media Type</Typography>
              <ToggleButtonGroup
                value={mediaFilter}
                exclusive
                onChange={(e, v) => { if (v) { setMediaFilter(v); setDisplayPage(1); } }}
                size="small"
                fullWidth
                sx={{ '& .MuiToggleButton-root': { color: '#888', borderColor: '#444', '&.Mui-selected': { bgcolor: 'rgba(255, 142, 83, 0.15)', color: '#FF8E53' } } }}
              >
                <ToggleButton value="all">All</ToggleButton>
                <ToggleButton value="pics">Pics</ToggleButton>
                <ToggleButton value="videos">Videos</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {/* Select All Active */}
            <Box sx={{ mb: 3, pt: 2, borderTop: '1px solid #333' }}>
              <FormControlLabel
                control={<Checkbox checked={selectAll} onChange={(e) => handleSelectAll(e.target.checked, filteredItems)} sx={{ color: '#666', '&.Mui-checked': { color: '#FF8E53' } }} />}
                label={<Typography variant="body2" sx={{ color: '#aaa' }}>Select All Active ({filteredActiveGroups.length})</Typography>}
              />
            </Box>

            {/* Actions */}
            <Box sx={{ pt: 2, borderTop: '1px solid #333' }}>
              {!commitAction && (
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<DeleteIcon />}
                  onClick={() => setCommitAction('delete')}
                  disabled={selectedItems.size === 0 || committing}
                  sx={{
                    background: 'linear-gradient(45deg, #f44336 30%, #ff5722 90%)',
                    fontWeight: 'bold',
                    py: 1.5,
                    '&:disabled': { background: '#333', color: '#666' }
                  }}
                >
                  Delete Selected ({selectedItems.size})
                </Button>
              )}

              {commitAction === 'delete' && (
                <Box>
                  <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2, bgcolor: 'rgba(237, 108, 2, 0.1)', color: '#ed6c02' }}>
                    Delete {selectedItems.size} file(s)?
                  </Alert>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button onClick={() => setCommitAction(null)} sx={{ flex: 1, color: '#aaa' }}>
                      Cancel
                    </Button>
                    <Button
                      variant="contained"
                      color="error"
                      onClick={() => handleCommit('delete')}
                      disabled={committing}
                      sx={{ flex: 1 }}
                    >
                      {committing ? 'Deleting...' : 'Confirm'}
                    </Button>
                  </Box>
                </Box>
              )}
            </Box>
          </Paper>
        </Grid>

        {/* Right Panel: Results */}
        <Grid item xs={12} md={9}>
          {committing ? (
            <Paper sx={{ p: 6, textAlign: 'center', bgcolor: '#1E1E1E', border: '1px solid #333', borderRadius: 2, minHeight: '50vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <CircularProgress size={60} sx={{ color: '#FF8E53', mb: 3 }} />
              <Typography variant="h5" sx={{ color: '#fff', mb: 1 }}>Processing Deletion...</Typography>
              <Typography variant="body2" sx={{ color: '#888' }}>Unmounting media to release file locks...</Typography>
            </Paper>
          ) : filteredActiveGroups.length === 0 ? (
            <Paper sx={{ p: 6, textAlign: 'center', bgcolor: '#1E1E1E', border: '1px solid #333', borderRadius: 2 }}>
              <Typography variant="h6" sx={{ color: '#666' }}>No active matches found at this threshold</Typography>
            </Paper>
          ) : (
            <HashResultsGrid
              paginatedGroups={paginatedGroups}
              startIndex={startIndex}
              isVideoPath={isVideoPath}
              selectedItems={selectedItems}
              handleToggleItem={handleToggleItem}
              onSwitch={handleSwitch}
              getSimilarityPercent={getSimilarityPercent}
              totalPages={totalPages}
              displayPage={displayPage}
              handlePageChange={handlePageChange}
              onFileDeleted={handleFileDeleted}
              committing={committing}
            />
          )}
        </Grid>
      </Grid>

      {/* Scroll to Bottom FAB */}
      <Fab
        size="medium"
        onClick={scrollToBottom}
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          bgcolor: '#252525',
          color: '#aaa',
          border: '1px solid #444',
          '&:hover': { bgcolor: '#333' }
        }}
      >
        <KeyboardArrowDownIcon />
      </Fab>
    </Box>
  );
}

export default HashResultsPage;
