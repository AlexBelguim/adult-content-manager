import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Alert,
  Slider,
  Checkbox,
  FormControlLabel,
  Card,
  CardMedia,
  Chip,
  CircularProgress,
  Tooltip,
  Fab,
  ToggleButtonGroup,
  ToggleButton,
  Pagination,
  Grid,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import HashResultsGrid from './HashResultsGrid';

const HashResultsModal = ({ open, onClose, runId, standalone = false }) => {
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
  const groupsPerPage = 9;
  const itemsPerPage = 300;

  useEffect(() => {
    if ((open || standalone) && runId) {
      loadResults();
    }
  }, [open, runId, hammingThreshold, standalone]);

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

  const handleToggleItem = (itemId) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedItems(new Set(items.map(item => item.id)));
    } else {
      setSelectedItems(new Set());
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
        await loadResults();

        if (standalone) {
          setTimeout(() => {
            window.close();
          }, 2000);
        }
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

  // Filter and sort items
  let filteredItems = items.filter(
    item => item.exact_match || item.hamming_distance <= hammingThreshold
  );

  if (sortBy === 'exact') {
    filteredItems = filteredItems.filter(item => item.exact_match);
  } else if (sortBy === 'similar') {
    filteredItems = filteredItems.filter(item => !item.exact_match);
  }

  // Group items by target
  const groupedItems = new Map();
  for (const item of filteredItems) {
    const targetId = item.candidate_id;
    if (!groupedItems.has(targetId)) {
      groupedItems.set(targetId, []);
    }
    groupedItems.get(targetId).push(item);
  }

  const itemGroups = Array.from(groupedItems.values());

  // Media filter
  const isVideoPath = (p) => /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(p);

  let mediaFilteredGroups = itemGroups;
  if (mediaFilter === 'pics') {
    mediaFilteredGroups = itemGroups.filter(group => {
      const targetIsVideo = isVideoPath(group[0].target_path);
      const anySourcePic = group.some(i => !isVideoPath(i.source_path));
      return !targetIsVideo || anySourcePic;
    });
  } else if (mediaFilter === 'videos') {
    mediaFilteredGroups = itemGroups.filter(group => {
      const targetIsVideo = isVideoPath(group[0].target_path);
      const anySourceVideo = group.some(i => isVideoPath(i.source_path));
      return targetIsVideo || anySourceVideo;
    });
  }

  // Split into Active and Deleted groups
  const activeGroups = [];
  const deletedGroups = [];

  mediaFilteredGroups.forEach(group => {
    const isDeleted = group.some(item => item.source_deleted === 1 || item.target_deleted === 1 || item.source_deleted === true || item.target_deleted === true);
    if (isDeleted) {
      deletedGroups.push(group);
    } else {
      activeGroups.push(group);
    }
  });

  // Group filter (only applying to active groups for main view, maybe also deleted?)
  let filteredGroups = activeGroups;
  if (groupFilter === 'pairs') {
    filteredGroups = activeGroups.filter(group => group.length === 1);
  } else if (groupFilter === 'groups') {
    filteredGroups = activeGroups.filter(group => group.length > 1);
  }

  // We will handle deletedGroups display separately
  // Deleted filter toggle removed/repurposed? User asked to show them as a grid/list.
  // I will remove the deletedFilter usage for the main list.

  // Pagination
  const totalPages = Math.ceil(filteredGroups.length / groupsPerPage);
  const startIndex = (displayPage - 1) * groupsPerPage;
  const endIndex = startIndex + groupsPerPage;
  const paginatedGroups = filteredGroups.slice(startIndex, endIndex);

  const handlePageChange = (event, value) => {
    setDisplayPage(value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGroupFilterChange = (event, newValue) => {
    if (newValue !== null) {
      setGroupFilter(newValue);
      setDisplayPage(1);
    }
  };

  const handleSwitch = async (group) => {
    // group[0] is the current candidate (keeper)
    const firstItem = group[0];

    // Choose item to promote: if single (pair) use that item, otherwise find an untoggled remove-side item
    let chosen = null;
    if (group.length === 1) {
      chosen = group[0];
    } else {
      chosen = group.find(i => !selectedItems.has(i.id));
    }

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
      if (!data.success) {
        throw new Error(data.error || 'Switch failed');
      }

      // Replace the entire group with the updated items from the backend, maintaining position
      setItems(prevItems => {
        const oldCandidateId = firstItem.candidate_id;

        // Find the index of the first item in this group
        const groupStartIndex = prevItems.findIndex(item => item.candidate_id === oldCandidateId);

        // Remove all items from the old group
        const withoutOldGroup = prevItems.filter(item => item.candidate_id !== oldCandidateId);

        // Insert the updated group at the original position
        if (groupStartIndex >= 0) {
          withoutOldGroup.splice(groupStartIndex, 0, ...data.updatedItems);
          return withoutOldGroup;
        } else {
          // Fallback: append at end if position not found
          return [...withoutOldGroup, ...data.updatedItems];
        }
      });

      // Update selection: remove the promoted item's ID, keep other selections
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(chosen.id); // Remove promoted item

        // Add the new item (old keeper) to selection since backend marks it selected=1
        if (data.newItemId) {
          newSet.add(data.newItemId);
        }

        return newSet;
      });
    } catch (err) {
      console.error('Error switching items:', err);
      setError(err.message);
    }
  };

  const handleMediaFilterChange = (event, newValue) => {
    if (newValue !== null) {
      setMediaFilter(newValue);
      setDisplayPage(1);
    }
  };

  const scrollToBottom = () => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth'
    });
  };

  const content = (
    <>
      {!standalone && (
        <DialogTitle>
          Duplicate Detection Results
          {run && (
            <Typography variant="caption" display="block" color="text.secondary">
              Run ID: {runId}
            </Typography>
          )}
        </DialogTitle>
      )}

      <Fab
        color="primary"
        size="medium"
        onClick={scrollToBottom}
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1000,
        }}
      >
        <KeyboardArrowDownIcon />
      </Fab>

      <DialogContent sx={standalone ? { p: 3 } : {}}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
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

        {loading ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <CircularProgress size={60} />
            <Typography variant="body1" color="text.secondary" sx={{ mt: 2 }}>
              Loading comparison results...
            </Typography>
          </Box>
        ) : (
          <>
            {/* Stats Summary */}
            {run && (
              <Box sx={{
                mb: 3,
                p: 2,
                bgcolor: '#252525',
                borderRadius: 2,
                border: '1px solid #444',
                display: 'flex',
                gap: 3,
                flexWrap: 'wrap'
              }}>
                <Box>
                  <Typography variant="caption" sx={{ color: '#888' }}>Total Matches</Typography>
                  <Typography variant="h6" fontWeight="bold" sx={{ color: '#fff' }}>{filteredItems.length}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: '#888' }}>Selected</Typography>
                  <Typography variant="h6" fontWeight="bold" sx={{ color: '#FF8E53' }}>{selectedItems.size}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: '#888' }}>Exact Matches</Typography>
                  <Typography variant="h6" fontWeight="bold" color="error">
                    {filteredItems.filter(i => i.exact_match).length}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: '#888' }}>Similar Matches</Typography>
                  <Typography variant="h6" fontWeight="bold" color="warning.main">
                    {filteredItems.filter(i => !i.exact_match).length}
                  </Typography>
                </Box>
              </Box>
            )}

            {/* Controls placeholder */}
            <Box sx={{ mb: 3, p: 2, bgcolor: '#1E1E1E', borderRadius: 2, border: '1px solid #333' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold">
                  Filter Options
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <ToggleButtonGroup
                    value={sortBy}
                    exclusive
                    onChange={(e, newValue) => newValue && setSortBy(newValue)}
                    size="small"
                  >
                    <ToggleButton value="all">
                      All ({items.filter(i => i.exact_match || i.hamming_distance <= hammingThreshold).length})
                    </ToggleButton>
                    <ToggleButton value="exact">
                      Exact ({items.filter(i => i.exact_match).length})
                    </ToggleButton>
                    <ToggleButton value="similar">
                      Similar ({items.filter(i => !i.exact_match && i.hamming_distance <= hammingThreshold).length})
                    </ToggleButton>
                  </ToggleButtonGroup>

                  <ToggleButtonGroup
                    value={groupFilter}
                    exclusive
                    onChange={handleGroupFilterChange}
                    size="small"
                  >
                    <ToggleButton value="all">
                      All ({itemGroups.length})
                    </ToggleButton>
                    <ToggleButton value="pairs">
                      Pairs ({itemGroups.filter(g => g.length === 1).length})
                    </ToggleButton>
                    <ToggleButton value="groups">
                      Groups ({itemGroups.filter(g => g.length > 1).length})
                    </ToggleButton>
                  </ToggleButtonGroup>

                  <ToggleButtonGroup
                    value={mediaFilter}
                    exclusive
                    onChange={handleMediaFilterChange}
                    size="small"
                  >
                    <ToggleButton value="all">All</ToggleButton>
                    <ToggleButton value="pics">Pictures</ToggleButton>
                    <ToggleButton value="videos">Videos</ToggleButton>
                  </ToggleButtonGroup>


                </Box>
              </Box>

              <Typography variant="subtitle2" gutterBottom>
                Similarity Threshold
              </Typography>
              <Box sx={{ px: 2, mb: 2 }}>
                <Slider
                  value={hammingThreshold}
                  onChange={(e, val) => setHammingThreshold(val)}
                  min={0}
                  max={60}
                  step={1}
                  marks={[
                    { value: 0, label: '100%' },
                    { value: 10, label: '84%' },
                    { value: 20, label: '69%' },
                    { value: 30, label: '53%' },
                    { value: 40, label: '38%' },
                    { value: 50, label: '22%' },
                    { value: 60, label: '6%' },
                  ]}
                  valueLabelFormat={(val) => `${getSimilarityPercent(val)}%`}
                  valueLabelDisplay="auto"
                  track={false}
                  sx={{
                    '& .MuiSlider-markLabel': {
                      fontSize: '0.75rem'
                    },
                    '& .MuiSlider-mark': {
                      backgroundColor: '#bfbfbf',
                      height: 8,
                      width: 2,
                      '&.MuiSlider-markActive': {
                        opacity: 1,
                        backgroundColor: 'currentColor',
                      },
                    },
                    '& .MuiSlider-thumb': {
                      height: 20,
                      width: 20,
                      backgroundColor: '#fff',
                      border: '2px solid currentColor',
                      '&:focus, &:hover, &.Mui-active, &.Mui-focusVisible': {
                        boxShadow: 'inherit',
                      },
                      '&:before': {
                        display: 'none',
                      },
                    },
                  }}
                />
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 1, borderTop: '1px solid #444' }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={selectAll}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  }
                  label={
                    <Typography variant="body2" fontWeight="medium">
                      Select All ({filteredItems.length} items)
                    </Typography>
                  }
                />

                <Chip
                  label={`${selectedItems.size} selected`}
                  color={selectedItems.size > 0 ? 'primary' : 'default'}
                  variant={selectedItems.size > 0 ? 'filled' : 'outlined'}
                />
              </Box>
            </Box>

            {/* Results placeholder */}
            {filteredItems.length === 0 ? (
              <Alert severity="info">
                No matches found at this similarity threshold.
              </Alert>
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
              />
            )}

            {/* Deleted File Matches Section - Compact View */}
            {deletedGroups.length > 0 && (
              <Box sx={{ mt: 4, mb: 4, pt: 3, borderTop: '1px solid #333' }}>
                <Typography variant="h6" sx={{ mb: 2, color: '#aaa', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DeleteIcon color="disabled" /> Matches with Deleted Files ({deletedGroups.length})
                </Typography>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                  {deletedGroups.map((group, groupIdx) => (
                    <Box
                      key={`del-group-${groupIdx}`}
                      sx={{
                        p: 1.5,
                        bgcolor: '#1a1a1a',
                        borderRadius: 2,
                        border: '1px solid #333',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        width: '100%',
                        maxWidth: 600
                      }}
                    >
                      {/* Target (Left) */}
                      <Box sx={{ position: 'relative', width: 80, height: 80, flexShrink: 0, borderRadius: 1, overflow: 'hidden' }}>
                        {isVideoPath(group[0].target_path) ? (
                          <CardMedia
                            component="img"
                            image={`/api/files/video-thumbnail?path=${encodeURIComponent(group[0].target_path)}`}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <CardMedia
                            component="img"
                            image={`/api/files/preview?path=${encodeURIComponent(group[0].target_path)}`}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                        {group[0].target_deleted === 1 && (
                          <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <DeleteIcon color="error" fontSize="small" />
                          </Box>
                        )}
                      </Box>

                      {/* Divider Icon */}
                      <CompareArrowsIcon sx={{ color: '#444' }} />

                      {/* Sources (Right) */}
                      <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', p: 0.5 }}>
                        {group.map((item, itemIdx) => (
                          <Box key={`del-item-${itemIdx}`} sx={{ position: 'relative', width: 80, height: 80, flexShrink: 0, borderRadius: 1, overflow: 'hidden', border: item.exact_match ? '2px solid #4caf50' : '2px solid #ed6c02' }}>
                            {isVideoPath(item.source_path) ? (
                              <CardMedia
                                component="img"
                                image={`/api/files/video-thumbnail?path=${encodeURIComponent(item.source_path)}`}
                                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              <CardMedia
                                component="img"
                                image={`/api/files/preview?path=${encodeURIComponent(item.source_path)}`}
                                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            )}
                            {item.source_deleted === 1 && (
                              <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <DeleteIcon color="error" fontSize="small" />
                              </Box>
                            )}
                          </Box>
                        ))}
                      </Box>

                      {/* Info Text */}
                      <Box sx={{ ml: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 100 }}>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 150 }} title={group[0].target_path.split(/[/\\]/).pop()}>
                          Target: {group[0].target_path.split(/[/\\]/).pop()}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          + {group.length} match{group.length > 1 ? 'es' : ''}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ flexDirection: 'column', alignItems: 'stretch', p: 2 }}>
        {!commitAction && (
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Close</Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setCommitAction('delete')}
              disabled={selectedItems.size === 0 || committing}
            >
              Delete Selected ({selectedItems.size})
            </Button>
          </Box>
        )}

        {commitAction === 'delete' && (
          <Box sx={{ mt: 2 }}>
            <Alert severity="warning" icon={<WarningIcon />}>
              Delete {selectedItems.size} duplicate file(s)? The kept file will remain.
            </Alert>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
              <Button onClick={() => setCommitAction(null)}>
                Cancel
              </Button>
              <Button
                variant="contained"
                color="error"
                onClick={() => handleCommit('delete')}
                disabled={committing}
                startIcon={<DeleteIcon />}
              >
                {committing ? 'Deleting...' : 'Confirm Delete'}
              </Button>
            </Box>
          </Box>
        )}
      </DialogActions>
    </>
  );

  if (standalone) {
    return content;
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      {content}
    </Dialog>
  );
};

export default HashResultsModal;
