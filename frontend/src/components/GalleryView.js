import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import PerformerCard from './PerformerCard';
import ContentCard from './ContentCard';
import PerformerSettingsModal from './PerformerSettingsModal';
import BackgroundTaskQueue from './BackgroundTaskQueue';
import { smartOpen } from '../utils/pwaNavigation';
import {
  generatePhotoWallLayout,
  generateCameraKeyframes,
  getCameraAnimationCSS,
  PHOTO_WALL_CONFIG
} from '../utils/photoWallGenerator';
import {
  Box,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Button,
  Container,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Slider,
  FormControlLabel,
  Checkbox,
  Divider
} from '@mui/material';
import { ViewModule, ViewList, FilterList as FilterIcon, Close as CloseIcon, Fullscreen as FullscreenIcon } from '@mui/icons-material';

function GalleryView({ subMode, basePath, cachedPerformers, onPerformersUpdate, cachedGenres, onGenresUpdate }) {
  const navigate = useNavigate();
  const [performers, setPerformers] = useState(cachedPerformers || []);
  const [genres, setGenres] = useState(cachedGenres || []);
  const [loadingPerformers, setLoadingPerformers] = useState(!cachedPerformers);
  const [loadingGenres, setLoadingGenres] = useState(!cachedGenres);
  const [renderedPerformerCount, setRenderedPerformerCount] = useState(cachedPerformers ? cachedPerformers.length : 0);
  const [showPerformers, setShowPerformers] = useState(true);
  const [showContent, setShowContent] = useState(true);
  const [performerSortBy, setPerformerSortBy] = useState(() => localStorage.getItem('galleryPerformerSortBy') || 'name-asc');
  const [contentViewMode, setContentViewMode] = useState(() => localStorage.getItem('galleryContentViewMode') || 'grid');
  const [contentSortBy, setContentSortBy] = useState(() => localStorage.getItem('galleryContentSortBy') || 'name-asc');
  const [performerSearchTerm, setPerformerSearchTerm] = useState('');
  const [contentSearchTerm, setContentSearchTerm] = useState('');
  const [settingsModal, setSettingsModal] = useState({ open: false, performer: null });
  const [backgroundTasks, setBackgroundTasks] = useState([]);
  const pollingIntervalsRef = useRef(new Map());
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const [photoWallLayout, setPhotoWallLayout] = useState([]);
  const [shrinePositions, setShrinePositions] = useState([]);
  const [wallKey, setWallKey] = useState(0); // For forcing re-render with fade
  const performerBagsRef = useRef({}); // 7-bag randomness for each performer
  const [filters, setFilters] = useState({
    age: { min: null, max: null },
    ethnicity: { include: [], exclude: [] },
    hair: { include: [], exclude: [] },
    eyes: { include: [], exclude: [] },
    body: { include: [], exclude: [] },
    bandSize: { include: [], exclude: [] },
    cupSize: { include: [], exclude: [] },
    measurements_fake: { include: [], exclude: [] }, // natural/fake
    weight: { include: [], exclude: [] },
    height: { include: [], exclude: [] },
    tags: { include: [], exclude: [] }
  });

  useEffect(() => {
    // Only fetch if we don't have cached data
    if (!cachedPerformers || cachedPerformers.length === 0) {
      fetchPerformers();
    } else {
      // We have cached data - show it immediately with progressive rendering
      setLoadingPerformers(false);

      // Trigger progressive rendering for cached data
      if (cachedPerformers.length > 0) {
        setRenderedPerformerCount(0);
        setTimeout(() => {
          let count = 0;
          const revealNext = () => {
            if (count < cachedPerformers.length) {
              count++;
              setRenderedPerformerCount(count);
              setTimeout(revealNext, 5); // Faster reveal for cached data
            }
          };
          revealNext();
        }, 50);
      }
    }

    // Only fetch genres if we don't have cached data
    if (!cachedGenres || cachedGenres.length === 0) {
      fetchGenres();
    } else {
      setLoadingGenres(false);
    }
  }, [basePath, cachedPerformers, cachedGenres]);

  // Save states to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('galleryPerformerSortBy', performerSortBy);
  }, [performerSortBy]);

  useEffect(() => {
    localStorage.setItem('galleryContentViewMode', contentViewMode);
  }, [contentViewMode]);

  useEffect(() => {
    localStorage.setItem('galleryContentSortBy', contentSortBy);
  }, [contentSortBy]);

  // Handle browser fullscreen mode
  useEffect(() => {
    const enterFullscreen = async () => {
      try {
        if (fullscreenMode && !document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        } else if (!fullscreenMode && document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch (err) {
        console.error('Error toggling fullscreen:', err);
      }
    };

    enterFullscreen();

    // Listen for fullscreen changes (e.g., user presses ESC)
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && fullscreenMode) {
        setFullscreenMode(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [fullscreenMode]);

  // Cleanup polling intervals on unmount
  useEffect(() => {
    return () => {
      pollingIntervalsRef.current.forEach(interval => clearInterval(interval));
      pollingIntervalsRef.current.clear();
    };
  }, []);

  // Handle fullscreen mode - generate layout and enter browser fullscreen
  useEffect(() => {
    if (fullscreenMode) {
      // Generate initial photo wall layout (async)
      const initWall = async () => {
        const { layout, shrinePositions: positions } = await generatePhotoWallLayout(performers, performerBagsRef.current);
        setPhotoWallLayout(layout);
        setShrinePositions(positions);
      };
      initWall();

      // Instead of regenerating every 10 seconds, we'll use CSS animation to pan continuously
      // The animation is handled in the Box sx prop below

      // Enter browser fullscreen
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(err => {
          console.log('Error attempting to enable fullscreen:', err);
        });
      }

      return () => {
        // No interval to clear
      };
    } else {
      // Exit browser fullscreen
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(err => {
          console.log('Error attempting to exit fullscreen:', err);
        });
      }
    }
  }, [fullscreenMode, performers]);

  const fetchPerformers = () => {
    setLoadingPerformers(true);
    setRenderedPerformerCount(0);
    fetch('/api/performers/gallery')
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        setPerformers(data);
        if (onPerformersUpdate) onPerformersUpdate(data); // Cache in parent

        // Progressively render cards one at a time
        if (data.length > 0) {
          // Give skeletons a moment to render before starting progressive reveal
          setTimeout(() => {
            let count = 0;
            const revealNext = () => {
              if (count < data.length) {
                count++;
                setRenderedPerformerCount(count);
                setTimeout(revealNext, 10); // 10ms delay between each card
              } else {
                setLoadingPerformers(false);
              }
            };
            revealNext();
          }, 100); // Initial delay to show skeletons
        } else {
          setLoadingPerformers(false);
        }
      })
      .catch(err => {
        console.error('Error loading performers for gallery:', err);
        setPerformers([]); // Set empty array on error
        setLoadingPerformers(false);
      });
  };

  const fetchGenres = () => {
    if (!basePath) return;

    setLoadingGenres(true);
    fetch(`/api/content/genres?basePath=${encodeURIComponent(basePath)}`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        setGenres(data);
        if (onGenresUpdate) onGenresUpdate(data); // Cache in parent
        setLoadingGenres(false);
      })
      .catch(err => {
        console.error('Error loading genres:', err);
        setGenres([]); // Set empty array on error
        setLoadingGenres(false);
      });
  };

  const applyPerformersUpdate = (mutator) => {
    setPerformers(prev => {
      const next = mutator(prev);
      if (onPerformersUpdate) onPerformersUpdate(next);
      return next;
    });
  };

  const handleRatePerformer = async (performerId, rating) => {
    const normalized = rating === null || rating === undefined
      ? null
      : Math.round(Math.min(5, Math.max(0, rating)) * 2) / 2;

    const previousEntry = performers.find(p => p.id === performerId);
    const previousRating = previousEntry && previousEntry.performer_rating !== undefined && previousEntry.performer_rating !== null
      ? Number(previousEntry.performer_rating)
      : null;

    if (previousRating === normalized || (previousRating === null && normalized === null)) {
      return;
    }

    applyPerformersUpdate(list => list.map(p => (
      p.id === performerId ? { ...p, performer_rating: normalized } : p
    )));

    try {
      const response = await fetch(`/api/performers/${performerId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: normalized }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const persistedRating = Object.prototype.hasOwnProperty.call(data, 'rating')
        ? (data.rating === null || data.rating === undefined ? null : Number(data.rating))
        : normalized;

      applyPerformersUpdate(list => list.map(p => (
        p.id === performerId ? { ...p, performer_rating: persistedRating } : p
      )));
    } catch (error) {
      console.error('Error saving performer rating:', error);
      applyPerformersUpdate(list => list.map(p => (
        p.id === performerId ? { ...p, performer_rating: previousRating } : p
      )));
      throw error;
    }
  };

  // Helper function to calculate current age from scraped age and scrape date
  const calculateCurrentAge = (scrapedAge, scrapedAt) => {
    if (!scrapedAge || !scrapedAt) return null;

    try {
      const scrapeDate = new Date(scrapedAt);
      const now = new Date();
      const yearsPassed = now.getFullYear() - scrapeDate.getFullYear();
      const monthsPassed = now.getMonth() - scrapeDate.getMonth();

      let currentAge = scrapedAge + yearsPassed;
      if (monthsPassed < 0) {
        currentAge--;
      }

      return currentAge;
    } catch (e) {
      return null;
    }
  };

  // Helper function to convert cup size to numeric value for sorting
  const cupSizeToNumber = (cupSize) => {
    if (!cupSize) return 0;
    const cupMap = { 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'DD': 5, 'E': 6, 'F': 7, 'G': 8, 'H': 9, 'I': 10, 'J': 11 };
    const cup = cupSize.toUpperCase().replace(/[0-9]/g, '').trim();
    return cupMap[cup] || 0;
  };

  // Helper function to extract unique values from performers
  const getUniqueValues = (field) => {
    const values = new Set();
    performers.forEach(p => {
      let value = p[field];
      if (value !== null && value !== undefined && value !== '') {
        // Handle scraped_tags JSON parsing
        if (field === 'tags' && p.scraped_tags) {
          try {
            const tags = JSON.parse(p.scraped_tags);
            tags.forEach(tag => values.add(tag));
          } catch (e) {
            // ignore parsing errors
          }
        } else {
          values.add(value);
        }
      }
    });
    return Array.from(values).sort();
  };

  // Get age range from performers
  const getAgeRange = () => {
    const ages = performers
      .map(p => p.age)
      .filter(age => age !== null && age !== undefined && !isNaN(age))
      .map(age => parseInt(age));

    if (ages.length === 0) return { min: 18, max: 60 };
    return { min: Math.min(...ages), max: Math.max(...ages) };
  };

  // Apply filters to performers
  const applyFilters = (performersList) => {
    return performersList.filter(p => {
      // Age filter
      if (filters.age.min !== null || filters.age.max !== null) {
        const age = parseInt(p.age);
        if (isNaN(age)) return false;
        if (filters.age.min !== null && age < filters.age.min) return false;
        if (filters.age.max !== null && age > filters.age.max) return false;
      }

      // Check include/exclude filters
      const checkFilter = (filterKey, performerValue) => {
        const filter = filters[filterKey];
        if (!filter) return true;

        // Handle tags specially
        if (filterKey === 'tags') {
          let performerTags = [];
          try {
            performerTags = p.scraped_tags ? JSON.parse(p.scraped_tags) : [];
          } catch (e) {
            performerTags = [];
          }

          if (filter.include.length > 0) {
            const hasIncluded = filter.include.some(tag => performerTags.includes(tag));
            if (!hasIncluded) return false;
          }

          if (filter.exclude.length > 0) {
            const hasExcluded = filter.exclude.some(tag => performerTags.includes(tag));
            if (hasExcluded) return false;
          }

          return true;
        }

        // Regular field filtering
        if (filter.include.length > 0 && !filter.include.includes(performerValue)) {
          return false;
        }
        if (filter.exclude.length > 0 && filter.exclude.includes(performerValue)) {
          return false;
        }
        return true;
      };

      // Apply all filters
      if (!checkFilter('ethnicity', p.ethnicity)) return false;
      if (!checkFilter('hair', p.hair)) return false;
      if (!checkFilter('eyes', p.eyes)) return false;
      if (!checkFilter('bodyType', p.body_type)) return false;
      if (!checkFilter('measurements_band_size', p.measurements_band_size)) return false;
      if (!checkFilter('measurements_cup', p.measurements_cup)) return false;

      // Natural/Fake filter
      if (filters.measurements_fake.include.length > 0 || filters.measurements_fake.exclude.length > 0) {
        const fakeValue = p.measurements_fake === 1 ? 'Fake' : 'Natural';
        if (!checkFilter('measurements_fake', fakeValue)) return false;
      }

      if (!checkFilter('weight', p.weight)) return false;
      if (!checkFilter('height', p.height)) return false;
      if (!checkFilter('tags', null)) return false; // tags handled specially above

      return true;
    });
  };

  // Sorting logic for performers
  const sortedPerformers = applyFilters([...performers])
    .filter(performer => {
      // Basic search filter
      const matchesSearch = performerSearchTerm === '' ||
        performer.name.toLowerCase().includes(performerSearchTerm.toLowerCase());

      // Filter by age/cup only when sorting by those fields
      if (performerSortBy.startsWith('age-')) {
        return matchesSearch && performer.age != null && performer.scraped_at != null;
      }
      if (performerSortBy.startsWith('cup-')) {
        return matchesSearch && performer.measurements_cup != null && performer.measurements_cup !== '';
      }

      return matchesSearch;
    })
    .sort((a, b) => {
      if (performerSortBy === 'size-desc') return (b.total_size_gb || 0) - (a.total_size_gb || 0);
      if (performerSortBy === 'size-asc') return (a.total_size_gb || 0) - (b.total_size_gb || 0);
      if (performerSortBy === 'name-asc') return (a.name || '').localeCompare(b.name || '');
      if (performerSortBy === 'name-desc') return (b.name || '').localeCompare(a.name || '');
      if (performerSortBy === 'date-desc') return new Date(b.import_date || 0) - new Date(a.import_date || 0);
      if (performerSortBy === 'date-asc') return new Date(a.import_date || 0) - new Date(b.import_date || 0);
      if (performerSortBy === 'rating-desc') {
        const aRating = a.performer_rating === null || a.performer_rating === undefined ? -1 : Number(a.performer_rating);
        const bRating = b.performer_rating === null || b.performer_rating === undefined ? -1 : Number(b.performer_rating);
        return bRating - aRating;
      }
      if (performerSortBy === 'rating-asc') {
        const aRating = a.performer_rating === null || a.performer_rating === undefined ? 6 : Number(a.performer_rating);
        const bRating = b.performer_rating === null || b.performer_rating === undefined ? 6 : Number(b.performer_rating);
        return aRating - bRating;
      }
      if (performerSortBy === 'age-asc') {
        const aAge = calculateCurrentAge(a.age, a.scraped_at) || 999;
        const bAge = calculateCurrentAge(b.age, b.scraped_at) || 999;
        return aAge - bAge;
      }
      if (performerSortBy === 'age-desc') {
        const aAge = calculateCurrentAge(a.age, a.scraped_at) || 0;
        const bAge = calculateCurrentAge(b.age, b.scraped_at) || 0;
        return bAge - aAge;
      }
      if (performerSortBy === 'cup-asc') {
        const aCup = cupSizeToNumber(a.measurements_cup);
        const bCup = cupSizeToNumber(b.measurements_cup);
        return aCup - bCup;
      }
      if (performerSortBy === 'cup-desc') {
        const aCup = cupSizeToNumber(a.measurements_cup);
        const bCup = cupSizeToNumber(b.measurements_cup);
        return bCup - aCup;
      }
      return 0;
    });

  // Sorting logic for content genres
  const sortedGenres = [...genres]
    .filter(genre =>
      contentSearchTerm === '' ||
      genre.name.toLowerCase().includes(contentSearchTerm.toLowerCase())
    )
    .sort((a, b) => {
      if (contentSortBy === 'name-asc') return (a.name || '').localeCompare(b.name || '');
      if (contentSortBy === 'name-desc') return (b.name || '').localeCompare(a.name || '');
      if (contentSortBy === 'count-desc') return (b.total_items || 0) - (a.total_items || 0);
      if (contentSortBy === 'count-asc') return (a.total_items || 0) - (b.total_items || 0);
      return 0;
    });

  // Toggle include/exclude for a filter value
  const toggleFilterValue = (filterKey, value, type) => {
    setFilters(prev => {
      const filter = { ...prev[filterKey] };
      const oppositeType = type === 'include' ? 'exclude' : 'include';

      // Remove from opposite list if present
      filter[oppositeType] = filter[oppositeType].filter(v => v !== value);

      // Toggle in current list
      if (filter[type].includes(value)) {
        filter[type] = filter[type].filter(v => v !== value);
      } else {
        filter[type] = [...filter[type], value];
      }

      return { ...prev, [filterKey]: filter };
    });
  };

  // Clear all filters
  const clearAllFilters = () => {
    setFilters({
      age: { min: null, max: null },
      ethnicity: { include: [], exclude: [] },
      hair: { include: [], exclude: [] },
      eyes: { include: [], exclude: [] },
      body: { include: [], exclude: [] },
      bandSize: { include: [], exclude: [] },
      cupSize: { include: [], exclude: [] },
      measurements_fake: { include: [], exclude: [] },
      weight: { include: [], exclude: [] },
      height: { include: [], exclude: [] },
      tags: { include: [], exclude: [] }
    });
  };

  const handlePerformerClick = (performerName) => {
    // Create a unified gallery URL and open it smartly (new tab in browser, same window in PWA)
    const performerUrl = `/unified-gallery?performer=${encodeURIComponent(performerName)}&basePath=${encodeURIComponent(basePath)}`;
    smartOpen(performerUrl);
  };

  const handleChangeThumbnail = async (performerId) => {
    try {
      const response = await fetch(`/api/performers/${performerId}/random-thumbnail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const result = await response.json();
        // Update only the changed performer's thumbnail in state
        setPerformers(prevPerformers =>
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

  const handleDeletePerformer = async (performerId, deleteFromSystem = false, action = 'delete') => {
    try {
      if (action === 'move') {
        // Moving back to before filter performer was already handled in PerformerCard
        // Just refresh the performers list to remove from gallery view
        fetchPerformers();
        console.log('Performer moved back to before filter performer');
        return;
      }

      // Handle delete action
      const response = await fetch(`/api/performers/${performerId}${deleteFromSystem ? '?deleteFromSystem=true' : ''}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Refresh the performers list to remove the deleted performer
        fetchPerformers();
        console.log('Performer deleted successfully');
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

  const handlePerformerSettings = (performer) => {
    setSettingsModal({ open: true, performer });
  };

  const handleSettingsClose = () => {
    setSettingsModal({ open: false, performer: null });
  };

  const handleSettingsUpdate = () => {
    // Refresh performers to get updated data
    fetchPerformers();
  };

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
      {/* Header */}
      <Box sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        mb: 3,
        flexWrap: 'wrap',
        gap: 2
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h4" sx={{ fontWeight: 600, color: 'text.primary' }}>
            Gallery
          </Typography>
          <Chip
            label={`${performers.length} performers`}
            variant="outlined"
            size="small"
          />
        </Box>
      </Box>

      {/* Section Toggles */}
      <Box sx={{
        display: 'flex',
        gap: 2,
        mb: 3,
        flexWrap: 'wrap'
      }}>
        <Button
          variant={showPerformers ? "contained" : "outlined"}
          onClick={() => setShowPerformers(!showPerformers)}
        >
          Performers
        </Button>
        <Button
          variant={showContent ? "contained" : "outlined"}
          onClick={() => setShowContent(!showContent)}
        >
          Content Genres
        </Button>
      </Box>

      {/* Performers Section */}
      {showPerformers && (
        <Box sx={{ mb: 4 }}>
          <Box sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 2,
            flexWrap: 'wrap',
            gap: 2
          }}>
            <Typography variant="h5" sx={{ fontWeight: 500 }}>
              Performers
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <TextField
                size="small"
                placeholder="Search performers..."
                value={performerSearchTerm}
                onChange={e => setPerformerSearchTerm(e.target.value)}
                sx={{
                  minWidth: 200,
                  '& .MuiOutlinedInput-root': {
                    color: 'white',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    '& fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                    },
                    '&:hover fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.5)',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.7)',
                    },
                  },
                  '& .MuiInputBase-input::placeholder': {
                    color: 'rgba(255, 255, 255, 0.5)',
                    opacity: 1,
                  },
                }}
              />

              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel sx={{ color: 'rgba(255, 255, 255, 0.7)', '&.Mui-focused': { color: 'white' } }}>Sort By</InputLabel>
                <Select
                  value={performerSortBy}
                  label="Sort By"
                  onChange={e => setPerformerSortBy(e.target.value)}
                  sx={{
                    color: 'white',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'rgba(255, 255, 255, 0.5)',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'rgba(255, 255, 255, 0.7)',
                    },
                    '& .MuiSvgIcon-root': {
                      color: 'white',
                    },
                  }}
                >
                  <MenuItem value="name-asc">Name (A-Z)</MenuItem>
                  <MenuItem value="name-desc">Name (Z-A)</MenuItem>
                  <MenuItem value="rating-desc">Rating (High-Low)</MenuItem>
                  <MenuItem value="rating-asc">Rating (Low-High)</MenuItem>
                  <MenuItem value="age-asc">Age (Youngest)</MenuItem>
                  <MenuItem value="age-desc">Age (Oldest)</MenuItem>
                  <MenuItem value="cup-asc">Cup Size (Smallest)</MenuItem>
                  <MenuItem value="cup-desc">Cup Size (Largest)</MenuItem>
                  <MenuItem value="size-desc">Size (Largest)</MenuItem>
                  <MenuItem value="size-asc">Size (Smallest)</MenuItem>
                  <MenuItem value="date-desc">Date (Newest)</MenuItem>
                  <MenuItem value="date-asc">Date (Oldest)</MenuItem>
                </Select>
              </FormControl>

              <Button
                variant="outlined"
                startIcon={<FilterIcon />}
                onClick={() => setFilterModalOpen(true)}
                sx={{
                  color: 'white',
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  '&:hover': {
                    borderColor: 'rgba(255, 255, 255, 0.5)',
                    backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  },
                }}
              >
                Filters
              </Button>

              <IconButton
                onClick={() => setFullscreenMode(true)}
                sx={{
                  color: 'white',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  },
                }}
              >
                <FullscreenIcon />
              </IconButton>
            </Box>
          </Box>

          {loadingPerformers && sortedPerformers.length === 0 ? (
            <Grid container spacing={3} justifyContent="center">
              {[...Array(12)].map((_, index) => (
                <Grid item xs={12} sm={6} md={2.4} key={`skeleton-${index}`}>
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
                </Grid>
              ))}
            </Grid>
          ) : sortedPerformers.length > 0 ? (
            <Grid container spacing={3} justifyContent="center">
              {sortedPerformers.map((performer, index) => (
                <Grid item xs={12} sm={6} md={2.4} key={performer.id}>
                  {index >= renderedPerformerCount ? (
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
                      onClick={() => handlePerformerClick(performer.name)}
                      onChangeThumbnail={handleChangeThumbnail}
                      onDelete={handleDeletePerformer}
                      onSettings={handlePerformerSettings}
                      onRate={handleRatePerformer}
                      onOpenThumbnailSelector={(performer) => navigate(`/thumbnail-selector/${performer.id}`, { state: { performer } })}
                      mode="gallery"
                      basePath={basePath}
                    />
                  )}
                </Grid>
              ))}
            </Grid>
          ) : (
            !loadingPerformers && (
              <Box sx={{
                textAlign: 'center',
                py: 6,
                color: 'text.secondary',
                border: '2px dashed',
                borderColor: 'divider',
                borderRadius: 2
              }}>
                <Typography variant="h6" gutterBottom>
                  No performers in gallery
                </Typography>
                <Typography variant="body2">
                  Import and filter performers to see them here.
                </Typography>
              </Box>
            )
          )}
        </Box>
      )}

      {/* Content Section */}
      {showContent && (
        <Box>
          <Box sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 2,
            flexWrap: 'wrap',
            gap: 2
          }}>
            <Typography variant="h5" sx={{ fontWeight: 500 }}>
              Content by Genre
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <TextField
                size="small"
                placeholder="Search genres..."
                value={contentSearchTerm}
                onChange={e => setContentSearchTerm(e.target.value)}
                sx={{
                  minWidth: 200,
                  '& .MuiOutlinedInput-root': {
                    color: 'white',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    '& fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                    },
                    '&:hover fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.5)',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.7)',
                    },
                  },
                  '& .MuiInputBase-input::placeholder': {
                    color: 'rgba(255, 255, 255, 0.5)',
                    opacity: 1,
                  },
                }}
              />

              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel sx={{ color: 'rgba(255, 255, 255, 0.7)', '&.Mui-focused': { color: 'white' } }}>Sort By</InputLabel>
                <Select
                  value={contentSortBy}
                  label="Sort By"
                  onChange={e => setContentSortBy(e.target.value)}
                  sx={{
                    color: 'white',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'rgba(255, 255, 255, 0.5)',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'rgba(255, 255, 255, 0.7)',
                    },
                    '& .MuiSvgIcon-root': {
                      color: 'white',
                    },
                  }}
                >
                  <MenuItem value="name-asc">Name (A-Z)</MenuItem>
                  <MenuItem value="name-desc">Name (Z-A)</MenuItem>
                  <MenuItem value="count-desc">Count (Most)</MenuItem>
                  <MenuItem value="count-asc">Count (Least)</MenuItem>
                </Select>
              </FormControl>

              <ToggleButtonGroup
                value={contentViewMode}
                exclusive
                onChange={(e, newView) => newView && setContentViewMode(newView)}
                size="small"
              >
                <ToggleButton value="grid">
                  <ViewModule />
                </ToggleButton>
                <ToggleButton value="list">
                  <ViewList />
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Box>

          {sortedGenres.length > 0 ? (
            contentViewMode === 'grid' ? (
              <Grid container spacing={3}>
                {sortedGenres.map(genre => (
                  <Grid item xs={12} sm={6} md={4} lg={3} xl={2} key={genre.name}>
                    <ContentCard genre={genre} basePath={basePath} />
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {sortedGenres.map(genre => (
                  <Box
                    key={genre.name}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      p: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor: 'action.hover'
                      }
                    }}
                    onClick={() => {
                      // Handle genre click - could navigate to genre page or open modal
                      console.log('Clicked genre:', genre.name);
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: 1,
                          bgcolor: 'primary.main',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontWeight: 'bold'
                        }}
                      >
                        {genre.name.charAt(0).toUpperCase()}
                      </Box>
                      <Typography variant="h6" sx={{ fontWeight: 500 }}>
                        {genre.name}
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {genre.total_items || 0} items
                    </Typography>
                  </Box>
                ))}
              </Box>
            )
          ) : (
            <Box sx={{
              textAlign: 'center',
              py: 6,
              color: 'text.secondary',
              border: '2px dashed',
              borderColor: 'divider',
              borderRadius: 2
            }}>
              <Typography variant="h6" gutterBottom>
                No content organized yet
              </Typography>
              <Typography variant="body2">
                Content will appear here after organizing performers.
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Settings Modal */}
      {settingsModal.open && settingsModal.performer && (
        <PerformerSettingsModal
          performer={settingsModal.performer}
          open={settingsModal.open}
          onClose={handleSettingsClose}
          onUpdate={handleSettingsUpdate}
          basePath={basePath}
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
                    if (taskData.status === 'completed') {
                      // Refresh performers data on completion
                      fetchPerformers();
                    }
                  }
                }
              } catch (err) {
                console.error('Error polling task:', err);
              }
            }, 500);

            pollingIntervalsRef.current.set(task.id, pollInterval);
          }}
        />
      )}

      {/* Filter Modal */}
      <Dialog
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#1e1e1e',
            color: 'white'
          }
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">Filter Performers</Typography>
          <IconButton onClick={() => setFilterModalOpen(false)} sx={{ color: 'white' }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ borderColor: 'rgba(255, 255, 255, 0.12)' }}>
          {/* Age Slider */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>
              Age Range
            </Typography>
            <Slider
              value={[filters.age.min || getAgeRange().min, filters.age.max || getAgeRange().max]}
              onChange={(e, newValue) => {
                setFilters(prev => ({
                  ...prev,
                  age: { min: newValue[0], max: newValue[1] }
                }));
              }}
              valueLabelDisplay="on"
              min={getAgeRange().min}
              max={getAgeRange().max}
              sx={{
                color: '#1976d2',
                '& .MuiSlider-thumb': {
                  backgroundColor: '#fff',
                },
                '& .MuiSlider-valueLabel': {
                  backgroundColor: '#1976d2',
                },
              }}
            />
          </Box>

          {/* Ethnicity */}
          {getUniqueValues('ethnicity').length > 0 && (
            <>
              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mt: 3 }}>
                Ethnicity
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {getUniqueValues('ethnicity').map(value => (
                  <Box key={value} sx={{ display: 'flex', gap: 0.5 }}>
                    <Chip
                      label={value}
                      onClick={() => toggleFilterValue('ethnicity', value, 'include')}
                      color={filters.ethnicity.include.includes(value) ? 'primary' : 'default'}
                      variant={filters.ethnicity.include.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer' }}
                    />
                    <Chip
                      label="✕"
                      onClick={() => toggleFilterValue('ethnicity', value, 'exclude')}
                      color={filters.ethnicity.exclude.includes(value) ? 'error' : 'default'}
                      variant={filters.ethnicity.exclude.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer', minWidth: '32px' }}
                    />
                  </Box>
                ))}
              </Box>
              <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.12)' }} />
            </>
          )}

          {/* Hair Color */}
          {getUniqueValues('hair').length > 0 && (
            <>
              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mt: 3 }}>
                Hair Color
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {getUniqueValues('hair').map(value => (
                  <Box key={value} sx={{ display: 'flex', gap: 0.5 }}>
                    <Chip
                      label={value}
                      onClick={() => toggleFilterValue('hair', value, 'include')}
                      color={filters.hair.include.includes(value) ? 'primary' : 'default'}
                      variant={filters.hair.include.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer' }}
                    />
                    <Chip
                      label="✕"
                      onClick={() => toggleFilterValue('hair', value, 'exclude')}
                      color={filters.hair.exclude.includes(value) ? 'error' : 'default'}
                      variant={filters.hair.exclude.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer', minWidth: '32px' }}
                    />
                  </Box>
                ))}
              </Box>
              <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.12)' }} />
            </>
          )}

          {/* Eye Color */}
          {getUniqueValues('eyes').length > 0 && (
            <>
              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mt: 3 }}>
                Eye Color
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {getUniqueValues('eyes').map(value => (
                  <Box key={value} sx={{ display: 'flex', gap: 0.5 }}>
                    <Chip
                      label={value}
                      onClick={() => toggleFilterValue('eyes', value, 'include')}
                      color={filters.eyes.include.includes(value) ? 'primary' : 'default'}
                      variant={filters.eyes.include.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer' }}
                    />
                    <Chip
                      label="✕"
                      onClick={() => toggleFilterValue('eyes', value, 'exclude')}
                      color={filters.eyes.exclude.includes(value) ? 'error' : 'default'}
                      variant={filters.eyes.exclude.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer', minWidth: '32px' }}
                    />
                  </Box>
                ))}
              </Box>
              <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.12)' }} />
            </>
          )}

          {/* Body Type */}
          {getUniqueValues('body_type').length > 0 && (
            <>
              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mt: 3 }}>
                Body Type
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {getUniqueValues('body_type').map(value => (
                  <Box key={value} sx={{ display: 'flex', gap: 0.5 }}>
                    <Chip
                      label={value}
                      onClick={() => toggleFilterValue('body', value, 'include')}
                      color={filters.body.include.includes(value) ? 'primary' : 'default'}
                      variant={filters.body.include.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer' }}
                    />
                    <Chip
                      label="✕"
                      onClick={() => toggleFilterValue('body', value, 'exclude')}
                      color={filters.body.exclude.includes(value) ? 'error' : 'default'}
                      variant={filters.body.exclude.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer', minWidth: '32px' }}
                    />
                  </Box>
                ))}
              </Box>
              <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.12)' }} />
            </>
          )}

          {/* Band Size */}
          {getUniqueValues('measurements_band_size').length > 0 && (
            <>
              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mt: 3 }}>
                Band Size
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {getUniqueValues('measurements_band_size').map(value => (
                  <Box key={value} sx={{ display: 'flex', gap: 0.5 }}>
                    <Chip
                      label={value}
                      onClick={() => toggleFilterValue('bandSize', value, 'include')}
                      color={filters.bandSize.include.includes(value) ? 'primary' : 'default'}
                      variant={filters.bandSize.include.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer' }}
                    />
                    <Chip
                      label="✕"
                      onClick={() => toggleFilterValue('bandSize', value, 'exclude')}
                      color={filters.bandSize.exclude.includes(value) ? 'error' : 'default'}
                      variant={filters.bandSize.exclude.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer', minWidth: '32px' }}
                    />
                  </Box>
                ))}
              </Box>
              <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.12)' }} />
            </>
          )}

          {/* Cup Size */}
          {getUniqueValues('measurements_cup').length > 0 && (
            <>
              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mt: 3 }}>
                Cup Size
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {getUniqueValues('measurements_cup').map(value => (
                  <Box key={value} sx={{ display: 'flex', gap: 0.5 }}>
                    <Chip
                      label={value}
                      onClick={() => toggleFilterValue('cupSize', value, 'include')}
                      color={filters.cupSize.include.includes(value) ? 'primary' : 'default'}
                      variant={filters.cupSize.include.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer' }}
                    />
                    <Chip
                      label="✕"
                      onClick={() => toggleFilterValue('cupSize', value, 'exclude')}
                      color={filters.cupSize.exclude.includes(value) ? 'error' : 'default'}
                      variant={filters.cupSize.exclude.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer', minWidth: '32px' }}
                    />
                  </Box>
                ))}
              </Box>
              <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.12)' }} />
            </>
          )}

          {/* Natural/Fake */}
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mt: 3 }}>
            Breast Type
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            {[0, 1].map(value => (
              <Box key={value} sx={{ display: 'flex', gap: 0.5 }}>
                <Chip
                  label={value === 0 ? 'Natural' : 'Fake'}
                  onClick={() => toggleFilterValue('measurements_fake', value, 'include')}
                  color={filters.measurements_fake.include.includes(value) ? 'primary' : 'default'}
                  variant={filters.measurements_fake.include.includes(value) ? 'filled' : 'outlined'}
                  size="small"
                  sx={{ cursor: 'pointer' }}
                />
                <Chip
                  label="✕"
                  onClick={() => toggleFilterValue('measurements_fake', value, 'exclude')}
                  color={filters.measurements_fake.exclude.includes(value) ? 'error' : 'default'}
                  variant={filters.measurements_fake.exclude.includes(value) ? 'filled' : 'outlined'}
                  size="small"
                  sx={{ cursor: 'pointer', minWidth: '32px' }}
                />
              </Box>
            ))}
          </Box>
          <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.12)' }} />

          {/* Weight */}
          {getUniqueValues('weight').length > 0 && (
            <>
              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mt: 3 }}>
                Weight
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {getUniqueValues('weight').map(value => (
                  <Box key={value} sx={{ display: 'flex', gap: 0.5 }}>
                    <Chip
                      label={value}
                      onClick={() => toggleFilterValue('weight', value, 'include')}
                      color={filters.weight.include.includes(value) ? 'primary' : 'default'}
                      variant={filters.weight.include.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer' }}
                    />
                    <Chip
                      label="✕"
                      onClick={() => toggleFilterValue('weight', value, 'exclude')}
                      color={filters.weight.exclude.includes(value) ? 'error' : 'default'}
                      variant={filters.weight.exclude.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer', minWidth: '32px' }}
                    />
                  </Box>
                ))}
              </Box>
              <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.12)' }} />
            </>
          )}

          {/* Height */}
          {getUniqueValues('height').length > 0 && (
            <>
              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mt: 3 }}>
                Height
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {getUniqueValues('height').map(value => (
                  <Box key={value} sx={{ display: 'flex', gap: 0.5 }}>
                    <Chip
                      label={value}
                      onClick={() => toggleFilterValue('height', value, 'include')}
                      color={filters.height.include.includes(value) ? 'primary' : 'default'}
                      variant={filters.height.include.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer' }}
                    />
                    <Chip
                      label="✕"
                      onClick={() => toggleFilterValue('height', value, 'exclude')}
                      color={filters.height.exclude.includes(value) ? 'error' : 'default'}
                      variant={filters.height.exclude.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer', minWidth: '32px' }}
                    />
                  </Box>
                ))}
              </Box>
              <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.12)' }} />
            </>
          )}

          {/* Tags */}
          {getUniqueValues('tags').length > 0 && (
            <>
              <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600, mt: 3 }}>
                Tags
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {getUniqueValues('tags').map(value => (
                  <Box key={value} sx={{ display: 'flex', gap: 0.5 }}>
                    <Chip
                      label={value}
                      onClick={() => toggleFilterValue('tags', value, 'include')}
                      color={filters.tags.include.includes(value) ? 'primary' : 'default'}
                      variant={filters.tags.include.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer' }}
                    />
                    <Chip
                      label="✕"
                      onClick={() => toggleFilterValue('tags', value, 'exclude')}
                      color={filters.tags.exclude.includes(value) ? 'error' : 'default'}
                      variant={filters.tags.exclude.includes(value) ? 'filled' : 'outlined'}
                      size="small"
                      sx={{ cursor: 'pointer', minWidth: '32px' }}
                    />
                  </Box>
                ))}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={clearAllFilters} color="warning">
            Clear All
          </Button>
          <Button onClick={() => setFilterModalOpen(false)} variant="contained">
            Apply Filters
          </Button>
        </DialogActions>
      </Dialog>

      {/* Fullscreen Idle Mode - Photo Wall */}
      <Dialog
        fullScreen
        open={fullscreenMode}
        onClose={() => setFullscreenMode(false)}
        sx={{
          '& .MuiDialog-paper': {
            backgroundColor: '#1a1a1a',
          }
        }}
      >
        <Box
          sx={{
            width: '100vw',
            height: '100vh',
            overflow: 'hidden', // Re-enabled for animation
            position: 'relative',
            backgroundColor: '#1a1a1a'
          }}
        >
          {/* Close button */}
          <IconButton
            onClick={() => setFullscreenMode(false)}
            sx={{
              position: 'fixed',
              top: 16,
              right: 16,
              color: 'white',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              zIndex: 1000,
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
              },
            }}
          >
            <CloseIcon />
          </IconButton>

          {/* Photo Wall - with organic camera-like panning */}
          <Box
            sx={{
              position: 'relative',
              width: `${PHOTO_WALL_CONFIG.screenMultiplier * 100}%`, // Dynamic based on multiplier
              height: `${PHOTO_WALL_CONFIG.screenMultiplier * 100}%`, // Dynamic based on multiplier
              animation: getCameraAnimationCSS(),
              '@keyframes cameraMove': generateCameraKeyframes()
            }}
          >
            {photoWallLayout.map((item, index) => {
              // Skip if no selected thumbnail
              if (!item.selectedThumbnail) {
                return null;
              }

              const imageUrl = `/api/files/raw?path=${encodeURIComponent(item.selectedThumbnail)}`;
              const isHero = item.isHero === true;
              const isFramed = item.isFramed === true;

              return (
                <Box
                  key={`${item.performer.id}-${index}-${wallKey}`}
                  onClick={() => {
                    setFullscreenMode(false);
                    handlePerformerClick(item.performer.name);
                  }}
                  sx={{
                    position: 'absolute',
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    width: `${item.width}px`,
                    height: `${item.height}px`,
                    transform: `rotate(${item.rotation}deg)`,
                    cursor: 'pointer',
                    zIndex: item.zIndex,
                    transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                    boxShadow: isHero
                      ? '0 10px 60px rgba(0, 0, 0, 0.8)'
                      : isFramed
                        ? '0 6px 25px rgba(0, 0, 0, 0.6)'
                        : '0 4px 20px rgba(0, 0, 0, 0.5)',
                    overflow: 'hidden',
                    backgroundColor: '#222',
                    // Frame border for framed photos
                    border: isFramed
                      ? `${8 + Math.floor(Math.random() * 8)}px solid ${['#8B7355', '#654321', '#D4AF37', '#C0C0C0', '#1a1a1a', '#f5f5dc'][Math.floor(Math.random() * 6)]
                      }`
                      : isHero
                        ? '8px solid rgba(255, 255, 255, 0.1)'
                        : 'none',
                    borderRadius: isFramed && item.frameShape === 'oval' ? '50%' : 0,
                    '&:hover': {
                      transform: `rotate(${item.rotation}deg) scale(${isHero ? 1.02 : 1.05})`,
                      boxShadow: isHero
                        ? '0 15px 80px rgba(0, 0, 0, 0.9)'
                        : isFramed
                          ? '0 10px 40px rgba(0, 0, 0, 0.8)'
                          : '0 8px 30px rgba(0, 0, 0, 0.8)',
                      zIndex: 100,
                    },
                  }}
                >
                  <img
                    src={imageUrl}
                    alt={item.performer.name}
                    onError={(e) => {
                      console.error(`Failed to load image for ${item.performer.name}:`, imageUrl);
                      e.target.style.display = 'none';
                    }}
                    onLoad={() => {
                      console.log(`✅ Loaded image for ${item.performer.name}`);
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'center',
                    }}
                  />

                  {/* Tape effect for non-framed photos */}
                  {!isFramed && (
                    <>
                      {isHero ? (
                        <>
                          <Box sx={{
                            position: 'absolute',
                            top: -10,
                            left: '20%',
                            width: '100px',
                            height: '35px',
                            backgroundColor: 'rgba(200, 180, 140, 0.7)',
                            transform: 'rotate(-2deg)',
                            boxShadow: '0 3px 6px rgba(0, 0, 0, 0.4)',
                          }} />
                          <Box sx={{
                            position: 'absolute',
                            top: -10,
                            right: '20%',
                            width: '100px',
                            height: '35px',
                            backgroundColor: 'rgba(200, 180, 140, 0.7)',
                            transform: 'rotate(2deg)',
                            boxShadow: '0 3px 6px rgba(0, 0, 0, 0.4)',
                          }} />
                          <Box sx={{
                            position: 'absolute',
                            bottom: -10,
                            left: '20%',
                            width: '100px',
                            height: '35px',
                            backgroundColor: 'rgba(200, 180, 140, 0.7)',
                            transform: 'rotate(2deg)',
                            boxShadow: '0 3px 6px rgba(0, 0, 0, 0.4)',
                          }} />
                          <Box sx={{
                            position: 'absolute',
                            bottom: -10,
                            right: '20%',
                            width: '100px',
                            height: '35px',
                            backgroundColor: 'rgba(200, 180, 140, 0.7)',
                            transform: 'rotate(-2deg)',
                            boxShadow: '0 3px 6px rgba(0, 0, 0, 0.4)',
                          }} />
                        </>
                      ) : (
                        <Box
                          sx={{
                            position: 'absolute',
                            top: -10,
                            left: '20%',
                            width: '60px',
                            height: '25px',
                            backgroundColor: 'rgba(200, 180, 140, 0.6)',
                            transform: 'rotate(-2deg)',
                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.3)',
                          }}
                        />
                      )}
                    </>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Dialog>

      {/* Background Task Queue */}
      {backgroundTasks.length > 0 && (
        <BackgroundTaskQueue
          tasks={backgroundTasks}
          onClose={() => {
            setBackgroundTasks(prev => prev.filter(t => t.status === 'processing' || t.status === 'queued'));
          }}
        />
      )}
    </Container>
  );
}

export default GalleryView;