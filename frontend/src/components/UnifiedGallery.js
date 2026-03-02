import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import './UnifiedGallery.css';
import '../utils/FunscriptPlayer.js'; // Import to register custom elements
import { ensureFlag } from '../utils/countryFlags';
import FlagEmoji from './FlagEmoji';

const UnifiedGallery = ({ handyIntegration, handyCode, handyConnected }) => {
  const [searchParams] = useSearchParams();
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

  useEffect(() => {
    if (activeFilters.tagActiveCount > 0) {
      console.log('[UnifiedGallery] Active tag filters:', activeFilters);
    }
  }, [activeFilters]);

  // Debug props
  useEffect(() => {
    console.log('🔍 UnifiedGallery props:', {
      handyConnected,
      handyCode,
      handyIntegration: !!handyIntegration
    });
  }, [handyConnected, handyCode, handyIntegration]);

  // Check localStorage for persisted connection state
  useEffect(() => {
    const storedConnected = localStorage.getItem('handyConnected') === 'true';
    const storedCode = localStorage.getItem('handyCode') || '';

    console.log('💾 Stored connection state:', { storedConnected, storedCode });

    // Use stored state if props don't indicate connection
    const effectiveConnected = handyConnected || storedConnected;
    const effectiveCode = handyCode || storedCode;

    window.appHandyConnected = effectiveConnected;
    console.log('🌐 UnifiedGallery: Set global Handy connection state:', effectiveConnected);

    // Try to restore connection if we have a code but aren't connected
    if (effectiveCode && !effectiveConnected && window.Handy) {
      console.log('🔄 Attempting to restore Handy connection from localStorage...');
      initializeAndConnect(effectiveCode);
    }
  }, [handyConnected, handyCode, handyIntegration]);

  const initializeAndConnect = async (connectionCode) => {
    try {
      // Use the HandyIntegration instance instead of direct SDK
      if (handyIntegration) {
        console.log('🔄 Using HandyIntegration for connection restoration...');
        const success = await handyIntegration.connect(connectionCode);
        if (success) {
          window.appHandyConnected = true;
          localStorage.setItem('handyConnected', 'true');
          console.log('✅ Handy connection restored via HandyIntegration');
        } else {
          console.warn('❌ Failed to restore Handy connection via HandyIntegration');
        }
      } else {
        // Fallback to direct SDK if HandyIntegration not available
        if (!window.handyInstance && window.Handy) {
          window.handyInstance = window.Handy.init();
          console.log('✅ Handy SDK initialized in UnifiedGallery');
        }

        if (window.handyInstance) {
          const result = await window.handyInstance.connect(connectionCode);
          if (result === window.Handy.ConnectResult.CONNECTED) {
            window.appHandyConnected = true;
            localStorage.setItem('handyConnected', 'true');
            console.log('✅ Handy connection restored in UnifiedGallery');
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

    hasLoadedPrefsRef.current = true;
    setPrefsLoaded(true);
  }, [preferencesKey]);

  useEffect(() => {
    if (totalActiveFilters > 0) {
      setShowFilterPanel(true);
    }
  }, [totalActiveFilters]);

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
  }, [galleryType, galleryName, basePath]);

  // Track if we need to refetch for duration sorting
  const [lastDurationFetch, setLastDurationFetch] = useState(null);

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
      let filteredContent = filterContent(allContent, showTaggedMode, activeFilters);
      filteredContent = sortContent(filteredContent, sortBy, sortOrder);
      setCurrentContent(filteredContent);
    }
    // eslint-disable-next-line
  }, [showTaggedMode, allContent, sortBy, sortOrder, activeFilters]);


  // Fetch all files (physical + tagged) for the gallery
  const fetchAllContent = async (sortByParam = 'name', sortOrderParam = 'asc') => {
    setLoading(true);
    try {
      if (galleryType === 'performer' && performerData?.id) {
        // FAST PATH: Use specialized endpoints
        console.log('[UnifiedGallery] Using Fast API for Performer:', performerData.name);

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
      console.log('[UnifiedGallery] Fetching ALL (Legacy/Genre):', apiUrl);
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
        data[type] = data[type].map(item => {
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
      const debugSample = (data.vids || []).slice(0, 5).map(item => ({
        name: item.name,
        tags: item.tags,
        normalized: extractTagStrings(item.tags).map(tag => tag.toLowerCase()),
      }));
      console.log('[UnifiedGallery] Sample video tags:', debugSample);
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

    if (includeNormalized.length > 0 && excludeNormalized.length > 0) {
      return {
        ...data,
        pics: [],
        vids: [],
        funscriptVids: [],
      };
    }

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

  const isScoreFilterActive = (type) => {
    const range = scoreFilters[type];
    if (!range) return false;
    return range.min !== null && range.min !== undefined || range.max !== null && range.max !== undefined;
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
        if (sortBy === 'video_rating' || sortBy === 'funscript_rating') {
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

  const switchTab = (tabIndex) => {
    setCurrentTab(tabIndex);
  };

  useEffect(() => {
    const allowedSorts = new Set(['name', 'size', 'date']);
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
  }, [currentTab, sortBy]);

  const handleSortChange = (event) => {
    const value = event.target.value;
    const [sortField, order] = value.includes('-desc')
      ? [value.replace('-desc', ''), 'desc']
      : [value, 'asc'];
    setSortBy(sortField);
    setSortOrder(order);
  };

  const formatRating = (rating) => {
    if (rating === null || rating === undefined) return '–';
    const formatted = Number(rating).toFixed(1);
    return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
  };

  const renderContent = () => {
    if (!currentContent) return null;

    let items = [];
    if (currentTab === 0) {
      items = currentContent.pics;
    } else if (currentTab === 1) {
      items = currentContent.vids;
    } else if (currentTab === 2) {
      items = currentContent.funscriptVids;
    }

    return items.map((item, index) => (
      <div key={index} className="gallery-item">
        {currentTab === 0 ? (
          // Pictures - use funscript-image with tagassign
          <>
            <funscript-image
              src={item.url}
              mode="modal"
              view="stretch"
              tagassign="true"
            ></funscript-image>
            <div className="gallery-item-overlay"></div>
            <div className="gallery-item-info">
              <div className="gallery-item-title">{item.name}</div>
              <div className="gallery-item-meta">
                <span className="gallery-item-size">{item.sizeFormatted}</span>
              </div>
            </div>
          </>
        ) : (
          // Videos (tab 1) and Funscript Videos (tab 2) - use funscript-player with tagassign and scenemanager
          <>
            <funscript-player
              src={item.url}
              type="video"
              mode="modal"
              view="stretch"
              funscriptmode="true"
              filtermode="true"
              loopmode="true"
              tagassign="true"
              scenemanager="true"
            ></funscript-player>
            <div className="gallery-item-overlay"></div>
            <div className="gallery-item-info">
              <div className="gallery-item-title">{item.name}</div>
              <div className="gallery-item-meta">
                <span className="gallery-item-size">{item.sizeFormatted}</span>
                {item.funscriptCount !== undefined && (
                  <span
                    className="funscript-badge"
                    style={{
                      backgroundColor: item.missingFunscripts || item.funscriptCount === 0 ? '#ff4444' : '#4caf50',
                      color: '#ffffff',
                      fontWeight: 'bold',
                      padding: '2px 6px',
                      borderRadius: '3px'
                    }}
                  >
                    {item.funscriptCount} funscripts
                  </span>
                )}
              </div>
              <div className="gallery-item-ratings">
                <span className={`rating-chip${item.videoRating == null ? ' rating-chip--empty' : ''}`}>
                  ⭐ {formatRating(item.videoRating)}
                </span>
                {currentTab === 2 && (
                  <span className={`rating-chip rating-chip--funscript${item.funscriptRating == null ? ' rating-chip--empty' : ''}`}>
                    🎵 {formatRating(item.funscriptRating)}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    ));
  };

  if (loading) {
    return (
      <div className="unified-gallery">
        <div className="container">
          <div className="loading">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="unified-gallery">
        <div className="container">
          <div className="loading">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="unified-gallery">
      <div className="container">
        <div className="header">
          <h1 className="gallery-title">{galleryName}</h1>
          <div className="stats">
            <div className="stat">{currentContent?.pics?.length || 0} pics</div>
            <div className="stat">{currentContent?.vids?.length || 0} videos</div>
            <div className="stat">{currentContent?.funscriptVids?.length || 0} funscripts</div>
          </div>
        </div>

        {/* Performer Info Section */}
        {galleryType === 'performer' && performerData && (performerData.age || performerData.born || performerData.birthplace || performerData.orientation || performerData.height || performerData.weight || performerData.measurements || performerData.body_type || performerData.hair_color || performerData.eye_color || performerData.ethnicity) && (
          <div className="performer-info" style={{
            background: 'rgba(25, 25, 25, 0.9)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '20px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '15px'
          }}>
            {/* Personal Info */}
            {(performerData.age || performerData.born || performerData.birthplace || performerData.orientation) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h3 style={{ margin: '0 0 10px 0', color: '#2196f3', fontSize: '1.1rem', borderBottom: '2px solid #2196f3', paddingBottom: '5px' }}>Personal Info</h3>
                {performerData.age && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Age:</span>
                    <span style={{ color: 'white', fontWeight: 'bold' }}>{calculateCurrentAge(performerData.age, performerData.scraped_at)} years old</span>
                  </div>
                )}
                {performerData.born && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Born:</span>
                    <span style={{ color: 'white', fontWeight: 'bold' }}>{performerData.born}</span>
                  </div>
                )}
                {performerData.birthplace && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Birthplace:</span>
                    <span style={{ color: 'white', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {ensureFlag(performerData.country_flag) && (
                        <FlagEmoji
                          countryCode={ensureFlag(performerData.country_flag)}
                          size="1.5rem"
                        />
                      )}
                      <span>{performerData.birthplace}</span>
                    </span>
                  </div>
                )}
                {performerData.orientation && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Orientation:</span>
                    <span style={{ color: 'white', fontWeight: 'bold' }}>{performerData.orientation}</span>
                  </div>
                )}
              </div>
            )}

            {/* Physical Attributes */}
            {(performerData.height || performerData.weight || performerData.measurements || performerData.body_type) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h3 style={{ margin: '0 0 10px 0', color: '#4caf50', fontSize: '1.1rem', borderBottom: '2px solid #4caf50', paddingBottom: '5px' }}>Physical Attributes</h3>
                {performerData.height && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Height:</span>
                    <span style={{ color: 'white', fontWeight: 'bold' }}>{performerData.height}</span>
                  </div>
                )}
                {performerData.weight && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Weight:</span>
                    <span style={{ color: 'white', fontWeight: 'bold' }}>{performerData.weight}</span>
                  </div>
                )}
                {performerData.measurements && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Measurements:</span>
                    <span style={{ color: 'white', fontWeight: 'bold' }}>{performerData.measurements}</span>
                  </div>
                )}
                {performerData.body_type && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Body Type:</span>
                    <span style={{ color: 'white', fontWeight: 'bold' }}>{performerData.body_type}</span>
                  </div>
                )}
              </div>
            )}

            {/* Appearance */}
            {(performerData.hair_color || performerData.eye_color || performerData.ethnicity) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h3 style={{ margin: '0 0 10px 0', color: '#ff9800', fontSize: '1.1rem', borderBottom: '2px solid #ff9800', paddingBottom: '5px' }}>Appearance</h3>
                {performerData.hair_color && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Hair:</span>
                    <span style={{ color: 'white', fontWeight: 'bold' }}>{performerData.hair_color}</span>
                  </div>
                )}
                {performerData.eye_color && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Eyes:</span>
                    <span style={{ color: 'white', fontWeight: 'bold' }}>{performerData.eye_color}</span>
                  </div>
                )}
                {performerData.ethnicity && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Ethnicity:</span>
                    <span style={{ color: 'white', fontWeight: 'bold' }}>{performerData.ethnicity}</span>
                  </div>
                )}
              </div>
            )}

            {/* Tags */}
            {performerData.scraped_tags && (() => {
              try {
                const tags = JSON.parse(performerData.scraped_tags);
                if (Array.isArray(tags) && tags.length > 0) {
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                      <h3 style={{ margin: '0 0 10px 0', color: '#e91e63', fontSize: '1.1rem', borderBottom: '2px solid #e91e63', paddingBottom: '5px' }}>Tags</h3>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {tags.map((tag, index) => (
                          <span key={index} style={{
                            background: 'rgba(233, 30, 99, 0.2)',
                            border: '1px solid rgba(233, 30, 99, 0.5)',
                            borderRadius: '4px',
                            padding: '4px 12px',
                            color: '#e91e63',
                            fontSize: '0.9rem',
                            fontWeight: 'bold'
                          }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                }
              } catch (e) { }
              return null;
            })()}
          </div>
        )}

        <div className="controls">
          <div className="tabs">
            <button
              className={`tab ${currentTab === 0 ? 'active' : ''}`}
              onClick={() => switchTab(0)}
            >
              Pictures ({currentContent?.pics?.length || 0})
            </button>
            <button
              className={`tab ${currentTab === 1 ? 'active' : ''}`}
              onClick={() => switchTab(1)}
            >
              Videos ({currentContent?.vids?.length || 0})
            </button>
            <button
              className={`tab ${currentTab === 2 ? 'active' : ''}`}
              onClick={() => switchTab(2)}
            >
              Funscripts ({currentContent?.funscriptVids?.length || 0})
            </button>
            {galleryType === 'genre' && (
              <button
                className={`tab showtagged-mode-${showTaggedMode}`}
                style={{
                  marginLeft: 10,
                  background: showTaggedMode === 0 ? '#1976d2' : showTaggedMode === 1 ? '#388e3c' : '#fbc02d',
                  color: showTaggedMode === 2 ? '#333' : '#fff',
                  fontWeight: 'bold',
                  border: '2px solid #1976d2',
                  transition: 'background 0.2s, color 0.2s',
                }}
                onClick={() => setShowTaggedMode((showTaggedMode + 1) % 3)}
                title={
                  showTaggedMode === 0 ? 'Show all files (physical and tagged)' :
                    showTaggedMode === 1 ? 'Show only files physically in this folder' :
                      'Show only files with this tag (not physically in folder)'
                }
              >
                {showTaggedMode === 0 && 'All'}
                {showTaggedMode === 1 && 'Folder'}
                {showTaggedMode === 2 && 'Tag'}
              </button>
            )}
          </div>

          <div className="control-actions">
            <div className="sort-controls">
              <label htmlFor="sortBy">Sort by:</label>
              <select
                id="sortBy"
                className="sort-select"
                value={`${sortBy}${sortOrder === 'desc' ? '-desc' : ''}`}
                onChange={handleSortChange}
              >
                <option value="name">Name (A-Z)</option>
                <option value="name-desc">Name (Z-A)</option>
                <option value="size">Size (Small-Large)</option>
                <option value="size-desc">Size (Large-Small)</option>
                <option value="date">Date (Old-New)</option>
                <option value="date-desc">Date (New-Old)</option>
                {currentTab !== 0 && (
                  <>
                    <option value="duration">Duration (Short-Long)</option>
                    <option value="duration-desc">Duration (Long-Short)</option>
                    <option value="video_rating">Video Score (Low-High)</option>
                    <option value="video_rating-desc">Video Score (High-Low)</option>
                  </>
                )}
                {currentTab === 2 && (
                  <>
                    <option value="funscript_rating">Funscript Score (Low-High)</option>
                    <option value="funscript_rating-desc">Funscript Score (High-Low)</option>
                    <option value="funscript_count">Funscript Count (Low-High)</option>
                    <option value="funscript_count-desc">Funscript Count (High-Low)</option>
                  </>
                )}
              </select>
            </div>
            <button
              type="button"
              className={`filter-toggle${showFilterPanel ? ' filter-toggle--active' : ''}${totalActiveFilters ? ' filter-toggle--has-active' : ''}`}
              onClick={() => setShowFilterPanel(prev => !prev)}
            >
              Filters{totalActiveFilters ? ` (${totalActiveFilters})` : ''}
            </button>
          </div>
        </div>

        {showFilterPanel && (
          <div className="filter-panel">
            <div className="filter-controls">
              <div className="filter-header">
                <label>Filter tags:</label>
                <div className="tag-filter-actions">
                  <button
                    type="button"
                    className="tag-filter-btn"
                    onClick={handleClearTags}
                    disabled={activeFilters.tagActiveCount === 0}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="tag-filter-btn"
                    onClick={handleReverseTags}
                    disabled={activeFilters.tagActiveCount === 0}
                  >
                    Reverse
                  </button>
                </div>
              </div>
              <div className="tag-chips">
                {availableTags.length === 0 && (
                  <span className="tag-chip tag-chip--empty-state">No tags available</span>
                )}
                {availableTags.map(tag => {
                  const state = tagStates[tag] || 'neutral';
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`tag-chip tag-chip--${state}`}
                      onClick={() => handleTagToggle(tag)}
                      title={
                        state === 'neutral'
                          ? 'Click to include this tag'
                          : state === 'include'
                            ? 'Click to exclude this tag'
                            : 'Click to clear this tag filter'
                      }
                    >
                      <span className="tag-chip__indicator">
                        {state === 'include' ? '✓' : state === 'exclude' ? '✕' : '•'}
                      </span>
                      <span className="tag-chip__label">{tag}</span>
                    </button>
                  );
                })}
              </div>

              <div className="score-filters">
                <div className="score-filter-row">
                  <span className="score-filter-label">Video score</span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    placeholder="Min"
                    value={scoreFilters.video.min ?? ''}
                    onChange={(e) => handleScoreFilterChange('video', 'min', e.target.value)}
                  />
                  <span className="score-filter-separator">to</span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    placeholder="Max"
                    value={scoreFilters.video.max ?? ''}
                    onChange={(e) => handleScoreFilterChange('video', 'max', e.target.value)}
                  />
                  <button
                    type="button"
                    className="tag-filter-btn score-filter-clear"
                    onClick={() => handleClearScoreFilter('video')}
                    disabled={!isScoreFilterActive('video')}
                  >
                    Clear
                  </button>
                </div>

                <div className="score-filter-row">
                  <span className="score-filter-label">Funscript score</span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    placeholder="Min"
                    value={scoreFilters.funscript.min ?? ''}
                    onChange={(e) => handleScoreFilterChange('funscript', 'min', e.target.value)}
                  />
                  <span className="score-filter-separator">to</span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    placeholder="Max"
                    value={scoreFilters.funscript.max ?? ''}
                    onChange={(e) => handleScoreFilterChange('funscript', 'max', e.target.value)}
                  />
                  <button
                    type="button"
                    className="tag-filter-btn score-filter-clear"
                    onClick={() => handleClearScoreFilter('funscript')}
                    disabled={!isScoreFilterActive('funscript')}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="gallery">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default UnifiedGallery;
