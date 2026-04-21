import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import PerformerCard from './PerformerCard';
import PerformerFilterView from './PerformerFilterView';
import PerformerSettingsModal from './PerformerSettingsModal';
import BackgroundTaskQueue from './BackgroundTaskQueue';
import { smartOpen } from '../utils/pwaNavigation';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Container,
  TextField
} from '@mui/material';

// Export utility functions for reuse in phone components
export const fetchPerformers = (page = 1, itemsPerPage = 12, sortBy = 'size-desc', searchTerm = '') => {
  const offset = (page - 1) * itemsPerPage;
  return fetch(`/api/performers/filter?limit=${itemsPerPage}&offset=${offset}&sortBy=${encodeURIComponent(sortBy)}&searchTerm=${encodeURIComponent(searchTerm)}`)
    .then(res => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.json(); // Now returns { performers, totalCount, limit, offset, sortBy, searchTerm }
    })
    .catch(err => {
      console.error('Error loading performers for filter:', err);
      return { performers: [], totalCount: 0 }; // Return structured response on error
    });
};

export const handleChangeThumbnail = async (performerId) => {
  try {
    const response = await fetch(`/api/performers/${performerId}/random-thumbnail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      return true;
    } else {
      console.error('Failed to change thumbnail');
      return false;
    }
  } catch (error) {
    console.error('Error changing thumbnail:', error);
    return false;
  }
};

export const handleDeletePerformer = async (performerId, deleteFromSystem = false) => {
  try {
    const response = await fetch(`/api/performers/${performerId}${deleteFromSystem ? '?deleteFromSystem=true' : ''}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      console.log('Performer deleted successfully');
      return true;
    } else {
      const errorData = await response.json();
      console.error('Failed to delete performer:', errorData.error);
      throw new Error(errorData.error || 'Failed to delete performer');
    }
  } catch (error) {
    console.error('Error deleting performer:', error);
    throw error;
  }
};

