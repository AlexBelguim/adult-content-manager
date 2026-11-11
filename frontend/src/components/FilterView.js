import React, { useEffect, useState, useRef } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import PerformerCard from './PerformerCard';
import PerformerFilterView from './PerformerFilterView';
import PerformerSettingsModal from './PerformerSettingsModal';
import FilterListIcon from '@mui/icons-material/FilterList';
import {
  EmptyState, LoadingState, PageShell, FillGrid, SideGroup, SideSearch, SideSelect, ContentLine, SIDE
} from './layout';
import { CARD_W, CARD_H, GAP } from './home/PerformerGrid';
import { setFilterCount } from './home/homeData';
import { lowerFirst } from './home/filterModel';
import { LibraryGroup } from './GalleryView';
import { useOpen } from '../nav';
import useFilterViewHistory from './filter/filterHistory';
import { Box, Button } from '@mui/material';

const skeletonSx = { width: CARD_W, height: CARD_H, borderRadius: '8px', bgcolor: 'var(--raised)' };
// When her filter view was left (the list mounts anew after it): the list then refreshes its cards.
let leftPerformerAt = 0;
const FILTER_SORTS = [
  ['size-desc', 'Size, largest first'], ['size-asc', 'Size, smallest first'],
  ['name-asc', 'Name, A to Z'], ['name-desc', 'Name, Z to A'],
  ['date-desc', 'Newest first'], ['date-asc', 'Oldest first'],
  ['pics-desc', 'Most pictures'], ['pics-asc', 'Fewest pictures'],
  ['vids-desc', 'Most videos'], ['vids-asc', 'Fewest videos'],
  ['funscript-desc', 'Most funscripts'], ['funscript-asc', 'Fewest funscripts'],
  ['pics-completion-asc', 'Pictures, least done'], ['pics-completion-desc', 'Pictures, most done'],
  ['vids-completion-asc', 'Videos, least done'], ['vids-completion-desc', 'Videos, most done'],
  ['overall-completion-asc', 'Overall, least done'], ['overall-completion-desc', 'Overall, most done'],
  ['in-after-first', 'Also in After first']
];
const SORT_OPTIONS = FILTER_SORTS.map(([value, label]) => ({ value, label }));

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

