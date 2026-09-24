import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { savePlayerContext, playerUrl } from '../utils/playerContext';
import GalleryHero from './gallery/GalleryHero';
import GalleryToolbar from './gallery/GalleryToolbar';
import ActiveFilters from './gallery/ActiveFilters';
import FilterDrawer from './gallery/FilterDrawer';
import MasonryGrid from './gallery/MasonryGrid';
import './gallery/gallery.css';

// Tiles rendered at first, and added each time the user nears the bottom.
const RENDER_BATCH = 120;
const SIZE_KEY = 'unifiedGallerySize';
const SIZE_MIN = 90;
const SIZE_MAX = 480;
const TAB_KEYS = ['pics', 'vids', 'funscriptVids'];
const TAB_ITEM_TYPES = { pics: 'image', vids: 'video', funscriptVids: 'funscript_video' };

const readStoredSize = () => {
  try {
    const stored = Number(localStorage.getItem(SIZE_KEY));
    if (stored >= SIZE_MIN && stored <= SIZE_MAX) return stored;
  } catch (e) {
    // storage unavailable — fall through to the default
  }
  return window.innerWidth < 600 ? 150 : 220;
};

// The fields the player contract (docs/redesign/SPEC.md) defines for a MediaItem.
const toMediaItem = (item) => ({
  path: item.path,
  name: item.name,
  type: item.type,
  url: item.url,
  thumbnail: item.thumbnail,
  size: item.size,
  sizeFormatted: item.sizeFormatted,
  modified: item.modified,
  duration: item.duration,
  width: item.width,
  height: item.height,
  videoRating: item.videoRating,
  funscriptRating: item.funscriptRating,
  funscriptCount: item.funscriptCount,
  tags: item.tags,
});