export const handleCompletePerformer = async (performerId) => {
  try {
    const response = await fetch(`/api/performers/${performerId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const result = await response.json();
      return result;
    } else {
      console.error('Failed to complete performer');
      return null;
    }
  } catch (error) {
    console.error('Error completing performer:', error);
    return null;
  }
};

function FilterView({ basePath, handyIntegration, handyConnected, cachedPerformers, onPerformersUpdate }) {
  const navigate = useNavigate();
  // Initialize from cache if available
  const [allPerformers, setAllPerformers] = useState(cachedPerformers || []);
  const [loading, setLoading] = useState(!cachedPerformers || cachedPerformers.length === 0);
  const [renderedCount, setRenderedCount] = useState(cachedPerformers?.length || 0);
  const [sort, setSort] = useState(() => localStorage.getItem('filterSortBy') || 'size-desc');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPerformer, setSelectedPerformer] = useState(null);
  const [settingsModal, setSettingsModal] = useState({ open: false, performer: null });
  const [containerWidth, setContainerWidth] = useState(0);
  const [backgroundTasks, setBackgroundTasks] = useState([]);
  const pollingIntervalsRef = useRef(new Map());
  const prevSortRef = useRef(sort);

  // Track initial tab when opening performer
  const [initialTab, setInitialTab] = useState(null);

  // Fetch ALL performers on mount (or when sort changes)
  const fetchAllPerformers = async () => {
    setLoading(true);
    try {
      console.log('FilterView: Fetching all performers...');
      // Use high limit to get all at once
      const response = await fetch(`/api/performers/filter?limit=1000&offset=0&sortBy=${encodeURIComponent(sort)}`);
      const data = await response.json();
      const performers = data.performers || [];

      console.log(`FilterView: Loaded ${performers.length} performers`);
      setAllPerformers(performers);
      setRenderedCount(performers.length); // Show all immediately on refresh

      if (onPerformersUpdate) {
        onPerformersUpdate(performers);
      }
    } catch (err) {
      console.error('FilterView: Error fetching performers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const isSortChange = prevSortRef.current !== sort;
    prevSortRef.current = sort;

    // If we have cached data and sort hasn't just changed, use it immediately
    if (!isSortChange && cachedPerformers && cachedPerformers.length > 0) {
      console.log(`FilterView: Using ${cachedPerformers.length} cached performers`);
      setAllPerformers(cachedPerformers);
      setRenderedCount(cachedPerformers.length);
      setLoading(false);
      return; // Don't fetch, we have cache
    }

    let cancelled = false;

    const loadPerformers = async () => {
      setLoading(true);
      try {
        console.log('FilterView: Fetching all performers...');
        const response = await fetch(`/api/performers/filter?limit=1000&offset=0&sortBy=${encodeURIComponent(sort)}`);
        if (cancelled) return;

        const data = await response.json();
        const performers = data.performers || [];

        console.log(`FilterView: Loaded ${performers.length} performers`);
        setAllPerformers(performers);

        // Progressive rendering for smooth appearance
        if (performers.length > 0) {
          setRenderedCount(0);
          setTimeout(() => {
            let count = 0;
            const revealNext = () => {
              if (count < performers.length && !cancelled) {
                count++;
                setRenderedCount(count);
                setTimeout(revealNext, 5); // Fast reveal
              }
            };
            revealNext();
          }, 50);
        }

        if (onPerformersUpdate) {
          onPerformersUpdate(performers);
        }
      } catch (err) {
        console.error('FilterView: Error fetching performers:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPerformers();

    return () => {
      cancelled = true;
    };
  }, [sort]); // Re-fetch when sort changes

  // Save states to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('filterSortBy', sort);
  }, [sort]);

  // Calculate container width for ghost cards
  useEffect(() => {
    const updateContainerWidth = () => {
      // Rough calculation based on typical container widths
      const width = window.innerWidth;
      if (width >= 1536) { // xl
        setContainerWidth(Math.min(width * 0.8, 1536 * 1.3));
      } else if (width >= 1200) { // lg
        setContainerWidth(Math.min(width * 0.8, 1200 * 1.3));
      } else {
        setContainerWidth(width * 0.9);
      }
    };

    updateContainerWidth();
    window.addEventListener('resize', updateContainerWidth);
    return () => window.removeEventListener('resize', updateContainerWidth);
  }, []);

  // Cleanup polling intervals on unmount
  useEffect(() => {
    return () => {
      pollingIntervalsRef.current.forEach(interval => clearInterval(interval));
      pollingIntervalsRef.current.clear();
    };
  }, []);

  // Client-side filtering by search term
  const sorted = allPerformers.filter(performer => {
    if (!searchTerm) return true;
    return performer.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const handlePerformerClick = (performer) => {
    // If performer is in "after filter performer" folder (moved_to_after = 1), open gallery
    if (performer.moved_to_after) {
      const performerUrl = `/performer-gallery.html?performer=${encodeURIComponent(performer.name)}&basePath=${encodeURIComponent(basePath)}`;
      smartOpen(performerUrl);
    } else {
      // Open filtering interface for this performer
      setInitialTab(null); // Reset initial tab
      setSelectedPerformer(performer);
    }
  };

  const handleProgressClick = (performer, tab) => {
    // Open filtering interface directly to the specified tab
    setInitialTab(tab);
    setSelectedPerformer(performer);
  };

  const handlePerformerThumbnailChange = async (performerId) => {
    try {
      // Call the random thumbnail API
      const response = await fetch(`/api/performers/${performerId}/random-thumbnail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const result = await response.json();
        // Update only this performer's thumbnail in state
        setAllPerformers(prevPerformers =>
          prevPerformers.map(p =>
            p.id === performerId ? { ...p, thumbnail: result.thumbnailPath } : p
          )
        );
      } else {
        console.error('Failed to change thumbnail');
      }
    } catch (error) {
      console.error('Error changing thumbnail:', error);
    }
  };

  const handlePerformerDelete = async (performerId, deleteFromSystem = false) => {
    try {
      await handleDeletePerformer(performerId, deleteFromSystem);
      // Refresh the performers list to remove the deleted performer
      fetchAllPerformers();
    } catch (error) {
      // Error already logged in the utility function
      throw error;
    }
  };

  const handlePerformerComplete = async (performerId) => {
    const result = await handleCompletePerformer(performerId);
    if (result) {
      // Refresh the performers list
      fetchAllPerformers();

      // If there's a next performer, auto-select it
      if (result.nextPerformer) {
        setSelectedPerformer(result.nextPerformer);
      } else {
        // No more performers to filter
        await exitPerformerView(selectedPerformer);
      }
    }
  };

  const handlePerformerSettings = (performer) => {
    setSettingsModal({ open: true, performer });
  };

  const handleOpenHash = (performerId) => {
    const performer = allPerformers.find(p => p.id === performerId);
    const performerName = performer?.name || '';
    const url = `/hash-management?performer=${encodeURIComponent(performerName)}`;

    // Try to find existing window
    const hashWindow = window.open('', 'hashManagementWindow');

    if (hashWindow && hashWindow.location.pathname === '/hash-management') {
      // Window exists and is on hash management page - just update the URL param without reload
      const newUrl = new URL(url, window.location.origin);
      hashWindow.history.pushState({}, '', newUrl);

      // Dispatch a popstate event to trigger the search update
      hashWindow.dispatchEvent(new PopStateEvent('popstate'));

      // Focus the window
      hashWindow.focus();
    } else {
      // Window doesn't exist or is on wrong page - open new/navigate
      window.open(url, 'hashManagementWindow');
    }
  };

  const handleSettingsModalClose = () => {
    setSettingsModal({ open: false, performer: null });
    fetchAllPerformers(); // Refresh the list
  };

  // Helper function to exit performer filter view with trash cleanup as background task
  const exitPerformerView = (currentPerformer, nextPerformer = null) => {
    if (currentPerformer?.id) {
      // Create background task for trash cleanup
      const taskId = `trash-cleanup-${currentPerformer.id}-${Date.now()}`;
      const newTask = {
        id: taskId,
        type: 'trash-cleanup',
        title: `Cleaning trash for ${currentPerformer.name}`,
        description: 'Removing deleted files from performer folder',
        status: 'processing',
        progress: 0
      };

      setBackgroundTasks(prev => [...prev, newTask]);

      // Start cleanup in background
      fetch(`/api/performers/${currentPerformer.id}/cleanup-trash-on-exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
        .then(response => response.json())
        .then(result => {
          console.log(`Cleaned up trash on exit: ${result.deletedCount} files`);
          setBackgroundTasks(prev =>
            prev.map(t => t.id === taskId ? {
              ...t,
              status: 'completed',
              progress: 100,
              description: `Removed ${result.deletedCount} files`
            } : t)
          );
          // Refresh performers data after cleanup
          fetchAllPerformers();
        })
        .catch(error => {
          console.error('Error cleaning up trash on exit:', error);
          setBackgroundTasks(prev =>
            prev.map(t => t.id === taskId ? {
              ...t,
              status: 'error',
              progress: 0,
              description: `Error: ${error.message}`
            } : t)
          );
        });
    }

    // Navigate immediately without waiting
    setSelectedPerformer(nextPerformer);
  };

  // Handle next performer without completion
  const handleNextPerformer = async (currentPerformerId) => {
    console.log('handleNextPerformer called with ID:', currentPerformerId);

    try {
      // Find the next performer in the current sort order
      const currentIndex = sorted.findIndex(p => p.id === currentPerformerId);
      console.log('Current performer index in sorted array:', currentIndex);

      if (currentIndex !== -1 && currentIndex < sorted.length - 1) {
        const nextPerformer = sorted[currentIndex + 1];
        console.log('Next performer from sorted array:', nextPerformer.name);

        // Refresh the performers list first
        fetchAllPerformers();

        // Switch to the next performer
        setSelectedPerformer(nextPerformer);
      } else {
        console.log('No more performers in sorted order, going back to list');
        // No more performers, go back to list
        exitPerformerView(selectedPerformer);
      }
    } catch (error) {
      console.error('Error getting next performer:', error);
      exitPerformerView(selectedPerformer);
    }
  };

  // If a performer is selected, show the filtering interface
  if (selectedPerformer) {
    return (
      <PerformerFilterView
        performer={selectedPerformer}
        initialTab={initialTab}
        onBack={async (nextPerformer) => {
          if (nextPerformer) {
            console.log('onBack called with next performer:', nextPerformer.name);
            // Reset initial tab when moving to next performer
            setInitialTab(null);
            // Switch to the next performer
            setSelectedPerformer(nextPerformer);
          } else {
            console.log('onBack called, going back to list');
            // Reset initial tab when going back to list
            setInitialTab(null);
            // Go back to list without rescanning - just cleanup and return
            exitPerformerView(selectedPerformer);
            // Don't call fetchPerformersData() - use cached data
          }
        }}
        onNext={handleNextPerformer}
        onComplete={handlePerformerComplete}
        handyIntegration={handyIntegration}
        handyConnected={handyConnected}
      />
    );
  }

  return (
    <Container
      maxWidth={false}
      sx={{
        py: 3,
        maxWidth: {
          xs: '100%',
          sm: '100%',
          md: '100%',
          lg: 'calc(1200px * 1.3)', // Increased by 0.3 for large screens
          xl: 'calc(1536px * 1.3)'  // Increased by 0.3 for xl screens
        },
        px: { xs: 2, sm: 3, md: 4 } // Responsive padding
      }}
    >
      {/* Header Controls */}
      <Box sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        mb: 3,
        flexWrap: 'wrap',
        gap: 2,
        // Calculate margins to align with card edges
        mx: (() => {
          if (containerWidth === 0) return 0;

          const cardWidth = 280;
          const gap = 24;
          const padding = 48; // Container padding
          const availableWidth = containerWidth - padding;
          const cardsPerRow = Math.floor(availableWidth / (cardWidth + gap));
          const totalCardsWidth = cardsPerRow * cardWidth + (cardsPerRow - 1) * gap;
          const leftoverSpace = availableWidth - totalCardsWidth;
          const sideMargin = leftoverSpace / 2;

          return `${sideMargin}px`;
        })()
      }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 600, color: 'text.primary' }}>
            Filter Performers
          </Typography>
          {allPerformers.length > 0 && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {searchTerm ? `${sorted.length} of ${allPerformers.length} performers` : `${allPerformers.length} performers`}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <TextField
            size="small"
            placeholder="Search performers..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            sx={{ minWidth: 200 }}
          />

          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Sort By</InputLabel>
            <Select
              value={sort}
              label="Sort By"
              onChange={e => setSort(e.target.value)}
            >
              <MenuItem value="size-desc">Size (Largest First)</MenuItem>
              <MenuItem value="size-asc">Size (Smallest First)</MenuItem>
              <MenuItem value="name-asc">Name (A-Z)</MenuItem>
              <MenuItem value="name-desc">Name (Z-A)</MenuItem>
              <MenuItem value="date-desc">Date (Newest First)</MenuItem>
              <MenuItem value="date-asc">Date (Oldest First)</MenuItem>
              <MenuItem value="pics-desc">Images (Most First)</MenuItem>
              <MenuItem value="pics-asc">Images (Least First)</MenuItem>
              <MenuItem value="vids-desc">Videos (Most First)</MenuItem>
              <MenuItem value="vids-asc">Videos (Least First)</MenuItem>
              <MenuItem value="funscript-desc">Funscript Count (Most First)</MenuItem>
              <MenuItem value="funscript-asc">Funscript Count (Least First)</MenuItem>
              <MenuItem value="pics-completion-asc">Images % (Least Done)</MenuItem>
              <MenuItem value="pics-completion-desc">Images % (Most Done)</MenuItem>
              <MenuItem value="vids-completion-asc">Videos % (Least Done)</MenuItem>
              <MenuItem value="vids-completion-desc">Videos % (Most Done)</MenuItem>
              <MenuItem value="overall-completion-asc">Overall % (Least Done)</MenuItem>
              <MenuItem value="overall-completion-desc">Overall % (Most Done)</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Performers Grid */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '24px' // Static gap between cards
        }}
      >
        {loading && sorted.length === 0 ? (
          // Show skeleton cards while loading initial data
          [...Array(12)].map((_, index) => (
            <Box key={`skeleton-${index}`} sx={{ flexShrink: 0 }}>
              <Box
                sx={{
                  width: '280px',
                  height: '520px',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  background: 'linear-gradient(90deg, rgba(40, 40, 40, 0.9) 25%, rgba(60, 60, 60, 0.9) 50%, rgba(40, 40, 40, 0.9) 75%)',
                  backgroundSize: '200% 100%',
                  animation: 'loading-skeleton 1.5s ease-in-out infinite',
                  '@keyframes loading-skeleton': {
                    '0%': { backgroundPosition: '200% 0' },
                    '100%': { backgroundPosition: '-200% 0' }
                  },
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Typography sx={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '14px' }}>
                  Loading...
                </Typography>
              </Box>
            </Box>
          ))
        ) : (
          sorted.map((performer, index) => (
            <Box key={performer.id} sx={{ flexShrink: 0 }}>
              {index >= renderedCount ? (
                <Box
                  sx={{
                    width: '280px',
                    height: '520px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    background: 'linear-gradient(90deg, rgba(40, 40, 40, 0.9) 25%, rgba(60, 60, 60, 0.9) 50%, rgba(40, 40, 40, 0.9) 75%)',
                    backgroundSize: '200% 100%',
                    animation: 'loading-skeleton 1.5s ease-in-out infinite',
                    '@keyframes loading-skeleton': {
                      '0%': { backgroundPosition: '200% 0' },
                      '100%': { backgroundPosition: '-200% 0' }
                    },
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Typography sx={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '14px' }}>
                    Loading...
                  </Typography>
                </Box>
              ) : (
                <PerformerCard
                  performer={performer}
                  onClick={() => handlePerformerClick(performer)}
                  onChangeThumbnail={handlePerformerThumbnailChange}
                  onComplete={handlePerformerComplete}
                  onSettings={handlePerformerSettings}
                  onOpenHash={handleOpenHash}
                  onDelete={handlePerformerDelete}
                  onProgressClick={handleProgressClick}
                  onOpenThumbnailSelector={(performer) => navigate(`/thumbnail-selector/${performer.id}`)}
                  mode="filter"
                  basePath={basePath}
                />
              )}
            </Box>
          ))
        )}

        {/* Ghost cards to fill out the last row */}
        {(() => {
          if (containerWidth === 0) return null; // Don't render until we have container width

          const cardWidth = 280;
          const gap = 24;
          const padding = 48; // Container padding
          const availableWidth = containerWidth - padding;
          const cardsPerRow = Math.floor(availableWidth / (cardWidth + gap));
          const remainder = sorted.length % cardsPerRow;
          const ghostCards = remainder > 0 ? cardsPerRow - remainder : 0;

          return Array.from({ length: ghostCards }, (_, index) => (
            <Box
              key={`ghost-${index}`}
              sx={{
                width: '280px',
                height: '520px',
                flexShrink: 0,
                visibility: 'hidden' // Invisible but takes up space
              }}
            />
          ));
        })()}
      </Box>

      {/* Empty State */}
      {!loading && sorted.length === 0 && (
        <Box sx={{
          textAlign: 'center',
          py: 8,
          color: 'text.secondary'
        }}>
          <Typography variant="h6" gutterBottom>
            No performers to filter
          </Typography>
          <Typography variant="body2">
            All performers have been processed or moved to the gallery.
          </Typography>
        </Box>
      )}

      {/* Background Task Queue */}
      {backgroundTasks.length > 0 && (
        <BackgroundTaskQueue
          tasks={backgroundTasks}
          onClose={() => {
            setBackgroundTasks(prev => prev.filter(t => t.status === 'processing' || t.status === 'queued'));
          }}
        />
      )}

      {/* Performer Settings Modal */}
      <PerformerSettingsModal
        open={settingsModal.open}
        performer={settingsModal.performer}
        onClose={handleSettingsModalClose}
        basePath={basePath}
        onUpdate={fetchAllPerformers}
        onAddBackgroundTask={(task) => {
          setBackgroundTasks(prev => [...prev, task]);

          const pollInterval = setInterval(async () => {
            try {
              const statusResp = await fetch(`/api/performers/background-task/${task.id}`);
              if (statusResp.ok) {
                const statusData = await statusResp.json();
                const taskData = statusData.task;

                setBackgroundTasks(prev =>
                  prev.map(t => t.id === task.id ? {
                    ...t,
                    status: taskData.status,
                    progress: taskData.progress || 0,
                    progressText: taskData.progressText,
                    error: taskData.error,
                    result: taskData.result ? (
                      taskData.type === 'move-to-after'
                        ? taskData.result
                        : `Refreshed: ${taskData.result.stats.pics_count} pics, ${taskData.result.stats.vids_count} vids`
                    ) : null,
                  } : t)
                );

                if (taskData.status === 'completed' || taskData.status === 'error') {
                  clearInterval(pollInterval);
                  pollingIntervalsRef.current.delete(task.id);
                  if (taskData.status === 'completed') fetchAllPerformers();
                }
              }
            } catch (err) {
              console.error('Error polling task:', err);
            }
          }, 500);

          pollingIntervalsRef.current.set(task.id, pollInterval);
        }}
      />
    </Container>
  );
}

export default FilterView;