function FilterView({ performerId = null, basePath, handyIntegration, handyConnected, cachedPerformers, onPerformersUpdate }) {
  const navigate = useNavigate();
  const open = useOpen();
  const { leave, goTo } = useFilterViewHistory('/filter');
  // Initialize from cache if available
  const [allPerformers, setAllPerformers] = useState(cachedPerformers || []);
  const [loading, setLoading] = useState(!cachedPerformers || cachedPerformers.length === 0);
  const [renderedCount, setRenderedCount] = useState(cachedPerformers?.length || 0);
  const [sort, setSort] = useState(() => localStorage.getItem('filterSortBy') || 'size-desc');
  const [searchTerm, setSearchTerm] = useState('');
  const [settingsModal, setSettingsModal] = useState({ open: false, performer: null });
  const prevSortRef = useRef(sort);

  // The performer of /filter/:performerId: from the list when she is in it, else asked of the server
  // (a deep link, or one the list does not hold). { id, performer, status: 'ok' | 'missing' | 'error', error }
  const listPerformer = performerId ? allPerformers.find((p) => String(p.id) === String(performerId)) || null : null;
  const [fetched, setFetched] = useState({ id: null, performer: null, status: null, error: null });
  const fetchedNow = fetched.id === performerId ? fetched : null;
  const performer = listPerformer || fetchedNow?.performer || null;
  const needFetch = !!performerId && !listPerformer && !fetchedNow;
  const inPerformer = !!performerId;

  useEffect(() => {
    if (!needFetch) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/performers/${encodeURIComponent(performerId)}`);
        if (res.status === 404) {
          if (!cancelled) setFetched({ id: performerId, performer: null, status: 'missing', error: null });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setFetched({ id: performerId, performer: data, status: 'ok', error: null });
      } catch (err) {
        if (!cancelled) setFetched({ id: performerId, performer: null, status: 'error', error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [needFetch, performerId]);

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
      setFilterCount(performers.length);

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
      setFilterCount(cachedPerformers.length);
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

        // All at once: a card-by-card timer chain is slowed down by the browser in a background tab
        setRenderedCount(performers.length);
        setFilterCount(performers.length);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the sort changes
  }, [sort]);

  // Back on the list from her filter view, by any way out (Back here, browser Back, a link): counts moved
  // and the view's cleanup runs on the server, so refresh the cards now and once more when it has most
  // likely finished. Her view and the list are separate mounts (MainPage gives the list the sidebar), so
  // leaving her is noted at module level and picked up by the list that mounts next.
  useEffect(() => {
    if (performerId) return () => { leftPerformerAt = Date.now(); };
    if (!leftPerformerAt || Date.now() - leftPerformerAt > 10000) return undefined;
    leftPerformerAt = 0;
    fetchAllPerformers();
    const timer = setTimeout(fetchAllPerformers, 5000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only when she is left
  }, [performerId]);

  // Save states to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('filterSortBy', sort);
  }, [sort]);


  // Client-side filtering by search term
  const sorted = allPerformers.filter(performer => {
    if (!searchTerm) return true;
    return performer.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // A card opens her filter view, or her gallery once she is in "after". Ctrl-click: a new tab.
  const handlePerformerClick = (performer, e) => {
    if (performer.moved_to_after) {
      open(`/unified-gallery?performer=${encodeURIComponent(performer.name)}&basePath=${encodeURIComponent(basePath)}`, e);
    } else {
      open(`/filter/${performer.id}`, e);
    }
  };

  // A progress row opens her filter view on that tab
  const handleProgressClick = (performer, tab) => {
    navigate(`/filter/${performer.id}?tab=${encodeURIComponent(tab)}`);
  };

  // Out of the filter view in one step, whatever it stacked (filter/filterHistory.js); the next performer
  // takes the place of this one in the history.
  const goToPerformer = (next) => goTo(next.id);

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

      // On to the next performer to filter: in her place from the filter view, a new entry from the list
      if (result.nextPerformer) {
        if (inPerformer) goToPerformer(result.nextPerformer);
        else navigate(`/filter/${result.nextPerformer.id}`);
      } else if (inPerformer) {
        // No more performers to filter
        exitPerformerView(performer, { cleanup: true });
        leave();
      }
    }
  };

  const handlePerformerSettings = (performer) => {
    setSettingsModal({ open: true, performer });
  };

  // Her duplicates, on Performer Management in this tab
  const handleOpenHash = (performerId) => {
    navigate(`/performer-management?performer=${performerId}`);
  };

  const handleSettingsModalClose = () => {
    setSettingsModal({ open: false, performer: null });
    fetchAllPerformers(); // Refresh the list
  };

  // The cleanup when the performer filter view is left. PerformerFilterView
  // already starts the trash cleanup on its own Back / Next and when it unmounts
  // (it has to: the phone shell mounts it without this parent), so only the
  // "complete performer" path asks for one here — otherwise every Back showed
  // two "Cleaning up trash" jobs. Where to go is the caller's: the URL holds it.
  const exitPerformerView = (currentPerformer, { cleanup = false } = {}) => {
    if (cleanup && currentPerformer?.id) {
      fetch(`/api/performers/${currentPerformer.id}/cleanup-trash-on-exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
        .then(response => response.json())
        .then(() => {
          // File counts changed — refresh the cards once the cleanup is done
          fetchAllPerformers();
        })
        .catch(error => {
          console.error('Error cleaning up trash on exit:', error);
        });
    }
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
        goToPerformer(nextPerformer);
      } else {
        console.log('No more performers in sorted order, going back to list');
        // No more performers, go back to list
        leave();
      }
    } catch (error) {
      console.error('Error getting next performer:', error);
      leave();
    }
  };

  // /filter/:performerId: the filtering interface for her
  if (inPerformer) {
    if (performer) {
      return (
        <PerformerFilterView
          key={performer.id}
          performer={performer}
          onBack={(nextPerformer) => {
            // Back to the list refreshes the cards (the effect on performerId)
            if (nextPerformer) goToPerformer(nextPerformer);
            else leave();
          }}
          onNext={handleNextPerformer}
          handyIntegration={handyIntegration}
          handyConnected={handyConnected}
        />
      );
    }
    if (fetchedNow?.status === 'missing' || fetchedNow?.status === 'error') {
      return (
        <PageShell full>
          <EmptyState
            title={fetchedNow.status === 'missing' ? 'Performer not found' : 'Could not load this performer'}
            description={fetchedNow.status === 'missing' ? `No performer has the id ${performerId}.` : fetchedNow.error}
            action={<Button component={RouterLink} to="/filter" variant="outlined">Back to the list</Button>}
          />
        </PageShell>
      );
    }
    return <PageShell full><LoadingState label="Loading the performer…" /></PageShell>;
  }

  // The list, inside MainPage's SidebarPage like the Gallery home: its Show group and the Library section in the
  // sidebar, one content line, the 280px cards grown to fill each row (FillGrid scales them; they keep their look).
  const sortLabel = lowerFirst(FILTER_SORTS.find(([value]) => value === sort)?.[1] || '');
  const total = allPerformers.length;
  const countText = searchTerm ? `${sorted.length.toLocaleString()} of ${total.toLocaleString()}` : total.toLocaleString();
  const meta = loading && total === 0 ? null
    : [`${countText} ${total === 1 ? 'performer' : 'performers'} to filter`, sortLabel].join(' · ');
  return (
    <>
      <SideGroup
        id="show"
        title="Show"
        icon={<FilterListIcon />}
        badge={searchTerm ? 1 : 0}
        summary={searchTerm ? 'search on' : 'nothing on'}
        order={SIDE.show}
      >
        <SideSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search performers" />
        <SideSelect label="Sort" value={sort} onChange={setSort} options={SORT_OPTIONS} />
      </SideGroup>
      <LibraryGroup />

      <ContentLine title="Filter" meta={meta} />

      {loading && sorted.length === 0 ? (
        <FillGrid base={CARD_W} height={CARD_H} gap={GAP} fit="scale" aria-hidden>
          {[...Array(12)].map((_, i) => <Box key={`skeleton-${i}`} sx={skeletonSx} />)}
        </FillGrid>
      ) : sorted.length > 0 ? (
        <FillGrid base={CARD_W} height={CARD_H} gap={GAP} fit="scale">
          {sorted.map((performer, index) => (
            index >= renderedCount ? <Box key={performer.id} sx={skeletonSx} /> : (
              <PerformerCard
                key={performer.id}
                performer={performer}
                onClick={(e) => handlePerformerClick(performer, e)}
                onChangeThumbnail={handlePerformerThumbnailChange}
                onComplete={handlePerformerComplete}
                onSettings={handlePerformerSettings}
                onOpenHash={handleOpenHash}
                onDelete={handlePerformerDelete}
                onProgressClick={handleProgressClick}
                onOpenThumbnailSelector={(p) => navigate(`/thumbnail-selector/${p.id}`)}
                mode="filter"
                basePath={basePath}
              />
            )
          ))}
        </FillGrid>
      ) : !loading && (
        <EmptyState
          title={searchTerm ? 'No performer matches the search' : 'No performers to filter'}
          description={searchTerm ? undefined : 'Every performer is filtered or moved to the gallery.'}
        />
      )}

      {/* Performer Settings Modal. Move-to-after / refresh-stats are server
          tasks: the modal polls /api/performers/background-task/:id itself and
          calls onUpdate when they finish, and the Jobs page shows their progress. */}
      <PerformerSettingsModal
        open={settingsModal.open}
        performer={settingsModal.performer}
        onClose={handleSettingsModalClose}
        basePath={basePath}
        onUpdate={fetchAllPerformers}
      />
    </>
  );
}

export default FilterView;