const UnifiedGallery = ({ handyIntegration, handyCode, handyConnected }) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [currentContent, setCurrentContent] = useState(null);
  const [allContent, setAllContent] = useState(null); // holds all (physical + tagged) files
  const [currentTab, setCurrentTab] = useState(0);
  const [galleryType, setGalleryType] = useState(null);
  const [galleryName, setGalleryName] = useState(null);
  const [basePath, setBasePath] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 0: all, 1: only physical (folder), 2: only tagged (virtual)
  const [showTaggedMode, setShowTaggedMode] = useState(0);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [performerData, setPerformerData] = useState(null);
  const [availableTags, setAvailableTags] = useState([]);
  const [tagStates, setTagStates] = useState({});
  const [globalTags, setGlobalTags] = useState([]);
  const [scoreFilters, setScoreFilters] = useState({
    video: { min: null, max: null },
    funscript: { min: null, max: null },
  });
  const hasLoadedPrefsRef = useRef(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const pendingTagStatesRef = useRef(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [tileSize, setTileSize] = useState(readStoredSize);
  const [renderCount, setRenderCount] = useState(RENDER_BATCH);
  const pendingRestoreRef = useRef(null); // { scrollY, count } saved when a tile was opened
  const rootRef = useRef(null);
  const [pairwiseScores, setPairwiseScores] = useState(null); // Map of path -> score
  const preferencesKey = useMemo(() => {
    if (!galleryType || !galleryName || !basePath) return null;
    return `unifiedGalleryPrefs:${galleryType}:${encodeURIComponent(basePath)}:${encodeURIComponent(galleryName)}`;
  }, [galleryType, galleryName, basePath]);

  // Calculate current age from scraped age and scrape date
  const calculateCurrentAge = (scrapedAge, scrapedAt) => {
    if (!scrapedAge || !scrapedAt) return scrapedAge;

    const scrapeDate = new Date(scrapedAt);
    const now = new Date();
    const yearsPassed = now.getFullYear() - scrapeDate.getFullYear();
    const monthsPassed = now.getMonth() - scrapeDate.getMonth();

    // If birthday hasn't occurred yet this year, subtract 1
    let currentAge = scrapedAge + yearsPassed;
    if (monthsPassed < 0) {
      currentAge--;
    }

    return currentAge;
  };

  const extractTagStrings = (raw) => {
    if (raw == null) return [];
    const items = Array.isArray(raw) ? raw : [raw];
    return items
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry.trim();
        }
        if (entry && typeof entry === 'object') {
          if (typeof entry.name === 'string') {
            return entry.name.trim();
          }
          if (typeof entry.label === 'string') {
            return entry.label.trim();
          }
          if (typeof entry.tag === 'string') {
            return entry.tag.trim();
          }
          if (typeof entry.value === 'string') {
            return entry.value.trim();
          }
        }
        return null;
      })
      .filter((value) => typeof value === 'string' && value.length > 0);
  };

  const activeFilters = useMemo(() => {
    const includes = [];
    const excludes = [];

    Object.entries(tagStates).forEach(([tag, state]) => {
      if (state === 'include') {
        includes.push(tag);
      } else if (state === 'exclude') {
        excludes.push(tag);
      }
    });

    return {
      includeTags: includes,
      excludeTags: excludes,
      tagActiveCount: includes.length + excludes.length,
      scoreFilters,
    };
  }, [tagStates, scoreFilters]);

  const scoreFilterActivity = useMemo(() => ({
    video: (scoreFilters.video.min !== null && scoreFilters.video.min !== undefined)
      || (scoreFilters.video.max !== null && scoreFilters.video.max !== undefined),
    funscript: (scoreFilters.funscript.min !== null && scoreFilters.funscript.min !== undefined)
      || (scoreFilters.funscript.max !== null && scoreFilters.funscript.max !== undefined),
  }), [scoreFilters]);

  const totalActiveFilters = activeFilters.tagActiveCount
    + (scoreFilterActivity.video ? 1 : 0)
    + (scoreFilterActivity.funscript ? 1 : 0);

  // Check localStorage for persisted connection state
  useEffect(() => {
    const storedConnected = localStorage.getItem('handyConnected') === 'true';
    const storedCode = localStorage.getItem('handyCode') || '';

    // Use stored state if props don't indicate connection
    const effectiveConnected = handyConnected || storedConnected;
    const effectiveCode = handyCode || storedCode;

    window.appHandyConnected = effectiveConnected;

    // Try to restore connection if we have a code but aren't connected
    if (effectiveCode && !effectiveConnected && window.Handy) {
      initializeAndConnect(effectiveCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handyConnected, handyCode, handyIntegration]);

  const initializeAndConnect = async (connectionCode) => {
    try {
      // Use the HandyIntegration instance instead of direct SDK
      if (handyIntegration) {
        const success = await handyIntegration.connect(connectionCode);
        if (success) {
          window.appHandyConnected = true;
          localStorage.setItem('handyConnected', 'true');
        } else {
          console.warn('❌ Failed to restore Handy connection via HandyIntegration');
        }
      } else {
        // Fallback to direct SDK if HandyIntegration not available
        if (!window.handyInstance && window.Handy) {
          window.handyInstance = window.Handy.init();
        }

        if (window.handyInstance) {
          const result = await window.handyInstance.connect(connectionCode);
          if (result === window.Handy.ConnectResult.CONNECTED) {
            window.appHandyConnected = true;
            localStorage.setItem('handyConnected', 'true');
          } else {
            console.warn('❌ Failed to restore Handy connection in UnifiedGallery');
          }
        }
      }
    } catch (error) {
      console.error('❌ Error restoring Handy connection:', error);
    }
  };

  useEffect(() => {
    // Parse URL parameters using React Router
    const performer = searchParams.get('performer');
    const genre = searchParams.get('genre');
    const basePathParam = searchParams.get('basePath');

    // Determine gallery type and name
    if (performer) {
      setGalleryType('performer');
      setGalleryName(performer);
      setBasePath(basePathParam);
      document.title = `${performer} - Gallery`;
    } else if (genre) {
      setGalleryType('genre');
      setGalleryName(genre);
      setBasePath(basePathParam);
      document.title = `${genre} - Gallery`;
    }
  }, [searchParams]);


  // Fetch all files (physical + tagged) only once per gallery
  // Wait for preferences to be loaded before fetching with correct sortBy
  useEffect(() => {
    if (galleryType && galleryName && basePath && prefsLoaded) {
      if (galleryType === 'performer') {
        if (!performerData) {
          fetchPerformerData(); // Fetch ID first
        } else {
          // Have ID, fetch content
          fetchAllContent(sortBy, sortOrder);
        }
      } else if (galleryType === 'genre') {
        fetchAllContent(sortBy, sortOrder);
      }
    }
    // eslint-disable-next-line
  }, [galleryType, galleryName, basePath, prefsLoaded, performerData]);

  useEffect(() => {
    let cancelled = false;
    const loadGlobalTags = async () => {
      try {
        const response = await fetch('/api/tags/all');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (!cancelled && data && Array.isArray(data.tags)) {
          setGlobalTags(data.tags.filter(tag => tag != null));
        }
      } catch (error) {
        console.warn('Failed to load global tags:', error);
      }
    };
    loadGlobalTags();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const tagSet = new Set();

    globalTags.forEach(tag => {
      extractTagStrings(tag).forEach(value => {
        tagSet.add(value);
      });
    });

    if (allContent) {
      ['pics', 'vids', 'funscriptVids'].forEach(type => {
        const items = allContent[type] || [];
        items.forEach(item => {
          extractTagStrings(item.tags).forEach(value => {
            tagSet.add(value);
          });
        });
      });
    }

    const sortedTags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));
    setAvailableTags(sortedTags);
    setTagStates(prev => {
      const next = {};
      sortedTags.forEach(tag => {
        const pendingState = pendingTagStatesRef.current ? pendingTagStatesRef.current[tag] : undefined;
        next[tag] = pendingState || prev[tag] || 'neutral';
      });
      return next;
    });

    if (pendingTagStatesRef.current && sortedTags.length > 0) {
      pendingTagStatesRef.current = null;
    }
  }, [allContent, globalTags]);

  useEffect(() => {
    if (!preferencesKey) return;

    hasLoadedPrefsRef.current = false;

    let parsed = null;
    try {
      const raw = localStorage.getItem(preferencesKey);
      if (raw) {
        parsed = JSON.parse(raw);
      }
    } catch (error) {
      console.warn('Failed to load gallery preferences:', error);
    }

    if (parsed) {
      if (typeof parsed.sortBy === 'string') {
        setSortBy(parsed.sortBy);
      } else {
        setSortBy('name');
      }

      if (parsed.sortOrder === 'desc' || parsed.sortOrder === 'asc') {
        setSortOrder(parsed.sortOrder);
      } else {
        setSortOrder('asc');
      }

      if (typeof parsed.showTaggedMode === 'number' && !Number.isNaN(parsed.showTaggedMode)) {
        const clampedMode = Math.min(2, Math.max(0, Math.round(parsed.showTaggedMode)));
        setShowTaggedMode(clampedMode);
      } else {
        setShowTaggedMode(0);
      }

      if (parsed.tagStates && typeof parsed.tagStates === 'object') {
        pendingTagStatesRef.current = parsed.tagStates;
        setTagStates(prev => {
          const next = { ...prev };
          Object.entries(parsed.tagStates).forEach(([tag, state]) => {
            if (state === 'include' || state === 'exclude') {
              next[tag] = state;
            }
          });
          return next;
        });
      } else {
        pendingTagStatesRef.current = null;
        setTagStates({});
      }

      if (parsed.scoreFilters && typeof parsed.scoreFilters === 'object') {
        const normalizeRange = (range = {}) => {
          const min = typeof range.min === 'number' && Number.isFinite(range.min) ? Math.min(10, Math.max(0, range.min)) : null;
          const max = typeof range.max === 'number' && Number.isFinite(range.max) ? Math.min(10, Math.max(0, range.max)) : null;
          if (min !== null && max !== null && min > max) {
            return { min: max, max };
          }
          return { min, max };
        };
        setScoreFilters({
          video: normalizeRange(parsed.scoreFilters.video),
          funscript: normalizeRange(parsed.scoreFilters.funscript),
        });
      } else {
        setScoreFilters({
          video: { min: null, max: null },
          funscript: { min: null, max: null },
        });
      }
    } else {
      setSortBy('name');
      setSortOrder('asc');
      setShowTaggedMode(0);
      pendingTagStatesRef.current = null;
      setTagStates({});
      setScoreFilters({
        video: { min: null, max: null },
        funscript: { min: null, max: null },
      });
    }

    // Coming back from the player: reopen the tab the user left and remember
    // where they were; the position is applied once the content is there.
    try {
      const returnKey = `unifiedGalleryReturn:${preferencesKey}`;
      const rawReturn = sessionStorage.getItem(returnKey);
      if (rawReturn) {
        sessionStorage.removeItem(returnKey);
        const saved = JSON.parse(rawReturn);
        if (saved && typeof saved === 'object') {
          if ([0, 1, 2].includes(saved.tab)) setCurrentTab(saved.tab);
          pendingRestoreRef.current = {
            scrollY: Number(saved.scrollY) || 0,
            count: Number(saved.count) || RENDER_BATCH,
          };
        }
      }
    } catch (error) {
      console.warn('Failed to read gallery return position:', error);
    }

    hasLoadedPrefsRef.current = true;
    setPrefsLoaded(true);
  }, [preferencesKey]);

  useEffect(() => {
    if (!preferencesKey || !hasLoadedPrefsRef.current) return;

    try {
      const activeTagStates = {};
      Object.entries(tagStates || {}).forEach(([tag, state]) => {
        if (state === 'include' || state === 'exclude') {
          activeTagStates[tag] = state;
        }
      });

      const serializeRange = (range = {}) => {
        const hasMin = range.min !== null && range.min !== undefined;
        const hasMax = range.max !== null && range.max !== undefined;
        if (!hasMin && !hasMax) {
          return { min: null, max: null };
        }
        return {
          min: hasMin ? range.min : null,
          max: hasMax ? range.max : null,
        };
      };

      const payload = {
        sortBy,
        sortOrder,
        showTaggedMode,
        tagStates: activeTagStates,
        scoreFilters: {
          video: serializeRange(scoreFilters.video),
          funscript: serializeRange(scoreFilters.funscript),
        },
      };
      localStorage.setItem(preferencesKey, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to persist gallery preferences:', error);
    }
  }, [preferencesKey, sortBy, sortOrder, showTaggedMode, tagStates, scoreFilters]);

  // Fetch performer data from API
  const fetchPerformerData = async () => {
    try {
      const response = await fetch(`/api/performers?name=${encodeURIComponent(galleryName)}&basePath=${encodeURIComponent(basePath)}`);
      if (response.ok) {
        const performers = await response.json();
        const performer = performers.find(p => p.name === galleryName);
        if (performer) {
          setPerformerData(performer);
        }
      }
    } catch (error) {
      console.error('Error fetching performer data:', error);
    }
  };

  // Listen for tag modal close event to refresh gallery
  useEffect(() => {
    let refreshTimeout = null;
    let lastRefresh = 0;
    function handleTagModalClosed() {
      // Debounce: only allow one refresh per 500ms
      const now = Date.now();
      if (now - lastRefresh < 500) return;
      lastRefresh = now;
      setAllContent(null);
      setCurrentContent(null);
      clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {
        fetchAllContent();
      }, 400); // Wait 400ms for backend to update
    }
    window.addEventListener('tag-modal-closed', handleTagModalClosed);
    window.addEventListener('gallery-content-updated', handleTagModalClosed);

    function handleRatingsUpdated(event) {
      const { filePath, videoRating, funscriptRating } = event.detail || {};
      if (!filePath) return;

      setAllContent(prev => {
        if (!prev) return prev;
        let changed = false;
        const updateList = (list = []) => list.map(item => {
          const itemPath = item.filePath || item.path;
          if (itemPath === filePath) {
            const nextItem = {
              ...item,
              videoRating: videoRating !== undefined ? videoRating : item.videoRating,
              funscriptRating: funscriptRating !== undefined ? funscriptRating : item.funscriptRating,
            };
            if (nextItem.videoRating !== item.videoRating || nextItem.funscriptRating !== item.funscriptRating) {
              changed = true;
              return nextItem;
            }
          }
          return item;
        });
        const nextVids = updateList(prev.vids);
        const nextFunscriptVids = updateList(prev.funscriptVids);

        if (!changed) return prev;

        return {
          ...prev,
          vids: nextVids,
          funscriptVids: nextFunscriptVids,
        };
      });
    }

    window.addEventListener('ratings-updated', handleRatingsUpdated);
    return () => {
      window.removeEventListener('tag-modal-closed', handleTagModalClosed);
      window.removeEventListener('gallery-content-updated', handleTagModalClosed);
      window.removeEventListener('ratings-updated', handleRatingsUpdated);
      clearTimeout(refreshTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryType, galleryName, basePath]);

  // Track if we need to refetch for duration sorting
  const [lastDurationFetch, setLastDurationFetch] = useState(null);

  // Fetch pairwise ELO scores when needed for sorting
  useEffect(() => {
    if (sortBy !== 'pairwise_score' || !performerData?.id) return;
    if (pairwiseScores) return; // Already loaded

    const fetchScores = async () => {
      try {
        const res = await fetch(`/api/pairwise/image-rankings?performer_id=${performerData.id}`);
        if (res.ok) {
          const data = await res.json();
          const scoreMap = {};
          (data.images || []).forEach(img => {
            scoreMap[img.path] = img.score;
          });
          setPairwiseScores(scoreMap);
        }
      } catch (err) {
        console.warn('[UnifiedGallery] Failed to fetch pairwise scores:', err);
      }
    };
    fetchScores();
  }, [sortBy, performerData, pairwiseScores]);

  // Reset pairwise scores when performer changes
  useEffect(() => {
    setPairwiseScores(null);
  }, [galleryName]);

  // Filter in frontend when toggling showTaggedMode or sorting changes  
  useEffect(() => {
    if (allContent) {
      // For duration sorting, we need duration data from backend
      // If sorting by duration and we don't have duration data, refetch
      if (sortBy === 'duration') {
        const hasDurationData = allContent.vids?.some(v => v.duration !== undefined) ||
          allContent.funscriptVids?.some(v => v.duration !== undefined);
        if (!hasDurationData && lastDurationFetch !== `${galleryType}-${galleryName}-duration`) {
          setLastDurationFetch(`${galleryType}-${galleryName}-duration`);
          fetchAllContent(sortBy, sortOrder);
          return;
        }
      }

      // Attach pairwise scores to pics if available
      let dataWithScores = allContent;
      if (pairwiseScores && Object.keys(pairwiseScores).length > 0) {
        dataWithScores = {
          ...allContent,
          pics: allContent.pics.map(pic => ({
            ...pic,
            _pairwiseScore: pairwiseScores[pic.path] ?? null
          }))
        };
      }

      let filteredContent = filterContent(dataWithScores, showTaggedMode, activeFilters);
      filteredContent = sortContent(filteredContent, sortBy, sortOrder);
      setCurrentContent(filteredContent);
    }
    // eslint-disable-next-line
  }, [showTaggedMode, allContent, sortBy, sortOrder, activeFilters, pairwiseScores]);


  // Fetch all files (physical + tagged) for the gallery
  const fetchAllContent = async (sortByParam = 'name', sortOrderParam = 'asc') => {
    setLoading(true);
    try {
      if (galleryType === 'performer' && performerData?.id) {
        // FAST PATH: Use specialized endpoints
        const [imagesParams, videosParams] = await Promise.all([
          fetch(`/api/performers/${performerData.id}/gallery/images`),
          fetch(`/api/performers/${performerData.id}/gallery/videos`)
        ]);

        const imagesData = await imagesParams.json();
        const videosData = await videosParams.json();

        const pics = (imagesData.pics || []).map(item => ({
          ...item,
          url: `/api/files/raw?path=${encodeURIComponent(item.path)}`,
          thumbnail: `/api/files/preview?path=${encodeURIComponent(item.path)}`,
          type: 'image'
        }));

        const allVids = (videosData.vids || []).map(item => ({
          ...item,
          url: `/api/files/raw?path=${encodeURIComponent(item.path)}`,
          thumbnail: `/api/files/video-thumbnail?path=${encodeURIComponent(item.path)}`,
          type: 'video'
        }));

        // Split videos
        const vids = [];
        const funscriptVids = [];

        allVids.forEach(v => {
          // Simple heuristic based on folder structure
          // If path contains "funscript" folder, treat as funscript video
          // Note: backend scanner implementation might need detailed check, 
          // but checking string path is fast and 99% accurate for this structure.
          if (v.path.includes('funscript') || v.path.includes('Funscript')) {
            v.type = 'funscript_video';
            funscriptVids.push(v);
          } else {
            vids.push(v);
          }
        });

        const data = { pics, vids, funscriptVids };
        setAllContent(data);
        setCurrentContent(filterContent(data, showTaggedMode, activeFilters));
        setLoading(false);
        return;
      }

      // LEGACY / GENRE PATH
      let apiUrl;
      const cacheBust = `t=${Date.now()}`;
      const sortParams = `sortBy=${sortByParam}&sortOrder=${sortOrderParam}`;
      if (galleryType === 'performer') {
        apiUrl = `/api/gallery/performer-name/${encodeURIComponent(galleryName)}?basePath=${encodeURIComponent(basePath)}&${cacheBust}&${sortParams}`;
      } else if (galleryType === 'genre') {
        // Always fetch all (physical + tagged) for genre
        apiUrl = `/api/gallery/genre/${encodeURIComponent(galleryName)}?basePath=${encodeURIComponent(basePath)}&${cacheBust}&${sortParams}`;
      }
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error('Failed to parse response:', responseText);
        throw e;
      }
      // Defensive: always provide arrays for all tabs
      data.pics = Array.isArray(data.pics) ? data.pics : [];
      data.vids = Array.isArray(data.vids) ? data.vids : [];
      data.funscriptVids = Array.isArray(data.funscriptVids) ? data.funscriptVids : [];
      // Mark physical vs virtual for filtering
      const genrePath = galleryType === 'genre' ? `/content/${galleryName}` : null;
      ['pics', 'vids', 'funscriptVids'].forEach(type => {
        data[type] = data[type].map(rawItem => {
          // The tiles and the player need path / type / url / thumbnail on every
          // item; this endpoint does not always send all four.
          const itemPath = rawItem.path || rawItem.filePath;
          const encodedPath = encodeURIComponent(itemPath || '');
          const item = {
            ...rawItem,
            path: itemPath,
            type: TAB_ITEM_TYPES[type],
            url: rawItem.url || `/api/files/raw?path=${encodedPath}`,
            thumbnail: rawItem.thumbnail
              || `/api/files/${type === 'pics' ? 'preview' : 'video-thumbnail'}?path=${encodedPath}`,
          };
          // If item.virtual is true, it's tagged-only; else, physical
          if (item.virtual) return { ...item, _isVirtual: true };
          // For physical, check if path starts with genrePath (for genre galleries)
          if (genrePath && item.path && !item.virtual) {
            if (item.path.replace(/\\/g, '/').includes(genrePath)) {
              return { ...item, _isVirtual: false };
            }
          }
          return { ...item, _isVirtual: false };
        });
      });
      setAllContent(data);
      setCurrentContent(filterContent(data, showTaggedMode, activeFilters));
      setLoading(false);
    } catch (error) {
      setError('Error loading content');
      setLoading(false);
    }
  };

  // Filter content in memory based on showTaggedMode and tag filters
  function filterContent(data, mode, { includeTags = [], excludeTags = [], scoreFilters: scoreRanges } = {}) {
    if (!data) return null;
    // 0: all, 1: only physical, 2: only tagged
    const filterFn = mode === 0
      ? () => true
      : mode === 1
        ? (item) => !item._isVirtual
        : (item) => item._isVirtual;
    const normalizeTag = (tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : tag);
    const includeNormalized = includeTags.map(normalizeTag).filter(Boolean);
    const excludeNormalized = excludeTags.map(normalizeTag).filter(Boolean);

    // include = must carry every included tag, exclude = must carry none of
    // the excluded ones; both apply together.
    const tagFn = (item) => {
      const normalizedItemTags = extractTagStrings(item.tags).map(normalizeTag);

      if (includeNormalized.length
        && !includeNormalized.every(tag => normalizedItemTags.includes(tag))) {
        return false;
      }

      if (excludeNormalized.length
        && excludeNormalized.some(tag => normalizedItemTags.includes(tag))) {
        return false;
      }

      return true;
    };
    const passesRange = (value, range) => {
      if (!range) return true;
      const { min, max } = range;
      const hasMin = min !== null && min !== undefined;
      const hasMax = max !== null && max !== undefined;
      if (!hasMin && !hasMax) return true;
      if (value === null || value === undefined) return false;
      const numeric = Number(value);
      if (Number.isNaN(numeric)) return false;
      if (hasMin && numeric < min) return false;
      if (hasMax && numeric > max) return false;
      return true;
    };

    const scoreFn = (item, type) => {
      if (!scoreRanges) return true;
      if ((type === 'vids' || type === 'funscriptVids') && scoreRanges.video) {
        if (!passesRange(item.videoRating, scoreRanges.video)) {
          return false;
        }
      }
      if (type === 'funscriptVids' && scoreRanges.funscript) {
        if (!passesRange(item.funscriptRating, scoreRanges.funscript)) {
          return false;
        }
      }
      return true;
    };

    const applyFilters = (item, type) => filterFn(item) && tagFn(item) && scoreFn(item, type);
    return {
      ...data,
      pics: data.pics.filter(item => applyFilters(item, 'pics')),
      vids: data.vids.filter(item => applyFilters(item, 'vids')),
      funscriptVids: data.funscriptVids.filter(item => applyFilters(item, 'funscriptVids')),
    };
  }

  const handleTagToggle = (tag) => {
    setTagStates(prev => {
      const current = prev[tag] || 'neutral';
      const nextState = current === 'neutral' ? 'include' : current === 'include' ? 'exclude' : 'neutral';
      return {
        ...prev,
        [tag]: nextState,
      };
    });
  };

  const handleClearTags = () => {
    setTagStates(prev => {
      const next = {};
      Object.keys(prev).forEach(tag => {
        next[tag] = 'neutral';
      });
      return next;
    });
  };

  const handleReverseTags = () => {
    setTagStates(prev => {
      const next = {};
      Object.entries(prev).forEach(([tag, state]) => {
        if (state === 'include') {
          next[tag] = 'exclude';
        } else if (state === 'exclude') {
          next[tag] = 'include';
        } else {
          next[tag] = 'neutral';
        }
      });
      return next;
    });
  };

  const handleScoreFilterChange = (type, bound, rawValue) => {
    setScoreFilters(prev => {
      const parsed = rawValue === '' ? null : Number(rawValue);
      if (rawValue !== '' && (Number.isNaN(parsed) || parsed < 0)) {
        return prev;
      }

      const clamped = parsed === null ? null : Math.min(10, Math.max(0, parsed));
      const nextRange = {
        ...prev[type],
        [bound]: clamped,
      };

      if (nextRange.min !== null && nextRange.max !== null && nextRange.min > nextRange.max) {
        if (bound === 'min') {
          nextRange.max = clamped;
        } else {
          nextRange.min = clamped;
        }
      }

      return {
        ...prev,
        [type]: nextRange,
      };
    });
  };

  const handleClearScoreFilter = (type) => {
    setScoreFilters(prev => ({
      ...prev,
      [type]: { min: null, max: null },
    }));
  };

  // Sort content in memory
  function sortContent(data, sortBy, sortOrder) {
    if (!data) return null;

    const getSortValue = (item, sortBy) => {
      switch (sortBy) {
        case 'name':
          return item.name || '';
        case 'size':
          return item.size || 0;
        case 'date':
          return item.modified || 0;
        case 'duration':
          return item.duration || 0;
        case 'funscript_count':
          return item.funscriptCount || 0;
        case 'video_rating':
          return item.videoRating ?? null;
        case 'funscript_rating':
          return item.funscriptRating ?? null;
        case 'pairwise_score':
          return item._pairwiseScore ?? null;
        default:
          return item.name || '';
      }
    };

    const sortFn = (a, b) => {
      const aVal = getSortValue(a, sortBy);
      const bVal = getSortValue(b, sortBy);

      let compareValue = 0;
      if (typeof aVal === 'string') {
        compareValue = aVal.localeCompare(bVal);
      } else {
        if (sortBy === 'video_rating' || sortBy === 'funscript_rating' || sortBy === 'pairwise_score') {
          const transform = (val) => {
            if (val === null || val === undefined) {
              return sortOrder === 'asc' ? Number.POSITIVE_INFINITY : -1;
            }
            return Number(val);
          };
          compareValue = transform(aVal) - transform(bVal);
        } else {
          compareValue = aVal - bVal;
        }
      }

      return sortOrder === 'desc' ? -compareValue : compareValue;
    };

    return {
      ...data,
      pics: [...data.pics].sort(sortFn),
      vids: [...data.vids].sort(sortFn),
      funscriptVids: [...data.funscriptVids].sort(sortFn),
    };
  }

  useEffect(() => {
    const allowedSorts = new Set(['name', 'size', 'date']);
    // Pairwise ELO sort is always available on the Pics tab
    if (currentTab === 0 && galleryType === 'performer') {
      allowedSorts.add('pairwise_score');
    }
    if (currentTab !== 0) {
      allowedSorts.add('duration');
      allowedSorts.add('video_rating');
      if (currentTab === 2) {
        allowedSorts.add('funscript_rating');
        allowedSorts.add('funscript_count');
      }
    }

    if (!allowedSorts.has(sortBy)) {
      setSortBy('name');
      setSortOrder('asc');
    }
  }, [currentTab, sortBy, galleryType]);

  const handleSortChange = (event) => {
    const value = event.target.value;
    const [sortField, order] = value.includes('-desc')
      ? [value.replace('-desc', ''), 'desc']
      : [value, 'asc'];
    setSortBy(sortField);
    setSortOrder(order);
  };

  const sortOptions = useMemo(() => {
    const options = [
      ['name', 'Name (A-Z)'],
      ['name-desc', 'Name (Z-A)'],
      ['size', 'Size (Small-Large)'],
      ['size-desc', 'Size (Large-Small)'],
      ['date', 'Date (Old-New)'],
      ['date-desc', 'Date (New-Old)'],
    ];
    if (currentTab !== 0) {
      options.push(
        ['duration', 'Duration (Short-Long)'],
        ['duration-desc', 'Duration (Long-Short)'],
        ['video_rating', 'Video Score (Low-High)'],
        ['video_rating-desc', 'Video Score (High-Low)'],
      );
    }
    if (currentTab === 0 && galleryType === 'performer') {
      options.push(
        ['pairwise_score', 'ELO Score (Low-High)'],
        ['pairwise_score-desc', 'ELO Score (High-Low)'],
      );
    }
    if (currentTab === 2) {
      options.push(
        ['funscript_rating', 'Funscript Score (Low-High)'],
        ['funscript_rating-desc', 'Funscript Score (High-Low)'],
        ['funscript_count', 'Funscript Count (Low-High)'],
        ['funscript_count-desc', 'Funscript Count (High-Low)'],
      );
    }
    return options;
  }, [currentTab, galleryType]);

  const handleRemoveTagFilter = useCallback((tag) => {
    setTagStates(prev => ({ ...prev, [tag]: 'neutral' }));
  }, []);

  const handleSizeChange = useCallback((nextSize) => {
    setTileSize(nextSize);
    try {
      localStorage.setItem(SIZE_KEY, String(nextSize));
    } catch (error) {
      console.warn('Failed to persist thumbnail size:', error);
    }
  }, []);

  const closeFilters = useCallback(() => setShowFilterPanel(false), []);

  const handleRank = () => {
    const params = new URLSearchParams({
      performerId: performerData.id,
      performerName: performerData.name || galleryName,
      basePath: basePath || ''
    });
    window.open(`/pairwise-rank?${params.toString()}`, '_blank');
  };

  // Items of the current tab, already filtered + sorted.
  const tabItems = useMemo(
    () => (currentContent ? currentContent[TAB_KEYS[currentTab]] || [] : []),
    [currentContent, currentTab]
  );

  // Incremental rendering: start over with one batch whenever the view
  // (tab / sort / filters) changes; MasonryGrid asks for more near the bottom.
  const viewKey = [
    currentTab, sortBy, sortOrder, showTaggedMode,
    JSON.stringify([activeFilters.includeTags, activeFilters.excludeTags, scoreFilters]),
  ].join('|');
  const lastViewKeyRef = useRef(viewKey);
  useEffect(() => {
    if (lastViewKeyRef.current === viewKey) return;
    lastViewKeyRef.current = viewKey;
    setRenderCount(RENDER_BATCH);
  }, [viewKey]);

  const handleNeedMore = useCallback(() => {
    setRenderCount(prev => prev + RENDER_BATCH);
  }, []);

  // Back from the player: render as many tiles as before, then scroll to where
  // the user was. The document grows over a few frames (grid measures itself
  // first), so wait until it is tall enough.
  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending || loading || !currentContent) return;
    pendingRestoreRef.current = null;
    setRenderCount(prev => Math.max(prev, pending.count));
    let tries = 0;
    const tick = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll >= pending.scrollY || tries >= 30) {
        window.scrollTo(0, pending.scrollY);
        return;
      }
      tries += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [loading, currentContent]);

  // Everything openItem needs, read at click time so the callback stays stable
  // and the memoised tiles don't re-render when unrelated state changes.
  const openStateRef = useRef(null);
  openStateRef.current = {
    items: tabItems,
    tab: currentTab,
    count: renderCount,
    title: galleryName,
    backUrl: `${location.pathname}${location.search}`,
    preferencesKey,
  };

  const openItem = useCallback((index) => {
    const state = openStateRef.current;
    const item = state.items[index];
    if (!item) return;

    try {
      sessionStorage.setItem(`unifiedGalleryReturn:${state.preferencesKey}`, JSON.stringify({
        scrollY: window.scrollY,
        count: state.count,
        tab: state.tab,
      }));
    } catch (error) {
      console.warn('Failed to save gallery position:', error);
    }

    let target;
    try {
      const contextId = savePlayerContext({
        title: state.title,
        backUrl: state.backUrl,
        items: state.items.map(toMediaItem),
      });
      target = playerUrl(contextId, index);
    } catch (error) {
      // e.g. sessionStorage quota on a huge list — still open the file itself.
      console.warn('Failed to save player context, opening the single file:', error);
      target = `/player?path=${encodeURIComponent(item.path)}`;
    }
    navigate(target);
  }, [navigate]);

  // The app bar above is sticky and wraps on narrow screens; keep the gallery
  // toolbar glued to its bottom edge whatever height it has.
  useEffect(() => {
    const root = rootRef.current;
    const appBar = document.querySelector('.MuiAppBar-root');
    if (!root || !appBar) return undefined;
    const update = () => {
      const position = window.getComputedStyle(appBar).position;
      const pinned = position === 'sticky' || position === 'fixed';
      root.style.setProperty('--ug-top', pinned ? `${Math.round(appBar.getBoundingClientRect().height)}px` : '0px');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(appBar);
    return () => observer.disconnect();
  }, []);

  const isPerformer = galleryType === 'performer';
  const counts = {
    pics: currentContent?.pics?.length || 0,
    vids: currentContent?.vids?.length || 0,
    funscripts: currentContent?.funscriptVids?.length || 0,
  };

  let body;
  if (loading) {
    body = <div className="ug-state">Loading...</div>;
  } else if (error) {
    body = <div className="ug-state bad">{error}</div>;
  } else {
    body = (
      <>
        <GalleryHero
          name={galleryName}
          isPerformer={isPerformer}
          performer={performerData}
          age={performerData ? calculateCurrentAge(performerData.age, performerData.scraped_at) : null}
          counts={counts}
        />
        <GalleryToolbar
          tab={currentTab}
          onTabChange={setCurrentTab}
          tabCounts={[counts.pics, counts.vids, counts.funscripts]}
          showTaggedMode={galleryType === 'genre'}
          taggedMode={showTaggedMode}
          onTaggedModeChange={setShowTaggedMode}
          sortValue={`${sortBy}${sortOrder === 'desc' ? '-desc' : ''}`}
          sortOptions={sortOptions}
          onSortChange={handleSortChange}
          filterCount={totalActiveFilters}
          filtersOpen={showFilterPanel}
          onOpenFilters={() => setShowFilterPanel(true)}
          showRank={isPerformer}
          rankEnabled={currentTab === 0 && Boolean(performerData?.id)}
          onRank={handleRank}
          size={tileSize}
          minSize={SIZE_MIN}
          maxSize={SIZE_MAX}
          onSizeChange={handleSizeChange}
        />
        <ActiveFilters
          includeTags={activeFilters.includeTags}
          excludeTags={activeFilters.excludeTags}
          scoreFilters={scoreFilters}
          scoreActive={scoreFilterActivity}
          onRemoveTag={handleRemoveTagFilter}
          onClearScore={handleClearScoreFilter}
        />
        <MasonryGrid
          items={tabItems}
          tab={currentTab}
          size={tileSize}
          count={renderCount}
          showElo={sortBy === 'pairwise_score'}
          onNeedMore={handleNeedMore}
          onOpen={openItem}
          emptyText={totalActiveFilters > 0 ? 'Nothing matches these filters.' : 'Nothing here yet.'}
        />
        <FilterDrawer
          open={showFilterPanel}
          onClose={closeFilters}
          availableTags={availableTags}
          tagStates={tagStates}
          tagActiveCount={activeFilters.tagActiveCount}
          onToggleTag={handleTagToggle}
          onClearTags={handleClearTags}
          onReverseTags={handleReverseTags}
          scoreFilters={scoreFilters}
          scoreActive={scoreFilterActivity}
          onScoreChange={handleScoreFilterChange}
          onClearScore={handleClearScoreFilter}
        />
      </>
    );
  }

  return (
    <div className="ug" ref={rootRef}>
      <div className="ug-inner">{body}</div>
    </div>
  );
};

export default UnifiedGallery;
